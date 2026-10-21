import { z } from 'zod'
import { randomUUID } from 'node:crypto'

export interface Request { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }
export interface Response { status(code: number): Response; json(value: unknown): void; setHeader(name: string, value: string): void }
const eventSchema = z.object({ type: z.enum(['Wedding','Birthday','Engagement','Anniversary','Community Event','Festival','Other']), title: z.string().trim().min(2).max(80), date: z.string().refine(value => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0,10) === value && value >= new Date().toISOString().slice(0,10) }), location: z.string().max(80), guests: z.number().int().min(1).max(100000), days: z.number().int().min(1).max(30), budget: z.number().finite().min(1).max(1_000_000_000), currency: z.enum(['INR','USD','EUR','GBP']), flexibility: z.enum(['Fixed','Flexible']), theme: z.string().max(120), setting: z.string().max(40), food: z.string().max(160), personal: z.string().max(240), formality: z.string().max(40), priority: z.enum(['Budget','Aesthetics','Convenience','Balanced']), ageGroup: z.string().max(80), accessibility: z.string().max(200), special: z.string().max(240), contingency: z.string().max(160) })
export type Input = z.infer<typeof eventSchema>
export const planSchema = z.object({ summary: z.string().max(1200), concept: z.string().max(1200), theme: z.string().max(1200), venue: z.string().max(1200), food: z.string().max(1200), guestExperience: z.string().max(1200), contingency: z.string().max(1200), suggestions: z.array(z.string().max(500)).min(2).max(6) })
const recent = new Map<string, number[]>()
export function allowRate(req: Request, res: Response): boolean {
  const ipHeader = req.headers['x-forwarded-for']; const ip = (Array.isArray(ipHeader) ? ipHeader[0] : ipHeader)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  const now = Date.now(), hits = (recent.get(ip) || []).filter(time => now - time < 60_000)
  if (recent.size > 1000) for (const [knownIp, timestamps] of recent) if (timestamps.every(time => now - time >= 60_000)) recent.delete(knownIp)
  if (hits.length >= 12) { res.status(429).json({ error: 'Please try again in a minute.' }); return false }
  hits.push(now); recent.set(ip, hits); return true
}
export function guard(req: Request, res: Response): Input | null {
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff')
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return null }
  let body: string
  try { body = JSON.stringify(req.body ?? {}) } catch { res.status(400).json({ error: 'Invalid request' }); return null }
  if (body.length > 12000) { res.status(413).json({ error: 'Request is too large' }); return null }
  if (!allowRate(req, res)) return null
  const parsed = eventSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Please check your event details.' }); return null }
  return parsed.data
}
const GEMINI_PRIMARY_MODEL = 'gemini-3.8-flash'
const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite'
const GEMINI_TIMEOUT_MS = 18_000
const GEMINI_MAX_OUTPUT_TOKENS = 1000
const GEMINI_MAX_RETRIES = 2
const GEMINI_RETRY_BASE_MS = 250
const GEMINI_RETRY_MAX_MS = 2_000
const GEMINI_MIN_ATTEMPT_WINDOW_MS = 1_000
const ERROR_MESSAGE_LIMIT = 240

function retryAfterMs(response: globalThis.Response): number | undefined {
  const value = response.headers?.get('retry-after')?.trim()
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

function sanitizeProviderMessage(message: unknown, key: string, prompt: string): string | undefined {
  if (typeof message !== 'string') return undefined
  const sanitized = message
    .replaceAll(prompt, '[REDACTED_PROMPT]')
    .replaceAll(key, '[REDACTED_KEY]')
    .replace(/AIza[\w-]{20,}/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .trim()
  const withoutControls = Array.from(sanitized, character => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 ? ' ' : character
  }).join('')
  return withoutControls.slice(0, ERROR_MESSAGE_LIMIT) || undefined
}

export async function generate(prompt: string, schema: z.ZodTypeAny, route = 'unknown'): Promise<unknown> {
  const requestId = randomUUID()
  const startedAt = Date.now()
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    const error = Object.assign(new Error('AI is not configured'), { code: 'MISSING_KEY', category: 'configuration' })
    console.error(JSON.stringify({ event: 'gemini.failure', route, requestId, stage: 'configuration', category: 'configuration', elapsedMs: 0 }))
    throw error
  }
  let stage = 'request'
  let attempt = 0
  let activeModel = GEMINI_PRIMARY_MODEL
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  console.info(JSON.stringify({ event: 'gemini.start', route, requestId, model: GEMINI_PRIMARY_MODEL, fallbackModel: GEMINI_FALLBACK_MODEL }))
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      console.error(JSON.stringify({ event: 'gemini.deadline_abort', route, requestId, attempt, model: activeModel, failureCategory: 'application_deadline', elapsedMs: Date.now() - startedAt }))
      controller.abort()
      reject(Object.assign(new Error('Provider timeout'), { code: 'TIMEOUT', category: 'timeout' }))
    }, GEMINI_TIMEOUT_MS)
  })
  const operation = async () => {
    const requestModel = async (model: string, fallback = false): Promise<globalThis.Response> => {
      attempt++
      activeModel = model
      stage = 'upstream_request'
      const requestStartedAt = Date.now()
      console.info(JSON.stringify({ event: 'gemini.request_start', route, requestId, attempt, model, fallback, elapsedMs: requestStartedAt - startedAt }))
      let response: globalThis.Response
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS } }), signal: controller.signal,
        })
      } catch {
        if (controller.signal.aborted) {
          console.error(JSON.stringify({ event: 'gemini.fetch_rejected', route, requestId, attempt, model, failureCategory: 'application_deadline', elapsedMs: Date.now() - startedAt }))
          throw Object.assign(new Error('Provider timeout'), { code: 'TIMEOUT', category: 'timeout' })
        }
        console.error(JSON.stringify({ event: 'gemini.fetch_rejected', route, requestId, attempt, model, failureCategory: 'network', elapsedMs: Date.now() - startedAt }))
        throw Object.assign(new Error('Provider network error'), { code: 'NETWORK', category: 'network' })
      }
      const responseAt = Date.now()
      console.info(JSON.stringify({ event: 'gemini.upstream_response', route, requestId, attempt, model, fallback, status: response.status, requestDurationMs: responseAt - requestStartedAt, elapsedMs: responseAt - startedAt }))
      return response
    }

    let primaryAttempts = 1
    let response = await requestModel(GEMINI_PRIMARY_MODEL)
    while (response.status === 503) {
      const remainingMs = GEMINI_TIMEOUT_MS - (Date.now() - startedAt)
      const retryNumber = primaryAttempts
      const exponentialMs = Math.min(GEMINI_RETRY_MAX_MS, GEMINI_RETRY_BASE_MS * (2 ** (retryNumber - 1)))
      const jitteredMs = Math.round(exponentialMs * (0.5 + Math.random()))
      const requestedWaitMs = retryAfterMs(response) ?? jitteredMs
      const canRetry = primaryAttempts <= GEMINI_MAX_RETRIES && remainingMs > GEMINI_MIN_ATTEMPT_WINDOW_MS && requestedWaitMs <= remainingMs - GEMINI_MIN_ATTEMPT_WINDOW_MS
      if (!canRetry) {
        console.info(JSON.stringify({ event: 'gemini.retry_skipped', route, requestId, attempt, model: GEMINI_PRIMARY_MODEL, status: response.status, waitMs: 0, elapsedMs: Date.now() - startedAt, reason: primaryAttempts > GEMINI_MAX_RETRIES ? 'retry_limit' : 'deadline' }))
        break
      }
      console.info(JSON.stringify({ event: 'gemini.retry', route, requestId, attempt, model: GEMINI_PRIMARY_MODEL, status: response.status, waitMs: requestedWaitMs, elapsedMs: Date.now() - startedAt }))
      try { await response.body?.cancel() } catch { /* Ignore body cleanup errors before retrying. */ }
      await new Promise<void>(resolve => setTimeout(resolve, requestedWaitMs))
      primaryAttempts++
      response = await requestModel(GEMINI_PRIMARY_MODEL)
    }

    if (response.status === 503) {
      const remainingMs = GEMINI_TIMEOUT_MS - (Date.now() - startedAt)
      if (remainingMs > GEMINI_MIN_ATTEMPT_WINDOW_MS) {
        console.info(JSON.stringify({ event: 'gemini.fallback', route, requestId, fromModel: GEMINI_PRIMARY_MODEL, model: GEMINI_FALLBACK_MODEL, remainingMs, elapsedMs: Date.now() - startedAt }))
        try { await response.body?.cancel() } catch { /* Ignore body cleanup errors before falling back. */ }
        response = await requestModel(GEMINI_FALLBACK_MODEL, true)
      } else {
        console.info(JSON.stringify({ event: 'gemini.fallback_skipped', route, requestId, fromModel: GEMINI_PRIMARY_MODEL, model: GEMINI_FALLBACK_MODEL, remainingMs, reason: 'deadline', elapsedMs: Date.now() - startedAt }))
      }
    }
    if (!response.ok) {
      let googleError: { error?: { code?: number | string; message?: string } } | undefined
      try { googleError = await response.json() as typeof googleError } catch { /* Google may return a non-JSON error body. */ }
      throw Object.assign(new Error('Provider response error'), {
        code: 'UPSTREAM_HTTP', category: 'upstream_http', status: response.status,
        googleCode: googleError?.error?.code,
        googleMessage: sanitizeProviderMessage(googleError?.error?.message, key, prompt),
      })
    }
    stage = 'response_parse'
    const responseParseStartedAt = Date.now()
    console.info(JSON.stringify({ event: 'gemini.response_parse_start', route, requestId, elapsedMs: responseParseStartedAt - startedAt }))
    let payload: unknown
    try { payload = await response.json() } catch {
      console.info(JSON.stringify({ event: 'gemini.response_parse_end', route, requestId, outcome: 'invalid_json', parseDurationMs: Date.now() - responseParseStartedAt, elapsedMs: Date.now() - startedAt }))
      throw Object.assign(new Error('Invalid model response'), { code: 'INVALID_RESPONSE', category: 'malformed_response' })
    }
    const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates?.[0]?.content?.parts
    const raw = parts?.map(part => part.text ?? '').join('')
    if (!raw) {
      console.info(JSON.stringify({ event: 'gemini.response_parse_end', route, requestId, outcome: 'empty_content', parseDurationMs: Date.now() - responseParseStartedAt, elapsedMs: Date.now() - startedAt }))
      throw Object.assign(new Error('Empty model response'), { code: 'INVALID_RESPONSE', category: 'malformed_response' })
    }
    try {
      const result = schema.parse(JSON.parse(raw))
      console.info(JSON.stringify({ event: 'gemini.response_parse_end', route, requestId, outcome: 'success', parseDurationMs: Date.now() - responseParseStartedAt, elapsedMs: Date.now() - startedAt }))
      return result
    } catch {
      console.info(JSON.stringify({ event: 'gemini.response_parse_end', route, requestId, outcome: 'invalid_content', parseDurationMs: Date.now() - responseParseStartedAt, elapsedMs: Date.now() - startedAt }))
      throw Object.assign(new Error('Invalid model response'), { code: 'INVALID_RESPONSE', category: 'malformed_response' })
    }
  }
  try {
    const result = await Promise.race([operation(), timedOut])
    console.info(JSON.stringify({ event: 'gemini.success', route, requestId, totalDurationMs: Date.now() - startedAt }))
    return result
  } catch (error) {
    const details = error as { code?: string; category?: string; status?: number; googleCode?: number | string; googleMessage?: string }
    const category = details?.category || 'unexpected'
    console.error(JSON.stringify({ event: 'gemini.failure', route, requestId, stage, model: activeModel, category, code: details?.code, status: details?.status, googleCode: details?.googleCode, googleMessage: details?.googleMessage, totalDurationMs: Date.now() - startedAt }))
    throw error
  } finally { if (timeout) clearTimeout(timeout) }
}
export function failed(res: Response, error: unknown) {
  const details = error as { category?: string; status?: number }
  const category = details?.category || 'unexpected'
  if (category === 'configuration') { res.status(503).json({ error: 'AI generation is not configured on the server.' }); return }
  if (category === 'timeout') { res.status(504).json({ error: 'The planning service timed out. Please try again.' }); return }
  if (category === 'network') { res.status(502).json({ error: 'The planning service could not be reached. Please try again.' }); return }
  if (category === 'upstream_http' && details.status === 429) { res.status(429).json({ error: 'The planning assistant is busy. Please try again shortly.' }); return }
  if (category === 'upstream_http' && (details.status === 401 || details.status === 403)) { res.status(503).json({ error: 'The AI service is not authorized. Please contact support.' }); return }
  if (category === 'upstream_http' && details.status === 503) { res.status(503).json({ error: 'The planning assistant is temporarily unavailable. Please try again shortly.' }); return }
  if (category === 'upstream_http') { res.status(502).json({ error: 'The AI service rejected the request. Please try again later.' }); return }
  if (category === 'malformed_response') { res.status(502).json({ error: 'The planning assistant returned an invalid answer. Please try again.' }); return }
  res.status(500).json({ error: 'The planning assistant encountered an unexpected error.' })
}
