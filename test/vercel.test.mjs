import { test } from 'node:test'
import assert from 'node:assert/strict'
import vercel from '../api/index.mjs'

function call(url) {
  return new Promise((resolve) => {
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }) } }
    vercel({ url, method: 'GET', headers: {}, socket: {} }, res)
  })
}

test('vercel entry routes rewritten paths to the shared handler', async () => {
  const health = await call('/api/index?route=health')
  assert.equal(health.status, 200)
  assert.equal(health.body.ok, true)
  const config = await call('/api/index?route=config')
  assert.match(config.body.wsUrl, /^wss:\/\//)
})
