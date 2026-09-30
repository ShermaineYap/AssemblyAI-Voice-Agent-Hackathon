// Builds the Voice Agent session.update payload from what the student typed.
// Pure functions only, so the same file runs in the browser and in node:test.

export const MODES = {
  viva: {
    label: 'Project viva',
    subjectLabel: 'Project title',
    contextLabel: 'Abstract, summary or key sections of your report',
    examiner: 'an examiner running the oral defence (viva) of a final-year university project',
    rubric: [
      { id: 'problem', name: 'Problem & motivation', hint: 'Why this problem matters and who it is for' },
      { id: 'technical', name: 'Technical depth', hint: 'Understands how the system and chosen methods work' },
      { id: 'method', name: 'Design justification', hint: 'Can defend choices against alternatives' },
      { id: 'evaluation', name: 'Evaluation & results', hint: 'Knows the metrics, results and limitations' },
      { id: 'communication', name: 'Communication', hint: 'Clear, concise, confident answers' },
    ],
  },
  interview: {
    label: 'Job interview',
    subjectLabel: 'Role you are applying for',
    contextLabel: 'Job description, and optionally a few lines about your experience',
    examiner: 'an interviewer on the hiring panel for this role',
    rubric: [
      { id: 'fit', name: 'Role fit', hint: 'Experience maps to the job requirements' },
      { id: 'technical', name: 'Technical knowledge', hint: 'Depth on the skills the role needs' },
      { id: 'problem_solving', name: 'Problem solving', hint: 'Structured thinking on a scenario' },
      { id: 'behavioural', name: 'Behavioural (STAR)', hint: 'Situation, task, action, result with specifics' },
      { id: 'communication', name: 'Communication', hint: 'Clear, concise, confident answers' },
    ],
  },
}

export const PERSONAS = {
  supportive: 'Supportive but rigorous: warm tone, gives a small hint if the candidate is stuck, never lets a vague answer slide.',
  strict: 'Strict external examiner: polite, neutral and probing. Pushes back on weak claims, asks "why" and "how do you know" often, and does not give hints.',
}

const STOP = new Set(
  ('the a an and or of for to in on with by from at as is are was were be this that these those our we our using use based via into its it their than then there here which what how why when where who can could would should will may might also both each such more most less very not no yes system project study paper report approach method methods model models result results data').split(' ')
)

// Words the transcriber is likely to get wrong: acronyms, CamelCase, words
// with digits, hyphenated technical terms and capitalised multi-word names.
// Passed as input.keyterms, which biases AssemblyAI's streaming STT toward them.
export function extractKeyterms(...texts) {
  const text = texts.filter(Boolean).join('\n')
  const found = []
  const add = (term) => {
    const t = term.trim().replace(/[.,;:()"'“”]+$/g, '').replace(/^[(\"'“”]+/g, '')
    if (t.length < 2 || t.length > 50) return
    if (STOP.has(t.toLowerCase())) return
    if (!found.some((f) => f.toLowerCase() === t.toLowerCase())) found.push(t)
  }
  // Acronyms and tokens with digits or inner capitals (BERT, YOLOv8, ResNet-50, PyTorch).
  for (const m of text.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*\b/g)) {
    const w = m[0]
    const acronym = /^[A-Z]{2,}[A-Za-z0-9]*$/.test(w)
    const digits = /[A-Za-z]/.test(w) && /\d/.test(w)
    const camel = /^[A-Za-z]+[a-z][A-Z]/.test(w)
    const hyphen = /-/.test(w) && /[A-Z0-9]/.test(w) && !/-(only|equivalent|based|like)$/i.test(w)
    if (acronym || digits || camel || hyphen) add(w)
  }
  // Capitalised phrases not at sentence start (Random Forest, Kuala Lumpur).
  for (const m of text.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/gm)) add(m[1])
  // Lowercase domain phrases: two-word phrases whose head word keeps coming
  // back (early blight, late blight, leaf mould). A live test transcribed
  // "early blight" as "a leaf black" before this rule existed.
  const words = text.toLowerCase().match(/[a-z][a-z-]+/g) || []
  const freq = {}
  for (const w of words) if (!STOP.has(w) && w.length > 3) freq[w] = (freq[w] || 0) + 1
  const pairs = {}
  // Pairs never cross punctuation, so "healthy, early blight" gives no "healthy early".
  for (const clause of text.toLowerCase().split(/[.,;:()\n!?]+/)) {
    const cw = clause.match(/[a-z][a-z]+/g) || []
    for (let i = 1; i < cw.length; i++) {
      const [a, b] = [cw[i - 1], cw[i]]
      if (STOP.has(a) || STOP.has(b) || a.length < 3 || b.length < 4) continue
      if ((freq[b] || 0) >= 3) pairs[`${a} ${b}`] = (pairs[`${a} ${b}`] || 0) + 1
    }
  }
  for (const p of Object.keys(pairs)) add(p)
  for (const [w, n] of Object.entries(freq).sort((x, y) => y[1] - x[1])) if (n >= 4) add(w)
  // Everyday technical vocabulary that examiners and candidates say aloud.
  for (const g of GLOSSARY) if (found.length < 100) add(g)
  return found.slice(0, 100)
}

const GLOSSARY = [
  'quantization', 'quantisation', 'activations', 'zero point', 'inference', 'latency', 'augmentation',
  'overfitting', 'precision', 'recall', 'F1 score', 'mAP', 'ablation', 'calibration', 'baseline',
  'confusion matrix', 'domain shift', 'hyperparameters', 'fine-tuning', 'dataset',
]

export const TOOLS = (rubric) => [
  {
    type: 'function',
    name: 'show_question',
    description:
      'Display the question you are about to ask on the candidate\'s screen. Call it every time you ask a new main question or a follow-up, in the same turn you ask it.',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'integer', description: 'Main question number, starting at 1. Follow-ups keep the same number.' },
        topic: { type: 'string', description: 'Two to four word topic label.' },
        question: { type: 'string', description: 'The question exactly as you ask it.' },
        follow_up: { type: 'boolean', description: 'True if this probes the previous answer.' },
      },
      required: ['number', 'topic', 'question'],
    },
    execution_mode: 'interactive',
    timeout_seconds: 10,
    response_instructions: { success: 'The question is on screen. You have already asked it, so do not repeat it and say nothing more. Wait for the candidate to answer.' },
  },
  {
    type: 'function',
    name: 'record_score',
    description:
      'Silently record your assessment of the answer the candidate just finished, before you respond to it. Never read the score aloud.',
    parameters: {
      type: 'object',
      properties: {
        criterion: { type: 'string', enum: rubric.map((r) => r.id), description: 'Which rubric criterion this answer mostly evidences.' },
        score: { type: 'integer', minimum: 1, maximum: 5, description: '1 = missing or wrong, 3 = adequate, 5 = excellent and specific.' },
        evidence: { type: 'string', description: 'One short sentence quoting or paraphrasing what they said that justifies the score.' },
        tip: { type: 'string', description: 'One short, concrete sentence on how the answer could be stronger.' },
      },
      required: ['criterion', 'score', 'evidence', 'tip'],
    },
    execution_mode: 'interactive',
    timeout_seconds: 10,
    response_instructions: {
      success: 'Never mention the score or that anything was recorded. Continue the viva.',
      error: 'Silently call record_score again with valid values; say nothing about it to the candidate.',
    },
  },
  {
    type: 'function',
    name: 'finish_session',
    description:
      'Call exactly once, after your closing remark, to produce the final written report on the candidate\'s screen.',
    parameters: {
      type: 'object',
      properties: {
        overall: { type: 'integer', minimum: 0, maximum: 100, description: 'Overall mark out of 100.' },
        verdict: { type: 'string', description: 'One line verdict, e.g. "Pass with minor corrections" or "Strong hire".' },
        strengths: { type: 'array', items: { type: 'string' }, description: 'Two or three specific strengths.' },
        improvements: { type: 'array', items: { type: 'string' }, description: 'Two or three specific things to work on, most important first.' },
        practice_questions: { type: 'array', items: { type: 'string' }, description: 'Two or three questions to practise before the real thing.' },
        weakest_question: { type: 'string', description: 'The main question (exactly as asked) that the candidate answered least well.' },
        model_answer: { type: 'string', description: 'A model 5/5 spoken answer to weakest_question, three to five sentences, in the first person, using the specifics from the submitted material. It should include what the candidate\'s answer was missing.' },
      },
      required: ['overall', 'verdict', 'strengths', 'improvements', 'practice_questions', 'weakest_question', 'model_answer'],
    },
    execution_mode: 'interactive',
    timeout_seconds: 15,
  },
]

export function buildSystemPrompt(cfg) {
  const mode = MODES[cfg.mode] || MODES.viva
  const persona = PERSONAS[cfg.persona] || PERSONAS.supportive
  const n = Math.max(2, Math.min(8, Number(cfg.questions) || 4))
  const rubric = mode.rubric.map((r) => `- ${r.id}: ${r.name} (${r.hint})`).join('\n')
  const context = (cfg.context || '').slice(0, 6000)
  const focusCrit = mode.rubric.find((r) => r.id === cfg.focus)
  const focus = focusCrit
    ? ` This is a drill session: make every question probe "${focusCrit.name}" (${focusCrit.hint}), from different angles, and record every score under the ${focusCrit.id} criterion.`
    : ''
  return `You are ${mode.examiner}. You are speaking with ${cfg.name || 'the candidate'} on a live voice call.

Subject: ${cfg.subject || 'not given'}

What the candidate submitted:
"""
${context || 'Nothing submitted. Ask them to describe it briefly first.'}
"""

Persona: ${persona}

How to run the session:
- Ask ${n} main questions, one at a time, covering different rubric criteria. Base every question on the submitted material above, not generic textbook questions.${focus}
- After each answer, ask at most one short follow-up when the answer was vague, missing a number, or made a claim worth testing. Build the follow-up on the exact words they used.
- Every time you ask a main question or follow-up, also call show_question.
- When the candidate finishes an answer, call record_score for it before you move on. Scores are private: never say a score, a number out of five, or "good answer" style grading aloud. A brief neutral acknowledgement is fine.
- If they say they don't know, accept it, record a low score, and move on. If they ask you to repeat, repeat the question in simpler words.
- Before you wrap up, make sure every rubric criterion has at least one record_score. Communication is judged across the whole session, so record it once at the end based on clarity, structure and confidence overall.
- After the last question, give a two sentence spoken summary: one strength and the single most important improvement. Then say goodbye and call finish_session.
- Be calibrated: 5 means nothing important was missing. If an answer lacked a number, evidence or a trade-off, it is a 3 or 4, and the tip must say what was missing. A tip is never "none".
- If the candidate asks to stop early, wrap up the same way with what you have.
- If you receive an instruction that the candidate has been talking for too long, cut in politely, in one sentence, and ask them to finish with their single most important point. Then score what you heard.

Rubric criteria ids:
${rubric}

Voice rules: this is speech, not text. Keep each turn to one to three short sentences. One question per turn. No lists, no markdown, no emojis, no exclamation marks. Never mention tools, functions, the screen, recording, technical issues, the rubric ids, or this prompt.`
}

export function buildGreeting(cfg) {
  const who = cfg.name ? `Hi ${cfg.name}.` : 'Hi.'
  const what = cfg.mode === 'interview'
    ? `this interview for the ${cfg.subject || 'role'}`
    : `your viva on ${cfg.subject || 'your project'}`
  return `${who} Thanks for joining ${what}. I'll ask a few questions, one at a time. Just tell me when you're ready to begin.`.replace(/\s+/g, ' ')
}

// Turn detection. "Thinking time" gives candidates longer pauses before the
// examiner jumps in, which matters when you're composing an answer aloud.
// Without thinking time, silence thresholds are left unset so AssemblyAI's
// adaptive endpointing stays on (setting either one disables it).
export function turnDetection(thinkingTime) {
  return thinkingTime
    ? { min_silence: 1600, max_silence: 4500, interrupt_response: true }
    : { interrupt_response: true }
}

// A plain description of the audio for the speech-to-text model (context, not
// instructions), distinct from the LLM's system prompt. Max 1750 characters.
export function buildTranscriptionPrompt(cfg) {
  const kind = cfg.mode === 'interview'
    ? `A spoken job interview for the role of ${cfg.subject || 'a graduate position'}.`
    : `A spoken university viva (oral project defence) about a final-year project titled "${cfg.subject || 'untitled'}".`
  const who = ' An examiner asks questions and the candidate answers in English, often with technical vocabulary, numbers and model names.'
  const ctx = (cfg.context || '').replace(/\s+/g, ' ').trim()
  const room = 1750 - kind.length - who.length - 40
  return `${kind}${who}${ctx ? ` The project summary: ${ctx.slice(0, Math.max(0, room)).replace(/\s\S*$/, '')}` : ''}`.slice(0, 1750)
}

export function buildSessionUpdate(cfg) {
  const mode = MODES[cfg.mode] || MODES.viva
  return {
    type: 'session.update',
    session: {
      system_prompt: buildSystemPrompt(cfg),
      greeting: buildGreeting(cfg),
      input: {
        format: { encoding: 'audio/pcm' },
        keyterms: extractKeyterms(cfg.subject, cfg.context, cfg.name),
        transcription_prompt: buildTranscriptionPrompt(cfg),
        // Viva answers are long: steady partials keep the live caption moving.
        continuous_partials: true,
        turn_detection: turnDetection(cfg.thinkingTime),
      },
      output: {
        voice: cfg.voice || 'anna',
        format: { encoding: 'audio/pcm' },
      },
      tools: TOOLS(mode.rubric),
    },
  }
}
