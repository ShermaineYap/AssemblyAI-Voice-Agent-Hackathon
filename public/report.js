// If the examiner never called finish_session (early hang-up, network), build
// a report from the rubric scores we do have.
export function fallbackReport(stats, mode) {
  const scored = stats.filter((c) => c.avg != null)
  if (!scored.length) {
    return {
      overall: 0,
      verdict: 'Not enough answers to assess',
      strengths: [],
      improvements: ['Answer at least two questions so the examiner can score you.'],
      practice_questions: [],
      fallback: true,
    }
  }
  const avg = scored.reduce((a, c) => a + c.avg, 0) / scored.length
  const overall = Math.round(avg * 20)
  const sorted = [...scored].sort((a, b) => b.avg - a.avg)
  const verdict = mode === 'interview'
    ? overall >= 80 ? 'Strong candidate' : overall >= 60 ? 'Promising, with gaps to close' : 'Not ready yet'
    : overall >= 80 ? 'Well defended' : overall >= 60 ? 'Pass with corrections' : 'Needs more preparation'
  return {
    overall,
    verdict,
    strengths: sorted.slice(0, 2).filter((c) => c.avg >= 3).map((c) => `${c.name}: ${c.items.at(-1).evidence}`),
    improvements: sorted.slice(-2).reverse().map((c) => `${c.name}: ${c.items.at(-1).tip}`),
    practice_questions: [],
    fallback: true,
  }
}

