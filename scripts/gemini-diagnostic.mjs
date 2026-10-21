const model = 'gemini-3.8-flash'
const prompt = 'Return JSON only: {"ok":true}'
const timeoutMs = 8_000
const key = process.env.GEMINI_API_KEY
const startedAt = performance.now()

function sanitize(message) {
  return String(message)
    .replaceAll(key ?? '\0', '[REDACTED_KEY]')
    .replaceAll(prompt, '[REDACTED_PROMPT]')
    .replace(/AIza[\w-]{20,}/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 240)
}

let status = 'not received'
let errorMessage

if (!key) {
  errorMessage = 'GEMINI_API_KEY is not set in this terminal environment.'
} else {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
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
    errorMessage = controller.signal.aborted
      ? `Local diagnostic timed out after ${timeoutMs} ms.`
      : sanitize(error instanceof Error ? error.message : 'Request failed.')
  } finally {
    clearTimeout(timeout)
  }
}

const elapsedMs = Math.round(performance.now() - startedAt)
console.log(`HTTP status: ${status}`)
console.log(`Elapsed time: ${elapsedMs} ms`)
if (errorMessage) console.log(`Error: ${errorMessage}`)
