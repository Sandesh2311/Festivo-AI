import { failed, generate, guard, type Request, type Response } from './_shared'
import { z } from 'zod'
const schema = z.object({ ideas: z.array(z.string().min(8).max(500)).min(3).max(6) })
export default async function handler(req: Request, res: Response) {
  const event = guard(req,res); if (!event) return
  try { const ideas = await generate(`Give 4 practical, distinctive celebration ideas personalized to this event. Avoid verified-business claims or specific vendor quotes. Include low-cost and accessible ideas when appropriate. JSON only: {"ideas":["..."]}. Event: ${JSON.stringify(event)}`, schema); res.status(200).json(ideas) } catch (error) { failed(res,error) }
}
