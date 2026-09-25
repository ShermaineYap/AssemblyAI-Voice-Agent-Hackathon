// Extracts the parts of a report that matter for a viva, in the browser.
// pdf.js does the reading; pickSections() is pure and unit-tested.

const HEADINGS = [
  'abstract', 'executive summary', 'summary', 'introduction', 'problem statement', 'aim', 'aims', 'objectives',
  'methodology', 'methods', 'method', 'design', 'system design', 'implementation', 'results', 'evaluation',
  'findings', 'discussion', 'limitations', 'conclusion', 'conclusions', 'future work',
]
// Sections a viva examiner cares most about, in the order they should appear.
const WANTED = ['abstract', 'executive summary', 'summary', 'problem statement', 'objectives', 'aims', 'aim', 'methodology', 'methods', 'method', 'results', 'evaluation', 'findings', 'limitations', 'conclusion', 'conclusions', 'future work']
const SKIP = /^(references|bibliography|appendix|appendices|acknowledg|table of contents|list of figures|list of tables|declaration)/i

const PER_SECTION = 1400
const TOTAL = 6000

export function cleanText(t) {
  return t
    .replace(/-\n(?=[a-z])/g, '')       // hyphenated line breaks
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// Finds heading lines: short lines that are a known heading, optionally numbered.
export function splitSections(text) {
  const lines = cleanText(text).split('\n')
  const sections = []
  let cur = { title: 'front', body: [] }
  for (const raw of lines) {
    const line = raw.trim()
    const m = line.match(/^(?:(?:chapter\s+)?\d+(?:\.\d+)*\.?\s+)?([A-Za-z][A-Za-z &]{2,40})$/i)
    const title = m && m[1].trim().toLowerCase()
    if (title && line.length <= 48 && (HEADINGS.includes(title) || SKIP.test(title))) {
      sections.push(cur)
      cur = { title, body: [] }
    } else if (line) cur.body.push(line)
  }
  sections.push(cur)
  return sections.map((s) => ({ title: s.title, text: s.body.join(' ').replace(/\s+/g, ' ').trim() })).filter((s) => s.text)
}

export function pickSections(text) {
  const sections = splitSections(text)
  const picked = []
  const used = new Set()
  for (const want of WANTED) {
    const s = sections.find((x) => x.title === want && !used.has(x))
    if (!s) continue
    used.add(s)
    picked.push(s)
  }
  // No recognisable headings: take the start of the document.
  if (!picked.length) {
    const body = sections.map((s) => s.text).join(' ')
    return { context: body.slice(0, TOTAL), found: [], title: guessTitle(text) }
  }
  let out = ''
  for (const s of picked) {
    if (out.length >= TOTAL) break
    const room = Math.min(PER_SECTION, TOTAL - out.length)
    const chunk = s.text.length > room ? s.text.slice(0, room).replace(/\s\S*$/, '') + '…' : s.text
    out += `${cap(s.title)}: ${chunk}\n\n`
  }
  return { context: out.trim(), found: picked.map((s) => cap(s.title)), title: guessTitle(text) }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// The title is usually the first substantial line on the first page.
export function guessTitle(text) {
  const lines = cleanText(text).split('\n').map((l) => l.trim())
  const line = lines.find((l) => l.length >= 12 && l.length <= 160 && /[a-z]/.test(l) && !/^(by |a (thesis|dissertation|project|report)|the university|submitted|student|supervisor|faculty|school|department|bachelor|master)/i.test(l) && (l.match(/[A-Za-z]/g) || []).length > l.length * 0.6)
  return line || ''
}

let pdfjs
export async function extractPdf(file, onProgress) {
  pdfjs ||= await import('./vendor/pdfjs/pdf.min.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = Math.min(doc.numPages, 80)
  let text = ''
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let last = null
    let line = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      const y = item.transform[5]
      if (last != null && Math.abs(y - last) > 2) { text += line + '\n'; line = '' }
      line += (line && !line.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str
      last = y
    }
    text += line + '\n\n'
    onProgress?.(i, pages)
  }
  return { text, pages: doc.numPages }
}
