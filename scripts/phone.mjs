#!/usr/bin/env node
// Puts the VivaVoice examiner on a phone number.
//
//   npm run phone               publish the phone examiner and attach it to your Twilio number
//   npm run phone -- --agent    only publish (or update) the phone examiner agent
//
// Needs, in .env or the environment:
//   ASSEMBLYAI_API_KEY
//   PUBLIC_URL          the https address of your deployed VivaVoice (AssemblyAI calls its tools)
//   PHONE_TOOL_SECRET   any long random string; the same value must be set on the deployed server
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (+E.164), TWILIO_TRUNK_DOMAIN (*.pstn.twilio.com)
//   PHONE_AGENT_ID      optional; set after the first run so later runs update the same agent
//
// Every step checks what already exists first, so it is safe to re-run.
// Flow: Twilio SIP trunk -> sip:sip.assemblyai.com -> the stored agent below.
// https://www.assemblyai.com/docs/voice-agents/voice-agent-api/connect-to-twilio

import { randomBytes } from 'node:crypto'
import { loadEnv } from '../server.mjs'
import { buildPhoneAgent } from '../public/session.js'

loadEnv()
const agentOnly = process.argv.includes('--agent')
const env = (name, hint) => {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing ${name}.${hint ? ' ' + hint : ''}`)
    process.exit(1)
  }
  return v
}

const API = process.env.AGENTS_API_BASE || 'https://agents.assemblyai.com/v1'
async function aai(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}`, 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) throw Object.assign(new Error(`AssemblyAI ${method} ${path} failed (${res.status}): ${text}`), { status: res.status })
  return text ? JSON.parse(text) : {}
}

async function twilio(url, form) {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
  const res = await fetch(url, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: `Basic ${auth}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(form ? { body: new URLSearchParams(form).toString() } : {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Twilio ${form ? 'POST' : 'GET'} ${url.replace(/https:\/\/[^/]+/, '')} failed (${res.status}): ${text}`)
  return text ? JSON.parse(text) : {}
}

env('ASSEMBLYAI_API_KEY', 'Get one at https://www.assemblyai.com/dashboard/api-keys')
const publicUrl = env('PUBLIC_URL', 'The https address of your deployed VivaVoice, e.g. https://vivavoice.onrender.com')
if (!/^https:\/\//.test(publicUrl)) {
  console.error('PUBLIC_URL must start with https:// (AssemblyAI calls the phone tools on it).')
  process.exit(1)
}
let secret = process.env.PHONE_TOOL_SECRET
if (!secret) {
  secret = randomBytes(24).toString('hex')
  console.log(`No PHONE_TOOL_SECRET set, generated one. Add it to .env AND to your deployed server's environment:\n  PHONE_TOOL_SECRET=${secret}\n`)
}

// 1. The phone examiner: a stored agent whose tools call this server.
const agent = buildPhoneAgent({ publicUrl, secret, voice: process.env.PHONE_VOICE || 'anna' })
let agentId = process.env.PHONE_AGENT_ID
if (agentId) {
  try {
    await aai(`/agents/${agentId}`, { method: 'PUT', body: agent })
    console.log(`Agent: ${agentId} updated`)
  } catch (e) {
    if (e.status !== 404) throw e
    agentId = null
  }
}
if (!agentId) {
  const existing = ((await aai('/agents')).agents || []).find((a) => a.name === agent.name)
  if (existing) {
    agentId = existing.id
    await aai(`/agents/${agentId}`, { method: 'PUT', body: agent })
    console.log(`Agent: ${agentId} updated (found by name)`)
  } else {
    agentId = (await aai('/agents', { method: 'POST', body: agent })).id
    console.log(`Agent: ${agentId} created`)
  }
  console.log(`  Add to .env so later runs update it: PHONE_AGENT_ID=${agentId}`)
}
if (agentOnly) {
  console.log('\nDone. Attach this agent to a number in the AssemblyAI dashboard, or run without --agent.')
  process.exit(0)
}

// 2. Twilio: the number must already be yours.
const number = env('TWILIO_PHONE_NUMBER', 'A number you own in Twilio, in E.164 format like +15551234567')
const trunkDomain = env('TWILIO_TRUNK_DOMAIN', 'A name you choose ending in .pstn.twilio.com, e.g. vivavoice-shermaine.pstn.twilio.com')
env('TWILIO_ACCOUNT_SID')
env('TWILIO_AUTH_TOKEN')
if (!/^\+[1-9]\d{6,14}$/.test(number)) throw new Error(`TWILIO_PHONE_NUMBER must be E.164, like +15551234567 (got ${number})`)
if (!trunkDomain.endsWith('.pstn.twilio.com')) throw new Error(`TWILIO_TRUNK_DOMAIN must end in .pstn.twilio.com (got ${trunkDomain})`)

const TRUNKS = 'https://trunking.twilio.com/v1/Trunks'
const ACCOUNT = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}`
const SIP = 'sip:sip.assemblyai.com'

const incoming = (await twilio(`${ACCOUNT}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(number)}`)).incoming_phone_numbers?.[0]
if (!incoming) throw new Error(`${number} is not on this Twilio account. Buy it in the Twilio console first.`)

let trunk = ((await twilio(TRUNKS)).trunks || []).find((t) => t.domain_name === trunkDomain)
if (!trunk) trunk = await twilio(TRUNKS, { FriendlyName: 'VivaVoice', DomainName: trunkDomain })
console.log(`Trunk: ${trunk.sid}`)

const origins = (await twilio(`${TRUNKS}/${trunk.sid}/OriginationUrls`)).origination_urls || []
if (!origins.some((o) => o.sip_url === SIP)) {
  await twilio(`${TRUNKS}/${trunk.sid}/OriginationUrls`, { FriendlyName: 'AssemblyAI', SipUrl: SIP, Priority: 1, Weight: 1, Enabled: true })
}
console.log(`Origination: ${SIP}`)

if (incoming.trunk_sid && incoming.trunk_sid !== trunk.sid) throw new Error(`${number} is on another trunk (${incoming.trunk_sid}). Detach it in the Twilio console and re-run.`)
if (!incoming.trunk_sid) await twilio(`${TRUNKS}/${trunk.sid}/PhoneNumbers`, { PhoneNumberSid: incoming.sid })
console.log(`Number: ${number} on the trunk`)

// 3. AssemblyAI: register the number and bind the agent to it.
const enc = encodeURIComponent(number)
try {
  await aai(`/phone-numbers/${enc}`)
} catch (e) {
  if (e.status !== 404) throw e
  await aai('/phone-numbers/import', { method: 'POST', headers: { 'Idempotency-Key': randomBytes(16).toString('hex') }, body: { phone_number: number, termination_uri: trunkDomain } })
}
await aai(`/phone-numbers/${enc}/agent`, { method: 'PUT', body: { agent_id: agentId } })
console.log(`Attached: the VivaVoice examiner answers ${number}`)
console.log(`\nSet these on your deployed server too, then redeploy:\n  PHONE_TOOL_SECRET=${secret}\n  PHONE_NUMBER=${number}\n\nThen open ${publicUrl}, fill in your project and choose "Practise by phone".`)
