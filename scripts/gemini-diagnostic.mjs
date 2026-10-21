/* global process, performance, console, Headers, AbortController, setTimeout, fetch, clearTimeout */

const model = 'gemini-3.8-flash'
const prompt = 'Return JSON only: {"ok":true}'
const timeoutMs = 8_000
const rawKey = process.env.GEMINI_API_KEY
const key = rawKey?.trim()
const startedAt = performance.now()

const keyHasLineBreak = typeof rawKey === 'string' && /[\r\n]/.test(rawKey)
const keyHasOuterWhitespace = typeof rawKey === 'string' && rawKey !== rawKey.trim()
console.log(`GEMINI_API_KEY exists: ${rawKey !== undefined}`)
console.log(`GEMINI_API_KEY type: ${typeof rawKey}`)
console.log(`GEMINI_API_KEY character count: ${typeof rawKey === 'string' ? rawKey.length : 0}`)
console.log(`GEMINI_API_KEY contains CR/LF: ${keyHasLineBreak}`)
console.log(`GEMINI_API_KEY has leading/trailing whitespace: ${keyHasOuterWhitespace}`)

function sanitize(message) {
  return String(message)
    .replaceAll(key ?? '\0', '[REDACTED_KEY]')
    .replaceAll(prompt, '[REDACTED_PROMPT]')
    .replace(/AIza[\w-]{20,}/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 240)
}

let status = 'not received'
let errorMessage
let errorName
let causeCode
let causeMessage

if (!key) {
  errorMessage = 'GEMINI_API_KEY is not set in this terminal environment.'
} else if (typeof key !== 'string') {
  errorMessage = 'GEMINI_API_KEY must be a string. Set it as a normal environment variable and try again.'
} else if (keyHasLineBreak) {
  errorMessage = 'GEMINI_API_KEY contains a line break. Remove CR/LF characters and try again.'
} else {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  try {
    headers.set('x-goog-api-key', key)
  } catch {
    errorMessage = 'GEMINI_API_KEY is not valid for an HTTP header. Set a valid API key value and try again.'
  }
  if (!errorMessage) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 16 },
      }),
      signal: controller.signal,
    })
    status = String(response.status)
    if (!response.ok) {
      let providerMessage
      try {
        const payload = await response.json()
        providerMessage = payload?.error?.message
      } catch {
        // Keep the status if the provider error body is not JSON.
      }
      errorMessage = sanitize(providerMessage || `Gemini returned HTTP ${response.status}.`)
    }
  } catch (error) {
    errorName = error instanceof Error ? error.name : typeof error
    const cause = error instanceof Error && error.cause && typeof error.cause === 'object'
      ? error.cause
      : undefined
    causeCode = typeof cause?.code === 'string' ? sanitize(cause.code) : undefined
    causeMessage = typeof cause?.message === 'string' ? sanitize(cause.message) : undefined
    errorMessage = controller.signal.aborted
      ? `Local diagnostic timed out after ${timeoutMs} ms.`
      : sanitize(error instanceof Error ? error.message : 'Request failed.')
  } finally {
    clearTimeout(timeout)
  }
  }
}

const elapsedMs = Math.round(performance.now() - startedAt)
console.log(`HTTP status: ${status}`)
console.log(`Elapsed time: ${elapsedMs} ms`)
if (errorMessage) console.log(`Error: ${errorMessage}`)
if (errorName) console.log(`Error name: ${sanitize(errorName)}`)
if (causeCode) console.log(`Fetch cause code: ${causeCode}`)
if (causeMessage) console.log(`Fetch cause message: ${causeMessage}`)
