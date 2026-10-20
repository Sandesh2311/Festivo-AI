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
    expect(state.body).toEqual({ error:'AI is not configured' })
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
    expect(state.body).toEqual({ error:'The planning assistant could not return a valid answer' })
  })
  it('returns a safe timeout after one bounded upstream request', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response, state } = responseMock()
    const pending = handler({ method:'POST', headers:{'x-forwarded-for':'test-timeout'}, body } as Request, response)
    await vi.advanceTimersByTimeAsync(18_000)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.code).toBe(504)
    expect(state.body).toEqual({ error:'The planning service timed out. Please try again.' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-only-key')
    expect(JSON.stringify(log.mock.calls)).not.toContain('Garden picnic')
  })
  it('maps non-2xx Gemini responses to a safe upstream error', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:false, status:503, text:async () => 'sensitive provider details' }))
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':'test-upstream-error'}, body } as Request, response)
    expect(state.code).toBe(502)
    expect(state.body).toEqual({ error:'The planning assistant could not return a valid answer' })
    expect(JSON.stringify(state.body)).not.toContain('sensitive provider details')
  })
  it('handles a malformed Gemini HTTP response body safely', async () => {
    process.env.GEMINI_API_KEY = 'test-only-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true, status:200, json:async () => { throw new SyntaxError('private response body') } }))
    const { response, state } = responseMock()
    await handler({ method:'POST', headers:{'x-forwarded-for':'test-malformed-body'}, body } as Request, response)
    expect(state.code).toBe(502)
    expect(state.body).toEqual({ error:'The planning assistant could not return a valid answer' })
    expect(JSON.stringify(state.body)).not.toContain('private response body')
  })
})
