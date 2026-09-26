#!/usr/bin/env node
// VivaVoice server. Zero dependencies, Node 18+.
//
//   npm start            -> http://localhost:3000
//
// It does three things: serves the static app in ./public, mints short-lived
// AssemblyAI Voice Agent tokens so the API key never reaches the browser, and
// answers /health for hosting platforms. Everything else (the examiner
// persona, tools, scorecard) is configured per session in the browser.

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPhoneStore, publicState, runTool, secretMatches } from './phone.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PUBLIC = join(ROOT, 'public')

// --- env -------------------------------------------------------------------
export function loadEnv(path = join(ROOT, '.env')) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || m[1] in process.env) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

// --- token rate limit ------------------------------------------------------
// A public demo URL can start sessions billed to your key, so each IP gets a
// small number of tokens per window. Tune with TOKENS_PER_HOUR.
export function createLimiter({ limit = 20, windowMs = 3_600_000, now = Date.now } = {}) {
  const hits = new Map()
  return (key) => {
    const t = now()
    const recent = (hits.get(key) || []).filter((at) => t - at < windowMs)
    if (recent.length >= limit) {
      hits.set(key, recent)
      return false
    }
    recent.push(t)
    hits.set(key, recent)
    return true
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

// Resolves a URL path inside ./public, refusing anything that escapes it.
export function resolveStatic(urlPath) {
  let clean
  try { clean = decodeURIComponent(urlPath.split('?')[0]) } catch { return null }
  const rel = normalize(clean === '/' ? '/index.html' : clean).replace(/^([/\\])+/, '')
  const full = join(PUBLIC, rel)
  if (!full.startsWith(PUBLIC)) return null
  return full
}

const API_BASE = () => process.env.AGENTS_API_BASE || 'https://agents.assemblyai.com/v1'

async function mintToken() {
  const url = new URL(API_BASE() + '/token')
  url.searchParams.set('product', 'voice_agent')
  url.searchParams.set('expires_in_seconds', '60')
  // A viva runs ~10 minutes; cap sessions at 20 so a forgotten tab stops billing.
  url.searchParams.set('max_session_duration_seconds', process.env.MAX_SESSION_SECONDS || '1800')
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`token request failed (${res.status}): ${text}`)
  const { token } = JSON.parse(text)
  if (!token) throw new Error('token response had no token field')
  return token
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readJson(req, max = 32_000) {
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > max) throw Object.assign(new Error('body too large'), { status: 413 })
    chunks.push(c)
  }
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }) }
}

const clientIp = (req) => {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
  return (process.env.TRUST_PROXY && xff.at(-1)) || req.socket.remoteAddress
}

export function createServer({ limiter = createLimiter({ limit: Number(process.env.TOKENS_PER_HOUR) || 20 }), tokenFn = mintToken, phone = createPhoneStore() } = {}) {
  return http.createServer(async (req, res) => {
    try { await route(req, res) } catch (error) {
      if (!error.status) console.error(error)
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'server error' })
    }
  })
  async function route(req, res) {
    const path = (req.url || '/').split('?')[0]

    if (path === '/health') return send(res, 200, { ok: true, key: Boolean(process.env.ASSEMBLYAI_API_KEY) })

    // Lets a regional deployment (or the test suite) point the browser at another socket.
    if (path === '/config') {
      return send(res, 200, {
        wsUrl: process.env.AGENTS_WS_URL || 'wss://agents.assemblyai.com/v1/ws',
        maxSessionSeconds: Number(process.env.MAX_SESSION_SECONDS) || 1800,
        // Shown only when the phone examiner is set up (npm run phone).
        phoneNumber: process.env.PHONE_TOOL_SECRET ? process.env.PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || null : null,
      })
    }

    // ---- phone-in: the student's browser creates a session and watches it
    if (path === '/api/phone/session' && req.method === 'POST') {
      if (!process.env.PHONE_TOOL_SECRET) return send(res, 404, { error: 'Phone practice is not set up on this server.' })
      if (!limiter(clientIp(req))) return send(res, 429, { error: 'Too many sessions from this address. Try again later.' })
      const s = phone.create(await readJson(req))
      if (!s) return send(res, 503, { error: 'Too many active phone sessions. Try again shortly.' })
      return send(res, 200, { code: s.code, key: s.key })
    }
    const watch = path.match(/^\/api\/phone\/session\/(\d{4})$/)
    if (watch && req.method === 'GET') {
      const s = phone.get(watch[1])
      const key = new URL(req.url, 'http://x').searchParams.get('key')
      if (!s || !secretMatches(key, s.key)) return send(res, 404, { error: 'No such session' })
      return send(res, 200, publicState(s))
    }

    // ---- phone-in: HTTP tools that AssemblyAI calls during the phone call
    const tool = path.match(/^\/api\/tools\/([a-z_]+)$/)
    if (tool) {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
      if (!secretMatches(req.headers['x-vivavoice-secret'], process.env.PHONE_TOOL_SECRET)) return send(res, 401, { error: 'unauthorised' })
      const r = runTool(phone, tool[1], await readJson(req))
      return send(res, r.status, r.body)
    }

    if (path === '/token') {
      if (req.method !== 'GET') return send(res, 405, { error: 'GET only' })
      // Behind a proxy (Render sets TRUST_PROXY in render.yaml) the client IP is
      // the last hop the proxy appended; otherwise the header is untrusted.
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
      const ip = (process.env.TRUST_PROXY && xff.at(-1)) || req.socket.remoteAddress
      if (!limiter(ip)) return send(res, 429, { error: 'Too many sessions from this address. Try again later.' })
      // Same-origin check: a token is money, so other sites can't mint them.
      const origin = req.headers.origin
      const allowed = process.env.PUBLIC_ORIGIN
      // Browsers send Origin on cross-site fetches and Sec-Fetch-Site on all; a
      // token request from another site, or from a script with no browser headers, is refused.
      const site = req.headers['sec-fetch-site']
      if (allowed && ((origin && origin !== allowed) || (!origin && site && site !== 'same-origin' && site !== 'none'))) return send(res, 403, { error: 'origin not allowed' })
      try {
        return send(res, 200, { token: await tokenFn() })
      } catch (error) {
        console.error(error.message)
        return send(res, 502, { error: 'Could not get a session token. Check ASSEMBLYAI_API_KEY.' })
      }
    }

    const file = resolveStatic(path)
    if (!file) return send(res, 404, 'not found', 'text/plain')
    try {
      const info = await stat(file)
      if (!info.isFile()) throw new Error('not a file')
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      })
      res.end(body)
    } catch {
      send(res, 404, 'not found', 'text/plain')
    }
  }
}

// --- main ------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  loadEnv()
  if (!process.env.ASSEMBLYAI_API_KEY) {
    console.error('Missing ASSEMBLYAI_API_KEY. Put it in .env (see .env.example).')
    process.exit(1)
  }
  const server = createServer()
  let port = Number(process.env.PORT) || 3000
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !process.env.PORT && port < 3010) return server.listen(++port)
    throw err
  })
  server.on('listening', () => console.log(`VivaVoice is running: http://localhost:${port}`))
  server.listen(port)
}
