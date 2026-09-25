import test from 'node:test'
import assert from 'node:assert/strict'
import { createLimiter, createServer, resolveStatic } from '../server.mjs'

async function withServer(opts, fn) {
  const server = createServer(opts)
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  try { await fn(base) } finally { server.close() }
}

test('serves the app, health and config', async () => {
  await withServer({ tokenFn: async () => 'tok' }, async (base) => {
    const html = await (await fetch(base + '/')).text()
    assert.match(html, /VivaVoice/)
    assert.equal((await fetch(base + '/health')).status, 200)
    const conf = await (await fetch(base + '/config')).json()
    assert.match(conf.wsUrl, /^wss:\/\//)
  })
})

test('mints a token without exposing the key', async () => {
  await withServer({ tokenFn: async () => 'tok123' }, async (base) => {
    const res = await fetch(base + '/token')
    assert.deepEqual(await res.json(), { token: 'tok123' })
  })
})

test('rate limits token minting per IP', async () => {
  await withServer({ tokenFn: async () => 't', limiter: createLimiter({ limit: 2 }) }, async (base) => {
    assert.equal((await fetch(base + '/token')).status, 200)
    assert.equal((await fetch(base + '/token')).status, 200)
    assert.equal((await fetch(base + '/token')).status, 429)
  })
})

test('token failure is a clean 502', async () => {
  await withServer({ tokenFn: async () => { throw new Error('nope') } }, async (base) => {
    const res = await fetch(base + '/token')
    assert.equal(res.status, 502)
  })
})

test('static paths cannot escape public/', () => {
  assert.equal(resolveStatic('/../server.mjs')?.endsWith('server.mjs') && !resolveStatic('/../server.mjs').includes('/public/'), false)
  assert.ok(resolveStatic('/app.js').endsWith('public/app.js'))
  assert.ok(resolveStatic('/').endsWith('public/index.html'))
})

test('limiter window expires', () => {
  let t = 0
  const lim = createLimiter({ limit: 1, windowMs: 1000, now: () => t })
  assert.equal(lim('a'), true)
  assert.equal(lim('a'), false)
  t = 1500
  assert.equal(lim('a'), true)
})
