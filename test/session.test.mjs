import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSessionUpdate, extractKeyterms, MODES, turnDetection } from '../public/session.js'
import { SAMPLES } from '../public/samples.js'

test('session.update uses inline config with the documented shape', () => {
  const cfg = { mode: 'viva', name: 'Aisyah', subject: 'LeafLens', context: SAMPLES.viva.context, persona: 'strict', questions: 4, voice: 'anna', thinkingTime: true }
  const msg = buildSessionUpdate(cfg)
  assert.equal(msg.type, 'session.update')
  const s = msg.session
  assert.ok(!('agent_id' in s), 'inline mode must not mix in agent_id')
  assert.equal(s.output.voice, 'anna')
  assert.equal(s.input.format.encoding, 'audio/pcm')
  assert.ok(s.system_prompt.includes('Ask 4 main questions'))
  assert.ok(s.system_prompt.includes('Strict external examiner'))
  assert.ok(s.greeting.startsWith('Hi Aisyah.'))
  assert.deepEqual(s.tools.map((t) => t.name), ['show_question', 'record_score', 'finish_session'])
  for (const t of s.tools) {
    assert.equal(t.type, 'function')
    assert.equal(t.parameters.type, 'object')
    assert.ok(t.timeout_seconds >= 1 && t.timeout_seconds <= 300)
  }
  const crit = s.tools[1].parameters.properties.criterion.enum
  assert.deepEqual(crit, MODES.viva.rubric.map((r) => r.id))
  assert.ok(s.input.keyterms.length <= 100)
})

test('interview mode swaps the rubric', () => {
  const s = buildSessionUpdate({ mode: 'interview', subject: 'Data Analyst', context: SAMPLES.interview.context }).session
  assert.ok(s.tools[1].parameters.properties.criterion.enum.includes('behavioural'))
  assert.ok(s.greeting.includes('interview for the Data Analyst'))
})

test('question count is clamped', () => {
  assert.ok(buildSessionUpdate({ mode: 'viva', questions: 99, context: 'x' }).session.system_prompt.includes('Ask 8 main'))
  assert.ok(buildSessionUpdate({ mode: 'viva', questions: 0, context: 'x' }).session.system_prompt.includes('Ask 4 main'))
})

test('keyterms pick up jargon and skip plain words', () => {
  const terms = extractKeyterms(SAMPLES.viva.subject, SAMPLES.viva.context)
  for (const t of ['YOLOv8', 'YOLOv8n', 'NCNN', 'INT8', 'PlantVillage', 'PlantDoc', 'Cameron Highlands', 'Raspberry Pi']) {
    assert.ok(terms.some((x) => x === t || x.startsWith(t)), `missing ${t} in ${terms.join(', ')}`)
  }
  assert.ok(!terms.includes('the'))
  assert.equal(new Set(terms.map((t) => t.toLowerCase())).size, terms.length, 'no duplicates')
})

test('keyterms are capped at 100', () => {
  const text = Array.from({ length: 300 }, (_, i) => `ABC${i}`).join(' ')
  assert.equal(extractKeyterms(text).length, 100)
})

test('thinking time loosens turn detection', () => {
  assert.ok(turnDetection(true).max_silence > turnDetection(false).max_silence)
  assert.ok(turnDetection(true).min_silence > turnDetection(false).min_silence)
})
