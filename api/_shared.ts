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
const GEMINI_MODEL = 'gemini-3.8-flash'
const GEMINI_TIMEOUT_MS = 18_000

export async function generate(prompt: string, schema: z.ZodTypeAny, route = 'unknown'): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw Object.assign(new Error('AI is not configured'), { code: 'MISSING_KEY' })
  const requestId = randomUUID()
  const startedAt = Date.now()
  let stage = 'request'
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  console.info(JSON.stringify({ event: 'gemini.start', route, requestId, model: GEMINI_MODEL }))
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(Object.assign(new Error('Provider timeout'), { code: 'TIMEOUT' }))
    }, GEMINI_TIMEOUT_MS)
  })
  const operation = async () => {
    stage = 'upstream_request'
    let response: globalThis.Response
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.65, maxOutputTokens: 1800 } }), signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) throw Object.assign(new Error('Provider timeout'), { code: 'TIMEOUT' })
      throw Object.assign(new Error('Provider network error'), { code: 'NETWORK' })
    }
    console.info(JSON.stringify({ event: 'gemini.response', route, requestId, status: response.status, elapsedMs: Date.now() - startedAt }))
    if (!response.ok) throw Object.assign(new Error('Provider response error'), { status: response.status })
    stage = 'response_parse'
    let payload: unknown
    try { payload = await response.json() } catch { throw Object.assign(new Error('Invalid model response'), { code: 'INVALID_RESPONSE' }) }
    const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates?.[0]?.content?.parts
    const raw = parts?.map(part => part.text ?? '').join('')
    if (!raw) throw Object.assign(new Error('Empty model response'), { code: 'INVALID_RESPONSE' })
    try { return schema.parse(JSON.parse(raw)) } catch { throw Object.assign(new Error('Invalid model response'), { code: 'INVALID_RESPONSE' }) }
  }
  try {
    const result = await Promise.race([operation(), timedOut])
    console.info(JSON.stringify({ event: 'gemini.success', route, requestId, elapsedMs: Date.now() - startedAt }))
    return result
  } catch (error) {
    const details = error as { code?: string; status?: number }
    const code = details?.code || (details?.status ? 'UPSTREAM_ERROR' : 'UNKNOWN')
    console.error(JSON.stringify({ event: 'gemini.failure', route, requestId, stage, code, status: details?.status, elapsedMs: Date.now() - startedAt }))
    throw error
  } finally { if (timeout) clearTimeout(timeout) }
}
export function failed(res: Response, error: unknown) {
  const code = (error as {code?:string})?.code
  if (code === 'MISSING_KEY') { res.status(503).json({ error: 'AI is not configured' }); return }
  if (code === 'TIMEOUT') { res.status(504).json({ error: 'The planning service timed out. Please try again.' }); return }
  if (code === 'NETWORK') { res.status(502).json({ error: 'The planning service could not be reached. Please try again.' }); return }
  if ((error as {status?:number})?.status === 429) { res.status(429).json({ error: 'The planning assistant is busy' }); return }
  res.status(502).json({ error: 'The planning assistant could not return a valid answer' })
}
