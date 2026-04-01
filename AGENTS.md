# Art Cooperation Agent Guide

## Core Mission

- The core task of this repository is still **active product development**, not project wrap-up.
- This repository is a **local test slice** of a larger system, not the full competition platform.
- The current objective is to keep building the MVP where multiple OpenClaw contestants write poems, turn those poems into prompts, and collaboratively produce one shared pixel artwork in the web client.
- In the current product direction, upstream can now hand this repo any number of static contestants with written persona prompts and poems, and this repo continues the rest of the art pipeline locally.
- Any work should be judged by whether it pushes that product loop forward: contestant setup -> poem/prompt shaping -> serial drawing -> visible shared artwork -> replayable presentation.

## Current Development Stage

- This repo is in the **MVP building phase**.
- The shipped implementation now proves a **text-driven deterministic slice** of the interaction loop.
- The current static contestants are a local sample roster, not a claim that the full production contestant flow is already implemented here.
- Poems and drawing prompts already affect the derived painting strategy and replay metadata, but the system is still local and fully deterministic.
- The canonical prompt lineage in this repo is `poem -> drawingPrompt -> strategyHint -> painting turns`; `personaPrompt` and `motif` are supporting context, not the authoritative drawing prompt source.
- Sessions now load through an async provider boundary and expose provider provenance through `session.meta`.
- Generated replay drafts now preserve original provider provenance through `session.meta.origin`.
- The current UI already includes loading, error, and retry states around session generation.
- The current `local-openclaw` path now uses explicit run-scoped isolation via `runId` and per-agent `--session-id`, and surfaces the active run id through `session.meta.runId`.
- The current replay UI already supports direct turn selection, selected-turn cumulative canvas inspection, per-turn before/diff mini-views, and labeled lineage display for `poem`, `drawingPrompt`, and `strategyHint`.
- The repository now ships `static-ingest`, `local-deterministic`, `draft`, and legacy `local-openclaw` provider paths, and `?provider=` is the active provider-resolution entrypoint.
- The dev server now exposes a dev-only `POST /__drafts/save` path that writes generated replay drafts into `public/session-drafts/generated/` and returns a reopenable same-origin `draftUrl`.
- `openclaw` is available on this machine PATH and the local OpenClaw gateway is the preferred development bridge entrypoint.
- On this machine, the current `local-openclaw` success path is live: `openclaw agent` can return structured `poem / drawingPrompt / strategyHint`, and both `GET /__openclaw/health` plus `POST /__openclaw/contestant-texts` are expected to succeed before assuming any bridge regression.
- Treat provider/model identity as runtime truth, not a fixed repo constant: probe `agents.defaults.model.primary` and bridge health instead of assuming `gmn/gpt-5.4` or any other pinned model.
- Do not treat the current static version as the final product shape.
- Prefer feature progress over polish-only work unless the user explicitly asks for cleanup or documentation.

## Active Product Boundary

- Keep the web client as the main delivery surface.
- The current main path ingests any number of same-origin static contestants with at least `id`, `name`, `personaPrompt`, and `poem`.
- The repo internally derives `motif`, `paletteBias`, `drawingPrompt`, and `strategyHint` before building painting turns.
- The current drawing engine is deterministic and serial on one shared `32 x 32` pixel canvas.
- The current session builder derives turn strategy from contestant text before generating pixel ops.
- The current app reads only provider-produced `CoCreationSession` objects and should not couple playback directly to raw local data modules.
- The current app uses the main canvas as the authoritative cumulative image and treats any inspector mini-canvases as read-only debugging aids.
- Any provider or bridge may enrich contestant text, but it must still hand the web app a `CoCreationSession` whose drawing behavior remains explainable from poem-derived drawing text rather than raw model chatter.
- Treat `static-ingest` as the default backend path; explicit `local-openclaw` requests must still either return a `CoCreationSession` or fail loudly.
- Do not treat this repo as the place to implement the upstream task system; upstream now stops at handing over static persona prompts and poems.
- The draft path may come either from the built-in sample draft or from an externally loaded same-origin JSON draft session.
- Generated draft exports should keep the replay import boundary at `draftUrl`, not introduce a second persistence/read path in the web client.
- The `local-openclaw` path is development-only and should bridge to the local machine's OpenClaw runtime instead of pretending to be a generic remote service.
- This deterministic local setup is a temporary MVP scaffold, not a claim that the final product should stay local-only or fixed forever.

## Development Priorities

- Prioritize work that strengthens the core loop:
  - richer contestant identity and poem-to-strategy mapping
  - better shared-canvas drawing behavior
  - stronger turn playback and collaboration readability
  - future-ready boundary for arbitrary-count static ingest
  - external draft/session import boundaries ahead of real OpenClaw session generation
  - real external draft JSON import before any heavier editor or persistence workflow
  - local OpenClaw bridge correctness before any cross-machine or centralized provider rollout
- When extending the app, preserve the main split between:
  - UI shell and playback controls in `src/App.tsx`
  - contestant definitions in `src/data/contestants.ts`
  - session and pixel logic in `src/lib/art.ts`
  - shared types in `src/types.ts`
- If a future remote or model-backed generator returns, add it behind a provider or adapter boundary instead of mixing network behavior directly into view code.
- When extending the ingest pipeline, preserve the text flow `poem -> drawingPrompt -> strategyHint` before any deterministic or model-backed drawing behavior is derived.
- If you change painting logic, keep it explainable in playback: the UI should be able to show why a turn looks the way it does from derived strategy metadata.
- If a future legacy `local-openclaw` session sees bridge trouble, re-probe in this order before reviving old failure narratives: `openclaw config get agents.defaults.model.primary`, `GET /__openclaw/health`, then `POST /__openclaw/contestant-texts` with a small payload.
- `agent_contract_mismatch` still exists as a fallback error code, but it is now a secondary protection path rather than the baseline expectation for `local-openclaw`.
- Long-lived OpenClaw agent sessions can contaminate style/output: if one contestant starts drifting or returning odd text, suspect persistent session history in `contestant-01..04` before blaming the browser UI.
- Do not start a broader remote or cross-machine provider rollout until the local bridge can fail fast and report actionable OpenClaw CLI errors.

## Near-Term Execution Plan

- Treat this 3-step sequence as the default near-term roadmap for new sessions unless the user explicitly reopens broader scope.
- Session 1: Local OpenClaw run isolation, completed
  - `SessionMeta.runId?: string` and `LocalOpenClawBridgeRequest.runId?: string` are live.
  - `local-openclaw` loads now create distinct run ids and explicit per-agent `--session-id` values.
- Session 2: Replay inspector completion, completed
  - Full-session generation remains intact; there is still no per-turn network generation.
  - The current UI supports direct turn selection, current-turn diff visibility, and labeled lineage display for `poem`, `drawingPrompt`, and `strategyHint`.
  - Treat the selected-turn inspector as the current baseline UX rather than an optional experiment.
- Session 3: Saveable same-origin replay drafts, completed
  - The dev-only save flow now writes generated sessions into `public/session-drafts/generated/` through `POST /__drafts/save`.
  - `SessionMeta.origin?: { providerId; providerLabel; mode; sourceLabel?; runId? }` is live and preserves first-hop provenance when exporting drafts.
  - `draftUrl` remains the replay import boundary; reopening continues to flow through the existing `draft` provider path.
  - The existing replay inspector remains intact for generated drafts reopened through `?provider=draft&draftUrl=...`.
  - Treat the generated-draft flow as the current baseline dev save/reopen path rather than an experiment.

## Anti-Drift Rules

- Do not shift the repo into finished showcase mode unless the user explicitly asks for that.
- Do not over-invest in docs, cleanup, or ornamental UI work while the core product loop is still evolving.
- Do not claim that live poem generation or real multi-agent collaboration already exists unless it is actually implemented.
- Do not present the bundled sample roster as the real production contestant roster; it is only a local testing input.
- Do not regress the app back to contestant-id-only hardcoded drawing behavior when extending the generator.
- Do not treat `personaPrompt` alone as the main art prompt source.
- Do not let `drawingPrompt` drift into a separate idea that is no longer grounded in the poem text.
- Do not bypass provider resolution by wiring alternate session sources straight into `App.tsx`.
- Do not bypass `static-ingest` by wiring raw roster data straight into view code.
- Do not silently fall back from an explicit `draftUrl` to the built-in sample draft when the requested external draft fails.
- Do not bypass the dev save endpoint by inventing a second ad-hoc writer path; generated replay drafts should continue to flow through `POST /__drafts/save`.
- Do not overwrite first-hop provenance when re-exporting a draft; preserve the existing `session.meta.origin` chain head.
- Do not silently fall back from an explicit `local-openclaw` request to deterministic or draft providers when the local bridge fails.
- Do not remove or sideline the selected-turn replay inspector when extending playback or save flows.
- Do not replace the shared pixel-canvas concept with an unrelated visualization.

## Verification

- Before closing implementation work, run:
  - `pnpm test`
  - `pnpm build`
  - `pnpm lint`
- For runtime verification, prefer launching the real app with `pnpm dev` and confirming the page serves successfully.
- When save/export behavior changes, also verify a real `POST /__drafts/save` write and reopen the returned `draftUrl` through the `draft` provider path.
