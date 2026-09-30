// Vercel entry point. vercel.json serves ./public as static files and sends
// /token, /config and /health here, to the same handler `npm start` uses.
import { createHandler } from '../server.mjs'

const handler = createHandler()

export default function vercel(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const route = url.searchParams.get('route')
  if (route) req.url = '/' + route
  return handler(req, res)
}
