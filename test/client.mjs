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
  assert.deepEqual([...exports.inject], ["slots"])
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
  assert.equal(messages.zh['scope.dsh'], '用户全局 · DSH 家目录')
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
