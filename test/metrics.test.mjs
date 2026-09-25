import test from 'node:test'
import assert from 'node:assert/strict'
import { countFillers, DeliveryMetrics, paceLabel, wordCount } from '../public/metrics.js'

test('counts fillers but not grammatical "like"', () => {
  assert.deepEqual(countFillers('Um, so basically I, uh, used YOLO.'), { um: 1, uh: 1, basically: 1 })
  assert.deepEqual(countFillers('I would like to explain. It looks like a leaf.'), {})
  assert.deepEqual(countFillers('It was, like, really like fast.'), { like: 2 })
  assert.deepEqual(countFillers('You know, it is sort of a detector.'), { 'you know': 1, 'sort of': 1 })
})

test('word count', () => {
  assert.equal(wordCount("I didn't use ResNet-50"), 4)
  assert.equal(wordCount(''), 0)
})

test('pace, thinking time and fillers from a simulated session', () => {
  let t = 0
  const m = new DeliveryMetrics(() => t)
  m.agentFinished()        // examiner done at 0
  t = 2000; m.speechStarted()  // 2 s to start answering
  t = 12000; m.speechStopped() // 10 s of speech
  m.userTurn(Array(25).fill('word').join(' ') + ' um') // 26 words
  t = 20000; m.agentFinished()
  t = 24000; m.speechStarted()
  t = 34000; m.userTurn(Array(26).fill('word').join(' ')) // closes speech itself
  const s = m.summary()
  assert.equal(s.answers, 2)
  assert.equal(s.words, 52)
  assert.equal(s.wpm, 156) // 52 words / 20 s
  assert.equal(s.avgThinkSec, 3)
  assert.equal(s.fillerTotal, 1)
})

test('empty transcript does not create a turn', () => {
  const m = new DeliveryMetrics(() => 0)
  assert.equal(m.userTurn(''), null)
  assert.equal(m.summary().wpm, null)
})

test('pace labels', () => {
  assert.match(paceLabel(90), /Slow/)
  assert.match(paceLabel(140), /Good/)
  assert.match(paceLabel(200), /Fast/)
})

test('pauses inside one answer count as one answer', () => {
  let t = 0
  const m = new DeliveryMetrics(() => t)
  m.agentFinished()
  t = 1000; m.speechStarted(); t = 3000; m.userTurn('The main reason is connectivity.')
  t = 4000; m.speechStarted(); t = 6000; m.userTurn('So it works offline, um.')
  m.agentFinished()
  t = 9000; m.speechStarted(); t = 11000; m.userTurn('Second answer here.')
  const s = m.summary()
  assert.equal(s.answers, 2)
  assert.equal(s.words, 13)
  assert.equal(s.avgThinkSec, 2)
  assert.equal(s.fillerTotal, 1)
})
