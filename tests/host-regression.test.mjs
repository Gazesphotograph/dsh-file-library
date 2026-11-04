import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import { apply, ROUTE_PREFIX } from '../index.js'

const fixtureDir = fileURLToPath(new URL('./.test-data/', import.meta.url))
const digest = (data) => createHash('sha256').update(data).digest('hex')
const payload = Buffer.from('original report bytes')
const id = `sha256:${digest(payload)}`
const event = (attachmentId = id, name = 'report.txt', time = 100) => ({ type: 'user/message', time, data: { content: [{ type: 'file', attachment: { attachmentId, name, bytes: payload.length } }] } })
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }

async function fixture({ manual = false, listGate, readGate, blockedState = false } = {}) {
  await mkdir(fixtureDir, { recursive: true })
  const root = await mkdtemp(join(fixtureDir, 'host-'))
  assert.equal(dirname(resolve(root)), resolve(fixtureDir))
  const objectPath = (attachmentId, family = 'file-objects') => join(root, 'attachments', 'v1', family, attachmentId.slice(7, 9), attachmentId.slice(7))
  const store = async (data, name) => {
    const attachmentId = `sha256:${digest(data)}`
    await mkdir(dirname(objectPath(attachmentId)), { recursive: true })
    await writeFile(objectPath(attachmentId), data)
    return { attachmentId, name, bytes: data.length }
  }
  await store(payload, 'report.txt')
  if (blockedState) await writeFile(join(root, 'dsh-file-library'), 'a file blocks state directory creation')
  else {
    await mkdir(join(root, 'dsh-file-library'), { recursive: true })
    await writeFile(join(root, 'dsh-file-library', 'state.json'), JSON.stringify({
      manual: manual ? { [id]: { attachmentId: id, name: 'manual-report.txt', bytes: payload.length, kind: 'file', mediaType: 'text/plain', createdAt: 50 }, broken: null } : {},
      favorites: [id],
      scan: { sessions: { malformed: null } },
    }))
  }
  const routes = new Map(), handlers = new Map(), disposers = [], warnings = []
  let listCalls = 0, readCalls = 0, failList = false, title = 'Original title'
  let events = [event()]
  let revision = 'one'
  const services = {
    attachments: { saveFile: ({ data, name }) => store(Buffer.from(data), name), saveImage() { throw new Error('invalid raster') }, fileHostPath: (ref) => objectPath(ref.attachmentId), imageHostPath: (ref) => objectPath(ref.attachmentId, 'objects') },
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } },
    sessionQuery: { async readTitleSnapshots(ids) { return ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title } } })) } },
  }
  const ctx = {
    logger: { warn(error) { warnings.push(error.message) } },
    sessionPersistence: {
      async list() { listCalls++; if (listGate) await listGate.promise; if (failList) throw new Error('session list unavailable'); return [{ header: { id: 'session-a', cwd: '/project', createdAt: 10 }, revision }] },
      async open() { readCalls++; return { header: { cwd: '/project' }, async read() { const captured = structuredClone(events); if (readGate) { readGate.entered.resolve(); await readGate.promise }; return { events: captured } }, async close() {} } },
    },
    get(name) { return services[name] },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
    on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name) },
  }
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try { apply(ctx, { maxScannedFiles: 1 }) } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  const request = async (path, value) => {
    const route = routes.get(ROUTE_PREFIX + path.split('?')[0])
    assert.ok(route, `route ${path}`)
    return route.fetch(new Request('http://dsh.internal' + ROUTE_PREFIX + path, value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }))
  }
  return {
    root, store, request, routes, handlers, warnings,
    get listCalls() { return listCalls }, get readCalls() { return readCalls },
    set failList(value) { failList = value }, set title(value) { title = value },
    setEvents(value) { events = value; revision += '-next' },
    async cleanup() {
      // These are the exact fixture roots created above, all inside our write scope.
      assert.equal(dirname(resolve(root)), resolve(fixtureDir))
      for (const dispose of disposers.reverse()) dispose()
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 })
    },
  }
}

test('initial scan and concurrent list requests share one scan and loaded durable state', async () => {
  const listGate = deferred()
  const current = await fixture({ manual: true, listGate })
  try {
    const first = current.request('/items')
    const second = current.request('/items')
    listGate.resolve()
    const [a, b] = await Promise.all([first, second])
    const one = await a.json(), two = await b.json()
    assert.equal(one.ok, true); assert.equal(two.ok, true)
    assert.equal(current.listCalls, 1); assert.equal(current.readCalls, 1)
    assert.equal(one.items.length, 1); assert.equal(one.totals.items, 1)
    assert.equal(one.items[0].origin, 'manual'); assert.equal(one.items[0].name, 'manual-report.txt')
    assert.equal(one.items[0].favorite, true)
    assert.equal(one.items[0].createdAt, 50)
    assert.equal(one.items[0].sessions[0].id, 'session-a')
    assert.equal(one.items[0].readonlyExists, true)
  } finally { await current.cleanup() }
})

test('manual upload, malformed base64, binary raw and duplicate upload work end to end', async () => {
  const current = await fixture()
  try {
    await current.request('/items')
    const malformed = await current.request('/upload', { name: 'bad.txt', dataBase64: 'aGVsbG8=TRAILING!' })
    assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, 'DATA_INVALID')
    const valid = await current.request('/upload', { name: 'report.txt', mediaType: 'text/plain', dataBase64: payload.toString('base64') })
    assert.equal(valid.status, 201)
    const uploaded = await valid.json()
    assert.equal(uploaded.item.id, id); assert.equal(uploaded.item.sessions.length, 1)
    const raw = await current.request(`/raw?id=${encodeURIComponent(id)}`)
    assert.equal(raw.status, 200); assert.deepEqual(Buffer.from(await raw.arrayBuffer()), payload)
    await current.request('/upload', { name: 'report.txt', dataBase64: payload.toString('base64') })
    const listed = await (await current.request('/items')).json()
    assert.equal(listed.items.length, 1); assert.equal(listed.items[0].createdAt, 100)
    assert.equal(listed.totals.bytes, payload.length)
    const searched = await (await current.request('/items?query=' + encodeURIComponent(listed.items[0].readonlyPath))).json()
    assert.equal(searched.count, 1)
  } finally { await current.cleanup() }
})

test('live committed attachments resolve raw paths before a full rescan', async () => {
  const current = await fixture()
  try {
    await current.request('/items')
    const bytes = Buffer.from([0, 128, 255, 42])
    const attachment = await current.store(bytes, 'new.bin')
    current.handlers.get('session/event')({ id: 'session-a', header: { cwd: '/project' } }, event(attachment.attachmentId, 'new.bin', 200))
    const raw = await current.request(`/raw?id=${encodeURIComponent(attachment.attachmentId)}`)
    assert.equal(raw.status, 200); assert.deepEqual(Buffer.from(await raw.arrayBuffer()), bytes)
    const listed = await (await current.request('/items')).json()
    const record = listed.items.find((entry) => entry.id === attachment.attachmentId)
    assert.equal(record.readonlyExists, true); assert.equal(current.listCalls, 1)
  } finally { await current.cleanup() }
})

test('refreshing renamed titles works with cached session attachment summaries', async () => {
  const current = await fixture()
  try {
    await current.request('/items')
    current.title = 'Renamed conversation'
    const refreshed = await (await current.request('/refresh', {})).json()
    assert.equal(refreshed.items[0].sessions[0].title, 'Renamed conversation')
    assert.equal(current.readCalls, 1)
  } finally { await current.cleanup() }
})

test('failed rescan returns a structured error and preserves the previous records', async () => {
  const current = await fixture()
  try {
    await current.request('/items')
    current.failList = true
    const response = await current.request('/refresh', {})
    assert.equal(response.status, 500); assert.equal((await response.json()).error.code, 'REQUEST_FAILED')
    const listed = await (await current.request('/items')).json()
    assert.equal(listed.items.length, 1); assert.equal(listed.items[0].id, id)
  } finally { await current.cleanup() }
})

test('state persistence failures do not report a successful mutation', async () => {
  const current = await fixture({ blockedState: true })
  try {
    // Initial scan may publish an in-memory record, but cannot persist its cache.
    const state = await current.request('/state', { id, favorite: true })
    if (state.status === 404) await current.request('/items')
    const response = await current.request('/state', { id, favorite: true })
    assert.equal(response.status, 500); assert.equal((await response.json()).ok, false)
  } finally { await current.cleanup() }
})

test('uploads committed during a scan survive publication and favorites keep their latest value', async () => {
  const readGate = { ...deferred(), entered: deferred() }
  const current = await fixture({ manual: true, readGate })
  try {
    const pending = current.request('/items')
    await readGate.entered.promise
    const bytes = Buffer.from('committed while scanning')
    const attachment = await current.store(bytes, 'concurrent.txt')
    const committed = event(attachment.attachmentId, 'concurrent.txt', 300)
    current.setEvents([event(), committed])
    current.handlers.get('session/event')({ id: 'session-a' }, committed)
    const a = current.request('/state', { id, favorite: true })
    const b = current.request('/state', { id, favorite: false })
    await Promise.all([a, b])
    readGate.resolve()
    const body = await (await pending).json()
    assert.equal(body.ok, true); assert.equal(body.items.length, 2)
    assert.equal(body.items.find((entry) => entry.id === id).favorite, false)
    assert.equal(body.items.find((entry) => entry.id === attachment.attachmentId).readonlyExists, true)
    assert.equal(current.listCalls, 2); assert.equal(current.readCalls, 2)
    const persisted = JSON.parse(await readFile(join(current.root, 'dsh-file-library', 'state.json'), 'utf8'))
    assert.equal(persisted.favorites.includes(id), false)
  } finally { readGate.resolve(); await current.cleanup() }
})

test('actual Connection browser-auth source accepts the signed browser cookie without Authorization', async () => {
  // Load the shipped implementation, keeping external package imports out of this fixture.
  const connection = await readFile(new URL('./fixtures/browser-auth.js', import.meta.url), 'utf8')
  const authSource = connection.split('//#region lib/types/browser-auth.js')[1].split('//#endregion')[0]
  const context = vm.createContext({ credentialKey: (...parts) => parts.join(':'), createHash, createHmac, randomBytes, timingSafeEqual, Buffer, URL, Headers, console })
  vm.runInContext(authSource + '\nglobalThis.createAuth = () => new BrowserAuth({}, Buffer.alloc(32, 9), 30);', context)
  const auth = context.createAuth()
  const launch = new URL(auth.authenticatedUrl('http://127.0.0.1:54436/'))
  let headers, status
  const response = { writeHead(code, values) { status = code; headers = values }, end() {} }
  const host = '127.0.0.1:54436'
  assert.equal(auth.authorizeIndex({ method: 'GET', url: launch.pathname + launch.search, headers: { host } }, response), false)
  assert.equal(status, 303); assert.match(headers['set-cookie'], /HttpOnly; SameSite=Strict/)
  const cookie = headers['set-cookie'].split(';', 1)[0]
  for (const method of ['GET', 'POST', 'HEAD']) assert.equal(auth.isAuthenticated({ method, headers: { host, cookie } }), true)
  assert.equal(auth.isAuthenticated({ headers: { host } }), false)
  assert.equal(auth.isAuthenticated({ headers: { host: 'localhost:54436', cookie } }), false)
})
