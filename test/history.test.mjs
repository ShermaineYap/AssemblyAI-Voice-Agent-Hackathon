import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHistory, saveSession, makeEntry, compareToPrevious, sparkline } from '../public/history.js'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }
const stats = [{ id: 'a', name: 'A', avg: 4 }, { id: 'b', name: 'B', avg: 2.5 }, { id: 'c', name: 'C', avg: null }]
const cfg = { mode: 'viva', subject: 'LeafLens' }

test('entries record the weakest scored criterion', () => {
  const e = makeEntry({ cfg, overall: 70, metrics: { fillersPer100: 2.5, avgThinkSec: 3, wpm: 150 }, stats })
  assert.deepEqual(e.weakest, { id: 'b', name: 'B', avg: 2.5 })
  assert.deepEqual(e.criteria, { a: 4, b: 2.5 })
})

test('save, load and cap at 30', () => {
  const s = mem()
  for (let i = 0; i < 35; i++) saveSession(s, { overall: i })
  const list = loadHistory(s)
  assert.equal(list.length, 30)
  assert.equal(list[0].overall, 5)
})

test('compares with the previous session on the same subject', () => {
  const s = mem()
  saveSession(s, { subject: 'Other', overall: 90, fillersPer100: 1, avgThinkSec: 1 })
  saveSession(s, { subject: 'LeafLens', overall: 60, fillersPer100: 4, avgThinkSec: 5 })
  const entry = { subject: 'LeafLens', overall: 72, fillersPer100: 2.5, avgThinkSec: 3.2 }
  const cmp = compareToPrevious(loadHistory(s), entry)
  assert.equal(cmp.prev.overall, 60)
  assert.equal(cmp.overall, 12)
  assert.equal(cmp.fillersPer100, -1.5)
  assert.equal(cmp.avgThinkSec, -1.8)
  assert.equal(compareToPrevious([], entry), null)
})

test('corrupt storage is treated as empty', () => {
  const s = mem(); s.setItem('vivavoice.history.v1', '{nope')
  assert.deepEqual(loadHistory(s), [])
})

test('sparkline points', () => {
  assert.equal(sparkline([0, 100], 100, 10, 0, 100), '0.0,10.0 100.0,0.0')
  assert.equal(sparkline([5], 100, 10), '')
})
