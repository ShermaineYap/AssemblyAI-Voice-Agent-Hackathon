# lablab.ai submission kit: VivaVoice

Deadline: **30 Sep 2026, 11:00 AM EDT = 11:00 PM Malaysia time.** Aim to submit a day early.

## Checklist

- [ ] Live test done locally (`npm start`, sample viva end to end)
- [ ] Repo set to **public**: GitHub → Settings → General → Danger Zone → Change visibility
- [ ] App deployed (Render: New → Blueprint → pick this repo → paste `ASSEMBLYAI_API_KEY`), URL tested
- [ ] Demo video recorded and uploaded to YouTube (Unlisted is fine) ≤ 3–4 min
- [ ] Slide deck exported to PDF
- [ ] Cover image uploaded (`docs/cover.png`)
- [ ] Form filled with the text below, then submitted
- [ ] Revoke the GitHub token used for pushing

## Form fields

**Project title**
VivaVoice

**Short description** (one line)
A voice examiner that questions you on your own project or target job, scores every answer live and hands you a report, built on the AssemblyAI Voice Agent API.

**Long description**
Final-year students have to defend their projects in a viva, and job seekers face interviews. Both tests are spoken, yet almost everyone prepares by reading. Mock vivas need a lecturer's time, and generic interview bots ask textbook questions that have nothing to do with your work.

VivaVoice is a real-time voice examiner for your own material. Paste your project abstract or a job description, choose a supportive or strict examiner, and start talking. The examiner asks questions drawn from what you submitted. When an answer is vague, it asks a follow-up that builds on your exact words, the way a real panel does.

While you speak, the agent calls client-side tools: show_question puts the current question on screen, and record_score fills a five-criterion rubric with evidence and a concrete tip after each answer. VivaVoice also coaches delivery. Using AssemblyAI's streaming transcript and speech events, it measures speaking pace, highlights filler words and tracks thinking time. At the end, finish_session produces a report with an overall mark, verdict, strengths, prioritised improvements, practice questions and the full transcript, which you can export to Markdown or PDF.

The whole app runs on one AssemblyAI Voice Agent API WebSocket. Each session is configured inline from the student's input:
- Technical terms from the abstract (like YOLOv8n, NCNN or PlantVillage) are sent as keyterms, so the student's jargon is transcribed correctly.
- A "thinking time" option loosens turn detection, so a pause mid-answer doesn't end the student's turn.
- Barge-in stops playback mid-word.
- Tool results follow the API's reply.done timing rules and are dropped for interrupted replies.

A zero-dependency Node server mints short-lived tokens with per-IP rate limiting, so the API key never reaches the browser. The code is MIT licensed and has 23 automated tests.

**Technologies / tags**
AssemblyAI, Voice Agent API, Speech-to-Text, Voice AI, Real-time, WebSocket, Tool Calling, JavaScript, Node.js, Web Audio API, Education, EdTech, Career

**Category**
Education / Productivity

**GitHub repository**
https://github.com/ShermaineYap/AssemblyAI-Voice-Agent-Hackathon

**Demo application URL**
<your Render URL>

## Demo video script (~3 min)

Record with QuickTime (File → New Screen Recording) or OBS, with system audio so the examiner's voice is captured. On a Mac, the simplest way is to play the examiner through speakers and record with the microphone on, or use BlackHole for clean audio.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | Cover slide | "Hi, I'm Shermaine, a final-year student at APU Malaysia. Everyone has to defend their project out loud, but we all prepare by reading. So I built VivaVoice." |
| 0:15–0:35 | Setup page, click *Fill with a sample* | "You paste your abstract or a job description. See these terms? VivaVoice sends them to AssemblyAI as keyterms, so my jargon, like YOLOv8n and NCNN, gets transcribed correctly. I'll choose a strict examiner and turn on thinking time." |
| 0:35–2:05 | Live session: answer 2–3 questions. Make one answer deliberately vague, with an "um" | Let the demo speak. Point out: the question card updates, a follow-up on your vague answer, the rubric bars filling, filler words highlighted, interrupting the examiner mid-sentence. |
| 2:05–2:30 | Click End session → report | "When I end, the examiner wraps up and the report appears: my mark, what to fix first, and questions to practise." |
| 2:30–2:55 | "How it works" slide | "It's all one AssemblyAI Voice Agent API session: inline config per student, keyterms, tuned turn detection and three client-side tools, with the key kept on the server." |
| 2:55–3:10 | Closing slide | "VivaVoice is open source. Walk into your viva having already said it out loud. Thank you." |

Tips: use headphones or keep speakers low so the examiner doesn't hear itself. Do one practice run first. Keep the whole video under 4 minutes.
