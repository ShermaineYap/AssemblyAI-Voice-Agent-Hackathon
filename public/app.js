import { MODES, buildSessionUpdate, extractKeyterms } from './session.js'
import { DeliveryMetrics, countFillers, paceLabel } from './metrics.js'
import { ToolResultQueue } from './toolqueue.js'
import { openAudio, toBase64, fromBase64 } from './audio.js'
import { SAMPLES } from './samples.js'
import { fallbackReport } from './report.js'
import { extractPdf, pickSections } from './pdftext.js'
import { loadHistory, saveSession, makeEntry, compareToPrevious, sparkline } from './history.js'
import { createAura } from './aura.js'

// Seconds of one answer before the examiner cuts in. ?ramble=30 lowers it for a demo.
const RAMBLE_SECONDS = Math.max(10, Number(new URLSearchParams(location.search).get('ramble')) || 90)
// Warn in the last sixth of the allowance (15 s of 90).
const RAMBLE_WARN = Math.round(RAMBLE_SECONDS * 5 / 6)

const $ = (id) => document.getElementById(id)
const form = $('setup-form')
const STORE_KEY = 'vivavoice.setup.v1'

// ---------------------------------------------------------------- state
let ws = null
let audio = null
let cfg = null
let queue = null
let metrics = null
let startedAt = 0
let timer = null
let ending = false
let finished = false
let agentPlaying = false
let micLevel = 0
let speakerLevel = 0
let scores = [] // { criterion, score, evidence, tip, at }
let report = null
let questionsAsked = []
const transcript = [] // { who, text }
let focus = null // rubric id for a drill session
let rambleTimer = null
let rambleWarned = false
let answerStartIdx = 0 // transcript index where the current answer began
let lastEntry = null

// ---------------------------------------------------------------- setup form
function readForm() {
  const d = new FormData(form)
  return {
    mode: d.get('mode'),
    name: String(d.get('name') || '').trim(),
    subject: String(d.get('subject') || '').trim(),
    context: String(d.get('context') || '').trim(),
    persona: d.get('persona'),
    questions: Number(d.get('questions')),
    voice: d.get('voice'),
    thinkingTime: d.get('thinkingTime') === 'on',
    focus,
  }
}

function writeForm(v) {
  for (const [k, val] of Object.entries(v)) {
    const els = form.elements[k]
    if (!els) continue
    if (els instanceof RadioNodeList) {
      for (const r of els) r.checked = r.value === val
    } else if (els.type === 'checkbox') els.checked = Boolean(val)
    else els.value = val
  }
  syncForm()
}

function syncForm() {
  const v = readForm()
  const mode = MODES[v.mode]
  $('subject-label').textContent = mode.subjectLabel
  $('context-label').textContent = mode.contextLabel
  form.elements.subject.placeholder = v.mode === 'interview' ? 'e.g. Junior Data Analyst' : 'e.g. Crop disease detection with YOLOv8'
  $('start-btn').textContent = v.mode === 'interview' ? 'Start the interview' : 'Start the viva'
  $('char-count').textContent = v.context.length
  renderKeyterms(v.context.trim().length >= 40 || v.subject ? extractKeyterms(v.subject, v.context) : [])
  const persona = form.elements.persona.selectedOptions[0]?.textContent.split(' ')[0] || ''
  const voice = form.elements.voice.selectedOptions[0]?.textContent.split(' ')[0] || ''
  $('settings-summary').innerHTML = ''
  for (const t of [persona, `${v.questions} questions`, voice, v.thinkingTime ? 'thinking time' : 'fast turns']) {
    const i = document.createElement('i'); i.textContent = t; $('settings-summary').append(i)
  }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)) } catch {}
}

let shownTerms = ''
function renderKeyterms(terms) {
  const key = terms.slice(0, 14).join('|')
  if (key === shownTerms) return
  shownTerms = key
  const box = $('keyterm-preview')
  box.replaceChildren()
  if (!terms.length) { const n = document.createElement('span'); n.className = 'none'; n.textContent = 'Terms from your report appear here.'; box.append(n); return }
  terms.slice(0, 14).forEach((t, i) => {
    const c = document.createElement('span'); c.className = 'kt'; c.textContent = t; c.style.animationDelay = `${i * 25}ms`; box.append(c)
  })
  if (terms.length > 14) { const m = document.createElement('span'); m.className = 'kt more'; m.textContent = `+${terms.length - 14} more`; box.append(m) }
}

form.addEventListener('input', syncForm)
form.addEventListener('change', syncForm)
$('sample-btn').onclick = () => {
  const mode = readForm().mode
  writeForm({ ...readForm(), ...SAMPLES[mode] })
}
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
  if (saved) writeForm(saved)
} catch {}
syncForm()

async function listMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
  const sel = $('mic')
  const chosen = sel.value
  sel.replaceChildren(new Option('Default microphone', ''))
  devices.forEach((d, i) => sel.append(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)))
  if (devices.some((d) => d.deviceId === chosen)) sel.value = chosen
}
listMics()
navigator.mediaDevices?.addEventListener?.('devicechange', listMics)

form.addEventListener('submit', (e) => {
  e.preventDefault()
  start(readForm())
})

// ---------------------------------------------------------------- PDF upload
const drop = $('drop')
const pdfInput = $('pdf-input')
drop.onclick = () => pdfInput.click()
drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pdfInput.click() } }
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over') })
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over') })
drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) loadPdf(f) })
pdfInput.onchange = () => { if (pdfInput.files[0]) loadPdf(pdfInput.files[0]); pdfInput.value = '' }

async function loadPdf(file) {
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return showError('That is not a PDF.')
  if (file.size > 40e6) return showError('That PDF is over 40 MB. Export a smaller one or paste the abstract instead.')
  showError('')
  drop.classList.add('busy')
  drop.classList.remove('done')
  $('drop-title').textContent = `Reading ${file.name}…`
  try {
    const { text, pages } = await extractPdf(file, (i, n) => ($('drop-sub').textContent = `Page ${i} of ${n}`))
    const picked = pickSections(text)
    if (!picked.context.trim()) throw new Error('No text found. If the PDF is scanned, paste the abstract instead.')
    const v = readForm()
    writeForm({ ...v, context: picked.context, subject: v.subject || picked.title })
    drop.classList.add('done')
    $('drop-title').textContent = `${file.name} · ${pages} pages`
    $('drop-sub').textContent = picked.found.length
      ? `Pulled out: ${picked.found.join(', ')}. Edit the text below if you like.`
      : 'No standard headings found, so the opening pages were used. Trim the text below to the parts that matter.'
  } catch (err) {
    $('drop-title').textContent = 'Drop your report PDF here'
    $('drop-sub').textContent = 'or click to choose.'
    showError(err.message || 'Could not read that PDF.')
  } finally {
    drop.classList.remove('busy')
  }
}

// ---------------------------------------------------------------- progress
function renderProgress() {
  let list = []
  try { list = loadHistory(localStorage) } catch {}
  const card = $('progress')
  if (list.length < 1) { card.hidden = true; return }
  card.hidden = false
  $('progress-count').textContent = `${list.length} session${list.length === 1 ? '' : 's'}`
  const recent = list.slice(-10)
  const set = (id, key, min, max, fmt) => {
    const pts = sparkline(recent.map((e) => e[key]), 160, 40, min, max)
    $(`spark-${id}`).setAttribute('points', pts)
    $(`spark-${id}`).parentElement.hidden = !pts
    const last = recent.at(-1)[key]
    $(`spark-${id}-last`).textContent = last == null ? '–' : fmt(last)
  }
  set('score', 'overall', 0, 100, (v) => `${v} / 100`)
  set('fill', 'fillersPer100', 0, null, (v) => `${v}`)
  set('think', 'avgThinkSec', 0, null, (v) => `${v}s`)
  const weak = {}
  for (const e of recent) if (e.weakest) weak[e.weakest.name] = (weak[e.weakest.name] || 0) + 1
  const top = Object.entries(weak).sort((a, b) => b[1] - a[1])[0]
  $('progress-note').textContent = list.length < 2
    ? 'Run another session to see a trend.'
    : top ? `Most often your weakest area: ${top[0]}. Use "Drill my weakest area" on a report to work on it.` : ''
}
renderProgress()

// ---------------------------------------------------------------- session
function showError(msg) {
  const el = $('setup-error')
  el.className = 'error'
  el.textContent = msg
  el.hidden = !msg
}

async function start(config) {
  showError('')
  if (!config.subject || config.context.length < 40) {
    showError('Add a title and at least a few sentences of context, so the examiner has something real to ask about.')
    return
  }
  cfg = config
  $('start-btn').disabled = true
  resetLive()

  try {
    const [tokenRes, conf] = await Promise.all([fetch('/token'), fetch('/config').then((r) => r.json()).catch(() => ({}))])
    const body = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !body.token) throw new Error(body.error || 'Could not start a session.')

    audio = await openAudio({
      deviceId: $('mic').value,
      onChunk: (pcm) => {
        if (ws?.readyState === 1 && ws.ready) ws.send(JSON.stringify({ type: 'input.audio', audio: toBase64(pcm) }))
      },
      onMicLevel: (l) => { micLevel = l; aura.setLevels(speakerLevel, micLevel) },
      onSpeakerLevel: (l) => { speakerLevel = l; aura.setLevels(speakerLevel, micLevel) },
      onPlaying: (playing) => {
        agentPlaying = playing
        if (!playing) metrics.agentFinished()
        if (!playing && !ending) setStatus('listening')
      },
    })
    listMics()

    const url = new URL(conf.wsUrl || 'wss://agents.assemblyai.com/v1/ws')
    url.searchParams.set('token', body.token)
    ws = new WebSocket(url)
    ws.ready = false
    queue = new ToolResultQueue((m) => ws?.readyState === 1 && ws.send(JSON.stringify(m)))
    ws.onopen = () => ws.send(JSON.stringify(buildSessionUpdate(cfg)))
    ws.onmessage = (e) => handle(JSON.parse(e.data))
    ws.onclose = () => { if (!finished) finalize() }
    ws.onerror = () => setStatus('error', 'Connection problem')

    setView('live')
    setStatus('connecting')
  } catch (err) {
    teardown()
    setView('setup')
    const msg = err?.name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow it in your browser and try again.' : err.message
    showError(msg)
  } finally {
    $('start-btn').disabled = false
  }
}

function handle(msg) {
  queue.onEvent(msg)
  switch (msg.type) {
    case 'session.ready':
      ws.ready = true
      startedAt = Date.now()
      timer = setInterval(tick, 1000)
      tick()
      buildStepper()
      setStatus('listening')
      break
    case 'input.speech.started':
      audio?.flush() // barge-in: stop the examiner mid-word
      metrics.speechStarted()
      setStatus('listening')
      startRambleClock()
      break
    case 'input.speech.stopped':
      metrics.speechStopped()
      setStatus('thinking')
      break
    case 'transcript.user.delta':
      partial('you', msg.text)
      break
    case 'transcript.user': {
      const turn = metrics.userTurn(msg.text)
      addLine('you', msg.text)
      if (turn) updateMetrics()
      break
    }
    case 'reply.started':
      setStatus('speaking')
      stopRambleClock()
      newReply = true
      repliedSinceYou = true
      break
    case 'reply.audio':
      audio?.play(fromBase64(msg.data))
      break
    case 'transcript.agent.delta':
      partial('examiner', ((partials.examiner?.text || '') + ' ' + (msg.delta || '')).replace(/\s+/g, ' ').trimStart())
      break
    case 'transcript.agent':
      addLine('examiner', msg.text + (msg.interrupted ? ' —' : ''))
      break
    case 'reply.done':
      if (msg.status === 'interrupted') audio?.flush()
      if (ending && report) scheduleEnd()
      break
    case 'tool.call':
      onTool(msg)
      break
    case 'session.error':
      console.warn('session.error', msg)
      setStatus('error', msg.message || msg.code)
      break
    case 'session.ended':
      finalize()
      break
  }
}

// ---------------------------------------------------------------- rambling alarm
// One answer = from the examiner's last reply until its next one. The clock
// starts on the first speech and is only reset when the examiner replies, so
// pauses don't restart it. At RAMBLE_SECONDS the examiner is asked to cut in.
let answerClockStart = 0
function startRambleClock() {
  if (answerClockStart || ending) return
  answerClockStart = Date.now()
  rambleWarned = false
  rambleTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - answerClockStart) / 1000)
    const ring = $('answer-ring')
    ring.style.strokeDashoffset = String(603.2 * (1 - Math.min(1, (secs + 1) / RAMBLE_SECONDS)))
    ring.classList.toggle('late', secs >= RAMBLE_WARN)
    if (secs >= RAMBLE_WARN && !rambleWarned) {
      $('ramble-secs').textContent = String(secs)
      $('ramble').hidden = false
    }
    if (secs >= RAMBLE_WARN) $('ramble-secs').textContent = String(secs)
    if (secs >= RAMBLE_SECONDS && !rambleWarned) {
      rambleWarned = true
      if (ws?.readyState === 1 && ws.ready) {
        ws.send(JSON.stringify({
          type: 'reply.create',
          instructions: `The candidate has now been talking for ${secs} seconds on this one answer. Cut in politely with one sentence asking them to finish with their single most important point. Do not ask a new question yet.`,
        }))
        addLine('examiner', '(cutting in: the answer has run long)')
      }
    }
  }, 1000)
}
function stopRambleClock() {
  clearInterval(rambleTimer)
  rambleTimer = null
  answerClockStart = 0
  $('ramble').hidden = true
  const ring = $('answer-ring')
  if (ring) { ring.style.strokeDashoffset = '603.2'; ring.classList.remove('late') }
  answerStartIdx = transcript.length
}

function onTool({ call_id, name, arguments: raw }) {
  let args = raw
  if (typeof raw === 'string') { try { args = JSON.parse(raw) } catch { args = {} } }
  args ||= {}
  if (name === 'show_question') {
    showQuestion(args)
    queue.add(call_id, { shown: true })
  } else if (name === 'record_score') {
    const known = MODES[cfg.mode].rubric.some((r) => r.id === args.criterion)
    const score = Math.round(Number(args.score))
    if (!known || !(score >= 1 && score <= 5)) {
      queue.add(call_id, { error: `criterion must be one of ${MODES[cfg.mode].rubric.map((r) => r.id).join(', ')} and score 1-5. Nothing was recorded; call again with valid values.` })
      return
    }
    recordScore({ ...args, score })
    queue.add(call_id, { recorded: true, answers_scored: scores.length })
  } else if (name === 'finish_session') {
    report = args
    ending = true
    queue.add(call_id, { report_shown: true, instruction: 'Do not say anything else.' })
    scheduleEnd()
  } else {
    queue.add(call_id, { error: `unknown tool ${name}` })
  }
}

// Let the goodbye finish playing before hanging up.
let endTimer = null
function scheduleEnd() {
  clearTimeout(endTimer)
  const wait = () => (agentPlaying ? (endTimer = setTimeout(wait, 300)) : (endTimer = setTimeout(hangUp, 900)))
  wait()
}

function hangUp() {
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ type: 'session.end' }))
    const s = ws
    setTimeout(() => s.readyState === 1 && s.close(), 2000)
  }
  finalize()
}

// End button: ask the examiner to wrap up properly, fall back after 20 s.
$('end-btn').onclick = () => {
  if (ending) return hangUp()
  ending = true
  $('end-btn').textContent = 'Finish now'
  setStatus('thinking', 'wrapping up')
  if (ws?.readyState === 1 && ws.ready) {
    ws.send(JSON.stringify({
      type: 'reply.create',
      instructions: 'The candidate has asked to end the session now. Do not ask another question. Give your two sentence spoken summary, say goodbye, then call finish_session with your assessment of what you heard.',
    }))
    endTimer = setTimeout(hangUp, 20000)
  } else hangUp()
}

function finalize() {
  if (finished) return
  finished = true
  clearTimeout(endTimer)
  teardown()
  renderReport()
  setView('report')
}

function saveToHistory(overall, m) {
  try {
    const entry = makeEntry({ cfg, overall, metrics: m, stats: criterionStats() })
    const before = loadHistory(localStorage)
    const cmp = compareToPrevious(before, entry)
    saveSession(localStorage, entry)
    lastEntry = entry
    renderProgress()
    return cmp
  } catch { return null }
}

function teardown() {
  clearInterval(timer)
  try { audio?.close() } catch {}
  audio = null
  if (ws && ws.readyState <= 1) { try { ws.close() } catch {} }
}

function resetLive() {
  stopRambleClock()
  answerStartIdx = 0
  lastEntry = null
  ending = finished = false
  report = null
  scores = []
  questionsAsked = []
  transcript.length = 0
  metrics = new DeliveryMetrics()
  $('transcript').replaceChildren()
  $('feed').innerHTML = '<li class="empty">Private notes appear here after each answer.</li>'
  $('q-num').textContent = 'Waiting for the first question'
  $('q-topic').hidden = true
  $('q-text').textContent = 'The examiner will introduce themselves first.'
  $('end-btn').textContent = 'End session'
  $('elapsed').textContent = '0:00'
  renderRubric()
  updateMetrics()
}

// ---------------------------------------------------------------- live UI
function setView(v) {
  document.body.dataset.view = v
  if (v !== 'live') document.body.dataset.state = 'idle'
  window.scrollTo({ top: 0 })
}

function setStatus(state, text) {
  const el = $('status')
  el.className = 'live-only status ' + state
  document.body.dataset.state = state
  aura.setState(state)
  const labels = { listening: 'your turn', speaking: 'examiner speaking', thinking: 'examiner thinking', connecting: 'connecting' }
  $('status-text').textContent = text || labels[state] || state
  $('orb-label').textContent = text || labels[state] || state
}

// Question progress dots in the top bar.
function buildStepper(current = 0) {
  const n = Number(cfg?.questions) || 4
  const ol = $('stepper')
  ol.replaceChildren()
  for (let i = 1; i <= n; i++) {
    const li = document.createElement('li')
    li.className = i < current ? 'done' : i === current ? 'now' : ''
    li.title = `Question ${i}`
    ol.append(li)
  }
}

function tick() {
  const s = Math.floor((Date.now() - startedAt) / 1000)
  $('elapsed').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function showQuestion({ number, topic, question, follow_up }) {
  const card = $('question-card')
  $('q-num').textContent = follow_up ? `Question ${number} · follow-up` : `Question ${number} of ${cfg.questions}`
  $('q-topic').hidden = !topic
  $('q-topic').textContent = topic || ''
  $('q-topic').classList.toggle('fu', Boolean(follow_up))
  $('q-text').textContent = question || ''
  card.animate([{ opacity: 0.3, transform: 'translateY(6px) scale(.99)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' })
  if (!cfg.focus) buildStepper(Number(number) || 0)
  else buildStepper(Math.min(Number(number) || 0, Number(cfg.questions) || 4))
  questionsAsked.push({ number, topic, question, follow_up: Boolean(follow_up), at: transcript.length })
}

function criterionStats() {
  return MODES[cfg.mode].rubric.map((r) => {
    const s = scores.filter((x) => x.criterion === r.id)
    const avg = s.length ? s.reduce((a, b) => a + b.score, 0) / s.length : null
    return { ...r, avg, n: s.length, items: s }
  })
}

function renderRubric(flashId) {
  if (!cfg) return
  const ul = $('rubric')
  ul.replaceChildren()
  for (const c of criterionStats()) {
    const li = document.createElement('li')
    if (c.id === flashId) li.className = 'flash'
    const cls = c.avg == null ? '' : c.avg < 2.5 ? 'lo' : c.avg < 3.75 ? 'mid' : 'hi'
    li.innerHTML = `<div class="top"><span></span><span class="val"></span></div><div class="bar"><i class="${cls}"></i></div>`
    li.querySelector('.top span').textContent = c.name
    li.querySelector('.val').textContent = c.avg == null ? '–' : `${c.avg.toFixed(1)} / 5`
    li.title = c.hint
    ul.append(li)
    requestAnimationFrame(() => (li.querySelector('i').style.width = c.avg == null ? '0' : `${(c.avg / 5) * 100}%`))
  }
  $('scored-count').textContent = `${scores.length} scored`
}

function recordScore(s) {
  scores.push({ ...s, at: Date.now() })
  renderRubric(s.criterion)
  const feed = $('feed')
  feed.querySelector('.empty')?.remove()
  const li = document.createElement('li')
  const name = MODES[cfg.mode].rubric.find((r) => r.id === s.criterion)?.name || s.criterion
  li.innerHTML = '<div class="crit"><span></span><span></span></div><div class="ev"></div><div class="tip"></div>'
  li.querySelector('.crit span').textContent = name
  li.querySelector('.crit span:last-child').textContent = '●'.repeat(s.score) + '○'.repeat(5 - s.score)
  li.querySelector('.ev').textContent = s.evidence || ''
  li.querySelector('.tip').textContent = s.tip ? `→ ${s.tip}` : ''
  feed.prepend(li)
}

function updateMetrics() {
  const m = metrics.summary()
  $('m-wpm').textContent = m.wpm ?? '–'
  $('m-fill').textContent = m.fillerTotal
  $('m-think').textContent = m.avgThinkSec ?? '–'
}

// Transcript with live partials and highlighted filler words.
const partials = {}
function lineEl(who, text, isPartial) {
  const div = document.createElement('div')
  div.className = `line ${who}${isPartial ? ' partial' : ''}`
  const w = document.createElement('span')
  w.className = 'who'
  w.textContent = who === 'you' ? (cfg?.name || 'You') : 'Examiner'
  const said = document.createElement('span')
  said.className = 'said'
  if (who === 'you' && !isPartial) highlightFillers(said, text)
  else said.textContent = text
  div.append(w, said)
  return div
}

function highlightFillers(el, text) {
  const fillers = Object.keys(countFillers(text))
  if (!fillers.length) { el.textContent = text; return }
  const re = new RegExp(`\\b(${fillers.map((f) => f.replace(/ /g, '\\s')).join('|')})\\b`, 'gi')
  let last = 0
  for (const m of text.matchAll(re)) {
    el.append(text.slice(last, m.index))
    const mark = document.createElement('mark')
    mark.textContent = m[0]
    el.append(mark)
    last = m.index + m[0].length
  }
  el.append(text.slice(last))
}

// Captions under the orb: the examiner's current words large, yours below.
let newReply = false
function caption(who, text, final) {
  if (who === 'examiner') {
    if (newReply) { $('cap-you').textContent = ''; newReply = false }
    $('cap-examiner').textContent = text
  } else {
    const el = $('cap-you')
    el.replaceChildren()
    if (final) highlightFillers(el, text)
    else el.textContent = text
  }
}

function partial(who, text) {
  caption(who, who === 'you' ? liveAnswer(text) : text, false)
  const box = $('transcript')
  if (partials[who]) {
    partials[who].text = text
    partials[who].el.querySelector('.said').textContent = text
  } else {
    const el = lineEl(who, text, true)
    partials[who] = { el, text }
    box.append(el)
  }
  box.scrollTop = box.scrollHeight
}

function addLine(who, text) {
  if (!text) return
  partials[who]?.el.remove()
  delete partials[who]
  const box = $('transcript')
  const prev = transcript.at(-1)
  // Consecutive finals from the candidate are one answer said with pauses.
  if (who === 'you' && prev?.who === 'you' && box.lastElementChild?.classList.contains('you')) {
    prev.text += ' ' + text
    box.lastElementChild.replaceWith(lineEl(who, prev.text))
  } else {
    transcript.push({ who, text })
    box.append(lineEl(who, text))
  }
  box.scrollTop = box.scrollHeight
  if (who === 'you') repliedSinceYou = false
  const last = transcript.at(-1)
  if (!/^\(cutting in/.test(text)) caption(who, last?.who === who ? last.text : text, true)
}

// While a candidate answer is split by pauses, show the whole answer so far.
function liveAnswer(partialText) {
  const last = transcript.at(-1)
  return last?.who === 'you' && !newReplySinceLast() ? `${last.text} ${partialText}` : partialText
}
let repliedSinceYou = true
function newReplySinceLast() { return repliedSinceYou }

// ---------------------------------------------------------------- aura
const aura = createAura($('orb'))
// The landing page gets its own aura, breathing gently on its own.
const heroAura = createAura($('hero-aura'))
heroAura.setState('idle')
;(function breathe(t) {
  requestAnimationFrame(breathe)
  if (document.body.dataset.view !== 'setup') return
  const k = (t || 0) / 1000
  heroAura.setLevels(0.05 + 0.04 * Math.sin(k * 1.3) + 0.03 * Math.sin(k * 3.1), 0)
})()

// ---------------------------------------------------------------- report
// Score counts up from 0, like a result reveal.
function countUp(el, to) {
  const t0 = performance.now(), dur = 1400
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur)
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))))
    if (k < 1) requestAnimationFrame(step)
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) el.textContent = String(to)
  else requestAnimationFrame(step)
}

// Radar chart of the rubric, one axis per criterion, scale 0-5.
function drawRadar(svg, stats) {
  const NS = 'http://www.w3.org/2000/svg'
  const cx = 160, cy = 150, R = 100, n = stats.length
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]
  }
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e }
  svg.replaceChildren()
  for (const lvl of [0.2, 0.4, 0.6, 0.8, 1]) {
    svg.append(el('polygon', { class: 'grid', points: stats.map((_, i) => pt(i, lvl).join(',')).join(' ') }))
  }
  stats.forEach((c, i) => {
    const [x, y] = pt(i, 1)
    svg.append(el('line', { class: 'axis', x1: cx, y1: cy, x2: x, y2: y }))
    const [lx, ly] = pt(i, 1.16)
    const t = el('text', { x: lx, y: ly + (ly < cy - 10 ? -2 : ly > cy + 10 ? 12 : 4), 'text-anchor': Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end' })
    t.textContent = c.name.split(' ')[0].replace(/[^A-Za-z]/g, '')
    svg.append(t)
  })
  const vals = stats.map((c) => (c.avg == null ? 0 : c.avg / 5))
  svg.append(el('polygon', { class: 'shape', points: vals.map((v, i) => pt(i, Math.max(v, 0.02)).join(',')).join(' ') }))
  stats.forEach((c, i) => {
    const [x, y] = pt(i, vals[i])
    svg.append(el('circle', { class: c.avg == null ? 'pt na' : 'pt', cx: x, cy: y, r: 4.5 }))
  })
}

function fill(id, items, empty = 'Nothing noted.') {
  const el = $(id)
  el.replaceChildren()
  for (const t of items?.length ? items : [empty]) {
    const li = document.createElement('li')
    li.textContent = t
    el.append(li)
  }
}

function renderReport() {
  if (!cfg) return
  const stats = criterionStats()
  const r = report || fallbackReport(stats, cfg.mode)
  const overall = Math.max(0, Math.min(100, Math.round(Number(r.overall) || 0)))
  countUp($('overall'), overall)
  $('ring-fg').style.strokeDashoffset = '326.7'
  setTimeout(() => ($('ring-fg').style.strokeDashoffset = String(326.7 * (1 - overall / 100))), 60)
  const grid = document.querySelector('.report-grid')
  grid.classList.remove('reveal'); void grid.offsetWidth; grid.classList.add('reveal')
  $('r-kind').textContent = `${MODES[cfg.mode].label} report`
  $('r-verdict').textContent = r.verdict || 'Report'
  const mins = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60000)) : 0
  $('r-sub').textContent = `${cfg.subject} · ${cfg.name || 'Candidate'} · ${mins} min · ${scores.length} answers scored${r.fallback ? ' · summary built from live scores' : ''}`
  fill('r-strengths', r.strengths)
  fill('r-improve', r.improvements)
  fill('r-practice', r.practice_questions, 'Re-run the session and ask for a strict examiner.')

  const tb = $('r-rubric')
  tb.replaceChildren()
  for (const c of stats) {
    const tr = document.createElement('tr')
    tr.innerHTML = '<td><b></b><small></small></td><td></td>'
    tr.querySelector('b').textContent = c.name
    tr.querySelector('small').textContent = c.items.at(-1)?.tip || c.hint
    tr.lastChild.textContent = c.avg == null ? 'not assessed' : `${c.avg.toFixed(1)} / 5`
    tb.append(tr)
  }
  drawRadar($('radar'), stats)

  const m = metrics.summary()
  const rows = [
    ['Speaking pace', m.wpm ? `${m.wpm} wpm` : '–', paceLabel(m.wpm)],
    ['Filler words', `${m.fillerTotal} (${m.fillersPer100} per 100 words)`, m.topFillers.map(([k, v]) => `"${k}" ×${v}`).join(', ') || 'Clean'],
    ['Average thinking time', m.avgThinkSec != null ? `${m.avgThinkSec}s` : '–', m.avgThinkSec == null ? '' : m.avgThinkSec > 4 ? 'Long pauses; try a holding phrase' : 'Comfortable'],
    ['Answers given', String(m.answers), `${m.words} words total`],
  ]
  const d = $('r-delivery')
  d.replaceChildren()
  for (const [k, v, note] of rows) {
    const div = document.createElement('div')
    div.innerHTML = '<span><span></span><br><small class="muted"></small></span><b></b>'
    div.querySelector('span span').textContent = k
    div.querySelector('small').textContent = note
    div.querySelector('b').textContent = v
    d.append(div)
  }

  const t = $('r-transcript')
  t.replaceChildren(...transcript.map((l) => lineEl(l.who, l.text)))

  // Weakest question, answered two ways.
  const mc = $('r-model-card')
  if (r.weakest_question && r.model_answer) {
    mc.hidden = false
    $('r-model-q').textContent = r.weakest_question
    $('r-model-yours').textContent = answerTo(r.weakest_question) || 'No answer was captured for this question.'
    $('r-model-answer').textContent = r.model_answer
  } else mc.hidden = true

  // Drill button for the weakest criterion.
  const weakest = stats.filter((c) => c.avg != null).sort((a, b) => a.avg - b.avg)[0]
  const rb = $('retry-btn')
  rb.hidden = !weakest
  if (weakest) {
    rb.textContent = `Drill: ${weakest.name}`
    rb.onclick = () => { focus = weakest.id; setView('setup'); showFocusNote(weakest.name) }
  }

  // Change since last time, saved once per session.
  const cmp = finished && !lastEntry ? saveToHistory(overall, m) : null
  const dl = $('r-delta')
  if (cmp) {
    dl.hidden = false
    const part = (label, v, goodWhenUp, unit = '') => v == null || v === 0 ? '' : `${label} <b class="${(v > 0) === goodWhenUp ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v}${unit}</b>`
    const parts = [part('Score', cmp.overall, true), part('fillers / 100', cmp.fillersPer100, false), part('thinking', cmp.avgThinkSec, false, 's')].filter(Boolean)
    dl.innerHTML = parts.length ? `Since your last session: ${parts.join(' · ')}` : 'Same as your last session.'
  } else dl.hidden = true
  window.__vvReport = { report: r, overall, scores, metrics: m }
}

// The candidate's lines between when a question was shown and the next one.
function answerTo(question) {
  const i = questionsAsked.findIndex((q) => q.question === question)
  if (i < 0) return ''
  const from = questionsAsked[i].at ?? 0
  const to = questionsAsked[i + 1]?.at ?? transcript.length
  return transcript.slice(from, to).filter((l) => l.who === 'you').map((l) => l.text).join(' ')
}

function showFocusNote(name) {
  const el = $('setup-error')
  el.hidden = false
  el.className = 'error focus'
  el.innerHTML = ''
  el.append(`Drill session: every question will target "${name}". `)
  const clear = document.createElement('a')
  clear.href = '#'
  clear.textContent = 'Switch back to a full viva'
  clear.onclick = (e) => { e.preventDefault(); focus = null; showError('') }
  el.append(clear)
}

function reportMarkdown() {
  const r = window.__vvReport
  const stats = criterionStats()
  const lines = [
    `# VivaVoice ${MODES[cfg.mode].label.toLowerCase()} report`,
    '',
    `**${cfg.subject}**, ${cfg.name || 'Candidate'}, ${new Date().toLocaleString()}`,
    '',
    `## ${r.overall}/100 · ${r.report.verdict}`,
    '',
    '## Strengths', ...(r.report.strengths || []).map((s) => `- ${s}`), '',
    '## Work on next', ...(r.report.improvements || []).map((s, i) => `${i + 1}. ${s}`), '',
    '## Rubric', '| Criterion | Score | Latest note |', '|---|---|---|',
    ...stats.map((c) => `| ${c.name} | ${c.avg == null ? '–' : c.avg.toFixed(1) + '/5'} | ${(c.items.at(-1)?.tip || '').replace(/\|/g, '/')} |`), '',
    '## Delivery',
    `- Pace: ${r.metrics.wpm ?? '–'} wpm (${paceLabel(r.metrics.wpm)})`,
    `- Filler words: ${r.metrics.fillerTotal} (${r.metrics.fillersPer100} per 100 words)`,
    `- Average thinking time: ${r.metrics.avgThinkSec ?? '–'}s`, '',
    ...(r.report.model_answer ? ['## Weakest question', r.report.weakest_question, '', '**What you said:** ' + (answerTo(r.report.weakest_question) || '(not captured)'), '', '**A 5/5 answer:** ' + r.report.model_answer, ''] : []),
    '## Practice questions', ...(r.report.practice_questions || []).map((s) => `- ${s}`), '',
    '## Transcript', ...transcript.map((l) => `**${l.who === 'you' ? cfg.name || 'You' : 'Examiner'}:** ${l.text}  `),
  ]
  return lines.join('\n')
}

$('dl-btn').onclick = () => {
  const blob = new Blob([reportMarkdown()], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `vivavoice-report-${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
$('print-btn').onclick = () => {
  document.querySelector('#view-report details')?.setAttribute('open', '')
  window.print()
}
$('again-btn').onclick = () => { focus = null; showError(''); setView('setup') }

// Test hook: lets the automated UI test drive the page without a microphone.
window.__vv = {
  handle: (m) => handle(m),
  mock: (send) => { queue = new ToolResultQueue(send); metrics = new DeliveryMetrics(); startedAt = Date.now() }, get cfg() { return cfg }, set cfg(v) { cfg = v }, resetLive, setView, finalize }
