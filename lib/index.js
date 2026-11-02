// dsh-agents-md — Host half.
//
// Serves the "Agent docs" conversation tab: same-origin JSON routes that list,
// read, and write the AGENTS.md instruction files DSH actually loads for a
// Session — the user-global files under $DSH_HOME and $DSH_AGENTS_HOME, plus
// the project-root-to-cwd chain of AGENTS.md / CLAUDE.md (and the *.local.md
// variants).
//
// The client half (`lib/client.js`) renders the tab and talks to these routes.
// Writes are atomic (tmp file + rename) and version-checked (sha256 of the
// bytes the editor started from), so an out-of-band edit is reported as a
// conflict instead of being silently overwritten.
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'

/** Cordis plugin name. */
export const name = 'dsh-agents-md'
/** Services this plugin needs before `apply` runs. */
export const inject = ['webServer']

const ROUTE_PREFIX = '/__dsh-agents-md/'
const ROUTE_OWNER = 'dsh-agents-md'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024
/** Matches the base `agent-instructions` config budget in dsh-base. */
const INSTRUCTION_BUDGET_BYTES = 65536
const USER_GLOBAL_FILENAMES = ['AGENTS.md']
const PROJECT_FILENAMES = ['AGENTS.md', 'CLAUDE.md']
const PROJECT_LOCAL_FILENAMES = ['AGENTS.local.md', 'CLAUDE.local.md']
const PROJECT_ROOT_MARKERS = ['.git']

/** One request-level failure carrying the JSON code the client shows. */
class RequestError extends Error {
  /**
   * @param {string} code - stable machine code.
   * @param {string} message - human-readable detail (English, for logs).
   * @param {number} [status] - HTTP status.
   */
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

/**
 * Expand the `~` forms the harness home-path resolver accepts.
 * @param {string} value - configured path.
 * @returns {string} expanded path.
 */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homedir(), value.slice(2))
  return value
}

/**
 * Resolve one harness home directory from its environment override.
 * @param {string} envName - environment variable name.
 * @param {string} directoryName - default directory name under the user home.
 * @returns {string} absolute home directory.
 */
function resolveHome(envName, directoryName) {
  const configured = typeof process.env[envName] === 'string' ? process.env[envName].trim() : ''
  return path.resolve(configured === '' ? path.join(homedir(), directoryName) : expandHome(configured))
}

/**
 * Stat a path, treating a missing path as absent.
 * @param {string} target - absolute path.
 * @returns {Promise<import('node:fs').Stats | null>} stats or null.
 */
async function statOrNull(target) {
  try {
    return await stat(target)
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw error
  }
}

/**
 * @param {string} target - absolute path.
 * @returns {Promise<boolean>} whether the path is a directory.
 */
async function isDirectory(target) {
  const info = await statOrNull(target)
  return info !== null && info.isDirectory()
}

/**
 * Find the nearest ancestor carrying a project-root marker.
 * @param {string} cwd - Session working directory.
 * @returns {Promise<string>} project root, or `cwd` when no marker exists.
 */
async function findProjectRoot(cwd) {
  let current = path.resolve(cwd)
  for (;;) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (await statOrNull(path.join(current, marker)) !== null) return current
    }
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(cwd)
    current = parent
  }
}

/**
 * Build the inclusive root-to-cwd directory chain.
 * @param {string} root - broadest directory.
 * @param {string} target - most specific directory.
 * @returns {string[]} directories ordered root first.
 */
function ancestorChain(root, target) {
  const resolvedRoot = path.resolve(root)
  const chain = []
  let current = path.resolve(target)
  while (current !== resolvedRoot) {
    chain.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

/**
 * List every instruction-file candidate DSH would consider for a workspace.
 * Missing files stay in the list only when they are the primary AGENTS.md of a
 * user-global root or of the workspace boundary (so the editor can create it).
 * @param {string} cwd - Session working directory.
 * @returns {Promise<{dshHome: string, agentsHome: string, projectRoot: string, entries: object[]}>} discovery.
 */
async function discover(cwd) {
  const dshHome = resolveHome('DSH_HOME', '.dsh')
  const agentsHome = resolveHome('DSH_AGENTS_HOME', '.agents')
  const projectRoot = await findProjectRoot(cwd)
  const entries = []
  const seen = new Set()

  /**
   * @param {string} target - candidate path.
   * @param {object} meta - scope metadata.
   */
  const add = (target, meta) => {
    const absolute = path.resolve(target)
    if (seen.has(absolute)) return
    seen.add(absolute)
    entries.push({ path: absolute, ...meta })
  }

  add(path.join(dshHome, USER_GLOBAL_FILENAMES[0]), {
    scope: 'dsh-home',
    relativeDir: '',
    fileName: USER_GLOBAL_FILENAMES[0],
    create: true,
  })
  add(path.join(agentsHome, USER_GLOBAL_FILENAMES[0]), {
    scope: 'agents-home',
    relativeDir: '',
    fileName: USER_GLOBAL_FILENAMES[0],
    create: await isDirectory(agentsHome),
  })

  for (const directory of ancestorChain(projectRoot, cwd)) {
    const relativeDir = path.relative(projectRoot, directory)
    const boundary = relativeDir === '' || directory === path.resolve(cwd)
    for (const fileName of PROJECT_FILENAMES) {
      add(path.join(directory, fileName), {
        scope: 'project',
        relativeDir,
        fileName,
        create: fileName === 'AGENTS.md' && boundary,
      })
    }
    for (const fileName of PROJECT_LOCAL_FILENAMES) {
      add(path.join(directory, fileName), {
        scope: 'project',
        relativeDir,
        fileName,
        create: false,
      })
    }
  }

  return { dshHome, agentsHome, projectRoot, entries }
}

/**
 * Render a compact path for the client (`~/...` for home files).
 * @param {{scope: string, path: string, relativeDir: string, fileName: string}} entry - candidate.
 * @returns {string} display path.
 */
function displayPathFor(entry) {
  if (entry.scope === 'project') {
    const relative = entry.relativeDir === '' ? entry.fileName : path.join(entry.relativeDir, entry.fileName)
    return relative.split(path.sep).join('/')
  }
  const home = homedir()
  const relative = path.relative(home, entry.path)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return entry.path
  return '~/' + relative.split(path.sep).join('/')
}

/**
 * @param {Buffer} buffer - file bytes.
 * @returns {string} hex sha256.
 */
function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Resolve one request `cwd`.
 * @param {object} body - request body.
 * @returns {Promise<string>} resolved directory.
 */
async function requireCwd(body) {
  const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
  if (cwd === '' || !path.isAbsolute(cwd)) throw new RequestError('CWD_REQUIRED', 'cwd must be an absolute path')
  const resolved = path.resolve(cwd)
  const info = await statOrNull(resolved)
  if (info === null || !info.isDirectory()) throw new RequestError('CWD_INVALID', 'cwd is not a directory')
  return resolved
}

/**
 * Resolve one requested instruction file against a fresh discovery pass.
 * @param {string} cwd - resolved working directory.
 * @param {unknown} requested - requested absolute path.
 * @returns {Promise<object>} discovery entry.
 */
async function requireEntry(cwd, requested) {
  if (typeof requested !== 'string' || requested.trim() === '') throw new RequestError('PATH_REQUIRED', 'path is required')
  const absolute = path.resolve(requested)
  const discovery = await discover(cwd)
  const entry = discovery.entries.find((candidate) => candidate.path === absolute)
  if (entry === undefined) throw new RequestError('PATH_NOT_ALLOWED', 'path is not an instruction file for this workspace', 403)
  return entry
}

/**
 * List instruction files and the shared byte budget.
 * @param {object} body - request body.
 * @returns {Promise<object>} list payload.
 */
async function listFiles(body) {
  const cwd = await requireCwd(body)
  const discovery = await discover(cwd)
  const files = []
  let totalBytes = 0
  for (const entry of discovery.entries) {
    const info = await statOrNull(entry.path)
    if (info === null) {
      if (!entry.create) continue
      files.push({
        path: entry.path,
        displayPath: displayPathFor(entry),
        scope: entry.scope,
        relativeDir: entry.relativeDir,
        fileName: entry.fileName,
        exists: false,
        size: 0,
        mtimeMs: null,
        creatable: true,
      })
      continue
    }
    if (!info.isFile()) continue
    totalBytes += info.size
    files.push({
      path: entry.path,
      displayPath: displayPathFor(entry),
      scope: entry.scope,
      relativeDir: entry.relativeDir,
      fileName: entry.fileName,
      exists: true,
      size: info.size,
      mtimeMs: info.mtimeMs,
      creatable: entry.create,
    })
  }
  return {
    ok: true,
    cwd,
    projectRoot: discovery.projectRoot,
    budget: INSTRUCTION_BUDGET_BYTES,
    totalBytes,
    files,
  }
}

/**
 * Read one instruction file, returning its content hash as the edit version.
 * @param {object} body - request body.
 * @returns {Promise<object>} read payload.
 */
async function readInstruction(body) {
  const cwd = await requireCwd(body)
  const entry = await requireEntry(cwd, body.path)
  const info = await statOrNull(entry.path)
  if (info === null) {
    return { ok: true, path: entry.path, exists: false, content: '', version: null, size: 0, mtimeMs: null }
  }
  if (!info.isFile()) throw new RequestError('NOT_A_FILE', 'path is not a regular file')
  if (info.size > MAX_FILE_BYTES) throw new RequestError('FILE_TOO_LARGE', 'file exceeds the editable size limit', 413)
  const buffer = await readFile(entry.path)
  return {
    ok: true,
    path: entry.path,
    exists: true,
    content: buffer.toString('utf8'),
    version: digest(buffer),
    size: info.size,
    mtimeMs: info.mtimeMs,
  }
}

/**
 * Atomically replace (or create) one instruction file after a version check.
 * @param {object} body - request body.
 * @returns {Promise<object>} write payload.
 */
async function writeInstruction(body) {
  const cwd = await requireCwd(body)
  const entry = await requireEntry(cwd, body.path)
  if (typeof body.content !== 'string') throw new RequestError('CONTENT_REQUIRED', 'content must be a string')
  const buffer = Buffer.from(body.content, 'utf8')
  if (buffer.byteLength > MAX_FILE_BYTES) throw new RequestError('FILE_TOO_LARGE', 'content exceeds the editable size limit', 413)
  const expected = body.version === null || body.version === undefined ? null : body.version
  if (expected !== null && typeof expected !== 'string') throw new RequestError('VERSION_INVALID', 'version must be a string or null')

  const info = await statOrNull(entry.path)
  if (info !== null && !info.isFile()) throw new RequestError('NOT_A_FILE', 'path is not a regular file')
  const current = info === null ? null : await readFile(entry.path)
  const currentVersion = current === null ? null : digest(current)
  if (expected === null && current !== null) throw new RequestError('CONFLICT', 'file already exists', 409)
  if (expected !== null && (currentVersion === null || currentVersion !== expected)) {
    throw new RequestError('CONFLICT', 'file changed on disk', 409)
  }

  const directory = path.dirname(entry.path)
  await mkdir(directory, { recursive: true })
  const mode = info === null ? 0o644 : info.mode & 0o777
  const temporary = path.join(directory, '.' + path.basename(entry.path) + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp')
  try {
    await writeFile(temporary, buffer, { mode })
    await chmod(temporary, mode)
    await rename(temporary, entry.path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  const after = await stat(entry.path)
  return { ok: true, path: entry.path, version: digest(buffer), size: after.size, mtimeMs: after.mtimeMs }
}

const actions = {
  list: listFiles,
  read: readInstruction,
  write: writeInstruction,
}

/**
 * Write one JSON response with the headers this plugin always uses.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {object} data - JSON-serializable body.
 * @param {number} [status] - HTTP status.
 */
function sendJson(res, data, status = 200) {
  const text = JSON.stringify(data)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(text))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(text)
}

/**
 * Read a bounded JSON request body without destroying the socket on overflow.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<object>} parsed body or a marker object.
 */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let total = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      if (settled) return
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        finish({ __tooLarge: true })
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') return finish({})
      let body
      try {
        body = JSON.parse(text)
      } catch {
        return finish({ __malformed: true })
      }
      finish(body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {})
    })
  })
}

/**
 * Build the request handler for one action.
 * @param {string} action - action name.
 * @returns {Function} node request handler.
 */
function handlerFor(action) {
  return (req, res) => {
    req.on('error', () => {})
    res.on('error', () => {})
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      sendJson(res, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' }, 405)
      return
    }
    void readBody(req).then((body) => {
      if (body.__tooLarge) {
        res.setHeader('Connection', 'close')
        sendJson(res, { ok: false, code: 'BODY_TOO_LARGE', message: 'request body too large' }, 413)
        return
      }
      if (body.__malformed) {
        sendJson(res, { ok: false, code: 'BODY_MALFORMED', message: 'invalid JSON body' }, 400)
        return
      }
      return Promise.resolve(actions[action](body)).then((result) => {
        sendJson(res, result)
      }, (error) => {
        if (error instanceof RequestError) {
          sendJson(res, { ok: false, code: error.code, message: error.message }, error.status)
          return
        }
        console.error('[dsh-agents-md] action ' + action + ' failed:', error)
        sendJson(res, { ok: false, code: 'INTERNAL', message: 'internal error' }, 500)
      })
    })
  }
}

/**
 * Register the plugin routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) throw new Error('dsh-agents-md: the webServer service is unavailable')

  let nextRouteGeneration = 0
  const routeGenerations = new Map()

  /**
   * Claim one exact route for this instance, evicting only a previous instance
   * of this plugin (a hot-reload of the host half).
   * @param {object} route - the route to register.
   * @returns {{dispose: () => void}} the claim.
   */
  function claimRoute(route) {
    const owned = { ...route, owner: ROUTE_OWNER }
    const generation = ++nextRouteGeneration
    const register = () => webServer.register(owned)
    let dispose
    try {
      dispose = register()
    } catch (error) {
      const table = webServer.exact
      const previous = table instanceof Map ? table.get(owned.path) : undefined
      if (previous === undefined || (previous.owner !== undefined && previous.owner !== ROUTE_OWNER)) throw error
      table.delete(owned.path)
      dispose = register()
    }
    routeGenerations.set(owned.path, generation)
    return {
      dispose: () => {
        if (routeGenerations.get(owned.path) !== generation) return
        routeGenerations.delete(owned.path)
        dispose()
      },
    }
  }

  const claims = []
  for (const action of Object.keys(actions)) {
    try {
      claims.push(claimRoute({ kind: 'exact', path: ROUTE_PREFIX + action, handler: handlerFor(action) }))
    } catch (error) {
      for (const claim of claims.splice(0)) claim.dispose()
      throw error
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const claim of claims.splice(0)) claim.dispose()
    }, 'dsh-agents-md: routes')
  }
}
