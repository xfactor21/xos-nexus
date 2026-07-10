# xOS: neXus

An AI operating system for thought — cyberpunk-glassmorphism interface, one graph (`nodes`/`edges`) behind every room, a single Copilot gateway for classification.

This repo implements Steps 1–5 of the **Path to v1.0 — Cowork Handoff** doc: a real Vite + React + TypeScript + Zustand + Tailwind app that ports the interaction model and visual language from the source-of-truth HTML prototypes (`xos-prototype.html`, `xos-flight-simulator.html`), wires real Supabase Auth + Realtime underneath it, and layers the Step 4/5 Feature Uplift additions on top of Design Studio, Bug Tracker, and Roadmaps.

## Stack

- Vite + React + TypeScript
- Zustand for state (`src/stores`) — `authStore` (session) and `coreGraph` (domain data, Supabase-backed + Realtime)
- Tailwind CSS v4
- Supabase Auth (email/password + magic link) gates the whole app — see `src/modules/auth/AuthGate.tsx`
- Supabase JS client (`src/lib/supabase.ts`) — talks to the deployed `classify-capture` Edge Function for live AI classification, falls back to a real-but-offline classifier (writes an actual node, just without AI routing) when live AI is unreachable

## Structure

Mirrors the Engineering Bible's proposed folder layout:

```
src/
├─ core/          # types, room registry
├─ modules/       # one folder per room (observatory, copilot, capture, projects,
│                 # focus, studio, roadmaps, bugs, releases, vault, comms, settings)
├─ components/    # app shell: boot sequence, HUD/sidebar/dock, room router
├─ stores/        # Zustand stores (coreGraph, uiStore)
├─ lib/           # Supabase singleton, copilot client gateway
└─ styles/        # design tokens (tokens.css) + prototype CSS ported 1:1 (legacy.css)
supabase/
└─ functions/classify-capture/  # reference Edge Function implementation (copilot-client.ts)
```

## Getting started

```bash
npm install
npm run dev
```

```bash
npm run build    # tsc -b && vite build
npm run preview  # serve the production build locally
```

## Status

- **Done:** Step 1 (Auth + real ownership), Step 2 (scaffold + 12-room port), Step 3 (Realtime/Zustand wired to live Supabase data), Step 4 (Design Studio Feature Uplift), Step 5 (Bug Tracker + Roadmaps Feature Uplift)
- **Not started:** Step 6 (Suggestion Engine), Step 7 (persistent onboarding), Steps 8–10

Deviations, called out explicitly rather than silently:
- **Roadmaps/milestones stay on local state.** There's no real table for them in the deployed schema and adding one wasn't authorized by Step 3 (no migration was called for) — `coreGraph.milestones` is still the Step 5 seed data. Modeling them as `nodes` (`kind: 'roadmap_item'`, same `metadata` jsonb pattern as everything else) is the natural next step whenever that's in scope.
- **Design Studio still persists to `localStorage`**, not `nodes.metadata` — Step 4 predates Step 1 in this build order, and revisiting that wiring wasn't part of this pass.
- **classify-capture's live-AI path is currently blocked by the linked Anthropic account's credit balance** ("Your credit balance is too low..." — a billing issue, confirmed directly against the deployed function, not a code issue). Both capture surfaces (Neural Core, Neural Capture) now fall back to writing a real node via a local heuristic classifier when live AI is unreachable, so captures still land in Supabase and show up live elsewhere either way.
- **Project "health"/"idle days"/"stale" are computed client-side**, not stored columns — the live `projects` table doesn't have them. See `src/core/mappers.ts`.

See the 🛠 Cowork Session Log in the xOS Notion workspace for full session-by-session history.
