import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { File } from 'node:buffer'
import test from 'node:test'
import vm from 'node:vm'

// Execute the actual bundle, exposing its private boundaries only inside this VM.
const source = (await readFile(new URL('../client.js', import.meta.url), 'utf8')).replace(
  '\t\treturn {\n\t\t\t// `commandUi`',
  '\t\tglobalThis.testApi = { api, rawUrl, createLibraryLoader, attachToComposer, matchesQuery, fileToBase64, PathRow, pickerPlacement, observePickerPosition, LibraryPicker, ComposerLibraryOverlay, openPicker, pickerStore, flashPickerNotice, CSS };\n\t\treturn {\n\t\t\t// `commandUi`',
)
assert.ok(source.includes('globalThis.testApi'))
const success = (items, generatedAt = 1) => Response.json({ ok: true, items, generatedAt, totals: { items: items.length } })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = () => new Promise((resolve) => setImmediate(resolve))

function runtime(fetch) {
  let hookHost
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat() } },
    useState(initial) {
      const slot = hookHost.slot(() => ({ value: typeof initial === 'function' ? initial() : initial }))
      return [slot.value, (patch) => { slot.value = typeof patch === 'function' ? patch(slot.value) : patch }]
    },
    useRef(initial) { return hookHost.slot(() => ({ current: initial })) },
    useMemo(fn, deps) {
      const slot = hookHost.slot(() => ({}))
      if (!slot.deps || deps.some((value, index) => value !== slot.deps[index])) { slot.value = fn(); slot.deps = deps }
      return slot.value
    },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps) },
    useLayoutEffect(fn, deps) { return React.useEffect(fn, deps) },
    useEffect(fn, deps) {
      const slot = hookHost.slot(() => ({}))
      if (!slot.deps || deps.some((value, index) => value !== slot.deps[index])) {
        slot.deps = deps
        hookHost.effects.push(() => { slot.cleanup?.(); slot.cleanup = fn() })
      }
    },
  }
  const listeners = new Map()
  const document = {
    activeElement: null,
    addEventListener(name, fn) { listeners.set(name, fn) },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name) },
  }
  const timers = new Map()
  let timerId = 0
  const window = {
    setTimeout(fn) { timers.set(++timerId, fn); return timerId },
    clearTimeout(id) { timers.delete(id) },
    __ModuleLoader__: { load(definition) { definition.factory((name) => { assert.equal(name, 'react'); return React }) } },
  }
  const context = vm.createContext({ window, document, fetch, Headers, Response, Blob, File, AbortController, DOMException, console, Node: class {} })
  vm.runInContext(source, context, { filename: 'client.js' })
  const hooks = (component, props) => {
    const slots = []
    const host = {
      cursor: 0, effects: [],
      slot(create) { const at = host.cursor++; return slots[at] ??= create() },
      render(nextProps = props) {
        props = nextProps; hookHost = host; host.cursor = 0
        const tree = component(props)
        for (const effect of host.effects.splice(0)) effect()
        return tree
      },
      unmount() { for (const slot of slots) slot.cleanup?.() },
    }
    return host
  }
  return { api: context.testApi, hooks, listeners, timers, context }
}
const nodes = (tree) => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []
const text = (tree) => tree && typeof tree === 'object' ? tree.children.map(text).join(' ') : String(tree ?? '')
const t = (key) => key
const item = { id: 'sha256:' + 'a'.repeat(64), name: 'report.txt', mediaType: 'text/plain' }

function conversationFixture(overrides = {}) {
  const created = [], released = [], added = []
  const service = {
    createDrafts(sessionId, files) { const drafts = files.map((file) => ({ id: `draft-${created.length + 1}`, file })); created.push(...drafts); return drafts },
    releaseDraftAttachments(drafts) { released.push(...drafts) },
    ...overrides,
  }
  return { created, released, added, ctx: { get(name) { assert.equal(name, 'conversation'); return service } }, input: { addAttachments(ids) { added.push(...ids); return true } } }
}

test('same-origin cookie transport and document-relative paths cover every API', async () => {
  const calls = []
  const { api } = runtime(async (url, init) => { calls.push({ url, init }); return success([]) })
  await api.api('/items')
  await api.api('/state', { method: 'POST', body: '{}' })
  for (const call of calls) {
    assert.equal(call.init.credentials, 'same-origin')
    assert.equal(call.init.headers.has('authorization'), false)
    assert.equal(new URL(call.url, 'https://host.example/mount/').pathname, '/mount/api/dsh-file-library/' + (call.init.method === 'POST' ? 'state' : 'items'))
  }
  assert.equal(new URL(api.rawUrl(item.id), 'http://127.0.0.1:54436/').pathname, '/api/dsh-file-library/raw')
  assert.equal(calls[0].init.headers.has('content-type'), false)
  assert.equal(calls[1].init.headers.get('content-type'), 'application/json')
})

test('invalid success bodies and structured / non-JSON failures are errors', async () => {
  for (const [response, expected] of [
    [new Response('<html>login</html>'), /Invalid file library response/],
    [new Response('unauthorized', { status: 401 }), /HTTP 401/],
    [Response.json({ ok: false, error: { code: 'BROKEN', message: 'store failed' } }, { status: 500 }), /store failed/],
  ]) {
    const { api } = runtime(async () => response)
    await assert.rejects(api.api('/items'), expected)
  }
})

test('newer list / refresh wins even when the aborted transport resolves late', async () => {
  const requests = []
  const { api } = runtime((url, options) => { const next = deferred(); requests.push({ ...next, url, options }); return next.promise })
  let state = { items: [], phase: 'loading' }
  const loader = api.createLibraryLoader((patch) => { state = typeof patch === 'function' ? patch(state) : patch })
  const first = loader.load('')
  const second = loader.load('', true)
  assert.equal(requests[0].options.signal.aborted, true)
  assert.equal(requests[1].url.endsWith('/refresh'), true)
  requests[1].resolve(success([{ id: 'new' }], 2)); await second
  requests[0].resolve(success([{ id: 'old' }], 1)); await first
  assert.equal(state.items[0].id, 'new')
  assert.equal(state.generatedAt, 2)
  const last = loader.load('')
  const previous = state
  loader.cancel()
  requests[2].resolve(success([{ id: 'unmounted' }], 3)); await last
  assert.equal(state, previous)
})

test('loader preserves records on failure and retries malformed item lists', async () => {
  const responses = [success([item]), Response.json({ ok: true, items: null }), success([{ id: 'retry' }])]
  const { api } = runtime(async () => responses.shift())
  let state = { items: [] }
  const loader = api.createLibraryLoader((patch) => { state = typeof patch === 'function' ? patch(state) : patch })
  await loader.load(''); await loader.load('')
  assert.equal(state.phase, 'error'); assert.equal(state.items[0].id, item.id)
  await loader.load('')
  assert.equal(state.phase, 'ready'); assert.equal(state.items[0].id, 'retry')
})

test('draft hand-off sends browser-local ids and preserves binary bytes', async () => {
  const { api } = runtime(async (_url, init) => { assert.equal(init.credentials, 'same-origin'); return new Response(new Uint8Array([0, 1, 128, 255])) })
  const fixture = conversationFixture()
  assert.equal(await api.attachToComposer(fixture.ctx, 'session-a', fixture.input, [item]), 'attached')
  assert.deepEqual(fixture.added, ['draft-1'])
  assert.equal(fixture.created[0].file.name, 'report.txt')
  assert.deepEqual([...new Uint8Array(await fixture.created[0].file.arrayBuffer())], [0, 1, 128, 255])
  assert.equal(fixture.released.length, 0)
})

test('busy input and throwing input release drafts instead of leaking uploads / previews', async () => {
  for (const addAttachments of [() => false, () => { throw new Error('disposed') }]) {
    const { api } = runtime(async () => new Response('bytes'))
    const fixture = conversationFixture()
    const result = await api.attachToComposer(fixture.ctx, 'session-a', { addAttachments }, [item])
    assert.equal(result, addAttachments.toString().includes('false') ? 'busy' : 'failed')
    assert.equal(fixture.released.length, 1)
    assert.equal(fixture.released[0], fixture.created[0])
  }
})

test('a later draft allocation failure releases earlier allocations', async () => {
  const { api } = runtime(async () => new Response('bytes'))
  const fixture = conversationFixture()
  let count = 0
  fixture.ctx = { get: () => ({
    createDrafts() { if (++count === 2) throw new Error('allocation failure'); return [{ id: 'first' }] },
    releaseDraftAttachments(drafts) { fixture.released.push(...drafts) },
  }) }
  assert.equal(await api.attachToComposer(fixture.ctx, 'session-a', fixture.input, [item, { ...item, id: 'other' }]), 'failed')
  assert.equal(fixture.released.length, 1)
  assert.equal(fixture.added.length, 0)
})

test('partial raw failures are reported, complete failures do not allocate drafts', async () => {
  let requests = 0
  const { api } = runtime(async () => ++requests % 2 ? new Response('missing', { status: 404 }) : new Response('bytes'))
  const fixture = conversationFixture()
  assert.equal(await api.attachToComposer(fixture.ctx, 'session-a', fixture.input, [item, { ...item, id: 'other' }]), 'partial')
  assert.equal(fixture.added.length, 1)
  requests = 0
  assert.equal(await api.attachToComposer(fixture.ctx, 'session-a', fixture.input, [item]), 'failed')
  assert.equal(fixture.created.length, 1)
})

test('cancellation during a body download prevents draft creation', async () => {
  const body = deferred()
  const controller = new AbortController()
  const { api } = runtime(async () => ({ ok: true, blob: () => body.promise }))
  const fixture = conversationFixture()
  const operation = api.attachToComposer(fixture.ctx, 'session-a', fixture.input, [item], controller.signal)
  await tick(); controller.abort(); body.resolve(new Blob(['bytes']))
  assert.equal(await operation, 'cancelled')
  assert.equal(fixture.created.length, 0)
})

test('picker errors show retry without claiming the library is empty; Escape cleans listeners', async () => {
  let calls = 0
  const { api, hooks, listeners } = runtime(async () => ++calls === 1 ? new Response('unauthorized', { status: 401 }) : success([item]))
  let closed = 0
  const host = hooks(api.LibraryPicker, { t, onClose: () => { closed++ }, onPick() {} })
  host.render(); await tick()
  let tree = host.render()
  assert.equal(text(tree).includes('attach.empty'), false)
  assert.equal(text(tree).includes('HTTP 401'), true)
  const retry = nodes(tree).find((node) => node.type === 'button' && node.children.includes('retry'))
  assert.ok(retry); await retry.props.onClick(); tree = host.render()
  assert.equal(text(tree).includes('report.txt'), true)
  const escape = { key: 'Escape', preventDefault() {}, stopPropagation() {} }
  listeners.get('keydown')(escape); assert.equal(closed, 1)
  host.unmount(); assert.equal(listeners.size, 0)
})

test('overlay unmount cancels in-flight attachment and notices stay in their session', async () => {
  const { api, hooks } = runtime(async () => success([]))
  const handoff = deferred()
  let signal
  api.openPicker('session-a')
  const host = hooks(api.ComposerLibraryOverlay, { t, sessionId: 'session-a', inputActions: {}, attach: (_id, _actions, _items, current) => { signal = current; return handoff.promise } })
  const tree = host.render()
  const picker = nodes(tree).find((node) => node.type === api.LibraryPicker)
  const pending = picker.props.onPick([item])
  host.unmount(); assert.equal(signal.aborted, true)
  handoff.resolve('attached'); await pending
  assert.equal(api.pickerStore.notice, null)
  api.flashPickerNotice('session-a', 'notice-for-a')
  const other = hooks(api.ComposerLibraryOverlay, { t, sessionId: 'session-b', attach() {} })
  assert.equal(text(other.render()).includes('notice-for-a'), false)
  other.unmount()
})

test('file reads abort on page disposal and clipboard timers do not survive detail unmount', async () => {
  const { api, hooks, context, timers } = runtime(async () => success([]))
  let aborted = false
  context.FileReader = class { readAsDataURL() {} abort() { aborted = true } }
  const controller = new AbortController()
  const read = api.fileToBase64(new File(['bytes'], 'test.txt'), controller.signal)
  controller.abort()
  await assert.rejects(read, { name: 'AbortError' }); assert.equal(aborted, true)
  const copied = deferred()
  context.navigator = { clipboard: { writeText: () => copied.promise } }
  const host = hooks(api.PathRow, { label: 'path', path: '/stored/test.txt', t })
  const tree = host.render()
  const copy = nodes(tree).find((node) => node.type === 'button').props.onClick()
  host.unmount(); copied.resolve(); await copy
  assert.equal(timers.size, 0)
})

test('picker placement fits the measured hero, bottom composer, short window and visual viewport', () => {
  const { api } = runtime(async () => success([]))
  for (const sample of [
    { name: 'actual centered hero', composer: { top: 355.5, bottom: 469.5 }, viewport: { top: 0, height: 725 }, header: 60, side: 'above', height: 283.5 },
    { name: 'bottom composer', composer: { top: 650, bottom: 760 }, viewport: { top: 0, height: 820 }, header: 76, side: 'above', height: 420 },
    { name: 'top composer flips down', composer: { top: 100, bottom: 214 }, viewport: { top: 0, height: 725 }, header: 60, side: 'below', height: 420 },
    { name: 'short window', composer: { top: 136, bottom: 250 }, viewport: { top: 0, height: 320 }, header: 60, side: 'above', height: 64 },
    { name: 'keyboard / zoom visual viewport', composer: { top: 470, bottom: 560 }, viewport: { top: 200, height: 380 }, header: 60, side: 'above', height: 258 },
  ]) {
    // This is the native zero-height [data-composer-overlay] at the card's top.
    const reference = { top: sample.composer.top, bottom: sample.composer.top }
    const result = api.pickerPlacement(sample.composer, reference, sample.viewport, sample.header)
    assert.equal(result.side, sample.side, sample.name)
    assert.equal(result.style.maxHeight, sample.height, sample.name)
    const panelTop = result.side === 'above' ? reference.bottom - result.style.bottom - result.style.maxHeight : reference.top + result.style.top
    const panelBottom = panelTop + result.style.maxHeight
    assert.ok(panelTop >= Math.max(sample.viewport.top + 8, sample.header + 8), `${sample.name}: header stays visible`)
    assert.ok(panelBottom <= sample.viewport.top + sample.viewport.height - 8, `${sample.name}: inside visible viewport`)
    if (result.side === 'below') assert.ok(panelTop >= sample.composer.bottom + 4, 'downward panel clears the entire composer')
    else assert.ok(panelBottom <= sample.composer.top - 4, 'upward panel clears the composer')
  }
})

test('picker positioning tracks resize / captured scroll / visual viewport and releases every observer', () => {
  const { api, context } = runtime(async () => success([]))
  const windowListeners = new Map(), viewportListeners = new Map()
  const eventTarget = (listeners) => ({
    addEventListener(name, fn, capture = false) { listeners.set(`${name}:${capture}`, fn) },
    removeEventListener(name, fn, capture = false) { const key = `${name}:${capture}`; assert.equal(listeners.get(key), fn); listeners.delete(key) },
  })
  Object.assign(context.window, eventTarget(windowListeners), { innerHeight: 725 })
  const viewport = { ...eventTarget(viewportListeners), offsetTop: 0, height: 725 }
  context.window.visualViewport = viewport
  let card = { top: 355.5, bottom: 469.5 }
  let headerBottom = 60
  const composer = { getBoundingClientRect: () => card }
  const reference = { getBoundingClientRect: () => ({ top: card.top, bottom: card.top }) }
  const header = { getBoundingClientRect: () => ({ bottom: headerBottom }) }
  context.document.querySelector = (selector) => { assert.equal(selector, '[data-conversation-header-leading]'); return { closest: () => header } }
  const panel = { offsetParent: reference, closest: (selector) => selector === '[data-composer-card]' ? composer : null }
  let resize, disconnected = false, published = 0, placement
  const observed = new Set()
  context.ResizeObserver = class {
    constructor(callback) { resize = callback }
    observe(element) { observed.add(element) }
    disconnect() { disconnected = true; observed.clear() }
  }
  const dispose = api.observePickerPosition(panel, (update) => { published++; placement = update(placement) })
  assert.equal(placement.style.maxHeight, 283.5)
  assert.deepEqual([...observed], [composer, reference, header])
  card = { top: 100, bottom: 214 }; windowListeners.get('scroll:true')()
  assert.equal(placement.side, 'below'); assert.equal(placement.style.top, 118)
  viewport.height = 400; viewportListeners.get('resize:false')()
  assert.equal(placement.style.maxHeight, 174)
  card = { top: 250, bottom: 364 }; viewportListeners.get('scroll:false')()
  assert.equal(placement.side, 'above')
  headerBottom = 100; resize()
  assert.equal(placement.style.maxHeight, 138)
  windowListeners.get('resize:false')()
  dispose()
  assert.equal(disconnected, true); assert.equal(observed.size, 0)
  assert.equal(windowListeners.size, 0); assert.equal(viewportListeners.size, 0)
  const before = published; resize(); assert.equal(published, before, 'late observer callback is inert after disposal')
})

test('picker search includes session title, cwd, stored path and workspace copies', () => {
  const { api } = runtime(async () => success([]))
  const record = { ...item, readonlyPath: '/store/report', sessions: [{ title: 'Design review', cwd: '/projects/library' }], copies: [{ path: '/workspace/edited.txt' }] }
  for (const query of ['DESIGN REVIEW', 'projects/library', '/store/report', 'edited.txt']) assert.equal(api.matchesQuery(record, query), true)
  assert.equal(api.matchesQuery(record, 'unrelated'), false)
})
