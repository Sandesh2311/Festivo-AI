import { allowRate, failed, generate, type Request, type Response } from './_shared.js'
import { z } from 'zod'
const inputSchema = z.object({ event: z.record(z.unknown()), question: z.string().trim().min(4).max(500) })
const outputSchema = z.object({ answer: z.string().min(20).max(1500) })
export default async function handler(req: Request, res: Response) {
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff')
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  let size = 0; try { size = JSON.stringify(req.body ?? {}).length } catch { res.status(400).json({ error: 'Invalid request' }); return }
  if (size > 12000) { res.status(413).json({ error: 'Request is too large' }); return }
  if (!allowRate(req, res)) return
  const parsed = inputSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Please add a short question.' }); return }
  try { const output = await generate(`You are a careful event planning assistant. Answer the user's question practically, using their event details when relevant. Do not make up quotes, bookings, supplier availability, legal advice, or current local facts. Mention trade-offs and clear next steps. Keep the answer concise and state costs are estimates. Event context: ${JSON.stringify(parsed.data.event)}\nQuestion: ${parsed.data.question}`, outputSchema, 'ask-assistant'); res.status(200).json(output) } catch (error) { failed(res,error) }
}
