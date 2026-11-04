// Scratch harness: exercises dsh-file-library/index.js pure helpers.
// Run: node tests/harness.mjs
import assert from 'node:assert/strict'
import {
  guessMediaType,
  isImageMediaType,
  digestOfAttachmentId,
  attachmentObjectPaths,
  extractAttachments,
  summarizeSessionAttachments,
  mergeAttachmentSummaries,
  indexScannedFiles,
  matchWorkspaceCopies,
  filterItems,
  summarizeTotals,
} from '../index.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
let passed = 0
const check = (label, fn) => { fn(); passed += 1; console.log('ok  ', label) }

check('media type guessing', () => {
  assert.equal(guessMediaType('report.PDF'), 'application/pdf')
  assert.equal(guessMediaType('noext'), 'application/octet-stream')
  assert.equal(guessMediaType(''), 'application/octet-stream')
  assert.equal(isImageMediaType('image/png'), true)
  assert.equal(isImageMediaType('application/pdf'), false)
})

check('attachment id digest parsing', () => {
  assert.equal(digestOfAttachmentId(`sha256:${A}`), A)
  assert.equal(digestOfAttachmentId(`sha256:${A.toUpperCase()}`), undefined)
  assert.equal(digestOfAttachmentId('sha256:xyz'), undefined)
  assert.equal(digestOfAttachmentId(undefined), undefined)
})

check('store object paths follow attachment-local layout', () => {
  const p = attachmentObjectPaths('C:/home/.dsh/attachments/v1', '02be' + 'f'.repeat(60))
  assert.equal(p.image, 'C:\\home\\.dsh\\attachments\\v1\\objects\\02\\02be' + 'f'.repeat(60))
  assert.equal(p.file, 'C:\\home\\.dsh\\attachments\\v1\\file-objects\\02\\02be' + 'f'.repeat(60))
})

check('extractAttachments: images and files from user/message', () => {
  const event = {
    type: 'user/message',
    seq: 5,
    time: 1000,
    data: {
      role: 'user',
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'image', attachment: { attachmentId: `sha256:${A}`, mediaType: 'image/png', width: 800, height: 600, bytes: 1234, name: 'shot.png' } },
        { type: 'file', attachment: { attachmentId: `sha256:${B}`, name: 'report.pdf', bytes: 999 } },
        { type: 'image', attachment: { attachmentId: 'not-a-digest' } },
        { type: 'reasoning' },
        null,
      ],
    },
  }
  const refs = extractAttachments(event)
  assert.equal(refs.length, 2)
  assert.deepEqual(refs[0], { attachmentId: `sha256:${A}`, kind: 'image', name: 'shot.png', bytes: 1234, mediaType: 'image/png', width: 800, height: 600 })
  assert.deepEqual(refs[1], { attachmentId: `sha256:${B}`, kind: 'file', name: 'report.pdf', bytes: 999 })
})

check('extractAttachments: ignores assistant/tool-call carriers and non-arrays', () => {
  assert.deepEqual(extractAttachments({ type: 'assistant/message', data: { message: { content: [{ type: 'file', attachment: { attachmentId: `sha256:${A}`, name: 'x' } }] } } }), [])
  assert.deepEqual(extractAttachments({ type: 'user/message', data: {} }), [])
  assert.deepEqual(extractAttachments({ type: 'user/message', data: { content: 'text' } }), [])
  assert.deepEqual(extractAttachments(null), [])
  assert.deepEqual(extractAttachments({ type: 'tool/result', data: { message: { content: [{ type: 'file', attachment: { attachmentId: `sha256:${C}`, name: 'deep.txt', bytes: 3 } }] } } }),
    [{ attachmentId: `sha256:${C}`, kind: 'file', name: 'deep.txt', bytes: 3 }])
})

check('summarizeSessionAttachments aggregation', () => {
  const events = [
    { type: 'user/message', seq: 1, time: 5000, data: { content: [{ type: 'file', attachment: { attachmentId: `sha256:${A}`, name: '', bytes: 10 } }] } },
    { type: 'turn/start', seq: 2, time: 5001, data: { turn: 1 } },
    { type: 'user/message', seq: 3, time: 4000, data: { content: [{ type: 'file', attachment: { attachmentId: `sha256:${A}`, name: 'later-name.txt', bytes: 20 } }] } },
  ]
  const [entry] = summarizeSessionAttachments(events, { id: 's1', title: 'chat', cwd: '/w', createdAt: 1 })
  assert.equal(entry.attachmentId, `sha256:${A}`)
  assert.equal(entry.name, 'later-name.txt') // first non-empty name
  assert.equal(entry.bytes, 20)              // richest bytes
  assert.equal(entry.at, 4000)               // earliest time
  assert.equal(entry.sessions.length, 1)
  assert.equal(entry.sessions[0].id, 's1')
  assert.equal(entry.sessions[0].title, 'chat')
  assert.equal(entry.sessions[0].at, 4000)
})

check('mergeAttachmentSummaries unions sessions and prefers richest fields', () => {
  const s1 = summarizeSessionAttachments([
    { type: 'user/message', time: 10, data: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${A}`, mediaType: 'image/png', width: 100, height: 50, bytes: 5, name: 'p.png' } }] } },
  ], { id: 's1', cwd: '/one', createdAt: 0 })
  const s2 = summarizeSessionAttachments([
    { type: 'user/message', time: 20, data: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${A}`, width: 400, height: 300, bytes: 50 } }] } },
  ], { id: 's2', cwd: '/two', createdAt: 0 })
  const merged = mergeAttachmentSummaries([s1, s2])
  const entry = merged.get(`sha256:${A}`)
  assert.equal(entry.sessions.length, 2)
  assert.deepEqual(entry.sessions.map((s) => s.id).sort(), ['s1', 's2'])
  assert.equal(entry.width, 400)
  assert.equal(entry.bytes, 50)
  assert.equal(entry.at, 10)
  assert.equal(entry.name, 'p.png')
})

check('matchWorkspaceCopies: identical vs modified', () => {
  const files = [
    { path: '/ws/copy/report.pdf', workspaceId: 'ws1', size: 999, sha256: B },   // identical
    { path: '/ws/copy/report.pdf.bak', workspaceId: 'ws1', size: 500, sha256: C },
    { path: '/ws/report.pdf', workspaceId: 'ws1', size: 1200, sha256: C },       // modified (same basename)
    { path: '/ws/other.txt', workspaceId: 'ws1', size: 3, sha256: A },
  ]
  const index = indexScannedFiles(files)
  const copies = matchWorkspaceCopies({ sha256: B, name: 'report.pdf', kind: 'file' }, index)
  const byPath = Object.fromEntries(copies.map((c) => [c.path, c.state]))
  assert.equal(byPath['/ws/copy/report.pdf'], 'identical')
  assert.equal(byPath['/ws/report.pdf'], 'modified')
  assert.equal(byPath['/ws/copy/report.pdf.bak'], undefined)
  // exactly one entry per path even though digest and basename passes overlap
  assert.equal(new Set(copies.map((c) => c.path)).size, copies.length)
})

check('matchWorkspaceCopies: unknown-origin basename match and cap', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ path: `/ws/${i}/shot.png`, workspaceId: 'ws', size: i, sha256: C }))
  const index = indexScannedFiles(many)
  // Image whose id digests a normalized raster: we cannot know the upload digest.
  const copies = matchWorkspaceCopies({ sha256: '', name: 'shot.png', kind: 'image' }, index, 5)
  assert.equal(copies.length, 5)
  assert.ok(copies.every((c) => c.state === 'modified-with-unknown-origin'))
})

check('matchWorkspaceCopies: oversized files without digest never claim identical', () => {
  const index = indexScannedFiles([{ path: '/ws/huge.bin', workspaceId: 'ws', size: 10 * 1024 * 1024 }])
  const copies = matchWorkspaceCopies({ sha256: A, name: 'huge.bin' }, index)
  assert.deepEqual(copies.map((c) => c.state), ['modified-with-unknown-origin'])
})

check('filterItems ranks favorites first then newest', () => {
  const items = [
    { id: 'x', name: 'alpha.txt', kind: 'file', origin: 'session', favorite: false, createdAt: 100, sessions: [], copies: [] },
    { id: 'y', name: 'beta.png', kind: 'image', origin: 'manual', favorite: true, createdAt: 50, sessions: [], copies: [] },
    { id: 'z', name: 'gamma.pdf', kind: 'file', origin: 'session', favorite: false, createdAt: 300, sessions: [{ id: 's', cwd: '/proj-a' }], copies: [{ path: '/ws/gamma.pdf' }] },
  ]
  assert.deepEqual(filterItems(items, {}).map((i) => i.id), ['y', 'z', 'x'])
  assert.deepEqual(filterItems(items, { query: 'ALPHA' }).map((i) => i.id), ['x'])
  assert.deepEqual(filterItems(items, { query: 'proj-a' }).map((i) => i.id), ['z'])
  assert.deepEqual(filterItems(items, { query: 'gamma.pdf' }).map((i) => i.id), ['z'])
  assert.deepEqual(filterItems(items, { kind: 'image' }).map((i) => i.id), ['y'])
  assert.deepEqual(filterItems(items, { origin: 'session' }).map((i) => i.id), ['z', 'x'])
  assert.deepEqual(filterItems(items, { favorite: true }).map((i) => i.id), ['y'])
  assert.deepEqual(filterItems(items, { query: 'nothing-matches' }), [])
})

check('summarizeTotals', () => {
  assert.deepEqual(summarizeTotals([
    { kind: 'image', origin: 'session', bytes: 10, copies: [{ path: 'a' }] },
    { kind: 'file', origin: 'manual', bytes: 5, copies: [] },
    { kind: 'file', origin: 'session', bytes: 1 },
  ]), { items: 3, images: 1, files: 2, manual: 1, withCopies: 1, bytes: 16 })
})

console.log(`\n${passed} checks passed`)
