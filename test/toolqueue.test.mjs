import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolResultQueue } from '../public/toolqueue.js'

test('holds results until reply.done, then flushes', () => {
  const sent = []
  const q = new ToolResultQueue((m) => sent.push(m))
  q.onEvent({ type: 'reply.started' })
  q.add('c1', { ok: true })
  assert.equal(sent.length, 0)
  q.onEvent({ type: 'reply.done' })
  assert.deepEqual(sent, [{ type: 'tool.result', call_id: 'c1', result: '{"ok":true}' }])
})

test('sends immediately when reply.done is already the latest event', () => {
  const sent = []
  const q = new ToolResultQueue((m) => sent.push(m))
  q.onEvent({ type: 'reply.done' })
  q.add('c2', 'done')
  assert.equal(sent[0].result, 'done')
})

test('drops results for an interrupted reply', () => {
  const sent = []
  const q = new ToolResultQueue((m) => sent.push(m))
  q.onEvent({ type: 'reply.started' })
  q.add('c3', {})
  q.onEvent({ type: 'reply.done', status: 'interrupted' })
  assert.equal(sent.length, 0)
})

test('does not send once the user starts talking again', () => {
  const sent = []
  const q = new ToolResultQueue((m) => sent.push(m))
  q.onEvent({ type: 'reply.done' })
  q.onEvent({ type: 'input.speech.started' })
  q.add('c4', {})
  assert.equal(sent.length, 0)
})

test('error results carry is_error', () => {
  const sent = []
  const q = new ToolResultQueue((m) => sent.push(m))
  q.onEvent({ type: 'reply.done' })
  q.add('c5', { error: 'bad' }, true)
  assert.equal(sent[0].is_error, true)
})
