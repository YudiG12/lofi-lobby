/**
 * Fishing pomodoro: cast at the pond's edge, choose how many minutes to focus, and when the time
 * is up a fish bites (a sound plays) and you have PULL_WINDOW to pull it in. Client-only.
 */
import * as THREE from "three";
import "./fishing.css";

const FAST = import.meta.env.DEV && new URLSearchParams(location.search).has("fast");
const MIN = FAST ? 1000 : 60000;
const PULL_WINDOW = 60000;
const PLOP_EVERY = 4000;
const MINUTES = [15, 25, 50];
const MAX_MINUTES = 180;
export const FISH_NEAR = 2.4;
export const FISH_LEAVE = 2;
const CONFIRM_MS = 3000;

const FW = 24,
  FH = 12;
const OUTLINE = "#1b1b24";
const C = { back: "#55666f", side: "#8496a2", belly: "#c9d2d8", bars: "#46525c", fin: "#9a5a5a" };
/**
 * Draws the fish in pixel art, facing left.
 * @param {number} P size of one pixel on screen
 * @returns {HTMLCanvasElement}
 */
function fishCanvas(P) {
  const g = Array.from({ length: FH }, () => Array(FW).fill(null));
  const set = (x, y, col) => x >= 0 && x < FW && y >= 0 && y < FH && (g[y][x] = col);
  const x0 = 2,
    len = 15,
    h = 8,
    cy = (FH - 1) / 2;
  const half = (x) => (h / 2) * Math.sqrt(Math.max(0, 1 - (((x - x0) / (len - 1) - 0.42) / 0.6) ** 2));
  for (let x = x0; x < x0 + len; x++)
    for (let y = 0; y < FH; y++) {
      const d = (y - cy) / Math.max(half(x), 0.5);
      if (Math.abs(y - cy) > half(x)) continue;
      const bar = d < 0.45 && x - x0 > 3 && x - x0 < 13 && (x - x0) % 4 === 2;
      set(x, y, bar ? C.bars : d < -0.35 ? C.back : d > 0.4 ? C.belly : C.side);
    }
  const xt = x0 + len - 1;
  for (let i = 1; i <= 5; i++) {
    const spread = 1 + i * 0.85;
    for (let y = 0; y < FH; y++) {
      const d = Math.abs(y - cy);
      if (d <= spread && !(i > 3 && d < spread - 2)) set(xt + i, y, C.fin);
    }
  }
  for (let x = x0 + 5; x <= x0 + 9; x++) set(x, Math.ceil(cy - half(x)) - 1, C.fin);
  set(x0 + 2, Math.round(cy - 1), OUTLINE);
  set(x0, Math.round(cy + 1), OUTLINE);
  const cv = Object.assign(document.createElement("canvas"), { width: FW * P, height: FH * P });
  const c = cv.getContext("2d");
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const col = g[y][x] || ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => g[y + b]?.[x + a]) ? OUTLINE : null);
      if (col) (c.fillStyle = col), c.fillRect(x * P, y * P, P, P);
    }
  return cv;
}

const ROD_PX = 64,
  ROD_PAD = 16,
  ROD_LIFT = 0.225;
const ROD_ART = { right: [[21, 27], [31, 16]], down: [[22, 25], [28, 38]], up: [[23, 23], [26, 10]] };
const ROD_BACK = { right: [[21, 26], [14, 14]], down: [[22, 25], [24, 12]], up: [[23, 23], [21, 10]] }; // raised, before the throw
const PX = 5 / 32; // one pixel of the trainer, in world units
const CAST_MS = 800,
  WIND_UP = 0.35; // share of the cast spent with the rod raised
const ROD = { grip: "#2b2b33", wood: "#9a6a3a", shade: "#6b4423", tip: "#e8d9a8", reel: "#c8ccd4", crank: "#7d828f" };
/**
 * Draws the rod in pixel art for one direction, on a canvas twice the trainer's 32px frame (the
 * frame sits in the middle), at the trainer's own pixel size. "left" mirrors "right".
 * @param {string} dir "down" | "up" | "left" | "right"
 * @param {boolean} [back] raised behind the shoulder, as before a throw
 * @param {{shift: number, drop: number} | null} [shape] how far this trainer's body is from where the art expects it
 * @returns {{tex: THREE.CanvasTexture, u: number, v: number}} texture, and the tip on the rod's plane
 */
function rodArt(dir, back, shape) {
  const art = back ? ROD_BACK : ROD_ART;
  const [[ax, ay], [bx, by]] = art[dir === "left" ? "right" : dir] || art.down;
  const sx = shape?.shift || 0,
    sy = shape?.drop || 0;
  const flip = (x) => (dir === "left" ? 31 - x - sx : x + sx);
  const cv = Object.assign(document.createElement("canvas"), { width: ROD_PX, height: ROD_PX });
  const c = cv.getContext("2d");
  const dot = (x, y, col) => ((c.fillStyle = col), c.fillRect(flip(x) + ROD_PAD, y + sy + ROD_PAD, 1, 1));
  const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  const steep = Math.abs(by - ay) > Math.abs(bx - ax);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(ax + ((bx - ax) * i) / n),
      y = Math.round(ay + ((by - ay) * i) / n);
    if (i < n / 2) dot(steep ? x + 1 : x, steep ? y : y + 1, i < 3 ? ROD.grip : ROD.shade);
    if (i === 4) dot(steep ? x + 2 : x, steep ? y : y + 2, ROD.reel), dot(steep ? x + 2 : x + 1, steep ? y + 1 : y + 2, ROD.crank);
    dot(x, y, i < 3 ? ROD.grip : i > n - 3 ? ROD.tip : ROD.wood);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, u: (flip(bx) + ROD_PAD + 0.5) / ROD_PX - 0.5, v: 0.5 - (by + sy + ROD_PAD + 0.5) / ROD_PX + ROD_LIFT };
}

/**
 * @param {string[]} rows one string per pixel row, one letter per pixel ("." is empty)
 * @param {Record<string, string>} colors letter -> colour
 * @returns {THREE.CanvasTexture} pixel-art texture
 */
function pixelTexture(rows, colors) {
  const cv = Object.assign(document.createElement("canvas"), { width: rows[0].length, height: rows.length });
  const c = cv.getContext("2d");
  rows.forEach((row, y) => [...row].forEach((k, x) => colors[k] && ((c.fillStyle = colors[k]), c.fillRect(x, y, 1, 1))));
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const BOBBER = [".k.", "hrr", "rrr", "www", ".w."];
const BOBBER_COLORS = { k: "#2b2b33", r: "#e0402a", h: "#ff8a6b", w: "#f2efe6" };
const RING = 16;
const RING_ROWS = Array.from({ length: RING }, (_, y) =>
  Array.from({ length: RING }, (_, x) => (Math.abs(Math.hypot(x - 7.5, y - 7.5) - 6.5) < 0.6 ? "o" : ".")).join(""),
);

const load = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

let audio = null;
/** Starts the audio context; browsers only allow it after a click or key on the page. */
const unlockAudio = () => {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { audio ??= new AudioContext(); audio.resume(); } catch {}
};
/**
 * Plays a short sine sweep.
 * @param {number} freq start frequency (Hz)
 * @param {number} to end frequency (Hz)
 * @param {number} start delay (s)
 * @param {number} dur length (s)
 * @param {number} [vol]
 */
function tone(freq, to, start, dur, vol = 0.18) {
  if (!audio) return;
  const t = audio.currentTime + start;
  const o = audio.createOscillator(),
    g = audio.createGain();
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}
const plop = () => (tone(700, 180, 0, 0.16), tone(650, 170, 0.32, 0.16));

/** @param {number} ms @returns {string} "m:ss" */
const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Creates the fishing line: rod, line and bobber in the scene, the minutes box, the catch card and
 * the timer. A line that is out is kept in localStorage, so it survives a reload.
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {HTMLButtonElement} o.button HUD button that shows the time left
 * @param {(text: string) => void} o.say bubble over your trainer (only you see it)
 * @param {(mesh: THREE.Mesh) => void} o.feetDepth gives the rod the same depth as your trainer
 * @param {THREE.Camera} o.camera
 * @param {(dir: string) => {shift: number, drop: number} | null} o.shape where your trainer's body is on its frame (null while its sheet loads)
 */
export function createFishing({ scene, button, say, feetDepth, camera, shape }) {
  let state = load("fishing", { phase: "idle" });
  if (state?.phase !== "out") state = { phase: "idle" };
  let confirmUntil = 0,
    lastPlop = 0;
  const setState = (s) => save("fishing", (state = s));

  /** @returns {"idle" | "focus" | "bite"} */
  const phase = (now = Date.now()) => (state.phase !== "out" ? "idle" : now < state.end ? "focus" : "bite");

  const rods = {};
  const rodTex = rodArt("down").tex;
  const rod = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).translate(0, ROD_LIFT, 0),
    new THREE.MeshLambertMaterial({ map: rodTex, emissiveMap: rodTex, emissive: 0xffffff, emissiveIntensity: 0.7, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }),
  );
  rod.scale.set(10, 10, 1);
  feetDepth(rod);
  // the line: square dots on a screen grid about one trainer pixel wide, one dot per step, like a
  // line drawn in pixel art
  const LINE_PTS = 240,
    LINE_SAMPLES = 360;
  const lineGrid = { value: 2 },
    lineRes = { value: new THREE.Vector2(1, 1) };
  const line = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(LINE_PTS * 3), 3)),
    new THREE.PointsMaterial({ color: "#e9e6dc", size: 2, sizeAttenuation: false }),
  );
  line.material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = lineGrid;
    shader.uniforms.uRes = lineRes;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uGrid;\nuniform vec2 uRes;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vec2 cell = (gl_Position.xy / gl_Position.w * 0.5 + 0.5) * uRes;
cell = (floor(cell / uGrid) + 0.5) * uGrid;
gl_Position.xy = (cell / uRes * 2.0 - 1.0) * gl_Position.w;`,
      );
  };
  line.frustumCulled = false;
  const bobberTex = pixelTexture(BOBBER, BOBBER_COLORS);
  const bobber = new THREE.Mesh(
    new THREE.PlaneGeometry(BOBBER[0].length * PX, BOBBER.length * PX).translate(0, (BOBBER.length / 2 - 1) * PX, 0), // one row under water
    new THREE.MeshLambertMaterial({ map: bobberTex, emissiveMap: bobberTex, emissive: 0xffffff, emissiveIntensity: 0.5, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }),
  );
  const ripple = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: pixelTexture(RING_ROWS, { o: "#cfe6ff" }), transparent: true, opacity: 0, depthWrite: false }),
  );
  ripple.rotation.x = -Math.PI / 2;
  const gear = [rod, line, bobber, ripple];
  gear.forEach((o) => ((o.visible = false), scene.add(o)));
  // where the bobber lands: rings that open and fade on the water, like the rain's splashes
  const SPLASH_SIZES = [2.4, 3.4, 4.4],
    SPLASH_GAP = 0.12,
    SPLASH_SPEED = 3.2;
  const splashGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const splashes = SPLASH_SIZES.map(() => {
    const m = new THREE.Mesh(
      splashGeo,
      new THREE.ShaderMaterial({
        uniforms: { uAge: { value: 1 }, uColor: { value: new THREE.Color("#cfe6ff") } },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        vertexShader: `varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uAge; uniform vec3 uColor; varying vec2 vUv;
          void main() {
            float ring = smoothstep(0.2, 0.0, abs(length(vUv * 2.0 - 1.0) - 0.75));
            float a = ring * (1.0 - uAge);
            if (a < 0.01) discard;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    );
    m.renderOrder = 10;
    m.visible = false;
    scene.add(m);
    return m;
  });

  const _tip = new THREE.Vector3(),
    _end = new THREE.Vector3(),
    _p = new THREE.Vector3();
  const cx = [],
    cy = [],
    cz = [];
  let castAt = 0,
    landed = true,
    landAt = 0;
  /**
   * Places the rod, line and bobber for this frame (hidden while idle). The rod is drawn over the
   * trainer and turns with it; the line runs from the rod's tip to the bobber. Right after a cast
   * the rod goes up and the bobber flies out to the water.
   * @param {number} now Date.now()
   * @param {THREE.Mesh} body your trainer's sprite
   * @param {string} dir the way the trainer faces now
   */
  function draw(now, body, dir) {
    const p = phase(now);
    gear.forEach((o) => (o.visible = p !== "idle"));
    if (p === "idle") return splashes.forEach((m) => (m.visible = false));
    const t = now / 1000;
    const a = (now - castAt) / CAST_MS;
    const windUp = a < WIND_UP,
      flying = a < 1;
    const { x: tx, y: ty, z: tz } = state.target;

    const sh = shape(dir);
    const key = dir + (windUp ? "b" : "");
    const art = rods[key] || rodArt(dir, windUp, sh);
    if (sh) rods[key] = art;
    rod.material.map = rod.material.emissiveMap = art.tex;
    rod.position.copy(body.position);
    rod.rotation.copy(body.rotation);
    if (p === "bite" && Math.sin(t * 9) > 0) rod.position.y -= PX; // tugged one pixel down
    rod.updateMatrixWorld();
    rod.localToWorld(_tip.set(art.u, art.v, 0));
    // a tip drawn below the feet would put the line under the ground: slide it toward the camera
    // (the same spot on screen) until it is above the ground
    const low = body.position.y + 1;
    if (_tip.y < low) _tip.lerpVectors(camera.position, _tip, (low - camera.position.y) / (_tip.y - camera.position.y));

    if (windUp) bobber.position.set(_tip.x, _tip.y - 3 * PX, _tip.z);
    else if (flying) {
      const e = (a - WIND_UP) / (1 - WIND_UP);
      bobber.position.lerpVectors(_tip, _p.set(tx, ty + 0.06, tz), e).y += Math.sin(Math.PI * e) * 2;
    } else {
      if (!landed) (landed = true), (landAt = now), tone(700, 180, 0, 0.16, 0.1);
      const tug = p === "bite" ? Math.max(0, Math.sin(t * 9)) * 0.28 : 0;
      bobber.position.set(tx, ty + 0.06 + Math.sin(t * 1.8) * 0.04 - tug, tz);
    }
    bobber.rotation.copy(body.rotation);
    splashes.forEach((m, i) => {
      const age = ((now - landAt) / 1000 - i * SPLASH_GAP) * SPLASH_SPEED;
      m.visible = age >= 0 && age < 1;
      if (!m.visible) return;
      m.material.uniforms.uAge.value = age;
      m.position.set(tx, ty + 0.05, tz);
      m.scale.setScalar(SPLASH_SIZES[i] * (0.4 + age) * 0.45);
    });
    ripple.visible = !flying;
    const period = p === "bite" ? 0.7 : 2.6;
    const k = (t % period) / period;
    ripple.position.set(tx, ty + 0.02, tz);
    ripple.scale.setScalar(1 + k * (p === "bite" ? 4 : 2.5));
    ripple.material.opacity = (1 - k) * (p === "bite" ? 0.6 : 0.3);

    // the line's curve, turned into grid cells on screen: one cell per step, no doubled corners
    camera.updateMatrixWorld();
    const W = innerWidth,
      H = innerHeight;
    const g = Math.max(2, Math.floor((PX * camera.projectionMatrix.elements[5] * H) / 2 / camera.position.distanceTo(body.position)));
    lineRes.value.set(W, H);
    lineGrid.value = line.material.size = g;
    _end.copy(bobber.position).y += 3 * PX;
    const sag = flying ? 0 : p === "bite" ? 0.1 : Math.min(0.9, Math.hypot(_end.x - _tip.x, _end.z - _tip.z) * 0.2);
    let n = 0;
    for (let i = 0; i <= LINE_SAMPLES; i++) {
      const u = i / LINE_SAMPLES;
      _p.lerpVectors(_tip, _end, u).y -= Math.sin(Math.PI * u) * sag;
      if (!flying) _p.y = Math.max(_p.y, ty + 0.05);
      _p.project(camera);
      const x = Math.floor(((_p.x * 0.5 + 0.5) * W) / g),
        y = Math.floor(((_p.y * 0.5 + 0.5) * H) / g);
      if (n && cx[n - 1] === x && cy[n - 1] === y) continue;
      while (n >= 2 && Math.max(Math.abs(cx[n - 2] - x), Math.abs(cy[n - 2] - y)) <= 1) n--;
      (cx[n] = x), (cy[n] = y), (cz[n] = _p.z), n++;
    }
    n = Math.min(n, LINE_PTS);
    const pos = line.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      _p.set((((cx[i] + 0.5) * g) / W) * 2 - 1, (((cy[i] + 0.5) * g) / H) * 2 - 1, cz[i]).unproject(camera);
      pos.setXYZ(i, _p.x, _p.y, _p.z);
    }
    line.geometry.setDrawRange(0, n);
    pos.needsUpdate = true;
  }

  const picker = Object.assign(document.createElement("form"), { id: "fish-time", className: "glass", hidden: true });
  picker.innerHTML =
    '<b>focus for how long?</b><div class="quick"></div><label><input inputmode="numeric" maxlength="3" autocomplete="off" aria-label="minutes" /> min</label><button type="submit">cast</button><small>Enter casts · Esc cancels</small>';
  const field = picker.querySelector("input");
  for (const m of MINUTES) {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: `${m}` });
    b.addEventListener("click", () => ((field.value = m), picker.requestSubmit()));
    picker.querySelector(".quick").append(b);
  }
  document.body.append(picker);
  let onPick = null;
  const closePicker = () => {
    picker.hidden = true;
    onPick = null;
    field.blur();
  };
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") closePicker();
  });
  field.addEventListener("input", () => (field.value = field.value.replace(/\D/g, "")));
  picker.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!+field.value) return field.focus();
    const m = Math.min(MAX_MINUTES, Math.round(+field.value));
    save("fish-minutes", m);
    const done = onPick;
    closePicker();
    done?.(m);
  });
  /**
   * Opens the minutes box, filled with the last choice.
   * @param {(minutes: number) => void} cast called with the chosen minutes
   */
  function choose(cast) {
    onPick = cast;
    field.value = load("fish-minutes", 25);
    picker.hidden = false;
    field.focus();
    field.select();
  }

  const card = Object.assign(document.createElement("div"), { id: "catch", className: "glass", hidden: true });
  card.append(fishCanvas(4), Object.assign(document.createElement("p"), { className: "txt" }));
  document.body.append(card);
  let cardTimer = 0;

  /**
   * @param {{x: number, z: number, face: string, seat: number, target: {x: number, y: number, z: number}}} spot
   *   where you cast from and where the bobber lands
   * @param {number} minutes
   */
  function cast(spot, minutes) {
    unlockAudio();
    card.hidden = true;
    setState({ phase: "out", end: Date.now() + minutes * MIN, minutes, ...spot });
    castAt = Date.now();
    landed = false;
    tone(500, 260, 0, 0.12, 0.12);
    say(`line's out: ${minutes} min of focus`);
  }
  /** Brings the line back without a fish. @param {string} [text] bubble to show */
  function reelIn(text = "the fish got away") {
    if (state.phase !== "out") return;
    setState({ phase: "idle" });
    confirmUntil = 0;
    if (text) say(text);
  }
  function pull() {
    const minutes = state.minutes;
    setState({ phase: "idle" });
    card.querySelector(".txt").textContent = `you caught a fish! ${minutes} min of focus done`;
    card.hidden = false;
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => (card.hidden = true), 6000);
  }
  /** E while the line is out: pulls on a bite, otherwise reels in on the second press. */
  function press(now = Date.now()) {
    const p = phase(now);
    if (p === "bite") return pull();
    if (p !== "focus") return;
    if (now < confirmUntil) return reelIn("line's in. no fish this time");
    confirmUntil = now + CONFIRM_MS;
  }

  const baseTitle = document.title;
  const icon = button.querySelector("svg").outerHTML;
  /** Runs on an interval, so the timer and the sound keep going with the tab hidden. */
  function tick() {
    const now = Date.now();
    const p = phase(now);
    if (p === "bite") {
      if (now >= state.end + PULL_WINDOW) {
        reelIn("too slow: the fish got away");
        return tick();
      }
      if (now - lastPlop >= PLOP_EVERY) (lastPlop = now), unlockAudio(), plop();
    }
    const left = p === "bite" ? state.end + PULL_WINDOW - now : state.end - now;
    const title = p === "focus" ? `🎣 ${clock(left)} · ${baseTitle}` : p === "bite" ? `🐟 pull! · ${baseTitle}` : baseTitle;
    if (document.title !== title) document.title = title;
    const text = p === "focus" ? clock(left) : p === "bite" ? `pull! ${Math.ceil(left / 1000)}` : "";
    const confirming = p === "focus" && now < confirmUntil;
    button.classList.toggle("timer", !!text);
    button.classList.toggle("bite", p === "bite");
    button.classList.toggle("confirm", confirming);
    const label = confirming ? "press again to reel in" : p === "focus" ? "reel in (E)" : p === "bite" ? "pull it in! (E)" : "fish (E by the pond)";
    if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    const html = icon + (text ? `<span>${text}</span>` : "");
    if (button.dataset.html !== html) (button.innerHTML = html), (button.dataset.html = html);
  }
  setInterval(tick, 250);
  tick();

  return {
    phase,
    choose,
    choosing: () => !picker.hidden,
    closePicker,
    cast,
    press,
    reelIn,
    draw,
    confirming: () => phase() === "focus" && Date.now() < confirmUntil,
    spot: () => (state.phase === "out" ? state : null),
  };
}
