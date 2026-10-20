export type EventType = 'Wedding' | 'Birthday' | 'Engagement' | 'Anniversary' | 'Community Event' | 'Festival' | 'Other'
export type Priority = 'Budget' | 'Aesthetics' | 'Convenience' | 'Balanced'
export interface EventInput {
  type: EventType; title: string; date: string; location: string; guests: number; days: number; budget: number; currency: string; flexibility: 'Fixed' | 'Flexible'; theme: string; setting: string; food: string; personal: string; formality: string; priority: Priority; ageGroup: string; accessibility: string; special: string; contingency: string
}
export interface Allocation { category: string; amount: number; percent: number }
export interface Plan { summary: string; concept: string; theme: string; venue: string; food: string; guestExperience: string; contingency: string; suggestions: string[] }
export interface Task { id: string; title: string; category: string; due: string; priority: 'High' | 'Medium' | 'Low'; done: boolean; custom?: boolean }
export type NavPage = 'Overview' | 'Plan an Event' | 'Budget' | 'Timeline' | 'Vendor Checklist' | 'Inspiration'
