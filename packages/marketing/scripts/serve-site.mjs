#!/usr/bin/env node
/**
 * Static file server for site/ — zero dependencies, Node builtins only.
 *
 * Exists because `python3 -m http.server` runs in the foreground of whatever shell
 * started it, so it dies with the terminal. This one ignores SIGHUP and keeps its
 * own stdout writes from throwing once the pty is gone, so backgrounding it with
 * `&` or `nohup` is enough to outlive the tab. Ctrl-C still stops it.
 *
 * Live reload: HTML responses get a small script that subscribes to /__reload
 * (server-sent events); a change anywhere under the root reloads every open
 * tab. --no-reload serves the files untouched.
 *
 *   node scripts/serve-site.mjs [--port 4321] [--root site] [--no-reload]
 */

import { createServer } from 'node:http'
import { createReadStream, watch } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}

const PORT = Number(flag('port', 4321))
const HOST = flag('host', '127.0.0.1')
const ROOT = resolve(flag('root', 'site'))
const RELOAD = !args.includes('--no-reload')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** Resolve a URL path inside ROOT, or null if it tries to escape. */
function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  const full = resolve(join(ROOT, normalize(decoded)))
  return full === ROOT || full.startsWith(ROOT + sep) ? full : null
}

async function resolveFile(path) {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) return { path, size: info.size }
    const index = join(path, 'index.html')
    const indexInfo = await stat(index)
    return { path: index, size: indexInfo.size }
  } catch {
    return null
  }
}

// ---- live reload -----------------------------------------------------------

const RELOAD_PATH = '/__reload'
const RELOAD_SNIPPET = `<script>/* injected by serve-site.mjs; not in the deployed page */
new EventSource('${RELOAD_PATH}').addEventListener('message', function () { location.reload() })
</script>`
const reloadClients = new Set()

function openReloadStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  res.write(': connected\n\n')
  reloadClients.add(res)
  req.on('close', () => reloadClients.delete(res))
}

if (RELOAD) {
  // One trailing-edge debounce across all events: editors write files in
  // bursts (temp file, rename, metadata), and one reload covers the burst.
  let pending
  watch(ROOT, { recursive: true }, (_event, name) => {
    clearTimeout(pending)
    pending = setTimeout(() => {
      write(`  reload ${name ?? ''} -> ${reloadClients.size} client(s)\n`)
      for (const client of reloadClients) client.write('data: reload\n\n')
    }, 80)
  })
}

// ----------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const started = Date.now()
  const send = (code, body = '') => {
    res.writeHead(code, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
    log(code, req, started)
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed\n')

  if (RELOAD && req.url.split('?')[0] === RELOAD_PATH) return openReloadStream(req, res)

  const path = safePath(req.url)
  if (!path) return send(403, 'forbidden\n')

  const file = await resolveFile(path)
  if (!file) return send(404, 'not found\n')

  const type = TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream'
  const headers = {
    'content-type': type,
    'content-length': file.size,
    // Never cache: editing the favicon or CSS and hard-reloading should be enough,
    // and browsers hold onto favicons far longer than is useful while iterating.
    'cache-control': 'no-store, must-revalidate',
  }

  // HTML is buffered instead of streamed so the reload client can ride along.
  if (RELOAD && type.startsWith('text/html')) {
    let html
    try {
      html = await readFile(file.path, 'utf8')
    } catch {
      return send(404, 'not found\n')
    }
    const closing = html.lastIndexOf('</body>')
    const body =
      closing === -1
        ? html + RELOAD_SNIPPET
        : html.slice(0, closing) + RELOAD_SNIPPET + html.slice(closing)
    headers['content-length'] = Buffer.byteLength(body)
    res.writeHead(200, headers)
    log(200, req, started)
    return res.end(req.method === 'HEAD' ? undefined : body)
  }

  res.writeHead(200, headers)
  log(200, req, started)
  if (req.method === 'HEAD') return res.end()

  const stream = createReadStream(file.path)
  stream.on('error', () => res.destroy()) // file vanished mid-read
  res.on('close', () => stream.destroy()) // client hung up
  stream.pipe(res)
})

function log(code, req, started) {
  const mark = code >= 400 ? '!' : ' '
  write(`${mark} ${code} ${req.method} ${req.url} ${Date.now() - started}ms\n`)
}

/** Writing to a closed pty throws EIO; a log line is never worth dying over. */
function write(line) {
  try {
    process.stdout.write(line)
  } catch {}
}
process.stdout.on('error', () => {})

// A dropped connection or a client that hangs up mid-response must not be fatal.
server.on('clientError', (_err, socket) => socket.destroy())
process.on('uncaughtException', (err) => {
  if (['EPIPE', 'ECONNRESET', 'EIO'].includes(err.code)) return
  write(`! fatal ${err.stack ?? err}\n`)
  process.exit(1)
})

// Survive the terminal closing. Ctrl-C (SIGINT) and SIGTERM still stop it.
process.on('SIGHUP', () => write('  ignoring SIGHUP; still serving\n'))
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    write(`\n  ${sig} — shutting down\n`)
    // SSE streams never end on their own and would hold server.close() open.
    for (const client of reloadClients) client.end()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  })
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    write(`! port ${PORT} is already in use — pass --port to pick another\n`)
    process.exit(1)
  }
  throw err
})

server.listen(PORT, HOST, () => {
  write(`  serving ${ROOT}\n  http://${HOST}:${PORT}/\n`)
})
