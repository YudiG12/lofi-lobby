# ADR 008: Client-side automatic day/night cycle

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-26 |
| **Deciders** | Yudi Ganeko |

## Context

Previously, Lofi Lobby only offered a manual two-state switch (`night` / `day`) on `#day-night` (`N` key), linearly blending two static presets in `src/main.js` and persisting the choice in `localStorage`. An automatic cycle through day, golden hour, sunset, twilight, night, pre-dawn, and dawn adds atmosphere for long study or work sessions, while remaining an individual visual preference (like mute and rain) so each player chooses how they want to see the town.

## Decision

Implement the automatic cycle **entirely on the client** (`src/main.js` and `index.html`), with no server state or WebSocket protocol changes in `worker/index.js`:

- **Single 3-state control (`#day-night` / `N`).** `TIME_MODES` cycles through `night` → `day` → `auto` → `night`, displaying the active mode icon (moon, sun, or gold-highlighted `.on` cycle icon) and next-action `aria-label` (`"make it day"`, `"auto cycle"`, `"make it night"`). Switching into `auto` anchors `cycleEpoch` at late day (`AUTO_START_PHASE = 0.63`) so entering from `day` starts smoothly right before golden hour.
- **Per-player persistence.** `localStorage` stores `"time-of-day"` (`"night"` | `"day"` | `"auto"`) and `"time-of-day-epoch"` (the cycle start timestamp in ms).
- **10-minute default cycle.** `DEFAULT_CYCLE_MS` in `src/main.js` is `10 * 60 * 1000` (10 minutes), split across 30% night (`0.85..1.00..0.15`, 3 min), 20% dawn (`0.15..0.35`, 2 min), 30% day (`0.35..0.65`, 3 min), and 20% dusk (`0.65..0.85`, 2 min). Developers can adjust the default duration by changing `DEFAULT_CYCLE_MS` in `src/main.js`.
- **Keyframed circular interpolation with linear-RGB continuity.** `CYCLE_SPECS` replaces the two-point look table with keyframed presets interpolated via zero-allocation `copyLook`, `lerpLook`, and `sampleCycle`. Duplicate keyframes at `p = 0.185` (`MOONSET_SPEC`) and `p = 0.815` (`TWILIGHT_SPEC`) set `sunIntensity: 0` so the single `DirectionalLight` repositions cleanly between moon and sun without sweeping shadows backwards, while raising `skyTop`/`skyIntensity` so Three.js linear-RGB luminance stays strictly monotonic across dusk and dawn (both dry and raining). Subtle sun and moon arcs drift across the day (`[40, 80, 30] → [-15, 78, 30]`) and night (`[52, 74, 30] → [40, 80, 30] → [28, 78, 30]`) plateaus so shadows never freeze static.
- **Coordinated atmosphere and transitions.** Fireflies fade in smoothly below `daylight < 0.5` (`clamp(1 - dayAmount * 2, 0, 1) * (1 - rainAmount)`), rain streak colors lerp continuously between night and day tints, and manual mode switches blend over `lookBlendSec()` (`1 s` at the 10-minute default, scaled down proportionally in faster dev test speeds).
- **Dev-only cycle debug panel (`src/cycle-debug.js`).** Dynamically imported in `src/main.js` only when `import.meta.env.DEV` is true (with no markup, CSS, or URL query parameters such as `?cycle=` in `index.html` or production code), so Vite tree-shakes the entire debug UI, timeline, stall detector (`> 80ms`), luminance readout, and local speed presets (`2s`, `5s`, `10s`, `1m`, `10m`) out of production builds.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Synchronize the day/night cycle via the room clock (`roomNow()`) or server** | Each player has different lighting preferences (some prefer permanent night or day); keeping it local respects personal choice and adds zero server/WebSocket traffic. |
| **Tie the cycle to the 24-hour wall clock** | Players studying at night would never see dawn, sunset, or day during a session; a 10-minute loop lets everyone experience the full cycle. |
| **Add a separate HUD button for auto mode** | The toolbar already groups compact single-button tools; cycling `night → day → auto` on `#day-night` matches the `#hold` (`Q`) pattern and keeps desktop and mobile HUDs uncluttered. |
| **Keep a `?cycle=` URL query param or debug UI in production** | End users do not need debug tooling or hidden query overrides; gating `src/cycle-debug.js` behind `import.meta.env.DEV` keeps production clean. |

## Consequences

- Players independently choose static night, static day, or the 10-minute automatic cycle, with manual day and night visuals unchanged from `NIGHT_SPEC` and `DAY_SPEC`.
- Changing the default cycle length requires editing only `DEFAULT_CYCLE_MS` in `src/main.js`.
- Production builds (`npm run build`) exclude `src/cycle-debug.js` completely, keeping the bundle free of debug DOM, CSS, and per-frame telemetry.
