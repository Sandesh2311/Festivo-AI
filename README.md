# Festivo AI

**Your celebration, beautifully planned.**

Festivo AI is a practical event-planning assistant for weddings, birthdays, engagements, anniversaries, community events and festivals. It brings the first decisions—budget, preparation timeline, supplier checklist and personal ideas—into one calm, accessible workflow.

## What it does

- Builds an event plan from the actual event type, date, city, guest count, budget and preferences.
- Suggests an editable category budget that reconciles to the user's spending ceiling, with contingency and per-guest estimates.
- Works preparation milestones backwards from the selected date and lets people track tasks.
- Includes a category-based vendor checklist, custom reminders, filters and progress.
- Generates personalized ideas and answers follow-up questions.
- Clearly labels estimates and sample content; it does not present businesses, prices or bookings as verified.
- Keeps a deterministic, session-only planning guide available when the Gemini route is unconfigured or offline.

## Screenshots

Capture screenshots of the Overview, Plan an Event, Budget, Timeline, Vendor Checklist and Inspiration views here before a public release.

## Architecture

The React/TypeScript single-page app is built by Vite. Production requests use same-origin `/api/*` endpoints implemented as Vercel Node serverless functions. The Gemini key is read only by server code. The server calls Google's Gemini `generateContent` REST API with `gemini-3.8-flash`, falling back to `gemini-3.5-flash-lite` after bounded retries for upstream overload; Zod validates inputs and model output, and the browser never receives the key. There is no database or event persistence. Sample mode is an explicitly labelled local example.

```text
src/                 React views, planner logic, styles, tests
api/                 Vercel serverless Gemini handlers and validation
public/              Static assets
```

## Stack

React 18, TypeScript, Vite, Zod, the server-side Gemini API, Lucide, Vitest, React Testing Library and Vercel Functions.

## Local setup

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env.local
# Add GEMINI_API_KEY to .env.local for live generation (optional)
npm run dev
```

Vite serves the frontend. To exercise Vercel functions locally, use the Vercel CLI (`vercel dev`) and set `GEMINI_API_KEY` in the local environment. With plain `npm run dev`, API calls fall back to the deterministic local guide.

## Quality commands

```bash
npm test
npm run build
npm run lint
npm audit
```

## Live AI and security

Set `GEMINI_API_KEY` as a server-side environment variable in Vercel Project Settings. Do not use a `VITE_` prefix. The server validates method, payload size, field lengths and enum values; bounds generation time; caps short-window request volume per function instance; asks Gemini for JSON; validates the response; and returns safe errors without provider details. In-memory rate limits are best-effort and reset when an instance is recycled. Never commit `.env` files.

Live generation requires Gemini API access and a configured key. The app's deterministic local guide is not GenAI; the interface labels it accordingly. AI estimates are not supplier quotes. The app does not verify availability, book suppliers, provide weather forecasts or store personal event details.

## Deploy to Vercel

1. Push this project to a Git provider and import it into Vercel, or install the CLI with `npm install --global vercel` and run `vercel login` followed by `vercel link`.
2. Keep the Vite framework preset and default build command (`npm run build`). `vercel.json` enables Vite framework detection; `/api` handlers are discovered from the root `api/` directory.
3. Add `GEMINI_API_KEY` in Vercel's server environment for Preview and Production as needed.
4. Deploy from the CLI with `vercel deploy --prod`, or use the Vercel dashboard deployment flow.
5. Verify `/api/generate-plan`, `/api/generate-ideas` and `/api/ask-assistant` with a valid request. A GET should return 405. Confirm a successful AI response only after using a real configured key.

## Demo workflow

1. Choose Plan an Event; enter event type, title, future date, location, guests, budget and preferences.
2. Generate the plan; observe live AI or its clearly labelled local planning guide.
3. Edit category allocations and see remaining budget and cost per guest update.
4. Review milestones, mark checklist tasks complete, add a personal reminder.
5. Generate ideas and ask the assistant a follow-up question.
6. Try an empty title to demonstrate accessible validation.
7. Use “Explore sample plan” to inspect an explicitly labelled example, separate from live generation.

## Challenge alignment

| Challenge requirement | Implementation |
| --- | --- |
| Weddings, birthdays and community events | Event-type-aware guided form and planning language |
| Budgets | Editable category estimates, reconciliation, remaining budget, per-guest cost and contingency |
| Timelines | Milestones derived from the actual event date; past due suggestions move to today |
| Vendor checklists | Interactive category checklist with custom tasks, filters and progress |
| Personalized ideas | Gemini route uses the submitted event context; local fallback clearly labelled |
| GenAI planning assistant | Server-side Gemini routes for plans, ideas and contextual questions |

## Responsible AI notes

AI content can be incomplete or inaccurate. Treat outputs as suggestions, independently confirm important logistics and accessibility requirements with suppliers, and obtain written quotes. Avoid sharing sensitive personal information in optional preference fields. Data is processed for the request and is not saved by this app.
