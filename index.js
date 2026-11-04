/**
 * 文件库 / File Library — Host half.
 *
 * ## The model: one read-only original, many workspace copies
 *
 * Every file a user puts into DSH is committed, before any session event is
 * appended, to DSH's immutable content-addressed attachment store below
 * `<DSH_HOME>/attachments/v1` (DSH_HOME defaults to `~/.dsh`). That stored
 * object is the ORIGINAL: it is named by the sha256 of its own bytes, written
 * read-only, and never rewritten. A library record therefore always points at
 * exactly one original ("readonlyPath"), even when the same upload appears in
 * several conversations.
 *
 * Separately, the agent may copy such a file into a workspace directory and
 * rewrite it. Those copies are mutable and live outside the store, so the
 * record carries them as a separate list of COPY observations, each flagged:
 *   - `identical` — same basename AND same sha256 as the original;
 *   - `modified`  — same basename, different bytes (content changed), so it is
 *                   a derived artifact, never the source of truth.
 * Scanning never writes to workspaces; it only stats/hashes within bounds.
 *
 * ## Where originals actually live (verified in the installed build)
 *
 * `@deepseek-ai/dsh-attachment-local` v-root is `<DSH_HOME>/attachments/v1`
 * and it publishes images at `objects/<xx>/<sha256>` (normalizedImagePath) and
 * generic files at `file-objects/<xx>/<sha256>` with a per-name hard link at
 * `files/<xx>/<sha256>/<name>` (storedFileObjectPath / storedFilePath).
 *
 * IMPORTANT: an image's `attachmentId` digest is the digest of the NORMALIZED
 * image (downscaled to <= normalizedImageMaxBytes, default 4 MiB), not of the
 * uploaded bytes. So for images `attachmentId` often is NOT the sha256 of the
 * file the user picked, and workspace-copy matching for images is only
 * meaningful when the picked file is big enough to be normalized. `sha256`
 * on a record is the digest of whichever store object the id names.
 *
 * Paths are resolved through the live `attachments` service
 * (`fileHostPath`/`imageHostPath`) first and only fall back to the derived
 * layout above when the service cannot answer, so a future layout change
 * degrades to "path unknown" instead of a wrong clickable path.
 *
 * ## Persistence
 *
 * Only genuinely local state is persisted — manual uploads, favorites, the
 * remembered default origin, and the per-session `revision` cache used to skip
 * unchanged logs. Everything else is a derived read model recomputed on scan.
 * State is a single JSON file under `<DSH_HOME>/dsh-file-library/state.json`,
 * written atomically (temp file + rename). The documented `storageDomain`
 * service was considered, but it needs a zod `DomainSpec` (a dependency of its
 * own) and a dedicated storage backend row, so a plugin-owned JSON file with
 * explicit documentation is the deliberate fallback here.
 *
 * ## Transport
 *
 * Routes are served through `ctx.connection.fetch.register(...)`, which is the
 * shipped pattern (see `@deepseek-ai/dsh-session-log-export`): the `/api`
 * prefix belongs to the browser carrier, which applies the Host/Origin fence
 * and browser authentication before any route handler runs. Registering a bare
 * `webServer.register` path would bypass that admission, so this plugin keeps
 * every route under `/api/` and lets the carrier authenticate them.
 *
 * Agent-facing `file_library` calls the same operations as the HTTP handlers.
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, resolve, sep } from 'node:path'

/** Stable Cordis plugin name (the bundle patch row id may differ). */
export const name = 'file-library'

/** Hard dependencies: without these the plugin contributes nothing. */
export const inject = ['sessionPersistence', 'attachments', 'webServer', 'connection']

/** Route prefix every browser request uses. The carrier owns `/api`. */
export const ROUTE_PREFIX = '/api/dsh-file-library'

/**
 * Built-in limits. Deliberately NOT exported as `Config`: a plugin that exports
 * `Config` must supply a real Schemastery schema (`@deepseek-ai/schemastery`),
 * which a workspace-linked bundle cannot resolve, and an invalid schema makes
 * Cordis fail activation with "Cannot read properties of undefined (reading
 * 'validate')". The row's `config` object is merged over these defaults at
 * runtime instead, so every key stays overridable from `cordis.patch.yml`.
 */
const DEFAULTS = {
  /** Skip workspace files larger than this when hashing. */
  maxScanFileBytes: 64 * 1024 * 1024,
  /** Hard cap on files visited per workspace scan. */
  maxScannedFiles: 20000,
  /** Hard cap on workspace copies reported for one library record. */
  maxCopiesPerItem: 20,
  /** Largest accepted manual upload, in bytes (base64-decoded size). */
  maxUploadBytes: 64 * 1024 * 1024,
  /** Maximum nesting depth walked per workspace. */
  maxScanDepth: 12,
  /** Directories never descended into. */
  skipDirectories: ['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache'],
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for the scratch harness; not part of the plugin API)
// ---------------------------------------------------------------------------

/** Safe media-type guess from a filename, used only when nothing better exists. */
const MEDIA_TYPES_BY_EXTENSION = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.json': 'application/json', '.txt': 'text/plain',
  '.md': 'text/markdown', '.csv': 'text/csv', '.html': 'text/html', '.xml': 'application/xml',
  '.zip': 'application/zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/**
 * Guess a media type from a display name.
 * @param {string} fileName
 * @returns {string} a media type, or 'application/octet-stream'.
 */
export function guessMediaType(fileName) {
  const extension = extname(String(fileName ?? '')).toLowerCase()
  return MEDIA_TYPES_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

/** Whether a media type names one of the four raster kinds DSH admits as images. */
export function isImageMediaType(mediaType) {
  return mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif'
}

/**
 * Extract the hex digest from an attachment id of the form `sha256:<hex>`.
 * @param {unknown} attachmentId
 * @returns {string | undefined} lowercase hex digest, or undefined when malformed.
 */
export function digestOfAttachmentId(attachmentId) {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(String(attachmentId ?? ''))
  return match?.[1]
}

/**
 * Resolve the attachment-store candidate paths for one digest without any I/O.
 *
 * Mirrors `@deepseek-ai/dsh-attachment-local` `lib/index.js`:
 * `normalizedImagePath` => `objects/<xx>/<sha256>`,
 * `storedFileObjectPath` => `file-objects/<xx>/<sha256>`.
 *
 * @param {string} storeRoot absolute `<DSH_HOME>/attachments/v1`
 * @param {string} hex sha256 hex digest
 * @returns {{image: string, file: string}} candidate paths per object family
 */
export function attachmentObjectPaths(storeRoot, hex) {
  const prefix = String(hex).slice(0, 2)
  return {
    image: join(storeRoot, 'objects', prefix, hex),
    file: join(storeRoot, 'file-objects', prefix, hex),
  }
}

/**
 * Walk the content blocks of one session event and collect attachment references.
 *
 * Content carriers mirror the shipped session-log exporter: `data.content` for
 * user messages, and for `tool/result` etc. `data.message.content`; block-end
 * stream chunks of completed assistant blocks are not user imports so they are
 * ignored. Only blocks whose `type` is `image` or `file` with a usable
 * `attachment.attachmentId` are returned.
 *
 * @param {object} event a session event envelope ({type, seq, time, data})
 * @returns {Array<{attachmentId: string, kind: 'image'|'file', name?: string, bytes?: number,
 *   mediaType?: string, width?: number, height?: number}>}
 */
export function extractAttachments(event) {
  if (event === null || typeof event !== 'object') return []
  const type = event.type
  // Accept only first-party carriers that can carry a user import.
  const data = event.data
  if (data === null || typeof data !== 'object') return []
  let content
  if (type === 'user/message') content = data.content
  else if (type === 'tool/result' || type === 'team/message/queued') content = data.message?.content
  else return []
  if (!Array.isArray(content)) return []

  const found = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const attachment = block.attachment
    if (block.type !== 'image' && block.type !== 'file') continue
    if (attachment === null || typeof attachment !== 'object') continue
    const attachmentId = String(attachment.attachmentId ?? '')
    if (!/^sha256:[a-f0-9]{64}$/u.test(attachmentId)) continue
    /** @type {{attachmentId: string, kind: 'image'|'file', name?: string, bytes?: number,
     *   mediaType?: string, width?: number, height?: number}} */
    const ref = { attachmentId, kind: block.type === 'image' ? 'image' : 'file' }
    if (typeof attachment.name === 'string' && attachment.name !== '') ref.name = attachment.name
    if (Number.isFinite(attachment.bytes)) ref.bytes = attachment.bytes
    if (typeof attachment.mediaType === 'string') ref.mediaType = attachment.mediaType
    if (Number.isFinite(attachment.width)) ref.width = attachment.width
    if (Number.isFinite(attachment.height)) ref.height = attachment.height
    found.push(ref)
  }
  return found
}

/**
 * Fold a whole session's events into per-attachment usage records.
 *
 * Aggregation rules: the first non-empty `name` wins; `bytes`/`mediaType`/
 * `width`/`height` come from the richest block seen; the upload time is the
 * earliest carrier event `time`; each session appears once with the earliest
 * time it referenced the file.
 *
 * @param {readonly object[]} events session events in seq order
 * @param {{id: string, title?: string, cwd?: string}} session session identity
 * @returns {Array<object>} usage entries keyed by attachmentId
 */
export function summarizeSessionAttachments(events, session) {
  const byId = new Map()
  for (const event of events) {
    for (const ref of extractAttachments(event)) {
      let entry = byId.get(ref.attachmentId)
      if (entry === undefined) {
        entry = {
          attachmentId: ref.attachmentId,
          kind: ref.kind,
          name: '',
          bytes: 0,
          mediaType: '',
          width: 0,
          height: 0,
          at: Number.isFinite(event.time) ? event.time : session.createdAt ?? 0,
          sessions: [],
        }
        byId.set(ref.attachmentId, entry)
      }
      if (entry.name === '' && typeof ref.name === 'string') entry.name = ref.name
      if (entry.kind !== 'image' && ref.kind === 'image') entry.kind = 'image'
      if (typeof ref.bytes === 'number' && ref.bytes > entry.bytes) entry.bytes = ref.bytes
      if (typeof ref.mediaType === 'string' && ref.mediaType !== '') entry.mediaType = ref.mediaType
      if (typeof ref.width === 'number' && ref.width > entry.width) entry.width = ref.width
      if (typeof ref.height === 'number' && ref.height > entry.height) entry.height = ref.height
      const at = Number.isFinite(event.time) ? event.time : entry.at
      if (at < entry.at) entry.at = at
      const usage = entry.sessions.find((candidate) => candidate.id === session.id)
      if (usage === undefined) {
        entry.sessions.push({ id: session.id, title: session.title, cwd: session.cwd, at })
      } else if (at < usage.at) usage.at = at
    }
  }
  return [...byId.values()]
}

/**
 * Merge several sessions' usage summaries into one library map.
 * @param {readonly object[]} summaries one per session
 * @returns {Map<string, object>} attachmentId -> merged record fragments
 */
export function mergeAttachmentSummaries(summaries) {
  const merged = new Map()
  for (const summary of summaries) {
    for (const entry of summary) {
      const current = merged.get(entry.attachmentId)
      if (current === undefined) {
        merged.set(entry.attachmentId, {
          ...entry,
          sessions: [...entry.sessions],
        })
        continue
      }
      if (current.name === '' && entry.name !== '') current.name = entry.name
      if (current.kind !== 'image' && entry.kind === 'image') current.kind = 'image'
      if (entry.bytes > current.bytes) current.bytes = entry.bytes
      if (entry.mediaType !== '') current.mediaType = entry.mediaType
      if (entry.width > current.width) current.width = entry.width
      if (entry.height > current.height) current.height = entry.height
      if (entry.at < current.at) current.at = entry.at
      for (const usage of entry.sessions) current.sessions.push(usage)
    }
  }
  return merged
}

/**
 * Build the `{size, basename}` lookup the copy matcher needs from a file scan.
 * @param {readonly {path: string, workspaceId: string, size: number, sha256?: string}[]} files
 * @returns {Map<string, object[]>} key `size\u0000basename` -> candidate files
 */
export function indexScannedFiles(files) {
  const index = new Map()
  for (const file of files) {
    const key = `${file.size}\u0000${basename(file.path).toLowerCase()}`
    const bucket = index.get(key)
    if (bucket === undefined) index.set(key, [file])
    else bucket.push(file)
  }
  return index
}

/**
 * Match one library record against scanned workspace files.
 *
 * An `identical` copy has the same sha256. A `modified` copy shares the
 * basename but has different bytes, which is the "copied then rewritten" case.
 * When the original digest is unknown (an image whose id digests its normalized
 * form), only basename matches are reported, as `modified-with-unknown-origin`.
 *
 * @param {{sha256?: string, name?: string, kind?: string}} item the library record
 * @param {Map<string, object[]>} index from {@link indexScannedFiles}
 * @param {number} maxCopies cap on returned copies
 * @returns {Array<{path: string, workspaceId: string, state: string, size: number}>}
 */
export function matchWorkspaceCopies(item, index, maxCopies = DEFAULTS.maxCopiesPerItem) {
  const copies = []
  const seen = new Set()
  const push = (file, state) => {
    if (copies.length >= maxCopies || seen.has(file.path)) return
    seen.add(file.path)
    copies.push({ path: file.path, workspaceId: file.workspaceId, state, size: file.size })
  }

  const fileName = typeof item.name === 'string' && item.name !== '' ? item.name : undefined

  // 1. Exact content matches by digest (independent of name and size bucket).
  if (typeof item.sha256 === 'string' && item.sha256 !== '') {
    for (const candidate of index.values()) {
      for (const file of candidate) {
        if (file.sha256 === item.sha256) push(file, 'identical')
      }
    }
  }

  // 2. Basename matches: the same display name with different bytes, or an
  //    exact name match we could not verify by digest.
  if (fileName !== undefined) {
    for (const bucket of index.values()) {
      for (const file of bucket) {
        if (basename(file.path).toLowerCase() !== fileName.toLowerCase()) continue
        if (file.sha256 === undefined) push(file, 'modified-with-unknown-origin')
        else if (typeof item.sha256 === 'string' && item.sha256 !== '' && file.sha256 === item.sha256) push(file, 'identical')
        else if (typeof item.sha256 === 'string' && item.sha256 !== '') push(file, 'modified')
        else push(file, 'modified-with-unknown-origin')
      }
    }
  }

  return copies
}

/**
 * Filter and rank library records for a query.
 * @param {readonly object[]} items library records
 * @param {{query?: string, kind?: string, origin?: string, favorite?: boolean}} filter
 * @returns {object[]} matching records, favorite-first then newest-first
 */
export function filterItems(items, filter = {}) {
  const needle = String(filter.query ?? '').trim().toLowerCase()
  const kind = filter.kind === '' || filter.kind === undefined ? undefined : filter.kind
  const origin = filter.origin === '' || filter.origin === undefined ? undefined : filter.origin
  const matched = []
  for (const item of items) {
    if (kind !== undefined && item.kind !== kind) continue
    if (origin !== undefined && item.origin !== origin) continue
    if (filter.favorite === true && item.favorite !== true) continue
    if (needle !== '') {
      const haystack = [
        item.name,
        item.mediaType,
        item.sha256,
        item.readonlyPath,
        String(item.attachmentId ?? ''),
        ...(item.sessions ?? []).map((session) => `${session.title ?? ''} ${session.cwd ?? ''}`),
        ...(item.copies ?? []).map((copy) => copy.path),
      ].join(' ').toLowerCase()
      if (!haystack.includes(needle)) continue
    }
    matched.push(item)
  }
  matched.sort((left, right) => {
    if (Boolean(left.favorite) !== Boolean(right.favorite)) return left.favorite ? -1 : 1
    return (right.createdAt ?? 0) - (left.createdAt ?? 0)
  })
  return matched
}

/** @returns {{items: number, images: number, files: number, manual: number, withCopies: number, bytes: number}} */
export function summarizeTotals(items) {
  const totals = { items: items.length, images: 0, files: 0, manual: 0, withCopies: 0, bytes: 0 }
  for (const item of items) {
    if (item.kind === 'image') totals.images += 1
    else totals.files += 1
    if (item.origin === 'manual') totals.manual += 1
    if ((item.copies ?? []).length > 0) totals.withCopies += 1
    totals.bytes += Number(item.bytes) || 0
  }
  return totals
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Answer one JSON request.
 * @param {number} status
 * @param {unknown} body
 * @returns {Response}
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Answer a structured failure the browser and the agent can both read. */
function failure(status, code, message, details) {
  return json(status, { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } })
}

/**
 * Read and validate a JSON request body no larger than `limit` bytes.
 * @param {Request} request
 * @param {number} limit
 * @returns {Promise<{value?: unknown, response?: Response}>}
 */
async function readJsonBody(request, limit) {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > limit) {
    return { response: failure(413, 'BODY_TOO_LARGE', `Request body exceeds ${limit} bytes.`) }
  }
  let text
  try {
    text = await request.text()
  } catch (error) {
    return { response: failure(400, 'BODY_UNREADABLE', `Could not read request body: ${describe(error)}`) }
  }
  if (Buffer.byteLength(text, 'utf8') > limit) {
    return { response: failure(413, 'BODY_TOO_LARGE', `Request body exceeds ${limit} bytes.`) }
  }
  if (text.trim() === '') return { value: {} }
  try {
    return { value: JSON.parse(text) }
  } catch (error) {
    return { response: failure(400, 'BODY_NOT_JSON', `Request body is not JSON: ${describe(error)}`) }
  }
}

/** Normalize any thrown value into a message string. */
function describe(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Host half entry point.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} rawConfig the row's `config` object
 */
export function apply(ctx, rawConfig = {}) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const logger = ctx.logger ?? { warn: () => {}, info: () => {}, error: () => {} }
  const warn = (message, error) => {
    try {
      logger.warn(error instanceof Error ? error : new Error(`${message}${error === undefined ? '' : `: ${describe(error)}`}`))
    } catch {
      /* logging must never break a request */
    }
  }

  const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const storeRoot = join(dshHome, 'attachments', 'v1')
  const stateDir = join(dshHome, 'dsh-file-library')
  const statePath = join(stateDir, 'state.json')

  // --- durable plugin state ------------------------------------------------

  /** @type {{version: number, manual: Record<string, object>, favorites: string[],
   *   scan: {sessions: Record<string, string>, scannedAt: number|null}}} */
  const state = { version: 1, manual: {}, favorites: [], scan: { sessions: {}, scannedAt: null } }

  let stateLoading
  let writeChain = Promise.resolve()

  /** Concurrent callers must await the same disk read before touching state. */
  function loadState() {
    return stateLoading ??= (async () => {
      try {
        const text = await readFile(statePath, 'utf8')
        const parsed = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object') {
          if (parsed.manual !== null && typeof parsed.manual === 'object' && !Array.isArray(parsed.manual)) {
            state.manual = Object.fromEntries(Object.entries(parsed.manual).filter(([id, entry]) =>
              digestOfAttachmentId(id) !== undefined && entry?.attachmentId === id && typeof entry.name === 'string'))
          }
          if (Array.isArray(parsed.favorites)) state.favorites = parsed.favorites.filter((id) => digestOfAttachmentId(id) !== undefined)
          if (parsed.scan !== null && typeof parsed.scan === 'object' && typeof parsed.scan.sessions === 'object' && parsed.scan.sessions !== null) {
            state.scan.sessions = Object.fromEntries(Object.entries(parsed.scan.sessions).filter(([, cached]) =>
              typeof cached?.revision === 'string' && Array.isArray(cached.summary) && cached.summary.every((entry) =>
                digestOfAttachmentId(entry?.attachmentId) !== undefined && Array.isArray(entry.sessions) && entry.sessions.every((usage) => typeof usage?.id === 'string'))))
            state.scan.scannedAt = typeof parsed.scan.scannedAt === 'number' ? parsed.scan.scannedAt : null
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') warn('file-library: unreadable state file, starting empty', error)
      }
    })()
  }

  /** Serialize state writes and publish them atomically. */
  function persistState() {
    const snapshot = JSON.stringify(state, null, 0)
    writeChain = writeChain
      .catch(() => {})
      .then(async () => {
        await mkdir(stateDir, { recursive: true })
        const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`
        await writeFile(temporary, snapshot, 'utf8')
        await rename(temporary, statePath)
      })
    return writeChain
  }

  // --- read model ----------------------------------------------------------

  /** In-memory derived view; rebuilt by `rescan()`. */
  let items = []
  let generatedAt = 0
  let lastScan = { scannedSessions: 0, reusedSessions: 0, scannedFiles: 0, byWorkspace: {}, truncated: false }
  let scanPromise = null
  let dataRevision = 0

  /** Share in-flight work; a committed upload during a scan requires another pass. */
  function rescan() {
    if (scanPromise !== null) return scanPromise
    scanPromise = (async () => {
      let revision
      do {
        revision = dataRevision
        await rebuildReadModel()
      } while (revision !== dataRevision)
      return snapshot()
    })().finally(() => { scanPromise = null })
    return scanPromise
  }

  /**
   * Resolve the read-only original path for one attachment reference.
   * Prefers the live service (which owns the layout), then derived candidates.
   *
   * @param {{attachmentId: string, kind: string}} ref
   * @returns {Promise<{readonlyPath: string|undefined, exists: boolean, family: string}>}
   */
  async function resolveReadonlyPath(ref) {
    const hex = digestOfAttachmentId(ref.attachmentId)
    const service = ctx.get('attachments')
    const serviceRef = ref.kind === 'image'
      ? { attachmentId: ref.attachmentId, mediaType: ref.mediaType ?? 'image/png', bytes: ref.bytes ?? 0, width: ref.width ?? 0, height: ref.height ?? 0 }
      : { attachmentId: ref.attachmentId, name: ref.name ?? 'file', bytes: ref.bytes ?? 0 }
    let fromService
    try {
      if (service !== undefined) {
        fromService = ref.kind === 'image' ? service.imageHostPath(serviceRef) : service.fileHostPath(serviceRef)
      }
    } catch (error) {
      // An invalid/incomplete ref (e.g. a missing name) still has a digest; fall through to candidates.
      warn(`file-library: ${ref.kind}HostPath failed for ${ref.attachmentId}`, error)
    }
    const candidates = []
    if (typeof fromService === 'string' && fromService !== '') candidates.push({ path: fromService, family: ref.kind })
    if (hex !== undefined) {
      const derived = attachmentObjectPaths(storeRoot, hex)
      candidates.push({ path: derived.image, family: 'image' }, { path: derived.file, family: 'file' })
    }
    for (const candidate of candidates) {
      try {
        const info = await stat(candidate.path)
        if (info.isFile()) return { readonlyPath: candidate.path, exists: true, family: candidate.family }
      } catch {
        /* try the next candidate */
      }
    }
    return {
      readonlyPath: candidates[0]?.path,
      exists: false,
      family: candidates[0]?.family ?? ref.kind,
    }
  }

  /** Read one session's events (read handle) and return {header, events}. */
  async function readSessionEvents(sessionId) {
    const persistence = ctx.sessionPersistence
    const handle = await persistence.open(sessionId, 'read')
    try {
      const { events } = await handle.read(0, undefined)
      return { header: handle.header, events: events ?? [] }
    } finally {
      await handle.close().catch((error) => warn('file-library: closing session handle failed', error))
    }
  }

  /** Collect titles for the given sessions in one query, tolerating absence. */
  async function readTitles(sessionIds) {
    const titles = new Map()
    const sessionQuery = ctx.get('sessionQuery')
    if (sessionQuery === undefined || sessionIds.length === 0) return titles
    try {
      const results = await sessionQuery.readTitleSnapshots(sessionIds)
      for (const result of results ?? []) {
        if (result?.status === 'fulfilled' && typeof result.value?.title?.title === 'string') {
          titles.set(String(result.sessionId), result.value.title.title)
        }
      }
    } catch (error) {
      warn('file-library: reading session titles failed', error)
    }
    return titles
  }

  /** Enumerate registered workspace roots; falls back to the default directory. */
  function listWorkspaceRoots() {
    const roots = []
    try {
      const registry = ctx.get('workspaceRegistry')
      for (const workspace of registry?.list() ?? []) {
        if (typeof workspace?.path === 'string' && workspace.path !== '') {
          roots.push({ id: String(workspace.id ?? workspace.path), path: workspace.path, title: workspace.title })
        }
      }
    } catch (error) {
      warn('file-library: listing workspaces failed', error)
    }
    if (roots.length === 0) {
      const directory = ctx.get('workingDirectory')?.defaultDirectory
      if (typeof directory === 'string' && directory !== '') roots.push({ id: directory, path: directory })
    }
    // De-duplicate by resolved path (a workspace may be registered twice).
    const seen = new Set()
    return roots.filter((root) => {
      const key = resolve(root.path).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /**
   * Bounded recursive walk of one workspace root, hashing eligible files.
   * Skips VCS/dependency directories and oversized files; stops at
   * `maxScannedFiles`. Never writes.
   */
  async function scanWorkspace(root, budget) {
    const skip = new Set((config.skipDirectories ?? DEFAULTS.skipDirectories).map((entry) => String(entry).toLowerCase()))
    const files = []
    const stack = [{ path: resolve(root.path), depth: 0 }]
    while (stack.length > 0 && budget.remaining > 0) {
      const current = stack.pop()
      let entries
      try {
        entries = await readdir(current.path, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (budget.remaining <= 0) break
        const childPath = join(current.path, entry.name)
        if (entry.isDirectory()) {
          if (skip.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) continue
          if (current.depth + 1 > (config.maxScanDepth ?? DEFAULTS.maxScanDepth)) continue
          stack.push({ path: childPath, depth: current.depth + 1 })
          continue
        }
        if (!entry.isFile()) continue
        budget.remaining -= 1
        budget.visited += 1
        let info
        try {
          info = await stat(childPath)
        } catch {
          continue
        }
        if (!info.isFile()) continue
        if (info.size > (config.maxScanFileBytes ?? DEFAULTS.maxScanFileBytes)) {
          files.push({ path: childPath, workspaceId: root.id, size: info.size })
          continue
        }
        try {
          const data = await readFile(childPath)
          files.push({ path: childPath, workspaceId: root.id, size: data.byteLength, sha256: digestOfBytes(data) })
        } catch {
          files.push({ path: childPath, workspaceId: root.id, size: info.size })
        }
      }
    }
    return files
  }

  /** Scan every registered workspace, returning a digest-indexed file table. */
  async function scanWorkspaces() {
    const roots = listWorkspaceRoots()
    const budget = { remaining: config.maxScannedFiles ?? DEFAULTS.maxScannedFiles, visited: 0 }
    const all = []
    const byWorkspace = {}
    for (const root of roots) {
      if (budget.remaining <= 0) break
      const files = await scanWorkspace(root, budget)
      byWorkspace[root.id] = files.length
      all.push(...files)
    }
    return { files: all, byWorkspace, truncated: budget.remaining <= 0 }
  }

  /** Rebuild the whole read model: session events + workspace copies + manual uploads. */
  async function rebuildReadModel() {
    await loadState()
    const summaries = []
    let scannedSessions = 0
    let reusedSessions = 0

    let snapshots = []
    try {
      snapshots = [...(await ctx.sessionPersistence.list())]
    } catch (error) {
      warn('file-library: listing stored sessions failed', error)
      throw error
    }

    const titles = await readTitles(snapshots.map((snapshot) => snapshot.header.id).filter((id) => id !== undefined))

    for (const snapshot of snapshots) {
      const header = snapshot.header
      const sessionId = String(header.id)
      const revision = String(snapshot.revision ?? '')
      const cached = state.scan.sessions[sessionId]
      if (cached !== undefined && revision !== '' && cached.revision === revision && cached.summary !== undefined) {
        summaries.push(cached.summary)
        reusedSessions += 1
        continue
      }
      try {
        const revisionBeforeRead = dataRevision
        const { header: readHeader, events } = await readSessionEvents(header.id)
        const summary = summarizeSessionAttachments(events, {
          id: sessionId,
          title: titles.get(sessionId),
          cwd: readHeader?.cwd ?? header.cwd,
          createdAt: header.createdAt,
        })
        summaries.push(summary)
        if (revisionBeforeRead === dataRevision) state.scan.sessions[sessionId] = { revision, summary }
        scannedSessions += 1
      } catch (error) {
        warn(`file-library: reading session ${sessionId} failed`, error)
        if (cached?.summary !== undefined) summaries.push(cached.summary)
      }
    }

    // Titles can change without an attachment-log revision. Refresh them in a
    // copied projection so reusable cached summaries keep their original data.
    const titled = summaries.map((summary) => summary.map((entry) => ({
      ...entry,
      sessions: entry.sessions.map((usage) => titles.has(usage.id) ? { ...usage, title: titles.get(usage.id) } : usage),
    })))

    const merged = mergeAttachmentSummaries(titled)
    const workspace = await scanWorkspaces()
    const fileIndex = indexScannedFiles(workspace.files)

    const favorites = new Set(state.favorites)
    /** @type {object[]} */
    const built = []

    for (const entry of merged.values()) {
      const resolvedPath = await resolveReadonlyPath(entry)
      const sha256 = digestOfAttachmentId(entry.attachmentId) ?? ''
      const name = entry.name !== '' ? entry.name : basename(resolvedPath.readonlyPath ?? '') || entry.attachmentId
      /** @type {object} */
      const record = {
        id: entry.attachmentId,
        attachmentId: entry.attachmentId,
        origin: 'session',
        kind: entry.kind,
        name,
        bytes: entry.bytes,
        mediaType: entry.mediaType !== '' ? entry.mediaType : (entry.kind === 'image' ? '' : guessMediaType(name)),
        width: entry.kind === 'image' ? entry.width : undefined,
        height: entry.kind === 'image' ? entry.height : undefined,
        sha256,
        readonlyPath: resolvedPath.readonlyPath,
        readonlyExists: resolvedPath.exists,
        createdAt: entry.at,
        favorite: favorites.has(entry.attachmentId),
        sessions: entry.sessions
          .map((usage) => ({ id: usage.id, title: usage.title, cwd: usage.cwd, at: usage.at }))
          .sort((left, right) => left.at - right.at),
        copies: matchWorkspaceCopies({ sha256, name, kind: entry.kind }, fileIndex, config.maxCopiesPerItem ?? DEFAULTS.maxCopiesPerItem),
      }
      built.push(record)
    }

    for (const manual of Object.values(state.manual)) {
      const resolvedPath = await resolveReadonlyPath({
        attachmentId: manual.attachmentId,
        kind: manual.kind ?? 'file',
        name: manual.name,
        bytes: manual.bytes,
        mediaType: manual.mediaType,
      })
      const sha256 = digestOfAttachmentId(manual.attachmentId) ?? manual.sha256 ?? ''
      const existingIndex = built.findIndex((entry) => entry.id === manual.attachmentId)
      const existing = built[existingIndex]
      const record = {
        id: manual.attachmentId,
        attachmentId: manual.attachmentId,
        origin: 'manual',
        kind: existing?.kind === 'image' ? 'image' : manual.kind ?? 'file',
        name: manual.name || existing?.name || manual.attachmentId,
        bytes: manual.bytes ?? existing?.bytes ?? 0,
        mediaType: manual.mediaType || existing?.mediaType || guessMediaType(manual.name),
        width: manual.width ?? existing?.width,
        height: manual.height ?? existing?.height,
        sha256,
        readonlyPath: resolvedPath.exists ? resolvedPath.readonlyPath : existing?.readonlyPath ?? resolvedPath.readonlyPath,
        readonlyExists: resolvedPath.exists || existing?.readonlyExists === true,
        createdAt: Math.min(manual.createdAt ?? existing?.createdAt ?? 0, existing?.createdAt ?? manual.createdAt ?? 0),
        favorite: favorites.has(manual.attachmentId),
        sessions: existing?.sessions ?? [],
        copies: matchWorkspaceCopies({ sha256, name: manual.name, kind: manual.kind }, fileIndex, config.maxCopiesPerItem ?? DEFAULTS.maxCopiesPerItem),
      }
      if (existingIndex < 0) built.push(record)
      else built[existingIndex] = record
    }

    // A favorite request can finish while paths are being resolved above.
    const currentFavorites = new Set(state.favorites)
    items = built.map((entry) => ({ ...entry, favorite: currentFavorites.has(entry.id) }))
    generatedAt = Date.now()
    lastScan = {
      scannedSessions,
      reusedSessions,
      scannedFiles: workspace.files.length,
      byWorkspace: workspace.byWorkspace,
      truncated: workspace.truncated,
    }
    state.scan.scannedAt = generatedAt
    await persistState()
    return snapshot()
  }

  /** The current read model in wire form. */
  function snapshot(options = {}) {
    const filtered = options.unfiltered === true ? items : filterItems(items, options)
    return {
      ok: true,
      generatedAt,
      totals: summarizeTotals(items),
      scan: lastScan,
      count: filtered.length,
      items: filtered,
    }
  }

  /** Fetch one record by attachment id. */
  function findRecord(id) {
    return items.find((item) => item.id === id)
  }

  /**
   * Save one manual upload into the immutable store, then remember it.
   * @param {{name: string, mediaType?: string, dataBase64: string}} input
   */
  async function uploadManual(input) {
    await loadState()
    const attachments = ctx.get('attachments')
    if (attachments === undefined) {
      return { status: 503, body: { ok: false, error: { code: 'ATTACHMENTS_UNAVAILABLE', message: 'The attachments service is not mounted.' } } }
    }
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    if (name === '') return { status: 400, body: { ok: false, error: { code: 'NAME_REQUIRED', message: 'A file name is required.' } } }
    const dataBase64 = typeof input?.dataBase64 === 'string' ? input.dataBase64.replace(/^data:[^,]*,/u, '').replace(/\s/gu, '') : ''
    if (dataBase64 === '') return { status: 400, body: { ok: false, error: { code: 'DATA_REQUIRED', message: 'dataBase64 is required.' } } }
    let data
    try {
      // Buffer.from(base64) silently ignores invalid bytes and trailing junk.
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2,3})?$/u.test(dataBase64)) throw new Error('Invalid base64 encoding')
      data = Buffer.from(dataBase64, 'base64')
      if (data.toString('base64').replace(/=+$/u, '') !== dataBase64.replace(/=+$/u, '')) throw new Error('Invalid base64 encoding')
    } catch (error) {
      return { status: 400, body: { ok: false, error: { code: 'DATA_INVALID', message: `dataBase64 is not valid base64: ${describe(error)}` } } }
    }
    if (data.byteLength === 0) return { status: 400, body: { ok: false, error: { code: 'DATA_EMPTY', message: 'The uploaded file is empty.' } } }
    const limit = config.maxUploadBytes ?? DEFAULTS.maxUploadBytes
    if (data.byteLength > limit) {
      return { status: 413, body: { ok: false, error: { code: 'UPLOAD_TOO_LARGE', message: `Upload exceeds the ${limit} byte limit.`, details: { bytes: data.byteLength, limit } } } }
    }

    const declared = typeof input?.mediaType === 'string' && input.mediaType !== '' ? input.mediaType : guessMediaType(name)
    const asImage = isImageMediaType(declared)
    let ref
    try {
      // Accepted raster images follow DSH's image normalization and their id
      // names the normalized bytes. Generic files retain their original bytes.
      ref = asImage ? await attachments.saveImage({ data: new Uint8Array(data), mediaType: declared, name }) : await attachments.saveFile({ data: new Uint8Array(data), name })
    } catch (error) {
      // An image that fails image admission (dimensions/format) falls back to verbatim storage.
      if (asImage) {
        try {
          ref = await attachments.saveFile({ data: new Uint8Array(data), name })
        } catch (fallbackError) {
          return { status: 502, body: { ok: false, error: { code: 'SAVE_FAILED', message: `The attachment store refused the upload: ${describe(fallbackError)}` } } }
        }
      } else {
        return { status: 502, body: { ok: false, error: { code: 'SAVE_FAILED', message: `The attachment store refused the upload: ${describe(error)}` } } }
      }
    }

    const attachmentId = String(ref.attachmentId)
    const hex = digestOfAttachmentId(attachmentId) ?? ''
    const entry = {
      attachmentId,
      kind: ref.mediaType !== undefined ? 'image' : 'file',
      name: typeof ref.name === 'string' && ref.name !== '' ? ref.name : name,
      bytes: Number.isFinite(ref.bytes) ? ref.bytes : data.byteLength,
      mediaType: typeof ref.mediaType === 'string' ? ref.mediaType : declared,
      width: Number.isFinite(ref.width) ? ref.width : undefined,
      height: Number.isFinite(ref.height) ? ref.height : undefined,
      sha256: hex,
      createdAt: Date.now(),
    }
    entry.createdAt = state.manual[attachmentId]?.createdAt ?? entry.createdAt
    state.manual[attachmentId] = entry
    dataRevision += 1
    await persistState()
    await rescan()
    return { status: 201, body: { ok: true, item: findRecord(attachmentId) ?? entry, generatedAt } }
  }

  /** Toggle/set one record's favorite flag and persist it. */
  async function setFavorite(id, favorite) {
    await loadState()
    const known = findRecord(id) !== undefined || state.manual[id] !== undefined
    if (!known) return { status: 404, body: { ok: false, error: { code: 'NOT_FOUND', message: `No library record for ${id}.` } } }
    const set = new Set(state.favorites)
    if (favorite === true) set.add(id)
    else set.delete(id)
    state.favorites = [...set]
    dataRevision += 1
    await persistState()
    // The latest concurrent request owns the stored flag.
    for (const item of items) if (item.id === id) item.favorite = state.favorites.includes(id)
    return { status: 200, body: { ok: true, id, favorite: favorite === true } }
  }

  /** Stream one stored object's bytes to the browser, confined to the store. */
  async function readRaw(id) {
    if (generatedAt === 0) await rescan()
    const record = findRecord(id)
    if (record === undefined) return failure(404, 'NOT_FOUND', `No library record for ${id}.`)
    // The post-commit feed publishes records without doing I/O. Resolve their
    // paths on demand so a new upload can be previewed / attached immediately.
    if (record.readonlyPath === undefined || record.readonlyExists === false) {
      const resolvedPath = await resolveReadonlyPath(record)
      record.readonlyPath = resolvedPath.readonlyPath
      record.readonlyExists = resolvedPath.exists
    }
    if (record.readonlyPath === undefined) return failure(404, 'NO_PATH', 'This record has no readable stored object.')

    // Confinement: the resolved path must stay inside the plugin's own store root.
    const target = resolve(record.readonlyPath)
    const root = resolve(storeRoot)
    if (target !== root && !target.startsWith(root + sep)) {
      return failure(403, 'OUTSIDE_STORE', 'Refusing to read a path outside the attachment store.')
    }
    try {
      const data = await readFile(target)
      return new Response(data, {
        status: 200,
        headers: {
          'content-type': record.mediaType !== '' ? record.mediaType : guessMediaType(record.name),
          'content-length': String(data.byteLength),
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(record.name)}`,
          'cache-control': 'private, max-age=3600',
          'x-content-type-options': 'nosniff',
        },
      })
    } catch (error) {
      return failure(404, 'UNREADABLE', `Stored object could not be read: ${describe(error)}`)
    }
  }

  // --- lifecycle -----------------------------------------------------------

  ctx.effect(() => {
    let disposed = false
    void (async () => {
      await loadState()
      if (disposed) return
      try {
        await rescan()
      } catch (error) {
        warn('file-library: initial scan failed', error)
      }
    })()
    return () => {
      disposed = true
    }
  }, 'file-library: initial scan')

  // Keep the index fresh during a session: a committed user message that
  // carries a new attachment is folded into the live read model immediately, so
  // the page and the tool see an upload without waiting for a full rescan.
  // `session/event` is the post-commit append feed (see the `session/event`
  // Event contract); the handler is intentionally non-async because the feed is
  // fire-and-forget and must never delay a commit.
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event === null || typeof event !== 'object') return
    if (event.type !== 'user/message' && event.type !== 'tool/result' && event.type !== 'team/message/queued') return
    const refs = extractAttachments(event)
    if (refs.length === 0) return
    dataRevision += 1
    const sessionId = String(session?.id ?? '')
    const at = Number.isFinite(event.time) ? event.time : Date.now()
    try {
      for (const ref of refs) {
        let item = items.find((candidate) => candidate.id === ref.attachmentId)
        if (item === undefined) {
          item = {
            id: ref.attachmentId,
            attachmentId: ref.attachmentId,
            origin: 'session',
            kind: ref.kind,
            name: ref.name ?? '',
            bytes: ref.bytes ?? 0,
            mediaType: ref.mediaType ?? '',
            width: ref.width,
            height: ref.height,
            sha256: digestOfAttachmentId(ref.attachmentId) ?? '',
            // Resolved by the next full scan; the live event carries no store
            // knowledge and resolving it here would add I/O to the feed.
            readonlyPath: undefined,
            readonlyExists: false,
            createdAt: at,
            favorite: state.favorites.includes(ref.attachmentId),
            sessions: [],
            copies: [],
          }
          items.push(item)
        }
        if (ref.kind === 'image') {
          item.kind = 'image'
          if (typeof ref.mediaType === 'string' && ref.mediaType !== '') item.mediaType = ref.mediaType
          if (Number(ref.width) > (item.width ?? 0)) item.width = ref.width
          if (Number(ref.height) > (item.height ?? 0)) item.height = ref.height
        }
        if ((item.name === undefined || item.name === '') && typeof ref.name === 'string') item.name = ref.name
        if (typeof ref.bytes === 'number' && ref.bytes > (item.bytes ?? 0)) item.bytes = ref.bytes
        if (sessionId !== '' && item.sessions.every((usage) => usage.id !== sessionId)) {
          item.sessions.push({ id: sessionId, title: undefined, cwd: session?.header?.cwd, at })
          item.sessions.sort((left, right) => left.at - right.at)
        }
        if (at < (item.createdAt ?? at)) item.createdAt = at
        // Invalidate the cached scan entry so the next full scan re-derives
        // this session (and so the workspace copies / store path).
        if (sessionId !== '') delete state.scan.sessions[sessionId]
      }
      generatedAt = Date.now()
    } catch (error) {
      warn('file-library: live update failed', error)
    }
  }), 'file-library: live upload feed')

  // --- browser routes (authenticated by the /api carrier) ------------------

  const registerRoute = (route) => {
    const connection = ctx.get('connection')
    if (connection?.fetch?.register === undefined) {
      warn('file-library: connection.fetch is unavailable; browser routes are not registered')
      return () => {}
    }
    try {
      return connection.fetch.register({ ...route, fetch: async (request) => {
        try {
          return await route.fetch(request)
        } catch (error) {
          warn(`file-library: request ${route.path} failed`, error)
          return failure(500, 'REQUEST_FAILED', describe(error))
        }
      } })
    } catch (error) {
      warn(`file-library: registering route ${route.path} failed`, error)
      return () => {}
    }
  }

  const disposers = [
    registerRoute({
      path: `${ROUTE_PREFIX}/items`,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const url = new URL(request.url)
        const query = url.searchParams.get('query') ?? ''
        const kind = url.searchParams.get('kind') ?? ''
        const origin = url.searchParams.get('origin') ?? ''
        const favorite = url.searchParams.get('favorite')
        if (items.length === 0 && generatedAt === 0) await rescan()
        const body = snapshot({ query, kind, origin, favorite: favorite === 'true' ? true : undefined })
        if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
        return json(200, body)
      },
    }),
    registerRoute({
      path: `${ROUTE_PREFIX}/upload`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const limit = Math.ceil((config.maxUploadBytes ?? DEFAULTS.maxUploadBytes) * 4 / 3) + 64 * 1024
        const body = await readJsonBody(request, limit)
        if (body.response !== undefined) return body.response
        const result = await uploadManual(body.value)
        return json(result.status, result.body)
      },
    }),
    registerRoute({
      path: `${ROUTE_PREFIX}/refresh`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request, 64 * 1024)
        if (body.response !== undefined) return body.response
        const result = await rescan()
        return json(200, { ok: true, generatedAt: result.generatedAt, totals: result.totals, scan: result.scan, count: result.count, items: result.items })
      },
    }),
    registerRoute({
      path: `${ROUTE_PREFIX}/raw`,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const url = new URL(request.url)
        const id = url.searchParams.get('id') ?? ''
        if (id === '') return failure(400, 'ID_REQUIRED', 'The id query parameter is required.')
        const response = await readRaw(id)
        if (request.method === 'GET') return response
        await response.body?.cancel()
        return new Response(null, { status: response.status, headers: response.headers })
      },
    }),
    registerRoute({
      path: `${ROUTE_PREFIX}/state`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request, 64 * 1024)
        if (body.response !== undefined) return body.response
        const value = body.value ?? {}
        const id = typeof value.id === 'string' ? value.id : ''
        if (id === '') return failure(400, 'ID_REQUIRED', 'The id field is required.')
        if (typeof value.favorite !== 'boolean') return failure(400, 'FAVORITE_REQUIRED', 'The favorite field must be a boolean.')
        const result = await setFavorite(id, value.favorite)
        return json(result.status, result.body)
      },
    }),
    registerRoute({
      path: `${ROUTE_PREFIX}/info`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => json(200, {
        ok: true,
        storeRoot,
        limits: {
          maxUploadBytes: config.maxUploadBytes ?? DEFAULTS.maxUploadBytes,
          maxScanFileBytes: config.maxScanFileBytes ?? DEFAULTS.maxScanFileBytes,
          maxScannedFiles: config.maxScannedFiles ?? DEFAULTS.maxScannedFiles,
          maxCopiesPerItem: config.maxCopiesPerItem ?? DEFAULTS.maxCopiesPerItem,
        },
        generatedAt,
        scan: lastScan,
        totals: summarizeTotals(items),
      }),
    }),
  ]

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        void dispose()
      } catch (error) {
        warn('file-library: route disposer failed', error)
      }
    }
  }, 'file-library: routes')

  // --- agent tool ----------------------------------------------------------

  const tools = ctx.get('tools')
  if (tools === undefined) {
    warn('file-library: tools service is absent; file_library is not registered')
    return
  }

  const toolDisposer = tools.register({
    name: 'file_library',
    description:
      'Search every file the user uploaded to DSH (images and files, all stored sessions plus manual uploads). Returns display name, size, media type, upload time, the session it was used in, its read-only storage path, and any workspace copies (identical or modified).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'find', 'upload'],
          description: 'list: recent library records; find: filter by query; upload: store a file the user supplied as base64.',
        },
        query: { type: 'string', description: 'Case-insensitive text matched against name, media type, sha256, session title/cwd and copy paths.' },
        kind: { type: 'string', enum: ['image', 'file'], description: 'Restrict results to images or generic files.' },
        origin: { type: 'string', enum: ['session', 'manual'], description: 'Restrict to files from conversations or manually uploaded ones.' },
        limit: { type: 'integer', description: 'Maximum records to return (default 20, max 100).' },
        name: { type: 'string', description: 'For upload: the file name.' },
        mediaType: { type: 'string', description: 'For upload: the media type, when known.' },
        dataBase64: { type: 'string', description: 'For upload: the file bytes encoded as base64.' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          count: { type: 'integer' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        additionalProperties: true,
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args) => {
      const input = args !== null && typeof args === 'object' ? args : {}
      const action = typeof input.action === 'string' ? input.action : 'list'
      const limit = Math.max(1, Math.min(100, Number.isInteger(input.limit) ? input.limit : 20))
      try {
        if (action === 'upload') {
          const result = await uploadManual({ name: input.name, mediaType: input.mediaType, dataBase64: input.dataBase64 })
          if (result.status >= 400) return { ok: false, error: result.body.error, item: undefined }
          return { ok: true, count: 1, items: [result.body.item] }
        }
        if (items.length === 0 && generatedAt === 0) await rescan()
        const body = snapshot({ query: input.query, kind: input.kind, origin: input.origin })
        return { ok: true, count: Math.min(limit, body.count), generatedAt: body.generatedAt, totals: body.totals, items: body.items.slice(0, limit) }
      } catch (error) {
        warn('file-library: tool call failed', error)
        return { ok: false, error: { code: 'TOOL_FAILED', message: describe(error) } }
      }
    },
  })

  ctx.effect(() => () => {
    try {
      toolDisposer()
    } catch (error) {
      warn('file-library: tool disposer failed', error)
    }
  }, 'file-library: file_library tool')
}

/** sha256 hex digest of a byte buffer. */
function digestOfBytes(data) {
  return createHash('sha256').update(data).digest('hex')
}
