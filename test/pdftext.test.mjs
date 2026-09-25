import test from 'node:test'
import assert from 'node:assert/strict'
import { pickSections, splitSections, guessTitle, cleanText } from '../public/pdftext.js'

const THESIS = `LeafLens: Tomato Leaf Disease Detection on the Edge
Shermaine Yap
Submitted to the School of Computing
Asia Pacific University

Declaration
I declare that this is my own work.

Table of Contents
1 Introduction ....... 3

Abstract
Smallholder tomato farmers lose yield to blight. LeafLens runs YOLOv8n on a Raspberry Pi 5 to
detect lesions offline. It reaches mAP 0.87 on field images.

1. Introduction
Tomato is a major crop in Cameron Highlands. Diagnosis is slow.

3.2 Methodology
Images were annotated in Roboflow. Mosaic augmentation and background re-
placement were applied.

5 Results
Field mAP was 0.87 versus 0.95 on PlantVillage.

6 Conclusion
The system works offline at 118 ms per image.

References
[1] Redmon et al.`

test('splits on numbered and plain headings, skipping front matter', () => {
  const s = splitSections(THESIS)
  const titles = s.map((x) => x.title)
  assert.ok(titles.includes('abstract'))
  assert.ok(titles.includes('methodology'))
  assert.ok(titles.includes('results'))
  assert.ok(titles.includes('conclusion'))
  assert.ok(titles.includes('references'))
})

test('picks the viva-relevant sections in order and drops references', () => {
  const { context, found, title } = pickSections(THESIS)
  assert.deepEqual(found, ['Abstract', 'Methodology', 'Results', 'Conclusion'])
  assert.match(context, /^Abstract: Smallholder/)
  assert.match(context, /background replacement/, 'hyphenated line break joined')
  assert.ok(!context.includes('Redmon'))
  assert.ok(!context.includes('Table of Contents'))
  assert.equal(title, 'LeafLens: Tomato Leaf Disease Detection on the Edge')
})

test('falls back to the opening text when there are no headings', () => {
  const { context, found } = pickSections('Just a plain document.\nWith two lines of prose about a model.')
  assert.deepEqual(found, [])
  assert.match(context, /plain document/)
})

test('total context is capped', () => {
  const big = 'Abstract\n' + 'word '.repeat(5000) + '\nResults\n' + 'data '.repeat(5000)
  assert.ok(pickSections(big).context.length <= 6100)
})

test('guessTitle skips boilerplate', () => {
  assert.equal(guessTitle('by\nSubmitted to APU\nA Study of Things That Matter\n'), 'A Study of Things That Matter')
})

test('cleanText collapses whitespace', () => {
  assert.equal(cleanText('a  b   \n\n\n\nc'), 'a b\n\nc')
})
