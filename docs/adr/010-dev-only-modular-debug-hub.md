# ADR 010: Dev-only modular debug hub

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-27 |
| **Deciders** | Yudi Ganeko, Daniel |

## Context

Previously, `src/cycle-debug.js` ([ADR 008](008-client-side-day-night-cycle.md)) mounted its own button and standalone panel directly into the `#place` toolbar and document body, while adding cat and pathfinding telemetry pushed more conditional `import.meta.env.DEV` branches, timing wrappers, and state helpers into `src/main.js`. Keeping separate toolbars per debug feature crowds the HUD during development, and scattering dev-only hooks across `src/main.js` makes the game loop harder to maintain and easier to leak into production.

## Decision

Centralize all development-only debug UI, styles, and orchestration into a single dynamic hub (`src/debug.js`) hosting independent feature modules (`src/cat-debug.js`, `src/cycle-debug.js`):

- **Single dev-only entry point in `src/main.js`.** `src/main.js` keeps one `if (import.meta.env.DEV) { import("./debug.js").then(({ setupDebug }) => ...); }` call at setup time and passes a narrow read/control adapter object. No debug markup or CSS lives in `index.html` or `src/*.css`, and Vite strips the dynamic import branch completely in production builds (`npm run build`).
- **One toolbar bug button (`#debug-btn`) and shared menu (`setupDebugHub`).** `src/debug.js` injects `#debug-btn` into `#place .tools`, appends its `.glass` `#debug-panel` dynamically, and displays a module picker with `←` back and `✕` close controls instead of dedicating a separate toolbar button per debug tool.
- **Pluggable module contract.** Each debug tool exports a factory (`createCatDebugModule`, `createCycleDebugModule`) returning `{ id, title, desc, mount(slot), onOpen?, onClose?, needsTiming?, onNavRebuilt?, update? }`. Both `src/cat-debug.js` (FPS/frame ms, draw calls/triangles, GPU/JS memory, NavGrid/path visualizer, debug cat count `[5, 8, 10]`, local head-ride toggle) and `src/cycle-debug.js` (cycle stage timeline, stall detector, luminance readout, speed presets) mount into slots inside `#debug-panel`. This supersedes the standalone toolbar mount of `src/cycle-debug.js` described in [ADR 008](008-client-side-day-night-cycle.md).
- **Non-invasive loop instrumentation in `src/debug.js`.** Rather than branching inside `loop()` in `src/main.js`, `setupDebug()` wraps `renderer.render` in dev mode to measure frame interval, trigger NavGrid change notifications, and time `updateCats()` only when the cat debug view is open. Debug-only state overrides (such as local cat ride toggles and extra debug cats) stay isolated in `src/debug.js` and `src/cat-debug.js` without emitting multiplayer messages.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Keep one toolbar button and panel per debug tool** | Every new feature adds another HUD icon, overlapping floating panels, and duplicated positioning/CSS boilerplate. |
| **Keep `if (import.meta.env.DEV)` timing and event hooks inside `src/main.js`** | Couples `src/main.js` to each debug panel's telemetry needs; wrapping `renderer.render` inside `src/debug.js` achieves the same metrics with one entry point in `src/main.js`. |
| **Include a hidden keyboard shortcut or URL flag in production** | Ships unused debug DOM/CSS/visualizers to end users and risks leaking local state-override controls in production. |

## Consequences

- Production bundles (`npm run build`) emit zero code or CSS from `src/debug.js`, `src/cat-debug.js`, and `src/cycle-debug.js`.
- Developers have one bug-icon hub during `npm run dev` to switch cleanly between `cat debug`, `cycle debug`, and any future debug module.
- Adding a new debug view only requires creating a module under `src/*-debug.js` and registering it in `src/debug.js` without cluttering `src/main.js` or `index.html`.
