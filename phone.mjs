// Phone-in practice.
//
// On a phone call there is no browser to answer client-side tools, so the
// phone examiner uses HTTP tools instead: AssemblyAI calls this server while
// the call is running. The student prepares on the website, gets a four-digit
// code, calls the number and reads the code out; the examiner loads their
// material with load_session, and the scores it records show up live on the
// student's screen, which polls /api/phone/session/<code>.

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { MODES, PERSONAS } from './public/session.js'

const TTL_MS = 3 * 60 * 60 * 1000
const MAX_ACTIVE = 5000

export function createPhoneStore({ now = Date.now } = {}) {
  const sessions = new Map()
  const sweep = () => {
    const t = now()
    for (const [code, s] of sessions) if (t - s.createdAt > TTL_MS) sessions.delete(code)
  }
  return {
    create(cfg) {
      sweep()
      if (sessions.size >= MAX_ACTIVE) return null
      let code
      do code = String(randomInt(0, 10000)).padStart(4, '0')
      while (sessions.has(code))
      const session = {
        code,
        key: randomBytes(16).toString('hex'),
        cfg: cleanCfg(cfg),
        createdAt: now(),
        status: 'waiting', // waiting -> live -> done
        questions: [],
        scores: [],
        report: null,
      }
      sessions.set(code, session)
      return session
    },
    get(code) {
      sweep()
      return sessions.get(normaliseCode(code)) || null
    },
    size: () => sessions.size,
  }
}

// Callers say codes in all sorts of ways: "four eight two one", "4 8 2 1".
const WORDS = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
export function normaliseCode(raw) {
  const s = String(raw ?? '').toLowerCase()
  const digits = s.split(/[^a-z0-9]+/).map((w) => (w in WORDS ? String(WORDS[w]) : w.replace(/\D/g, ''))).join('')
  return digits.slice(0, 4)
}

function cleanCfg(c = {}) {
  const mode = c.mode === 'interview' ? 'interview' : 'viva'
  return {
    mode,
    name: String(c.name || '').slice(0, 60),
    subject: String(c.subject || '').slice(0, 160),
    context: String(c.context || '').slice(0, 6000),
    persona: c.persona === 'strict' ? 'strict' : 'supportive',
    questions: Math.max(2, Math.min(8, Number(c.questions) || 4)),
    focus: MODES[mode].rubric.some((r) => r.id === c.focus) ? c.focus : null,
  }
}

// What the viewer's browser sees. The material itself is not echoed back.
export function publicState(s) {
  return {
    code: s.code,
    status: s.status,
    cfg: { mode: s.cfg.mode, name: s.cfg.name, subject: s.cfg.subject, questions: s.cfg.questions, focus: s.cfg.focus },
    questions: s.questions,
    scores: s.scores,
    report: s.report,
  }
}

const ok = (body) => ({ status: 200, body })

// The HTTP tools. Each returns what the examiner model reads back.
export function runTool(store, name, args = {}) {
  const s = store.get(args.code)
  if (!s) {
    return ok({ ok: false, error: `There is no session with code ${normaliseCode(args.code) || args.code}. Ask the caller to read the four-digit code on their screen again, digit by digit.` })
  }
  const rubric = MODES[s.cfg.mode].rubric
  switch (name) {
    case 'load_session': {
      s.status = 'live'
      const focus = rubric.find((r) => r.id === s.cfg.focus)
      return ok({
        ok: true,
        code: s.code,
        candidate_name: s.cfg.name || 'the candidate',
        session_type: MODES[s.cfg.mode].label,
        you_are: MODES[s.cfg.mode].examiner,
        persona: PERSONAS[s.cfg.persona],
        subject: s.cfg.subject,
        main_questions: s.cfg.questions,
        drill_focus: focus ? `${focus.name}: every question should probe this, and every score goes under ${focus.id}` : null,
        rubric: rubric.map((r) => ({ id: r.id, name: r.name, hint: r.hint })),
        submitted_material: s.cfg.context,
      })
    }
    case 'show_question': {
      const q = { number: Number(args.number) || s.questions.length + 1, topic: String(args.topic || ''), question: String(args.question || ''), follow_up: Boolean(args.follow_up), at: Date.now() }
      s.questions.push(q)
      return ok({ ok: true, shown: true })
    }
    case 'record_score': {
      const score = Math.round(Number(args.score))
      if (!rubric.some((r) => r.id === args.criterion) || !(score >= 1 && score <= 5)) {
        return ok({ ok: false, error: `criterion must be one of ${rubric.map((r) => r.id).join(', ')} and score 1 to 5. Nothing was recorded; call again with valid values.` })
      }
      s.scores.push({ criterion: args.criterion, score, evidence: String(args.evidence || ''), tip: String(args.tip || ''), at: Date.now() })
      return ok({ ok: true, recorded: true, answers_scored: s.scores.length })
    }
    case 'finish_session': {
      const list = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : [])
      s.report = {
        overall: Math.max(0, Math.min(100, Math.round(Number(args.overall) || 0))),
        verdict: String(args.verdict || ''),
        strengths: list(args.strengths),
        improvements: list(args.improvements),
        practice_questions: list(args.practice_questions),
        weakest_question: String(args.weakest_question || ''),
        model_answer: String(args.model_answer || ''),
        your_answer_summary: String(args.your_answer_summary || ''),
      }
      s.status = 'done'
      return ok({ ok: true, report_shown: true, instruction: 'Say goodbye in one short sentence and end the call.' })
    }
    default:
      return { status: 404, body: { ok: false, error: `unknown tool ${name}` } }
  }
}

export function secretMatches(given, expected) {
  if (!expected || !given) return false
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}
