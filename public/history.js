// Past sessions, kept in the browser only. Pure helpers over a storage-like
// object so they can be tested without a DOM.

export const HISTORY_KEY = 'vivavoice.history.v1'
const MAX = 30

export function loadHistory(storage) {
  try {
    const list = JSON.parse(storage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveSession(storage, entry) {
  const list = loadHistory(storage)
  list.push(entry)
  while (list.length > MAX) list.shift()
  try { storage.setItem(HISTORY_KEY, JSON.stringify(list)) } catch {}
  return list
}

// entry = { at, mode, subject, overall, fillersPer100, avgThinkSec, wpm, weakest }
export function makeEntry({ cfg, overall, metrics, stats }) {
  const scored = stats.filter((c) => c.avg != null)
  const weakest = scored.length ? scored.reduce((a, b) => (b.avg < a.avg ? b : a)) : null
  return {
    at: new Date().toISOString(),
    mode: cfg.mode,
    subject: cfg.subject,
    focus: cfg.focus || null,
    overall,
    fillersPer100: metrics.fillersPer100,
    avgThinkSec: metrics.avgThinkSec,
    wpm: metrics.wpm,
    weakest: weakest ? { id: weakest.id, name: weakest.name, avg: +weakest.avg.toFixed(1) } : null,
    criteria: Object.fromEntries(scored.map((c) => [c.id, +c.avg.toFixed(1)])),
  }
}

// Change since the previous session on the same subject (or any, if none).
export function compareToPrevious(list, entry) {
  const prev = [...list].reverse().find((e) => e !== entry && e.subject === entry.subject) || [...list].reverse().find((e) => e !== entry)
  if (!prev) return null
  const d = (k) => (entry[k] == null || prev[k] == null ? null : +(entry[k] - prev[k]).toFixed(1))
  return { prev, overall: d('overall'), fillersPer100: d('fillersPer100'), avgThinkSec: d('avgThinkSec'), wpm: d('wpm') }
}

// Polyline points for a tiny sparkline, 0..w by 0..h, oldest first.
export function sparkline(values, w = 160, h = 40, min = 0, max = 100) {
  const v = values.filter((x) => x != null)
  if (v.length < 2) return ''
  const lo = min ?? Math.min(...v)
  const hi = max ?? Math.max(...v)
  const span = hi - lo || 1
  return v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - ((y - lo) / span) * h).toFixed(1)}`).join(' ')
}
