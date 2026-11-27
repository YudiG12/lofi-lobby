// Dev-only cycle debug panel: injected only when import.meta.env.DEV is true so production
// builds contain no debug UI, styles, or telemetry code.
import * as THREE from "three";

const CYCLE_DEBUG_CSS = `
  .dbg-bar { position: relative; display: flex; height: 8px; border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,.16); margin-bottom: 8px; }
  .dbg-bar span { height: 100%; }
  .dbg-bar .s-night { background: #1c2856; }
  .dbg-bar .s-dawn { background: #d4847a; }
  .dbg-bar .s-day { background: #64a8e8; }
  .dbg-bar .s-dusk { background: #d97b54; }
  #dbg-pin { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #fff; box-shadow: 0 0 4px #ffc95a; pointer-events: none; }
  .dbg-speeds { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.12); }
  .dbg-speeds span { color: #9a9db0; margin-right: 2px; font-size: 10px; }
  .dbg-speeds button { font: inherit; font-size: 9px; color: #F2F2F5; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.18); border-radius: 4px; padding: 2px 6px; cursor: pointer; }
  .dbg-speeds button:hover, .dbg-speeds button.on { border-color: #ffc95a; color: #ffc95a; }
  #dbg-reset { margin-left: auto; }
`;

const _dbgDir = new THREE.Vector3();
const _dbgUp = new THREE.Vector3(0, 1, 0);
const dbgLum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const fmtDur = (ms) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`);

function cycleStageInfo(p) {
  if (p < 0.15 || p >= 0.85) {
    const posInNight = p >= 0.85 ? p - 0.85 : p + 0.15;
    return { stage: "night", label: "night", progress: posInNight / 0.3, span: 0.3 };
  }
  if (p < 0.35) {
    const label = p < 0.185 ? "pre-dawn" : p < 0.26 ? "dawn" : "sunrise";
    return { stage: "dawn", label, progress: (p - 0.15) / 0.2, span: 0.2 };
  }
  if (p < 0.65) {
    return { stage: "day", label: "day", progress: (p - 0.35) / 0.3, span: 0.3 };
  }
  const label = p < 0.75 ? "golden hour" : p < 0.815 ? "sunset" : "twilight";
  return { stage: "dusk", label, progress: (p - 0.65) / 0.2, span: 0.2 };
}

/** Creates the dev-only cycle debug module for the modular Debug Hub (src/debug.js). */
export function createCycleDebugModule({
  getTimeMode,
  getCyclePhase,
  getCycleDurationMs,
  setCycleDuration,
  getLook,
  getRainAmount,
  getLampIntensity,
}) {
  let dbgEls = null;

  const dbg = {
    lastFrameMs: 0,
    lastUiMs: 0,
    fps: 60,
    avgMs: 16.7,
    stalls: 0,
    maxStallMs: 0,
    staticMs: 0,
    lastLum: -1,
    lastSunX: NaN,
    justResumed: false,
    stageMs: { night: 0, dawn: 0, day: 0, dusk: 0 },
  };

  function currentGroundLum() {
    const look = getLook();
    const t = look.daylight;
    const closed = Math.max(getRainAmount(), 1 - t);
    const gloom = 1 - (0.2 + 0.2 * t) * closed;
    _dbgDir.copy(look.sunPos).normalize();
    return (
      dbgLum(look.skyTop) * look.skyIntensity * gloom +
      dbgLum(look.sunColor) * look.sunIntensity * gloom * Math.max(0, _dbgDir.dot(_dbgUp))
    );
  }

  function resetDebugCounters() {
    dbg.stalls = 0;
    dbg.maxStallMs = 0;
    dbg.staticMs = 0;
    dbg.stageMs = { night: 0, dawn: 0, day: 0, dusk: 0 };
    dbg.lastUiMs = 0;
  }

  function drawDebugSpeeds() {
    if (!dbgEls) return;
    const sec = Math.round(getCycleDurationMs() / 1000);
    for (const b of dbgEls.speeds) b.classList.toggle("on", Number(b.dataset.cycle) === sec);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") dbg.justResumed = true;
  });

  return {
    id: "cycle",
    title: "cycle debug",
    desc: "day / night cycle & lighting",
    mount(container) {
      document.head.appendChild(Object.assign(document.createElement("style"), { textContent: CYCLE_DEBUG_CSS }));
      container.innerHTML = `
        <div class="dbg-bar" aria-hidden="true">
          <span class="s-night" style="width:15%"></span><span class="s-dawn" style="width:20%"></span><span class="s-day" style="width:30%"></span><span class="s-dusk" style="width:20%"></span><span class="s-night" style="width:15%"></span>
          <i id="dbg-pin"></i>
        </div>
        <dl>
          <dt>mode</dt><dd id="dbg-mode">—</dd>
          <dt>phase</dt><dd id="dbg-phase">—</dd>
          <dt>stage</dt><dd id="dbg-stage-time">—</dd>
          <dt>cycle</dt><dd id="dbg-budgets">—</dd>
          <dt>elapsed</dt><dd id="dbg-totals">—</dd>
          <dt>fps</dt><dd id="dbg-fps">—</dd>
          <dt>stalls &gt;80ms</dt><dd id="dbg-stalls">0</dd>
          <dt>static</dt><dd id="dbg-static">0.0s</dd>
          <dt>light</dt><dd id="dbg-light">—</dd>
        </dl>
        <div class="dbg-speeds">
          <span>speed:</span>
          <button type="button" data-cycle="2">2s</button>
          <button type="button" data-cycle="5">5s</button>
          <button type="button" data-cycle="10">10s</button>
          <button type="button" data-cycle="60">1m</button>
          <button type="button" data-cycle="600">10m</button>
          <button type="button" id="dbg-reset" title="reset debug counters">↺</button>
        </div>`;

      dbgEls = {
        pin: container.querySelector("#dbg-pin"),
        mode: container.querySelector("#dbg-mode"),
        phase: container.querySelector("#dbg-phase"),
        stageTime: container.querySelector("#dbg-stage-time"),
        budgets: container.querySelector("#dbg-budgets"),
        totals: container.querySelector("#dbg-totals"),
        fps: container.querySelector("#dbg-fps"),
        stalls: container.querySelector("#dbg-stalls"),
        staticTime: container.querySelector("#dbg-static"),
        light: container.querySelector("#dbg-light"),
        speeds: [...container.querySelectorAll(".dbg-speeds button[data-cycle]")],
      };

      drawDebugSpeeds();
      container.querySelector("#dbg-reset").addEventListener("click", (e) => {
        resetDebugCounters();
        e.currentTarget.blur();
      });
      for (const b of dbgEls.speeds) {
        b.addEventListener("click", (e) => {
          setCycleDuration(Number(b.dataset.cycle) * 1000);
          drawDebugSpeeds();
          dbg.lastUiMs = 0;
          e.currentTarget.blur();
        });
      }
    },
    onOpen() {
      dbg.lastUiMs = 0;
      drawDebugSpeeds();
    },
    update({ visible }) {
      const nowMs = performance.now();
      let rawDtMs = dbg.lastFrameMs ? nowMs - dbg.lastFrameMs : 0;
      dbg.lastFrameMs = nowMs;
      if (dbg.justResumed) {
        dbg.justResumed = false;
        rawDtMs = 0;
      }
      const timeMode = getTimeMode();
      const cycleDurationMs = getCycleDurationMs();
      const look = getLook();
      const p = timeMode === "auto" ? getCyclePhase() : timeMode === "day" ? 0.5 : 0;
      const info = timeMode === "auto"
        ? cycleStageInfo(p)
        : { stage: timeMode, label: `${timeMode} (fixed)`, progress: 0, span: 0.3 };
      const gndLum = currentGroundLum();
      if (rawDtMs > 0) {
        const instFps = Math.min(240, 1000 / rawDtMs);
        dbg.fps = dbg.fps * 0.9 + instFps * 0.1;
        dbg.avgMs = dbg.avgMs * 0.9 + rawDtMs * 0.1;
        if (document.visibilityState === "visible" && rawDtMs > 80) {
          dbg.stalls++;
          if (rawDtMs > dbg.maxStallMs) dbg.maxStallMs = rawDtMs;
        }
        dbg.stageMs[info.stage] += rawDtMs;
        if (Math.abs(gndLum - dbg.lastLum) < 0.0005 && Math.abs(look.sunPos.x - dbg.lastSunX) < 0.05) {
          dbg.staticMs += rawDtMs;
        } else {
          dbg.staticMs = 0;
        }
      }
      dbg.lastLum = gndLum;
      dbg.lastSunX = look.sunPos.x;
      if (!visible || !dbgEls) return;
      dbgEls.pin.style.left = `calc(${(p * 100).toFixed(2)}% - 1px)`;
      if (nowMs - dbg.lastUiMs < 100) return;
      dbg.lastUiMs = nowMs;
      dbgEls.mode.textContent = timeMode === "auto" ? `auto (${fmtDur(cycleDurationMs)})` : `${timeMode} (manual)`;
      dbgEls.phase.textContent = timeMode === "auto" ? `${p.toFixed(3)} · ${info.label}` : info.label;
      dbgEls.stageTime.textContent = timeMode === "auto"
        ? `${info.stage} ${fmtDur(info.progress * info.span * cycleDurationMs)} / ${fmtDur(info.span * cycleDurationMs)}`
        : "manual hold";
      dbgEls.budgets.textContent = `D:${fmtDur(cycleDurationMs * 0.3)} N:${fmtDur(cycleDurationMs * 0.3)} T:${fmtDur(cycleDurationMs * 0.2)}`;
      dbgEls.totals.textContent = `D:${fmtDur(dbg.stageMs.day)} N:${fmtDur(dbg.stageMs.night)} R:${fmtDur(dbg.stageMs.dawn)} S:${fmtDur(dbg.stageMs.dusk)}`;
      dbgEls.fps.textContent = `${Math.round(dbg.fps)} (${dbg.avgMs.toFixed(1)}ms)`;
      dbgEls.stalls.textContent = dbg.stalls ? `${dbg.stalls} (max ${Math.round(dbg.maxStallMs)}ms)` : "0";
      dbgEls.staticTime.textContent = fmtDur(dbg.staticMs);
      dbgEls.light.textContent = `lum ${gndLum.toFixed(3)} · sun ${look.sunIntensity.toFixed(2)} · lamp ${Math.round(getLampIntensity())}`;
    },
  };
}
