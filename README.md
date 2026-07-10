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
- **In progress — Room Overhaul (Blueprint v0.3, Amendment v0.2):** raises every room to a named flagship app's depth/polish as its real bar. **Batch 1 done:** Design Studio is now a multi-mode creative suite — a board picker (`src/modules/studio/index.tsx`) where each board picks a mode the way Figma picks a file type. **Draw/Paint mode** (`src/modules/studio/draw/`) is a genuine Photoshop-caliber engine: real brush dabs with pressure (Pointer Events, not synthesized), flow-vs-opacity modeled correctly (dabs accumulate on a scratch canvas via `source-over`, then merge once at stroke-end capped by `globalAlpha`), 4 brush types, layers with native blend modes (`globalCompositeOperation`) + opacity, an HSB color wheel, marquee/lasso/magic-wand selection, flood fill, gradient, eyedropper, real pixel-level adjustments (brightness/contrast, hue/saturation, 3-pass box blur, 3×3 sharpen convolution), multi-level undo/redo, resize/crop, PNG/JPEG export. **Wireframe/Prototype mode** is the original infinite-canvas tool extracted to be per-board (`src/modules/studio/Wireframe.tsx`), plus **Batch 1b done:** real interactive prototyping on top of it — a Link tool wires a click target (a specific button rendered inside a frame template, or the whole frame as a fallback) to another frame; a Play/Preview mode renders one frame at phone-mockup scale full-screen and lets the Captain actually click through the linked flow, with a back-stack and exit; a Components library (🧩) defines reusable components with named `default`/`hover`/`pressed` variants (real per-state color *and* label, not just a color swap), and instances placed on canvas respond to genuine mouse hover/mousedown with the matching variant, not a static three-state mockup. Animation/Vector/Diagram/Moodboard modes are modeled in the type system (`StudioMode`) but intentionally shown as "coming soon" in the picker rather than faked — the amendment's own execution order puts them after the rest of the room overhaul. **Batch 2 done:** Observatory + Neural Core, to the amendment's named bars ("Elite Dangerous' galaxy map / No Man's Sky-caliber depth" and "a sci-fi command bridge HUD"). **Observatory** (`src/modules/observatory/index.tsx`) now has real semantic zoom (galaxy tier shows project hubs only, system tier reveals every star, focused tier isolates one star + its graph-neighbor "moons" orbiting it), a real eased camera flight (`flyTo`, 0.7s quadratic ease, solved algebraically so the target star lands exactly at canvas center) instead of an instant camera snap, procedural nebula clouds colored from real project health (unhealthy → red/amber, healthy → cyan/green), comet events that fire only for genuinely new edges (diffed against a previously-seen id set, not the initial hydrate), a draggable Timeline scrub bar with auto/manual playback, and PNG snapshot export. **Neural Core** (`src/modules/copilot/NeuralCore.tsx`) is now a real bridge HUD on top of the living-blob canvas: the greeting line is time-of-day-aware, the stats line and a new briefing line are computed live from the actual graph (node/edge/active-project/open-bug counts, which project is stalest vs. healthiest, how many nodes landed in the last day) instead of a hardcoded string, a rotating activity ticker surfaces real recent nodes, clicking a radial module/project node now plays a real ~350ms docking-flight transition (a glowing ghost easing from the core to the clicked node's screen position via a CSS transition) before navigating instead of teleporting instantly, the blob's own color grading is driven by real data (dominant-layer hue shifts red↔cyan/green with average project health using the same mapping as Observatory's nebulae, and the amber "activity" layer + particle/spark energy scale with 24h node-creation workload), and Cmd/Ctrl+K opens a command palette scoped to fire only while the Core room is active (per the amendment's own "...without leaving the Core" placement) that fuzzy-filters every room and jumps on Enter. An ambient queued-captures indicator (`#pendingQueue`) is wired to the real Tauri-only local-SQLite outbox and gracefully renders nothing on the web build, where that query always resolves to zero. Batches 3–6 (Projects/Focus, Bug Tracker/Roadmaps, Memory Vault/Comms, Releases/Settings) and the OS-grade universal directives (system tray, poppable widgets, shortcut cheat-sheet, app-wide toasts, cross-room drag-and-drop) have not been started.

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
- **Design Studio still persists to `localStorage`**, not `nodes.metadata` — Step 4 predates Step 1 in this build order, and revisiting that wiring wasn't part of this pass. Draw/Paint documents persist as PNG data URLs per layer (`xos-studio-draw-<boardId>`) for the same reason — the only realistic way to survive a reload without a real backing store.
- **Pre-Amendment Studio data migrates automatically, once.** If a Captain has an existing single-canvas Studio board from before the multi-mode rework (`xos-studio-v1` in `localStorage`) and no boards have been created yet, the board picker seeds one "Original Board" (Wireframe mode) and copies that data over on first load — nothing is silently discarded.
- **Prototype link targets are always whole frames, not sub-regions of a target.** A link's *source* can be a specific button hotspot or a whole frame, but where it points is always another whole frame — the existing data model has no nested/child items, so "click here to reveal this sub-panel within the same frame" isn't representable yet. Component instances are top-level canvas items for the same reason (not nested inside frames), so a component's own default/hover/pressed states are demonstrated directly on the canvas via real mouse events rather than inside the phone-mockup Play view.
- **classify-capture's live-AI path is currently blocked by the linked Anthropic account's credit balance** ("Your credit balance is too low..." — a billing issue, confirmed directly against the deployed function, not a code issue). Both capture surfaces (Neural Core, Neural Capture) now fall back to writing a real node via a local heuristic classifier when live AI is unreachable, so captures still land in Supabase and show up live elsewhere either way.
- **Project "health"/"idle days"/"stale" are computed client-side**, not stored columns — the live `projects` table doesn't have them. See `src/core/mappers.ts`.
- **`has_completed_onboarding` lives in Supabase auth `user_metadata`**, not a `profiles` table column or a `memories` row — there's no `profiles` table in the deployed schema, and `memories.kind`'s CHECK constraint doesn't allow a `'system'` row type. `user_metadata` needed no migration and round-trips through `supabase.auth.updateUser()`/`getSession()` directly. See `src/stores/authStore.ts`'s `markOnboardingComplete`.
- **Offline sync is an outbox queue for captures, not a full table mirror.** Building genuine bidirectional sync (with conflict resolution) for every table (`nodes`, `edges`, `projects`, `memories`, `suggestions`) was out of scope for this pass — the acceptance criterion is about not losing a capture made offline, which the outbox satisfies directly. Broader offline read access (e.g. browsing previously-loaded Projects/Bugs while offline) isn't implemented yet.
- **Neural Core's queued-captures indicator is only ever non-zero inside the packaged Tauri shell.** `pendingCaptureCount()` (Step 8's local SQLite outbox) always rejects on the web build — there's no local SQLite runtime there — so `#pendingQueue` degrades to rendering nothing rather than a permanently-empty widget or a crash. Verified this degrades cleanly on the web build; full behavior (a real count while offline) can only be exercised inside `npm run tauri dev`.
- **Neural Core's command palette (⌘K) is scoped to the Core room, not global.** The amendment places this directive specifically under Neural Core's own feature list ("...without leaving the Core"), so the keydown listener only attaches while `r-core` is the active room rather than being a cross-app overlay — revisit if the OS-grade universal-directives pass wants a second, app-wide palette.

See the 🛠 Cowork Session Log in the xOS Notion workspace for full session-by-session history.
