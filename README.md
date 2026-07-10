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

- **Done:** Step 1 (Auth + real ownership), Step 2 (scaffold + 12-room port), Step 3 (Realtime/Zustand wired to live Supabase data), Step 4 (Design Studio Feature Uplift), Step 5 (Bug Tracker + Roadmaps Feature Uplift), Step 7 (persistent onboarding — full Flight Simulator cinematic + Returning-Captain flow), Step 8 (Tauri shell packaging + local SQLite offline-first capture queue)
- **Not started:** Step 6 (Suggestion Engine), Step 9 (Security/QA pass), Step 10 (v1.0.0 release)

### Shell (Tauri)

```bash
npm run tauri dev     # run the desktop shell in dev mode
npm run tauri build   # produce a packaged installer for the current platform
```

`src-tauri/` is a standard Tauri 2 project. It was scaffolded and built (Linux `.deb`, verified to launch cleanly) from this Linux cloud sandbox; Windows/macOS installers need to be built on those platforms — a normal Tauri cross-platform constraint (its bundler shells out to platform-native tooling: WiX/NSIS on Windows, `hdiutil` on macOS), not something specific to this app.

**Windows/macOS/Linux installers via CI:** `.github/workflows/tauri-build.yml` builds all three on GitHub-hosted runners — trigger it manually from the repo's Actions tab (`Build Tauri Shell` → `Run workflow`), or push a `v*` tag. Installers land as downloadable artifacts on the workflow run (no public GitHub Release is created).

Offline-first capture: `src/lib/localDb.ts` + `src/lib/offlineSync.ts` implement an outbox queue against a local SQLite database (`@tauri-apps/plugin-sql`) rather than a full bidirectional mirror of every Supabase table. A capture made while offline (inside the packaged shell) lands in `pending_captures` instead of being lost; `startSyncEngine()` (wired in `App.tsx`, no-ops outside Tauri) drains it back to Supabase the moment connectivity returns. This is scoped to what the handoff's Step 8 acceptance test actually requires ("disconnect network, capture a thought, reconnect — it appears in Supabase without data loss"), not a general-purpose sync engine for every table.

Deviations, called out explicitly rather than silently:
- **Roadmaps/milestones stay on local state.** There's no real table for them in the deployed schema and adding one wasn't authorized by Step 3 (no migration was called for) — `coreGraph.milestones` is still the Step 5 seed data. Modeling them as `nodes` (`kind: 'roadmap_item'`, same `metadata` jsonb pattern as everything else) is the natural next step whenever that's in scope.
- **Design Studio still persists to `localStorage`**, not `nodes.metadata` — Step 4 predates Step 1 in this build order, and revisiting that wiring wasn't part of this pass.
- **classify-capture's live-AI path is currently blocked by the linked Anthropic account's credit balance** ("Your credit balance is too low..." — a billing issue, confirmed directly against the deployed function, not a code issue). Both capture surfaces (Neural Core, Neural Capture) now fall back to writing a real node via a local heuristic classifier when live AI is unreachable, so captures still land in Supabase and show up live elsewhere either way.
- **Project "health"/"idle days"/"stale" are computed client-side**, not stored columns — the live `projects` table doesn't have them. See `src/core/mappers.ts`.
- **`has_completed_onboarding` lives in Supabase auth `user_metadata`**, not a `profiles` table column or a `memories` row — there's no `profiles` table in the deployed schema, and `memories.kind`'s CHECK constraint doesn't allow a `'system'` row type. `user_metadata` needed no migration and round-trips through `supabase.auth.updateUser()`/`getSession()` directly. See `src/stores/authStore.ts`'s `markOnboardingComplete`.
- **Offline sync is an outbox queue for captures, not a full table mirror.** Building genuine bidirectional sync (with conflict resolution) for every table (`nodes`, `edges`, `projects`, `memories`, `suggestions`) was out of scope for this pass — the acceptance criterion is about not losing a capture made offline, which the outbox satisfies directly. Broader offline read access (e.g. browsing previously-loaded Projects/Bugs while offline) isn't implemented yet.

See the 🛠 Cowork Session Log in the xOS Notion workspace for full session-by-session history.
