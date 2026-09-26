import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhoneStore, normaliseCode, runTool, publicState } from '../phone.mjs'
import { createServer, createLimiter } from '../server.mjs'
import { buildPhoneAgent } from '../public/session.js'

test('spoken codes are normalised', () => {
  assert.equal(normaliseCode('4821'), '4821')
  assert.equal(normaliseCode('4 8 2 1'), '4821')
  assert.equal(normaliseCode('four eight two one'), '4821')
  assert.equal(normaliseCode('oh seven, one, nine'), '0719')
})

test('a phone session runs through the HTTP tools', () => {
  const store = createPhoneStore()
  const s = store.create({ mode: 'viva', name: 'Aisyah', subject: 'LeafLens', context: 'Abstract text', questions: 3 })
  assert.match(s.code, /^\d{4}$/)
  const loaded = runTool(store, 'load_session', { code: s.code.split('').join(' ') }).body
  assert.equal(loaded.ok, true)
  assert.equal(loaded.submitted_material, 'Abstract text')
  assert.equal(loaded.main_questions, 3)
  assert.equal(store.get(s.code).status, 'live')
  assert.equal(runTool(store, 'show_question', { code: s.code, number: 1, topic: 'Gap', question: 'Why?' }).body.ok, true)
  assert.equal(runTool(store, 'record_score', { code: s.code, criterion: 'nope', score: 3 }).body.ok, false)
  assert.equal(runTool(store, 'record_score', { code: s.code, criterion: 'evaluation', score: 4, evidence: 'e', tip: 't' }).body.answers_scored, 1)
  runTool(store, 'finish_session', { code: s.code, overall: 81, verdict: 'Pass', strengths: 'one string', improvements: ['a'], practice_questions: [], weakest_question: 'Why?', model_answer: 'Because.' })
  const st = publicState(store.get(s.code))
  assert.equal(st.status, 'done')
  assert.deepEqual(st.report.strengths, ['one string'])
  assert.equal(st.scores.length, 1)
  assert.ok(!('context' in st.cfg), 'material is not echoed to the viewer')
})

test('unknown code asks the caller to repeat it', () => {
  const r = runTool(createPhoneStore(), 'load_session', { code: '9999' }).body
  assert.equal(r.ok, false)
  assert.match(r.error, /read the four-digit code/)
})

test('phone agent uses HTTP tools with the secret and a code on every tool', () => {
  const a = buildPhoneAgent({ publicUrl: 'https://vv.example.com/', secret: 'shh' })
  assert.deepEqual(a.tools.map((t) => t.name), ['load_session', 'show_question', 'record_score', 'finish_session'])
  for (const t of a.tools) {
    assert.equal(t.http.url, `https://vv.example.com/api/tools/${t.name}`)
    assert.equal(t.http.http_method, 'POST')
    assert.equal(t.http.headers[0].value, 'shh')
    assert.ok(t.parameters.required.includes('code'))
    assert.ok(!('type' in t))
  }
  assert.ok(a.system_prompt.includes('load_session'))
  assert.equal(a.voice.voice_id, 'anna')
})

async function withServer(fn) {
  const old = process.env.PHONE_TOOL_SECRET
  process.env.PHONE_TOOL_SECRET = 'test-secret'
  const server = createServer({ tokenFn: async () => 't', limiter: createLimiter({ limit: 50 }) })
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  try { await fn(base) } finally { server.close(); process.env.PHONE_TOOL_SECRET = old }
}

test('server: create, call tools with the secret, watch with the key', async () => {
  await withServer(async (base) => {
    const { code, key } = await (await fetch(base + '/api/phone/session', { method: 'POST', body: JSON.stringify({ subject: 'LeafLens', context: 'x' }) })).json()
    const call = (name, body, secret = 'test-secret') => fetch(`${base}/api/tools/${name}`, { method: 'POST', headers: { 'x-vivavoice-secret': secret }, body: JSON.stringify(body) })
    assert.equal((await call('load_session', { code }, 'wrong')).status, 401)
    assert.equal((await (await call('load_session', { code })).json()).ok, true)
    await call('record_score', { code, criterion: 'technical', score: 5, evidence: 'e', tip: 't' })
    assert.equal((await fetch(`${base}/api/phone/session/${code}?key=nope`)).status, 404)
    const st = await (await fetch(`${base}/api/phone/session/${code}?key=${key}`)).json()
    assert.equal(st.status, 'live')
    assert.equal(st.scores[0].criterion, 'technical')
    assert.equal((await fetch(base + '/api/tools/load_session', { method: 'POST', headers: { 'x-vivavoice-secret': 'test-secret' }, body: '{bad' })).status, 400)
  })
})

test('server: phone disabled without a secret', async () => {
  const old = process.env.PHONE_TOOL_SECRET
  delete process.env.PHONE_TOOL_SECRET
  const server = createServer({ tokenFn: async () => 't' })
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(base + '/api/phone/session', { method: 'POST', body: '{}' })).status, 404)
    assert.equal((await fetch(base + '/api/tools/load_session', { method: 'POST', body: '{}' })).status, 401)
    assert.equal((await (await fetch(base + '/config')).json()).phoneNumber, null)
  } finally { server.close(); if (old) process.env.PHONE_TOOL_SECRET = old }
})
