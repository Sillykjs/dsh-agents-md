// Smoke test for the host half. Starts a throwaway HTTP server, registers the
// plugin's routes against a fake `webServer`, and drives them over real HTTP.
//
// Run with: node test/smoke.mjs
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(tmpdir(), 'dsh-agents-md-'))
const dshHome = path.join(root, 'dsh-home')
const agentsHome = path.join(root, 'agents-home')
const workspace = path.join(root, 'workspace')
const nested = path.join(workspace, 'nested')
await mkdir(dshHome, { recursive: true })
await mkdir(path.join(workspace, '.git'), { recursive: true })
await mkdir(nested, { recursive: true })
await writeFile(path.join(dshHome, 'AGENTS.md'), '# global rules\n')
await writeFile(path.join(workspace, 'AGENTS.md'), '# root rules\n')
process.env.DSH_HOME = dshHome
process.env.DSH_AGENTS_HOME = agentsHome

const plugin = await import('../lib/index.js')
const routes = new Map()
const webServer = {
  exact: new Map(),
  /**
   * @param {object} route - route definition.
   * @returns {Function} disposer.
   */
  register(route) {
    if (routes.has(route.path)) throw new Error('duplicate route ' + route.path)
    routes.set(route.path, route)
    this.exact.set(route.path, route)
    return () => {
      routes.delete(route.path)
      this.exact.delete(route.path)
    }
  },
}
const disposers = []
const ctx = {
  /**
   * @param {string} serviceName - service name.
   * @returns {object | undefined} fake service.
   */
  get(serviceName) {
    return serviceName === 'webServer' ? webServer : undefined
  },
  /**
   * @param {Function} execute - effect body.
   * @returns {Function} disposer.
   */
  effect(execute) {
    const dispose = execute()
    disposers.push(dispose)
    return dispose
  },
}
plugin.apply(ctx)
assert.deepEqual([...routes.keys()].sort(), [
  '/__dsh-agents-md/list',
  '/__dsh-agents-md/open',
  '/__dsh-agents-md/read',
  '/__dsh-agents-md/write',
])

const server = createServer((req, res) => {
  const route = routes.get(req.url)
  if (route === undefined) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  route.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + String(server.address().port)
const prefix = base + '/__dsh-agents-md/'

/**
 * @param {string} action - route action.
 * @param {object} payload - JSON body.
 * @returns {Promise<{status: number, body: object}>} response.
 */
async function call(action, payload) {
  const response = await fetch(prefix + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: response.status, body: await response.json() }
}

let failures = 0
/**
 * @param {string} label - check label.
 * @param {Function} run - check body.
 */
async function check(label, run) {
  try {
    await run()
    console.log('ok   ' + label)
  } catch (error) {
    failures += 1
    console.log('FAIL ' + label)
    console.log('     ' + String(error && error.message ? error.message : error))
  }
}

try {
  const dshFile = path.join(dshHome, 'AGENTS.md')
  const rootFile = path.join(workspace, 'AGENTS.md')
  const nestedFile = path.join(nested, 'AGENTS.md')
  let version = null

  await check('list discovers the dsh home, project root and cwd boundary', async () => {
    const { status, body } = await call('list', { cwd: nested })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.projectRoot, workspace)
    assert.equal(body.budget, 65536)
    const byPath = new Map(body.files.map((file) => [file.path, file]))
    assert.equal(byPath.get(dshFile).scope, 'dsh-home')
    assert.equal(byPath.get(dshFile).exists, true)
    assert.equal(byPath.get(rootFile).scope, 'project')
    assert.equal(byPath.get(rootFile).relativeDir, '')
    assert.equal(byPath.get(rootFile).exists, true)
    assert.equal(byPath.get(nestedFile).exists, false)
    assert.equal(byPath.get(nestedFile).creatable, true)
    assert.equal(byPath.get(nestedFile).displayPath, 'nested/AGENTS.md')
    assert.equal(body.totalBytes, 28)
    assert.equal(body.files.some((file) => file.scope === 'agents-home'), false)
  })

  await check('read returns the content and a sha256 version', async () => {
    const { status, body } = await call('read', { cwd: nested, path: dshFile })
    assert.equal(status, 200)
    assert.equal(body.content, '# global rules\n')
    assert.equal(body.version.length, 64)
    version = body.version
  })

  await check('read reports a missing creatable file without an error', async () => {
    const { body } = await call('read', { cwd: nested, path: nestedFile })
    assert.equal(body.exists, false)
    assert.equal(body.content, '')
    assert.equal(body.version, null)
  })

  await check('write replaces the file after a matching version check', async () => {
    const { status, body } = await call('write', { cwd: nested, path: dshFile, content: '# global v2\n', version })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.size, 12)
    assert.equal(await readFile(dshFile, 'utf8'), '# global v2\n')
    version = body.version
  })

  await check('write rejects a stale version with CONFLICT and keeps the file', async () => {
    const { status, body } = await call('write', { cwd: nested, path: dshFile, content: '# clobbered\n', version: 'f'.repeat(64) })
    assert.equal(status, 409)
    assert.equal(body.code, 'CONFLICT')
    assert.equal(await readFile(dshFile, 'utf8'), '# global v2\n')
  })

  await check('write creates a missing file only when version is null', async () => {
    const { status, body } = await call('write', { cwd: nested, path: nestedFile, content: '# nested\n', version: null })
    assert.equal(status, 200)
    assert.equal(await readFile(nestedFile, 'utf8'), '# nested\n')
    const again = await call('write', { cwd: nested, path: nestedFile, content: '# again\n', version: null })
    assert.equal(again.status, 409)
    assert.equal(again.body.code, 'CONFLICT')
    assert.equal(body.ok, true)
  })

  await check('write refuses a path outside the workspace instruction set', async () => {
    const { status, body } = await call('write', { cwd: nested, path: '/etc/passwd', content: 'x', version: null })
    assert.equal(status, 403)
    assert.equal(body.code, 'PATH_NOT_ALLOWED')
  })

  await check('requests require an absolute, existing cwd', async () => {
    const missing = await call('list', {})
    assert.equal(missing.status, 400)
    assert.equal(missing.body.code, 'CWD_REQUIRED')
    const relative = await call('list', { cwd: 'relative/dir' })
    assert.equal(relative.status, 400)
    const absent = await call('list', { cwd: path.join(root, 'absent') })
    assert.equal(absent.status, 400)
    assert.equal(absent.body.code, 'CWD_INVALID')
  })

  await check('open validates the workspace directory before launching', async () => {
    const missing = await call('open', {})
    assert.equal(missing.status, 400)
    assert.equal(missing.body.code, 'CWD_REQUIRED')
    const absent = await call('open', { cwd: path.join(root, 'absent') })
    assert.equal(absent.status, 400)
    assert.equal(absent.body.code, 'CWD_INVALID')
  })

  await check('WSL directories translate to a Windows path Explorer accepts', async () => {
    const translated = await plugin.__test.windowsPathFor(workspace)
    const procVersion = await readFile('/proc/version', 'utf8').catch(() => '')
    if (process.platform !== 'linux' || !/microsoft/i.test(procVersion)) {
      assert.equal(translated, null)
      return
    }
    assert.equal(typeof translated, 'string')
    assert.match(translated, /^(?:[A-Za-z]:\\\\|\\\\wsl)/)
  })

  await check('non-POST requests are rejected', async () => {
    const response = await fetch(prefix + 'list')
    assert.equal(response.status, 405)
    assert.equal((await response.json()).code, 'METHOD_NOT_ALLOWED')
  })

  await check('disposing the plugin removes its routes', async () => {
    for (const dispose of disposers.reverse()) {
      if (typeof dispose === 'function') dispose()
    }
    assert.equal(routes.size, 0)
  })
} finally {
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(String(failures) + ' check(s) failed')
  process.exitCode = 1
} else {
  console.log('all checks passed')
}
