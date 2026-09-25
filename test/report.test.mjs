import test from 'node:test'
import assert from 'node:assert/strict'
import { fallbackReport } from '../public/report.js'

const c = (id, avg, tip = 'tip', evidence = 'ev') => ({ id, name: id, avg, items: avg == null ? [] : [{ tip, evidence }] })

test('fallback report averages scored criteria', () => {
  const r = fallbackReport([c('a', 5), c('b', 3), c('c', null)], 'viva')
  assert.equal(r.overall, 80)
  assert.equal(r.verdict, 'Well defended')
  assert.equal(r.strengths.length, 2)
  assert.ok(r.fallback)
})

test('fallback report with no answers', () => {
  const r = fallbackReport([c('a', null)], 'interview')
  assert.equal(r.overall, 0)
  assert.match(r.verdict, /Not enough/)
})
