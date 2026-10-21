import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from './generate-plan'
import type { Request, Response } from './_shared.js'

function responseMock() {
  const state: { code: number; body?: unknown; headers: Record<string,string> } = { code: 200, headers: {} }
  const response = {
    status(code: number) { state.code = code; return response },
    json(body: unknown) { state.body = body },
    setHeader(name: string, value: string) { state.headers[name] = value },
  }
  return { response: response as Response, state }
}
const body = { type:'Birthday',title:'Maya’s birthday',date:'2027-06-20',location:'Pune',guests:40,days:1,budget:20000,currency:'INR',flexibility:'Fixed',theme:'Garden picnic',setting:'Outdoor',food:'Vegetarian',personal:'',formality:'Relaxed',priority:'Budget',ageGroup:'Children',accessibility:'',special:'',contingency:'' }
const successPayload = { candidates:[{ content:{ parts:[{ text:JSON.stringify({ summary:'Plan summary', concept:'Garden concept', theme:'Garden theme', venue:'Accessible venue', food:'Vegetarian food', guestExperience:'Simple games', contingency:'Indoor backup', suggestions:['Confirm venue','Check dietary needs'] }) }] } }] }
function httpResponse(status: number, payload: unknown, retryAfter?: string) {
  return { ok:status >= 200 && status < 300, status, headers:{ get: (name: string) => name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null }, json:async () => payload } as unknown as Response
}

afterEach(() => { delete process.env.GEMINI_API_KEY; vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
describe('Vercel plan route guards', () => {
  it('rejects methods other than POST', async () => {
    const { response, state } = responseMock()
    await handler({ method:'GET', headers:{} }, response)
    expect(state.code).toBe(405)
  })
  it('rejects malformed input before contacting Gemini', async () => {
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{}, body:{ ...body, guests:0 } }, response)
    expect(state.code).toBe(400)
  })
  it('fails safely when the server key is missing', async () => {
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{}, body } as Request, response)
    expect(state.code).toBe(503)
    expect(state.body).toEqual({ error:'AI generation is not configured on the server.' })
    expect(JSON.stringify(state.body)).not.toContain('GEMINI_API_KEY')
  })
  it('validates and returns a successful structured Gemini response', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    const plan = { summary:'A joyful 40 guest birthday in Pune for ₹20,000; all costs are estimates.', concept:'A garden birthday with picnic tables.', theme:'Garden picnic with reusable details.', venue:'Choose an accessible outdoor venue with indoor backup.', food:'Confirm vegetarian options and dietary needs.', guestExperience:'Add a welcome table and relaxed games.', contingency:'Keep a weather-safe backup.', suggestions:['Ask for written venue inclusions.','Confirm dietary needs with guests.','Keep a reserve for last-minute needs.'] }
    const fetchMock = vi.fn().mockResolvedValue({ ok:true, json:async () => ({ candidates:[{ content:{ parts:[{ text:JSON.stringify(plan) }] } }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':'test-success'}, body } as Request, response)
    expect(state.code).toBe(200)
    expect((state.body as {plan:{summary:string}}).plan.summary).toContain('40 guest birthday')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method:'POST' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).generationConfig).toEqual({ responseMimeType:'application/json', maxOutputTokens:1000 })
  })
  it('rejects requests larger than the server limit', async () => {
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{}, body:{ ...body, special:'x'.repeat(13000) } }, response)
    expect(state.code).toBe(413)
  })
  it('returns a safe error for invalid model JSON', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true, json:async () => ({ candidates:[{ content:{ parts:[{ text:'not json' }] } }] }) }))
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':'test-invalid-model'}, body } as Request, response)
    expect(state.code).toBe(502)
    expect(state.body).toEqual({ error:'The planning assistant returned an invalid answer. Please try again.' })
  })
  it('returns a safe timeout after one bounded upstream request', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once:true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const timingLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { response, state } = responseMock()
    const pending = handler({ method:'POST', headers:{'x-forwarded-for':'test-timeout'}, body } as Request, response)
    await vi.advanceTimersByTimeAsync(18_000)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
    expect(state.code).toBe(504)
    expect(state.body).toEqual({ error:'The planning service timed out. Please try again.' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-only-key')
    expect(JSON.stringify(log.mock.calls)).not.toContain('Garden picnic')
    expect(JSON.stringify(timingLog.mock.calls)).toContain('gemini.request_start')
    expect(JSON.stringify(log.mock.calls)).toContain('totalDurationMs')
    expect(JSON.stringify(log.mock.calls)).toContain('gemini.deadline_abort')
    expect(JSON.stringify(log.mock.calls)).toContain('application_deadline')
  })
  it('maps non-2xx Gemini responses to a safe upstream error', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    const fetchMock = vi.fn().mockResolvedValue(httpResponse(500, { error:{ code:500, message:'sensitive provider details' } }))
    vi.stubGlobal('fetch', fetchMock)
    const timingLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':'test-upstream-error'}, body } as Request, response)
    expect(state.code).toBe(502)
    expect(state.body).toEqual({ error:'The AI service rejected the request. Please try again later.' })
    expect(JSON.stringify(state.body)).not.toContain('sensitive provider details')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(timingLog.mock.calls)).toContain('gemini.upstream_response')
  })
  it('retries a 503 once and succeeds within the shared deadline', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(httpResponse(503, { error:{ code:503, message:'temporary overload' } }, '0.05'))
      .mockResolvedValueOnce(httpResponse(200, successPayload))
    vi.stubGlobal('fetch', fetchMock)
    const timingLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { response, state } = responseMock()
    const pending = handler({ method:'POST', headers:{'x-forwarded-for':'test-retry-success'}, body } as Request, response)
    await vi.advanceTimersByTimeAsync(50)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(state.code).toBe(200)
    const events = timingLog.mock.calls.map(call => String(call[0])).join('\n')
    expect(events).toContain('"attempt":2')
    expect(events).toContain('"status":503')
    expect(events).toContain('"waitMs":50')
    expect(events).not.toContain('test-only-key')
    expect(events).not.toContain('Garden picnic')
  })
  it('stops after the configured retry limit for repeated 503 responses', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn().mockResolvedValue(httpResponse(503, { error:{ code:503, message:'temporary overload' } }))
    vi.stubGlobal('fetch', fetchMock)
    const timingLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { response, state } = responseMock()
    const pending = handler({ method:'POST', headers:{'x-forwarded-for':'test-retry-limit'}, body } as Request, response)
    await vi.advanceTimersByTimeAsync(125)
    await vi.advanceTimersByTimeAsync(250)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(state.code).toBe(503)
    expect(state.body).toEqual({ error:'The planning assistant is temporarily unavailable. Please try again shortly.' })
    const events = timingLog.mock.calls.map(call => String(call[0])).join('\n')
    expect(events).toContain('"reason":"retry_limit"')
    expect(events).toContain('"waitMs":125')
    expect(events).toContain('"waitMs":250')
  })
  it('does not retry when the deadline cannot fit another useful attempt', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.useFakeTimers()
    let resolveFirst!: (value: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { resolveFirst = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const timingLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { response, state } = responseMock()
    const pending = handler({ method:'POST', headers:{'x-forwarded-for':'test-retry-deadline'}, body } as Request, response)
    await vi.advanceTimersByTimeAsync(17_000)
    resolveFirst(httpResponse(503, { error:{ code:503, message:'temporary overload' } }))
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.code).toBe(503)
    expect(timingLog.mock.calls.map(call => String(call[0])).join('\n')).toContain('"reason":"deadline"')
  })
  it('keeps the original deadline after a retry instead of granting a fresh timeout', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(httpResponse(503, { error:{ code:503, message:'temporary overload' } }, '17'))
      .mockImplementationOnce((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once:true })
      }))
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response, state } = responseMock()
    const pending = handler({ method:'POST', headers:{'x-forwarded-for':'test-retry-total-deadline'}, body } as Request, response)
    await vi.advanceTimersByTimeAsync(17_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(true)
    expect(state.code).toBe(504)
    const deadlineEvent = log.mock.calls.map(call => JSON.parse(String(call[0]))).find(event => event.event === 'gemini.deadline_abort')
    expect(deadlineEvent).toMatchObject({ attempt:2, failureCategory:'application_deadline', elapsedMs:18_000 })
  })
  it.each([401, 403])('does not retry non-retryable HTTP %i responses', async status => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    const fetchMock = vi.fn().mockResolvedValue(httpResponse(status, { error:{ code:status, message:'not authorized' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':`test-no-retry-${status}`}, body } as Request, response)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.code).toBe(503)
  })
  it('handles a malformed Gemini HTTP response body safely', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    const fetchMock = vi.fn().mockResolvedValue({ ok:true, status:200, json:async () => { throw new SyntaxError('private response body') } })
    vi.stubGlobal('fetch', fetchMock)
    const timingLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':'test-malformed-body'}, body } as Request, response)
    expect(state.code).toBe(502)
    expect(state.body).toEqual({ error:'The planning assistant returned an invalid answer. Please try again.' })
    expect(JSON.stringify(state.body)).not.toContain('private response body')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(timingLog.mock.calls)).toContain('gemini.response_parse_start')
    expect(JSON.stringify(timingLog.mock.calls)).toContain('gemini.response_parse_end')
  })
  it('logs bounded Google error details without logging credentials or prompts', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:false, status:400, json:async () => ({ error:{ code:400, message:`Invalid API key test-only-key; ${'x'.repeat(400)}` } }) }))
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':'test-diagnostics'}, body } as Request, response)
    const failure = JSON.parse(log.mock.calls.map(call => String(call[0])).find(line => line.includes('gemini.failure')) as string)
    expect(failure).toMatchObject({ category:'upstream_http', status:400, googleCode:400, route:'generate-plan' })
    expect(failure.totalDurationMs).toEqual(expect.any(Number))
    expect(failure.googleMessage.length).toBeLessThanOrEqual(240)
    expect(failure.googleMessage).toContain('[REDACTED_KEY]')
    expect(JSON.stringify(failure)).not.toContain('test-only-key')
    expect(JSON.stringify(failure)).not.toContain('Maya')
    expect(state.code).toBe(502)
  })
  it('classifies network failures separately', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':'test-network'}, body } as Request, response)
    expect(state.code).toBe(502)
    expect(state.body).toEqual({ error:'The planning service could not be reached. Please try again.' })
    const fetchFailure = log.mock.calls.map(call => JSON.parse(String(call[0]))).find(event => event.event === 'gemini.fetch_rejected')
    expect(fetchFailure).toMatchObject({ attempt:1, failureCategory:'network' })
  })
  it('classifies unexpected upstream handling exceptions separately', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    const brokenResponse = { status:200, get ok(): boolean { throw new Error('unexpected internal detail') } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(brokenResponse))
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':'test-unexpected'}, body } as Request, response)
    expect(state.code).toBe(500)
    expect(state.body).toEqual({ error:'The planning assistant encountered an unexpected error.' })
  })
})
