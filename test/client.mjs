// Contract test for the browser half. Evaluates `lib/client.js` in a VM with a
// fake module loader, React, and slot/locale services, then checks the
// registration it produces and that the view renders a tree.
//
// Run with: node test/client.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

const captured = { definition: null, registrations: [], disposers: [] }
const styles = []

const head = {
  /**
   * @param {object} node - style element.
   */
  appendChild(node) {
    styles.push(node)
    node.parentNode = head
  },
  /**
   * @param {object} node - style element.
   */
  removeChild(node) {
    node.parentNode = null
  },
}

const documentStub = {
  /**
   * @param {string} tagName - element name.
   * @returns {object} fake element.
   */
  createElement(tagName) {
    return { tagName, parentNode: null, textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value } }
  },
  head,
}

const windowStub = {
  navigator: { language: 'zh-CN' },
  confirm: () => true,
  requestAnimationFrame: (callback) => callback(),
  __ModuleLoader__: {
    /**
     * @param {object} definition - module definition.
     */
    load(definition) {
      captured.definition = definition
    },
  },
}

/**
 * Minimal React stand-in: elements are plain trees, hooks keep initial state.
 */
const React = {
  /**
   * @param {unknown} type - element type.
   * @param {object | null} props - element props.
   * @param {...unknown} children - element children.
   * @returns {object} fake element.
   */
  createElement(type, props, ...children) {
    return { type, props: props === null ? {} : props, children }
  },
  useState(initial) {
    return [initial, () => {}]
  },
  useRef(initial) {
    return { current: initial }
  },
  useCallback(callback) {
    return callback
  },
  useEffect() {},
}

const requireStub = (id) => {
  if (id === 'react') return React
  throw new Error('unexpected require: ' + id)
}

const context = vm.createContext({
  window: windowStub,
  document: documentStub,
  navigator: windowStub.navigator,
  TextEncoder,
  console,
  fetch: () => Promise.reject(new Error('network disabled in test')),
})
vm.runInContext(source, context, { filename: 'lib/client.js' })
assert.equal(captured.definition.id, 'dsh-agents-md')

const messages = { zh: { 'view.label': '智能体文档' } }
const locale = {
  /**
   * @param {string} namespace - locale namespace.
   * @param {object} dictionaries - message dictionaries.
   */
  register(namespace, dictionaries) {
    assert.equal(namespace, 'dsh-agents-md')
    messages.zh = dictionaries.zh
    return () => {}
  },
  /**
   * @param {string} namespace - locale namespace.
   * @returns {Function} translator.
   */
  bind(namespace) {
    assert.equal(namespace, 'dsh-agents-md')
    return (key) => messages.zh[key] === undefined ? key : messages.zh[key]
  },
}

const slots = {
  /**
   * @param {string} slotName - slot name.
   * @param {Function} callback - registration callback.
   * @returns {Function} disposer.
   */
  inject(slotName, callback) {
    assert.equal(slotName, 'conversation.view')
    const dispose = callback()
    captured.disposers.push(dispose)
    return dispose
  },
  /**
   * @param {object} options - registration options.
   * @param {Function} component - view component.
   * @returns {Function} disposer.
   */
  register(options, component) {
    captured.registrations.push({ options, component })
    return () => {}
  },
}

const ctx = {
  /**
   * @param {string} serviceName - service name.
   * @returns {object | undefined} fake service.
   */
  get(serviceName) {
    if (serviceName === 'locale') return locale
    if (serviceName === 'slots') return slots
    return undefined
  },
  /**
   * @param {Function} execute - effect body.
   * @returns {Function} disposer.
   */
  effect(execute) {
    const dispose = execute()
    captured.disposers.push(dispose)
    return dispose
  },
}

let failures = 0
/**
 * @param {string} label - check label.
 * @param {Function} run - check body.
 */
function check(label, run) {
  try {
    run()
    console.log('ok   ' + label)
  } catch (error) {
    failures += 1
    console.log('FAIL ' + label)
    console.log('     ' + String(error && error.message ? error.message : error))
  }
}

const exports = captured.definition.factory(requireStub)

check('the module exports apply and the slots dependency', () => {
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual([...exports.inject], ["slots", "locale"])
})

exports.apply(ctx)

check('the plugin registers one conversation.view entry', () => {
  assert.equal(captured.registrations.length, 1)
})

check('the registration matches the slot contract', () => {
  const { options, component } = captured.registrations[0]
  assert.equal(options.name, 'conversation.view')
  assert.equal(options.id, 'agents-md')
  assert.equal(options.order, 20)
  assert.equal(options.locale, 'dsh-agents-md')
  assert.equal(typeof options.label, 'function')
  assert.equal(typeof component, 'function')
})

check('the tab label resolves through the locale service', () => {
  assert.equal(captured.registrations[0].options.label(), '智能体文档')
})

check('the plugin injects its stylesheet and dictionaries', () => {
  assert.equal(styles.length, 1)
  assert.equal(styles[0].attributes['data-dsh-agents-md'], '1')
  assert.ok(styles[0].textContent.includes('.dam-root'))
  assert.equal(messages.zh.title, '智能体文档')
  assert.equal(messages.zh['scope.dsh'], '全局 DSH 目录')
  assert.ok(messages.zh.intro.includes('说明书'))
  assert.ok(styles[0].textContent.includes('.dam-intro'))
  assert.ok(styles[0].textContent.includes('.dam-docsize'))
})

check('the view renders the root container before session data arrives', () => {
  const View = captured.registrations[0].component
  const element = View({ sessionId: 'session-1', t: (key) => messages.zh[key] === undefined ? key : messages.zh[key] })
  assert.equal(element.type, 'div')
  assert.equal(element.props['data-testid'], 'dsh-agents-md')
  assert.equal(element.props.className, 'dam-root')
  const text = JSON.stringify(element)
  assert.ok(text.includes('等待会话信息'))
})

check('the markdown preview renderer builds a safe block tree', () => {
  const { renderMarkdown } = exports.__test
  assert.equal(typeof renderMarkdown, 'function')
  assert.equal(renderMarkdown('').length, 0)
  const blocks = renderMarkdown([
    '# Title',
    '',
    '- alpha',
    '- **bold** and `code`',
    '',
    '| left | right |',
    '| --- | ---: |',
    '| 1 | 2 |',
    '',
    '> quoted',
    '',
    '```js',
    'const a = 1',
    '```',
    '',
    'A [link](https://example.com) and ~~gone~~.',
  ].join('\n'))
  assert.deepEqual([...blocks.map((block) => block.type)], ['h1', 'ul', 'table', 'blockquote', 'pre', 'p'])
  const text = JSON.stringify(blocks)
  assert.ok(text.includes('dam-md-h1'))
  assert.ok(text.includes('dam-inline-code'))
  assert.ok(text.includes('dam-table'))
  assert.ok(text.includes('"href":"https://example.com"'))
  assert.ok(!text.includes('dangerouslySetInnerHTML'))
})

check('the sidebar pins the workspace file on top and the agents-home file at the bottom', () => {
  const { orderFiles } = exports.__test
  assert.equal(typeof orderFiles, 'function')
  const listed = [
    { path: '/home/u/.dsh/AGENTS.md', scope: 'dsh-home' },
    { path: '/home/u/.agents/AGENTS.md', scope: 'agents-home' },
    { path: '/w/AGENTS.md', scope: 'project' },
    { path: '/w/pkg/AGENTS.md', scope: 'project' },
    { path: '/w/CLAUDE.md', scope: 'project' },
  ]
  const ordered = orderFiles(listed)
  assert.deepEqual([...ordered.map((file) => file.path)], [
    '/w/AGENTS.md',
    '/w/pkg/AGENTS.md',
    '/w/CLAUDE.md',
    '/home/u/.dsh/AGENTS.md',
    '/home/u/.agents/AGENTS.md',
  ])
  // The host order is left untouched; only the rendered array is reordered.
  assert.deepEqual(listed.map((file) => file.scope), ['dsh-home', 'agents-home', 'project', 'project', 'project'])
  assert.equal(orderFiles(undefined).length, 0)
})

check('the sidebar labels each file by its location', () => {
  const { scopeText, displayPathOf } = exports.__test
  assert.equal(typeof scopeText, 'function')
  const tr = (key) => messages.zh[key] === undefined ? key : messages.zh[key]
  assert.equal(scopeText({ scope: 'dsh-home', relativeDir: '' }, tr), '全局 DSH 目录')
  assert.equal(scopeText({ scope: 'agents-home', relativeDir: '' }, tr), '全局 Agents 目录')
  assert.equal(scopeText({ scope: 'project', relativeDir: '' }, tr), '工作区根目录')
  assert.equal(scopeText({ scope: 'project', relativeDir: 'pkg' }, tr), '工作区子目录 · pkg')
  assert.equal(displayPathOf({ scope: 'project', path: '/home/sjk/projects/demo/AGENTS.md', displayPath: 'AGENTS.md' }), '/home/sjk/projects/demo/AGENTS.md')
  assert.equal(displayPathOf({ scope: 'dsh-home', path: '/home/sjk/.dsh/AGENTS.md', displayPath: '~/.dsh/AGENTS.md' }), '~/.dsh/AGENTS.md')
})

check('the view starts in preview mode and offers an edit action', () => {
  const View = captured.registrations[0].component
  const element = View({ sessionId: 'session-1', t: (key) => messages.zh[key] === undefined ? key : messages.zh[key] })
  const text = JSON.stringify(element)
  assert.ok(text.includes('dsh-agents-md-preview') || text.includes('等待会话信息'))
})

check('the view shows the workspace path and its open action', () => {
  const View = captured.registrations[0].component
  const element = View({
    sessionId: 'session-1',
    t: (key) => messages.zh[key] === undefined ? key : messages.zh[key],
    useSessions: () => '/home/sjk/projects/demo',
  })
  const text = JSON.stringify(element)
  assert.ok(text.includes('dsh-agents-md-workspace'))
  assert.ok(text.includes('/home/sjk/projects/demo'))
  assert.ok(text.includes('在资源管理器中打开工作区目录'))
  // The workspace feedback sits in a row, so it can render right of the path.
  assert.ok(text.includes('dam-workspace-row'))
  assert.ok(styles[0].textContent.includes('.dam-notice-inline'))
  assert.ok(styles[0].textContent.includes('.dam-workspace-path'))
})

check('disposing the plugin removes the stylesheet', () => {
  for (const dispose of captured.disposers.reverse()) {
    if (typeof dispose === 'function') dispose()
  }
  assert.equal(styles[0].parentNode, null)
})

if (failures > 0) {
  console.error(String(failures) + ' check(s) failed')
  process.exitCode = 1
} else {
  console.log('all checks passed')
}
