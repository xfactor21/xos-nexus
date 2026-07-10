# xOS: neXus

An AI operating system for thought — cyberpunk-glassmorphism interface, one graph (`nodes`/`edges`) behind every room, a single Copilot gateway for classification.

This repo is the Step 2 (App Scaffold) implementation from the **Path to v1.0 — Cowork Handoff** doc: a real Vite + React + TypeScript + Zustand + Tailwind app that ports the interaction model and visual language from the source-of-truth HTML prototypes (`xos-prototype.html`, `xos-flight-simulator.html`), and layers the Step 4/5 Feature Uplift additions on top of Design Studio, Bug Tracker, and Roadmaps.

## Stack

- Vite + React + TypeScript
- Zustand for state (`src/stores`)
- Tailwind CSS v4
- Supabase JS client (`src/lib/supabase.ts`) — talks to the deployed `classify-capture` Edge Function for live AI classification, falls back to an offline mock classifier when unreachable

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

- **Done:** Step 2 (scaffold + 12-room port), Step 4 (Design Studio Feature Uplift), Step 5 (Bug Tracker + Roadmaps Feature Uplift)
- **Not started:** Step 1 (Auth), Step 3 (Realtime/Zustand wired to live Supabase data — the store is structured for this swap), Step 6 (Suggestion Engine), Step 7 (persistent onboarding), Steps 8–10

Design Studio currently persists canvas state to `localStorage` as a stand-in for `nodes.metadata` (jsonb) until Step 1 lands a real `owner_id` to scope Supabase rows to.

See the 🛠 Cowork Session Log in the xOS Notion workspace for full session-by-session history.
