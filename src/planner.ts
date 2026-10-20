import { z } from 'zod'
import type { Allocation, EventInput, Plan, Task } from './types'

function isDateTodayOrFuture(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.valueOf()) || date.getFullYear() !== Number(value.slice(0,4)) || date.getMonth() + 1 !== Number(value.slice(5,7)) || date.getDate() !== Number(value.slice(8,10))) return false
  const today = new Date(), todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  return value >= todayKey
}
export const eventSchema = z.object({
  type: z.enum(['Wedding', 'Birthday', 'Engagement', 'Anniversary', 'Community Event', 'Festival', 'Other']),
  title: z.string().trim().min(2, 'Add an event title').max(80, 'Keep the title under 80 characters'),
  date: z.string().refine(isDateTodayOrFuture, 'Choose today or a future date'),
  location: z.string().max(80).default(''), guests: z.number().int().min(1, 'At least one guest is needed').max(100000), days: z.number().int().min(1).max(30),
  budget: z.number().finite().min(1, 'Budget must be greater than zero').max(1_000_000_000), currency: z.string(), flexibility: z.enum(['Fixed', 'Flexible']),
  theme: z.string().max(120), setting: z.string(), food: z.string().max(160), personal: z.string().max(240), formality: z.string(), priority: z.enum(['Budget', 'Aesthetics', 'Convenience', 'Balanced']), ageGroup: z.string().max(80), accessibility: z.string().max(200), special: z.string().max(240), contingency: z.string().max(160),
})

const ratios: Record<string, number> = { Venue: 20, 'Food & drinks': 32, Decor: 12, 'Photo & video': 8, Entertainment: 7, Invitations: 3, Transport: 4, Miscellaneous: 6, Contingency: 8 }
export function allocateBudget(budget: number): Allocation[] {
  if (!Number.isFinite(budget) || budget <= 0) return Object.keys(ratios).map(category => ({ category, amount: 0, percent: Math.round(ratios[category] * 100) }))
  const cents = Math.round(budget * 100)
  const entries = Object.entries(ratios).map(([category, percent]) => ({ category, amount: Math.floor(cents * percent / 100), percent }))
  entries[0].amount += cents - entries.reduce((sum, row) => sum + row.amount, 0)
  return entries.map(row => ({ ...row, amount: row.amount / 100 }))
}
export function summarizeAllocations(allocations: Allocation[], guests: number, budget: number) {
  const allocatedCents = allocations.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? Math.round(row.amount * 100) : 0), 0)
  const allocated = allocatedCents / 100
  const remainingCents = Math.round(budget * 100) - allocatedCents
  return { allocated, remaining: remainingCents / 100, perGuest: guests > 0 ? Math.round(allocatedCents / guests) / 100 : 0, exceeded: remainingCents < 0 }
}

const prep = [
  ['Define requirements & guest list', 60, 'High', 'Planning'], ['Research venues and check availability', 45, 'High', 'Venue'], ['Contact potential vendors', 30, 'High', 'Vendors'], ['Finalize guest list and send invitations', 21, 'Medium', 'Invitations'], ['Confirm catering and dietary needs', 14, 'High', 'Catering'], ['Confirm logistics and accessibility', 7, 'Medium', 'Logistics'], ['Final checks and weather plan', 2, 'High', 'Contingency'], ['Celebrate!', 0, 'Low', 'Event day'],
] as const
export function makeTasks(input: EventInput, now = new Date()): Task[] {
  const event = new Date(`${input.date}T12:00:00`)
  return prep.map(([title, offset, priority, category], i) => {
    const due = new Date(event); due.setDate(due.getDate() - offset)
    const actual = due < now ? now : due
    const dueDate = `${actual.getFullYear()}-${String(actual.getMonth() + 1).padStart(2, '0')}-${String(actual.getDate()).padStart(2, '0')}`
    return { id: `task-${i}`, title, category, priority, due: dueDate, done: false }
  })
}

export function makeFallbackPlan(input: EventInput): Plan {
  const budgetView = new Intl.NumberFormat('en-IN', { style: 'currency', currency: input.currency, maximumFractionDigits: 0 }).format(input.budget)
  const location = input.location ? ` in ${input.location}` : ''
  const theme = input.theme || (input.type === 'Birthday' ? 'joyful, personal details' : input.type === 'Community Event' || input.type === 'Festival' ? 'welcoming local character' : 'warm modern elegance')
  return {
    summary: `A ${input.priority.toLowerCase()}-minded ${input.type.toLowerCase()} for ${input.guests} guests${location} on ${new Date(`${input.date}T12:00:00`).toLocaleDateString('en', { dateStyle: 'long' })}. Plan within ${budgetView}; all costs below are planning estimates, not vendor quotes.`,
    concept: `${input.days > 1 ? `${input.days}-day ` : ''}${input.type} built around ${theme.toLowerCase()}, with a clear welcome moment, a shared meal, and one memorable activity. ${input.personal ? `Personal touch: ${input.personal}.` : ''}`,
    theme: `Use ${theme} as the visual thread. Choose two main colors, reusable or seasonal flowers, warm lighting, and a few meaningful focal points rather than decorating every surface.`,
    venue: `${input.setting === 'No preference' ? 'Compare indoor and outdoor' : `Prioritize ${input.setting.toLowerCase()}`} spaces${location}, with capacity for ${input.guests}, accessible facilities, clear included-cost terms, and a weather backup if outdoors.`,
    food: `Request a per-person menu estimate for ${input.guests}, including ${input.food || 'a balanced menu'} and dietary accommodations. Compare buffet and family-style service; confirm final numbers and allergen handling before booking.`,
    guestExperience: `Make arrival easy with a welcome point, visible schedule, seating for different needs, and one participatory moment suited to ${input.type.toLowerCase()}. Share practical travel and timing details with guests in advance.`,
    contingency: `${input.contingency || 'Keep a weather-safe indoor alternative and a small reserve for last-minute needs.'} Set aside the contingency allocation before committing optional extras.`,
    suggestions: [
      `For ${input.guests} guests, request comparable written estimates with inclusions and cancellation terms before choosing a venue.`,
      input.accessibility ? `Plan for access needs early: ${input.accessibility}. Confirm details directly with each venue and supplier.` : 'Ask the venue about step-free access, rest areas, and clear signage before confirming.',
      input.priority === 'Budget' ? 'Protect food, comfort, and access first; simplify rentals and decorative details to stay inside budget.' : `Keep ${input.priority.toLowerCase()} as the tie-breaker when comparing choices, while preserving the agreed spending ceiling.`,
    ],
  }
}

export const vendorCategories = ['Venue', 'Catering', 'Decoration', 'Photography', 'Entertainment', 'Invitations', 'Transportation', 'Equipment', 'Accessibility', 'Contingency']
export function initialChecklist(): Task[] {
  return vendorCategories.map((category, index) => ({ id: `vendor-${index}`, title: `${category === 'Venue' ? 'Shortlist and confirm' : `Arrange ${category.toLowerCase()}`}`, category, due: '', priority: ['Venue', 'Catering', 'Accessibility', 'Contingency'].includes(category) ? 'High' : 'Medium', done: false }))
}
