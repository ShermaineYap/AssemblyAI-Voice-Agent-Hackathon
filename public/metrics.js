// Delivery metrics computed from AssemblyAI's live transcript and VAD events.
// Pure and clock-injectable so it can be unit tested.

const FILLERS = [
  'um', 'umm', 'uh', 'uhh', 'erm', 'er', 'ah', 'hmm',
  'you know', 'i mean', 'basically', 'actually', 'literally',
  'sort of', 'kind of', 'like',
]

// "like" only counts as a filler when it isn't doing grammatical work
// ("I would like", "looks like", "something like").
const LIKE_OK = /\b(would|i'd|you'd|we'd|they'd|looks?|looked|feels?|felt|seems?|something|anything|nothing|just|more|much|not|don't|didn't|is|was|are)\s+like\b/gi

export function countFillers(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z'\s]/g, ' ').replace(/\s+/g, ' ')} `
  const counts = {}
  for (const f of FILLERS) {
    const re = new RegExp(`(?<=\\s)${f.replace(/ /g, '\\s')}(?=\\s)`, 'g')
    let n = (t.match(re) || []).length
    // Punctuation kept here, so "was, like," still counts as a filler.
    if (f === 'like') n = Math.max(0, n - (String(text || '').toLowerCase().match(LIKE_OK) || []).length)
    if (n) counts[f] = n
  }
  return counts
}

export const wordCount = (text) => (String(text || '').match(/[A-Za-z0-9'’-]+/g) || []).length

export class DeliveryMetrics {
  constructor(now = () => Date.now()) {
    this.now = now
    this.turns = [] // { words, speakingMs, thinkMs, fillers }
    this.fillers = {}
    this._speechStart = null
    this._speakingMs = 0
    this._agentDoneAt = null
    this._pendingThink = null
  }

  // The examiner's audio finished playing: the candidate's thinking clock starts.
  agentFinished() {
    this._agentDoneAt = this.now()
  }

  speechStarted() {
    const t = this.now()
    this._speechStart = t
    if (this._agentDoneAt != null && this._pendingThink == null) {
      this._pendingThink = t - this._agentDoneAt
      this._agentDoneAt = null
    }
  }

  speechStopped() {
    if (this._speechStart == null) return
    this._speakingMs += this.now() - this._speechStart
    this._speechStart = null
  }

  // A final user transcript closes the turn.
  userTurn(text) {
    if (this._speechStart != null) this.speechStopped()
    const words = wordCount(text)
    if (!words) return null
    const f = countFillers(text)
    for (const [k, v] of Object.entries(f)) this.fillers[k] = (this.fillers[k] || 0) + v
    const turn = {
      words,
      speakingMs: this._speakingMs,
      thinkMs: this._pendingThink,
      fillers: Object.values(f).reduce((a, b) => a + b, 0),
    }
    this.turns.push(turn)
    this._speakingMs = 0
    this._pendingThink = null
    return turn
  }

  summary() {
    const words = this.turns.reduce((a, t) => a + t.words, 0)
    const ms = this.turns.reduce((a, t) => a + t.speakingMs, 0)
    const thinks = this.turns.map((t) => t.thinkMs).filter((v) => v != null && v >= 0)
    const fillerTotal = Object.values(this.fillers).reduce((a, b) => a + b, 0)
    const topFillers = Object.entries(this.fillers).sort((a, b) => b[1] - a[1]).slice(0, 3)
    return {
      answers: this.turns.length,
      words,
      wpm: ms > 3000 ? Math.round(words / (ms / 60000)) : null,
      avgThinkSec: thinks.length ? +(thinks.reduce((a, b) => a + b, 0) / thinks.length / 1000).toFixed(1) : null,
      fillerTotal,
      fillersPer100: words ? +((fillerTotal / words) * 100).toFixed(1) : 0,
      topFillers,
    }
  }
}

// Plain-language read of the pace, for the report.
export function paceLabel(wpm) {
  if (wpm == null) return 'Not enough speech yet'
  if (wpm < 110) return 'Slow, try to keep momentum'
  if (wpm <= 170) return 'Good conversational pace'
  return 'Fast, slow down on key points'
}
