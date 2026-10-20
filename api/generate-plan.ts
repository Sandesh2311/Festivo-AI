import { failed, generate, guard, planSchema, type Request, type Response } from './_shared.js'
export default async function handler(req: Request, res: Response) {
  const event = guard(req, res); if (!event) return
  const prompt = `You are a practical event planner. Build a concise, personalized plan using only the input below. Never claim a supplier, venue, booking, price quote, fact about availability, or weather forecast is verified. State costs are estimates. Fit all advice to the exact event, date, budget, guest count, location, theme, setting, food, preferences and accessibility needs. Do not exceed the budget. Respond as JSON with summary, concept, theme, venue, food, guestExperience, contingency and suggestions (array of 3 practical items).\nEVENT: ${JSON.stringify(event)}`
  try { const plan = await generate(prompt, planSchema, 'generate-plan'); res.status(200).json({ plan }) } catch (error) { failed(res, error) }
}
