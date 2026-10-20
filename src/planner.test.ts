import { describe, expect, it } from 'vitest'
import { allocateBudget, eventSchema, makeFallbackPlan, summarizeAllocations, makeTasks } from './planner'
import type { EventInput } from './types'

const event: EventInput = { type: 'Birthday', title: 'Maya turns ten', date: '2027-06-20', location: 'Pune', guests: 40, days: 1, budget: 20000, currency: 'INR', flexibility: 'Fixed', theme: 'Garden picnic', setting: 'Outdoor', food: 'Vegetarian', personal: '', formality: 'Casual', priority: 'Budget', ageGroup: 'Children', accessibility: '', special: '', contingency: '' }
describe('budget allocation', () => {
  it('reconciles exactly and stays inside the stated budget', () => { const rows = allocateBudget(20345.67); expect(Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100).toBe(20345.67) })
  it('calculates remaining, per guest, and exceeded state', () => { expect(summarizeAllocations(allocateBudget(1000), 10, 1000)).toMatchObject({ allocated: 1000, remaining: 0, perGuest: 100, exceeded: false }) })
  it('handles invalid budget and zero guests', () => { expect(allocateBudget(0).every(r => r.amount === 0)).toBe(true); expect(summarizeAllocations([], 0, 100).perGuest).toBe(0) })
})
describe('event timeline', () => {
  it('creates ordered milestones and clamps past due dates to today', () => { const tasks = makeTasks(event, new Date('2027-05-01T00:00:00Z')); expect(tasks).toHaveLength(8); expect(tasks.at(-1)?.title).toBe('Celebrate!'); expect(tasks[0].due).toBe('2027-05-01'); expect(tasks.at(-1)?.due).toBe('2027-06-20') })
})
describe('event validation and personalized guide', () => {
  it('accepts complete details and rejects invalid guests, budgets, and dates', () => {
    expect(eventSchema.safeParse(event).success).toBe(true)
    expect(eventSchema.safeParse({ ...event, guests: 0 }).success).toBe(false)
    expect(eventSchema.safeParse({ ...event, budget: -1 }).success).toBe(false)
    expect(eventSchema.safeParse({ ...event, date: '2020-01-01' }).success).toBe(false)
    expect(eventSchema.safeParse({ ...event, date: '2027-02-31' }).success).toBe(false)
  })
  it('reflects actual event context and preferences in the local plan', () => {
    const plan = makeFallbackPlan(event)
    expect(plan.summary).toContain('birthday')
    expect(plan.summary).toContain('40 guests')
    expect(plan.summary).toContain('Pune')
    expect(plan.concept).toContain('garden picnic')
    const changed = makeFallbackPlan({ ...event, type: 'Community Event', title: 'Pune harvest gathering', date: '2027-07-18', guests: 120, budget: 50000, theme: 'Harvest tables', food: 'Vegan', accessibility: 'Step-free access', priority: 'Convenience' })
    expect(changed.summary).toContain('community event')
    expect(changed.summary).toContain('120 guests')
    expect(changed.summary).toContain('50,000')
    expect(changed.summary).toContain('July 18, 2027')
    expect(changed.concept).toContain('harvest tables')
    expect(changed.food).toContain('Vegan')
    expect(changed.suggestions.join(' ')).toContain('Step-free access')
  })
})
