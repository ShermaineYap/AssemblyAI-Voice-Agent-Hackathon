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

VivaVoice is a real-time voice examiner for your own material. Drop in your report PDF (the abstract, methods, results and conclusion are extracted in the browser) or paste a job description, choose a supportive or strict examiner, and start talking. The examiner asks questions drawn from what you submitted. When an answer is vague, it asks a follow-up that builds on your exact words, the way a real panel does.

While you speak, the agent calls client-side tools: show_question puts the current question on screen, and record_score fills a five-criterion rubric with evidence and a concrete tip after each answer. VivaVoice also coaches delivery. Using AssemblyAI's streaming transcript and speech events, it measures speaking pace, highlights filler words and tracks thinking time. If an answer rambles past 90 seconds, the examiner cuts in and asks for your main point, like a real panel. At the end, finish_session produces a report with an overall mark, verdict, strengths, prioritised improvements, practice questions, the full transcript, and your weakest question answered two ways: what you said next to a model 5/5 answer. Reports are kept in the browser so you can see your score, filler words and thinking time improve across sessions, and one button starts a drill session on your weakest criterion.

The whole app runs on one AssemblyAI Voice Agent API WebSocket. Each session is configured inline from the student's input:
- Technical terms from the abstract (like YOLOv8n, NCNN or PlantVillage) are sent as keyterms, so the student's jargon is transcribed correctly.
- A "thinking time" option loosens turn detection, so a pause mid-answer doesn't end the student's turn.
- Barge-in stops playback mid-word.
- Tool results follow the API's reply.done timing rules and are dropped for interrupted replies.

Students can also rehearse by phone. The site gives a four-digit code, the student calls the VivaVoice number (a Twilio SIP trunk into an AssemblyAI stored agent) and reads the code out. The phone examiner then loads their material and scores them through HTTP tools that AssemblyAI calls on the VivaVoice server, so the rubric fills in live on the laptop while they talk on the phone. It also sends a plain-language transcription_prompt describing the session, keeps continuous partials on for long answers, resumes the session automatically after a network drop, and wraps up before the session cap. A zero-dependency Node server mints short-lived tokens with per-IP rate limiting, so the API key never reaches the browser. The code is MIT licensed and has 48 automated tests.

**Technologies / tags**
AssemblyAI, Voice Agent API, Twilio, Telephony, Speech-to-Text, Voice AI, Real-time, WebSocket, Tool Calling, JavaScript, Node.js, Web Audio API, Education, EdTech, Career

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
| 0:15–0:40 | Setup page, drag a real PDF onto the drop zone (use your FYP report, or `docs/sample-thesis.pdf`) | "I drop in my actual report. VivaVoice pulls out the abstract, methods and results in the browser. See these terms? They go to AssemblyAI as keyterms, so my jargon, like YOLOv8n and NCNN, gets transcribed correctly. I'll pick a strict examiner." |
| 0:40–2:05 | Live session (open the page with `?ramble=30` so the alarm fires quickly): answer 2–3 questions. Make one answer deliberately vague with an "um", and ramble on one so the examiner cuts in | Let the demo speak. Point out: the question card updates, a follow-up on your vague answer, the rubric bars filling, filler words highlighted, and the examiner cutting in when you ramble. |
| 2:05–2:35 | Click End session → report | "The report gives my mark, what to fix first, and my weakest question answered two ways: what I said, next to a 5/5 answer built from my own report. Every session is saved, so I can see my score and filler words improve, and drill my weakest area." |
| 2:30–2:55 | "How it works" slide | "It's all one AssemblyAI Voice Agent API session: inline config per student, keyterms, tuned turn detection and three client-side tools, with the key kept on the server." |
| 2:55–3:10 | Closing slide | "VivaVoice is open source. Walk into your viva having already said it out loud. Thank you." |

Tips: use headphones or keep speakers low so the examiner doesn't hear itself. Do one practice run first. Keep the whole video under 4 minutes.
