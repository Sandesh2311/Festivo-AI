import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('planning workflow', () => {
  it('flags missing required information accessibly', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /plan your celebration/i }))
    fireEvent.click(screen.getByRole('button', { name: /create my event plan/i }))
    expect(await screen.findByText('Add an event title')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('details need your attention')
  })

  it('keeps a usable local plan when the live route is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /plan your celebration/i }))
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Maya’s birthday' } })
    fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2027-06-20' } })
    fireEvent.click(screen.getByRole('button', { name: /create my event plan/i }))
    await waitFor(() => expect(screen.getByText('A budget with breathing room.')).toBeInTheDocument())
    expect(screen.getByText('Maya’s birthday')).toBeInTheDocument()
    expect(screen.getByText(/local planning guide/i)).toBeInTheDocument()
    expect(screen.getByText('Venue')).toBeInTheDocument()
  })

  it('offers a clearly labelled sample, then tracks checklist progress', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /explore sample plan/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Vendor Checklist' }))
    expect(screen.getByText(/Sample plan/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('New checklist item'), { target: { value: 'Bring table cards' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))
    expect(screen.getByText('Bring table cards')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remove bring table cards/i }))
    expect(screen.queryByText('Bring table cards')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /mark complete: shortlist and confirm/i }))
    expect(screen.getByText('1 of 10 complete')).toBeInTheDocument()
    expect(screen.getByText(/Sample mode/i)).toBeInTheDocument()
  })

  it('toggles timeline milestones independently of the vendor checklist', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /explore sample plan/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }))
    const milestone = screen.getByRole('button', { name: 'Mark complete: Define requirements & guest list' })
    fireEvent.click(milestone)
    expect(screen.getByRole('button', { name: 'Mark incomplete: Define requirements & guest list' }).closest('.timeline-item')).toHaveClass('complete')
    fireEvent.click(screen.getByRole('button', { name: 'Vendor Checklist' }))
    expect(screen.getByText('0 of 10 complete')).toBeInTheDocument()
  })

  it('shows locally tailored ideas and a contextual assistant answer when AI is offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /explore sample plan/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspiration' }))
    fireEvent.click(screen.getByRole('button', { name: /generate personal ideas/i }))
    expect(await screen.findByText(/local ideas are based on your event details/i)).toBeInTheDocument()
    expect(screen.getByText(/welcome table/i)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /ask the planning assistant/i }), { target: { value: 'How can I stay within my budget?' } })
    fireEvent.click(screen.getByRole('button', { name: /send question/i }))
    expect(await screen.findByText(/For Maya’s garden birthday/i)).toBeInTheDocument()
  })
})
