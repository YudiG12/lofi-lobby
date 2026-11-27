// Dev-only centralized Debug Hub & orchestration: mounts a single bug button (#debug-btn) in #place .tools,
// owns the debug rules/adapters (ride toggle, bubble clearing, module wiring), and hosts registered modules.
// Loaded strictly inside `if (import.meta.env.DEV)` so production builds emit zero debug UI/CSS.
import { createCatDebugModule } from "./cat-debug.js";
import { createCycleDebugModule } from "./cycle-debug.js";
import { createFireworksDebugModule } from "./fireworks-debug.js";

const HUB_CSS = `
  #debug-panel { left: 28px; top: 200px; width: 280px; padding: 12px 14px; font-size: 11px; line-height: 1.45; color: #C4C6D4; z-index: 4; }
  #debug-panel[hidden] { display: none; }
  #debug-panel .dbg-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
  #debug-panel .dbg-head b { font-weight: 400; font-size: 13px; color: #F2F2F5; }
  #debug-panel .dbg-head small { margin-left: auto; font-size: 10px; color: #ffc95a; }
  #debug-panel .dbg-icon { font: inherit; font-size: 12px; line-height: 1; color: #C4C6D4; background: rgba(255,255,255,.06);
                           border: 1px solid rgba(255,255,255,.16); border-radius: 4px; width: 22px; height: 22px;
                           display: grid; place-items: center; padding: 0; cursor: pointer; }
  #debug-panel .dbg-icon:hover { border-color: #ffc95a; color: #ffc95a; }
  #debug-panel .dbg-icon[hidden] { display: none; }
  #debug-panel .dbg-close { margin-left: auto; }
  #debug-panel .dbg-menu { display: flex; flex-direction: column; gap: 6px; }
  #debug-panel .dbg-menu[hidden], #debug-panel .dbg-slot[hidden] { display: none; }
  #debug-panel .dbg-item { display: flex; flex-direction: column; gap: 2px; text-align: left; font: inherit; padding: 8px 10px;
                           color: #F2F2F5; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.16);
                           border-radius: 6px; cursor: pointer; }
  #debug-panel .dbg-item:hover { border-color: #ffc95a; color: #ffc95a; }
  #debug-panel .dbg-item small { font-size: 9px; color: #9a9db0; }
  #debug-panel dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
  #debug-panel dt { color: #9a9db0; }
  #debug-panel dd { margin: 0; text-align: right; color: #F2F2F5; font-variant-numeric: tabular-nums; white-space: nowrap; }
  #debug-panel dd.warn { color: #ffc95a; }
  #debug-panel dd.bad { color: #ff8a6b; }
  #debug-panel .dbg-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 10px; padding-top: 8px;
                               border-top: 1px solid rgba(255,255,255,.12); }
  #debug-panel .dbg-controls span { font-size: 10px; color: #9a9db0; margin-right: 2px; }
  #debug-panel .dbg-controls button { font: inherit; font-size: 10px; color: #F2F2F5; background: rgba(255,255,255,.06);
                                      border: 1px solid rgba(255,255,255,.2); border-radius: 5px; padding: 3px 7px; cursor: pointer; }
  #debug-panel .dbg-controls button:hover, #debug-panel .dbg-controls button.on { border-color: #ffc95a; color: #ffc95a; }
  @media (pointer: coarse) {
    #debug-panel { left: 12px; width: auto; max-width: calc(100vw - 24px); }
  }
`;

const BUG_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3 3 0 1 1 6 0v1"/>' +
  '<path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z"/>' +
  '<path d="M12 20v-9M6.5 13H2M22 13h-4.5M6 17l-3 2M18 17l3 2M6 9L3 7M18 9l3-2"/></svg>';

export function setupDebugHub(modules) {
  const placeEl = document.querySelector("#place");
  const toolsEl = placeEl?.querySelector(".tools");
  const helpBtn = document.querySelector("#help");
  const hintEl = document.querySelector("#hint");
  if (!placeEl || !toolsEl) {
    return { isOpen: () => false, needsCatTiming: () => false, update() {}, onNavRebuilt() {} };
  }

  document.head.appendChild(Object.assign(document.createElement("style"), { textContent: HUB_CSS }));

  const debugBtn = Object.assign(document.createElement("button"), {
    id: "debug-btn",
    type: "button",
    innerHTML: BUG_ICON,
  });
  debugBtn.setAttribute("aria-label", "debug");
  if (helpBtn && helpBtn.parentElement === toolsEl) toolsEl.insertBefore(debugBtn, helpBtn);
  else toolsEl.append(debugBtn);

  const panel = Object.assign(document.createElement("div"), {
    id: "debug-panel",
    className: "glass",
    hidden: true,
  });

  const head = Object.assign(document.createElement("div"), { className: "dbg-head" });
  const backBtn = Object.assign(document.createElement("button"), {
    type: "button",
    className: "dbg-icon dbg-back",
    textContent: "←",
    hidden: true,
  });
  backBtn.setAttribute("aria-label", "back to debug menu");
  const titleEl = Object.assign(document.createElement("b"), { textContent: "debug" });
  const devTag = Object.assign(document.createElement("small"), { textContent: "DEV" });
  const closeBtn = Object.assign(document.createElement("button"), {
    type: "button",
    className: "dbg-icon dbg-close",
    textContent: "✕",
    hidden: true,
  });
  closeBtn.setAttribute("aria-label", "close debug");
  head.append(backBtn, titleEl, devTag, closeBtn);

  const menuEl = Object.assign(document.createElement("div"), { className: "dbg-menu" });
  const slots = new Map();
  const byId = new Map();

  for (const mod of modules) {
    byId.set(mod.id, mod);
    const item = Object.assign(document.createElement("button"), {
      type: "button",
      className: "dbg-item",
    });
    item.dataset.debugMod = mod.id;
    item.append(
      Object.assign(document.createElement("span"), { textContent: mod.title }),
      Object.assign(document.createElement("small"), { textContent: mod.desc }),
    );
    item.addEventListener("click", () => {
      selectModule(mod.id);
      item.blur();
    });
    menuEl.append(item);

    const slot = Object.assign(document.createElement("div"), {
      className: "dbg-slot",
      hidden: true,
    });
    mod.mount(slot);
    slots.set(mod.id, slot);
  }

  panel.append(head, menuEl, ...slots.values());
  document.body.append(panel);

  let open = false;
  let activeId = null;

  function placePanel() {
    const rect = placeEl.getBoundingClientRect();
    panel.style.top = `${Math.round(rect.bottom + 10)}px`;
  }
  placePanel();
  if (typeof ResizeObserver === "function") new ResizeObserver(placePanel).observe(placeEl);
  addEventListener("resize", placePanel);

  function selectModule(id) {
    if (activeId && activeId !== id) byId.get(activeId)?.onClose?.();
    activeId = id;
    const mod = id ? byId.get(id) : null;
    menuEl.hidden = !!mod;
    backBtn.hidden = !mod;
    closeBtn.hidden = !mod;
    devTag.hidden = !!mod;
    titleEl.textContent = mod ? mod.title : "debug";
    for (const [modId, slot] of slots) slot.hidden = modId !== id;
    mod?.onOpen?.();
    placePanel();
  }

  function setOpen(next, resetToMenu = true) {
    if (open === next) return;
    open = next;
    panel.hidden = !open;
    debugBtn.classList.toggle("on", open);
    if (open) {
      if (hintEl) {
        hintEl.classList.remove("fade");
        hintEl.hidden = true;
      }
      helpBtn?.classList.remove("on");
      if (resetToMenu) selectModule(null);
      else placePanel();
    } else if (activeId) {
      byId.get(activeId)?.onClose?.();
      activeId = null;
    }
  }

  debugBtn.addEventListener("click", () => {
    setOpen(!open, true);
    debugBtn.blur();
  });
  backBtn.addEventListener("click", () => {
    selectModule(null);
    backBtn.blur();
  });
  closeBtn.addEventListener("click", () => {
    setOpen(false);
    closeBtn.blur();
  });
  helpBtn?.addEventListener("click", () => {
    if (open && hintEl && !hintEl.hidden) setOpen(false);
  });

  return {
    isOpen: () => open,
    needsCatTiming: () => modules.some((m) => m.needsTiming?.(open && activeId === m.id)),
    onNavRebuilt() {
      for (const m of modules) m.onNavRebuilt?.();
    },
    update(ctx) {
      for (const m of modules) m.update?.({ ...ctx, visible: open && activeId === m.id });
    },
  };
}

/** Central entry point imported only by src/main.js under import.meta.env.DEV. */
export function setupDebug(app) {
  const {
    THREE,
    renderer,
    scene,
    cats,
    baseCatCount,
    createCat,
    useFeetDepth,
    bubbles,
    getCatNav,
    measureCats,
    getPlayerCount,
    roomNow,
    getMyId,
    catRideMs,
    catRideUpdate,
    resolveRideTarget,
    getTimeMode,
    getCyclePhase,
    getCycleDurationMs,
    setCycleDuration,
    getLook,
    getRainAmount,
    getLampIntensity,
    playFireworks,
  } = app;

  const toggleDebugRide = () => {
    const cat = cats[0];
    if (!cat) return;
    const now = roomNow();
    if (cat.ride) return catRideUpdate({ id: cat.id, playerId: null, at: now, until: now });
    cat.lastRideAt = null;
    catRideUpdate({
      id: cat.id,
      playerId: getMyId() || "me",
      at: now,
      until: now + catRideMs,
      phrase: Math.floor(Math.random() * 1000),
    });
  };

  const getRideLabel = (cat) => {
    if (cat.ride) {
      const rider = resolveRideTarget(cat.ride.playerId);
      return `on ${rider?.name || "?"} (${Math.max(0, Math.ceil((cat.ride.until - roomNow()) / 1000))}s)`;
    }
    return cat.hopOff ? "hopping down" : "";
  };

  const clearBubble = (mesh) => {
    const b = bubbles.get(mesh);
    if (b) {
      b.el.remove();
      bubbles.delete(mesh);
    }
  };

  const hub = setupDebugHub([
    createCatDebugModule({
      THREE,
      renderer,
      scene,
      cats,
      baseCatCount,
      createCat,
      useFeetDepth,
      clearBubble,
      getCatNav,
      getNavBuildMs: () => getCatNav().buildMs || 0,
      getPlayerCount,
      toggleDebugRide,
      getRideLabel,
    }),
    createCycleDebugModule({
      getTimeMode,
      getCyclePhase,
      getCycleDurationMs,
      setCycleDuration,
      getLook,
      getRainAmount,
      getLampIntensity,
    }),
    createFireworksDebugModule({ playFireworks }),
  ]);

  // Wrap renderer.render in DEV so frame timing, cat CPU timing, and NavGrid rebuild checks
  // stay completely out of src/main.js.
  const origRender = renderer.render.bind(renderer);
  let lastRenderAt = performance.now();
  let lastNav = getCatNav();
  renderer.render = (...args) => {
    origRender(...args);
    const now = performance.now();
    const frameMs = now - lastRenderAt;
    lastRenderAt = now;
    const nav = getCatNav();
    if (nav !== lastNav) {
      lastNav = nav;
      hub.onNavRebuilt();
    }
    let catMs = 0;
    if (hub.needsCatTiming()) {
      const t0 = performance.now();
      measureCats();
      catMs = performance.now() - t0;
    }
    hub.update({ frameMs, catMs });
  };

  return hub;
}
