// Fireworks after a deploy (ADR 016): a few bursts and the "PR #n" of each new pull request,
// written in sparks over the town. Everything is drawn from the room's clock and a seed per round
// (src/fireworks-plan.js), never integrated frame by frame: every tab shows the same picture, and a tab
// that was hidden comes back to the current moment instead of a pile of bursts.
//
// One THREE.Points (one draw call) with a fixed pool of square sparks. With additive blending a black
// spark adds nothing, so unused ones are simply black. The camera looks down at the town and never sees
// the sky, so the show sits in the upper part of the view, facing the camera, wherever the player is.
import * as THREE from "three";
import { ROUND_MS, planRounds, seededRandom, showState } from "./fireworks-plan.js";

const POOL = 2600;
const BURSTS = 3; // per round
const SPARKS = 80; // per burst
const TRAIL = 5; // points of a rocket going up
const LABEL_MAX = POOL - BURSTS * (SPARKS + TRAIL);
// where the show sits, from the point the camera looks at (the player): about 33° below the horizon,
// in the upper part of the view (the camera is at +(0, 38, 42) with a 30° field)
const LIFT = 5;
const AHEAD = 6;
const LABEL_Y = -1.6; // the text, under the bursts
const LABEL_IN = [1700, 2400]; // ms into the round: the sparks fly to the letters
const LABEL_OUT = [5100, 5800]; // and fade out
const ROCKET_MS = 500;
const PALETTE = ["#ffd166", "#ef476f", "#ff8fab", "#4cc9f0", "#f8961e", "#ffffff"].map((c) => new THREE.Color(c));
const WHITE = new THREE.Color("#ffffff");

export function createFireworks() {
  const positions = new Float32Array(POOL * 3);
  const colors = new Float32Array(POOL * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.PointsMaterial({
    size: 0.8,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false, // over the rides and roofs, like the name tags
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "Fireworks";
  points.frustumCulled = false; // the sparks move every frame; the bounding sphere would be stale
  points.renderOrder = 10;
  points.visible = false;

  let rounds = [];
  let at = 0;
  let label = null; // { text, pts: [x, y][], unit } for the round being shown
  const color = new THREE.Color();

  /** keeps the show; a later one replaces it */
  function play(show) {
    rounds = planRounds(show.prs, show.more | 0);
    at = show.at;
    label = null;
  }

  const dim = (now) => (rounds.length ? showState(rounds, at, now).dim : 0);

  // The label drawn once on a small canvas, its lit pixels taken as spark spots (chunky, like the town's
  // pixel art). Scaled to at most 80 % of the width the camera sees at the show's distance (a phone
  // held upright, or "+ 395 more").
  function labelFor(text, visibleWidth) {
    const font = "bold 14px monospace";
    const cv = document.createElement("canvas");
    const ctx = cv.getContext("2d");
    ctx.font = font;
    cv.width = Math.ceil(ctx.measureText(text).width) + 4;
    cv.height = 18;
    ctx.font = font;
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 2, 9);
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const lit = [];
    for (let y = 0; y < cv.height; y++)
      for (let x = 0; x < cv.width; x++) if (data[(y * cv.width + x) * 4 + 3] > 120) lit.push([x, y]);
    const step = Math.ceil(lit.length / LABEL_MAX); // a label too long for the pool keeps every second (third...) pixel
    const unit = Math.min(0.24, (0.8 * visibleWidth) / cv.width);
    const pts = lit.filter((_, i) => i % step === 0).map(([x, y]) => [(x - cv.width / 2) * unit, -(y - cv.height / 2) * unit + LABEL_Y]);
    return { text, pts, unit };
  }

  function put(i, x, y, z, c, k) {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colors[i * 3] = c.r * k;
    colors[i * 3 + 1] = c.g * k;
    colors[i * 3 + 2] = c.b * k;
  }

  let drawn = false;
  /**
   * @param {number} now the room's clock
   * @param {{ x: number, y: number, z: number }} target what the camera looks at (the player)
   * @param {THREE.PerspectiveCamera} camera
   */
  function update(now, target, camera) {
    const s = rounds.length ? showState(rounds, at, now) : null;
    if (!s?.running) {
      if (drawn) {
        colors.fill(0);
        geometry.attributes.color.needsUpdate = true;
        drawn = false;
      }
      points.visible = false;
      if (s && now > at + rounds.length * ROUND_MS + 2000) rounds = []; // over: nothing left to do
      return;
    }
    points.visible = true;
    drawn = true;
    points.position.set(target.x, target.y + LIFT, target.z - AHEAD);
    points.quaternion.copy(camera.quaternion); // facing the camera: local x/y are the screen's
    const distance = camera.position.distanceTo(points.position);
    const visibleWidth = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const round = rounds[s.round];
    const ms = s.t * ROUND_MS;
    const rand = seededRandom(round.seed * 7919 + 17);
    const spread = Math.min(8, visibleWidth * 0.35);
    let i = 0;

    // bursts: a rocket goes up, then a ring of sparks flies out, slows down, falls a little and fades
    for (let b = 0; b < BURSTS; b++) {
      const t0 = [250, 1500, 3100][b] + rand() * 400;
      const cx = (rand() * 2 - 1) * spread;
      const cy = 0.6 + rand() * 2.4;
      const c = PALETTE[Math.floor(rand() * PALETTE.length)];
      const life = 1.5 + rand() * 0.4;
      const speed = 6.5 + rand() * 3;
      const sparkRand = seededRandom(round.seed * 131 + b);
      for (let k = 0; k < TRAIL; k++, i++) {
        const up = (ms - (t0 - ROCKET_MS) - k * 40) / ROCKET_MS; // 0..1 while it rises
        if (up < 0 || up >= 1) put(i, 0, 0, 0, c, 0);
        else put(i, cx, cy - 6 * (1 - up), 0, color.copy(c).lerp(WHITE, 0.6), 0.9 - k * 0.17);
      }
      const age = (ms - t0) / 1000;
      for (let k = 0; k < SPARKS; k++, i++) {
        const angle = sparkRand() * Math.PI * 2;
        const v = speed * (0.55 + 0.45 * sparkRand());
        const flicker = sparkRand() * 6;
        if (age < 0 || age > life) {
          put(i, 0, 0, 0, c, 0);
          continue;
        }
        const out = (1 - Math.exp(-1.8 * age)) / 1.8; // drag
        const fade = Math.pow(1 - age / life, 1.5) * (age > 0.6 * life ? 0.6 + 0.4 * Math.sin(age * 30 + flicker) : 1);
        put(i, cx + Math.cos(angle) * v * out, cy + Math.sin(angle) * v * out - 0.9 * age * age, 0, c, fade);
      }
    }

    // the label: sparks fly from under the bursts to the letters, twinkle, then fade
    if (label?.text !== round.label) label = labelFor(round.label, visibleWidth);
    const lc = PALETTE[Math.floor(rand() * PALETTE.length)];
    const fly = Math.min(1, Math.max(0, (ms - LABEL_IN[0]) / (LABEL_IN[1] - LABEL_IN[0])));
    const ease = 1 - Math.pow(1 - fly, 3);
    const out = ms < LABEL_OUT[0] ? 1 : Math.max(0, 1 - (ms - LABEL_OUT[0]) / (LABEL_OUT[1] - LABEL_OUT[0]));
    const shown = ms >= LABEL_IN[0] && out > 0;
    const startRand = seededRandom(round.seed * 977 + 3);
    for (let k = 0; k < label.pts.length && i < POOL; k++, i++) {
      const [x, y] = label.pts[k];
      const sx = (startRand() * 2 - 1) * 1.2;
      const sy = LABEL_Y + 2 + (startRand() * 2 - 1) * 1.2;
      const twinkle = 0.8 + 0.2 * Math.sin(ms * 0.012 + k * 1.7);
      if (!shown) put(i, 0, 0, 0, lc, 0);
      else put(i, sx + (x - sx) * ease, sy + (y - sy) * ease, 0, color.copy(lc).lerp(WHITE, 0.3), twinkle * out);
    }
    for (; i < POOL; i++) put(i, 0, 0, 0, WHITE, 0);
    // A point's size on screen is size × (half the screen height) / distance, whatever the camera's field:
    // with a 30° field that is 1 / tan(15°) ≈ 3.7 times smaller than an object of the same size, so the
    // sparks are sized from the letters' pixel spacing to make solid, chunky letters.
    material.size = Math.max(0.45, Math.min(1, label.unit * 3.4));
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  return { points, play, update, dim };
}
