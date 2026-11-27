// Holding something over your head (a cat, picked up with H), facing any of the four ways, on any step.
// The sheets have no such frames, so, like the sitting ones (src/ground-sit.js), they are drawn in code
// from each trainer's own walking frames (after its cap colour is applied) and added as extra rows at
// the bottom of the same texture: nothing new to load, and every trainer and cap gets them.
//
//  - the arms hanging at the sides are taken off (their pixels go back to the body's edge);
//  - in their place both arms go straight up along the head, sleeve colour with an outline, and the
//    hands (their own skin colour, read from the hands that were taken off) end above the head;
//  - sideways only the near arm shows, raised in front of the face.

export const LIFT_DIRS = ["down", "left", "right", "up"]; // one row per direction, one column per step
const GAP = 2;
const OUTLINE = "#000000";
const RAISE = 1; // how far above the top of the head the hands reach (the frame has room above the cap)

// the box of the opaque pixels of a frame
function bounds(d, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] > 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return { x0, y0, x1, y1 };
}

// the most used non-outline colour among the pixels listed, or `fallback`
function mostColour(d, w, pixels, fallback) {
  const count = {};
  for (const [x, y] of pixels) {
    const i = (y * w + x) * 4;
    if (d[i + 3] <= 128 || d[i] + d[i + 1] + d[i + 2] < 60) continue;
    const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
    count[k] = (count[k] || 0) + 1;
  }
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return top ? `rgb(${top[0]})` : fallback;
}

// Where the arms are, measured once per direction on the standing frame (step 0) so every step of the
// walk loses the same columns: the torso rows (below the head, above the shoes) and the column the
// legs run in (the shoes' width, one pixel wider each side). Past that column hang the arms.
export function armBox(src, p) {
  const { w, h } = p;
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h }).getContext("2d", { willReadFrequently: true });
  c.drawImage(src, p.x, p.y, w, h, 0, 0, w, h);
  const d = c.getImageData(0, 0, w, h).data;
  const { x0, y0, x1, y1 } = bounds(d, w, h);
  let lx0 = w, lx1 = -1;
  for (let y = y1 - 1; y <= y1; y++)
    for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 128) (lx0 = Math.min(lx0, x)), (lx1 = Math.max(lx1, x));
  const tTop = y0 + Math.round((y1 - y0 + 1) * 0.5);
  // the skin of the hands hanging past the legs' column (only seen from the front and back)
  const hands = [];
  for (let y = tTop + 4; y <= y1 - 2; y++) for (let x = 0; x < w; x++) if (x < lx0 - 1 || x > lx1 + 1) hands.push([x, y]);
  return { x0, y0, x1, y1, tTop, keep0: lx0 - 1, keep1: lx1 + 1, skin: mostColour(d, w, hands, null) };
}

// one frame holding something up, from the walking frame `p` ({ x, y, w, h } in `src`) facing `dir`;
// `box` is that direction's armBox
export function liftFrame(src, p, dir, box) {
  const { w, h } = p;
  const out = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = out.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(src, p.x, p.y, w, h, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const od = d.slice(); // the frame as it was, to read colours from
  const opaque = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 128;
  const { x0, y0, x1, tTop, keep0, keep1 } = box;
  if (x1 < 0) return out;
  const b = bounds(d, w, h); // this step's own box (a walking step can sit a pixel higher)
  const lift = b.y0 - y0;
  const top0 = tTop + lift, bot = b.y1 - 2;
  const side = dir === "left" || dir === "right";

  // the jacket at the shoulders (the arm's sleeve) and the skin of the hands hanging at the sides
  const shoulder = [], hands = [];
  for (let x = keep0 + 2; x <= keep1 - 2; x++) shoulder.push([x, top0 + 1], [x, top0 + 2]);
  if (!side) {
    for (let y = top0; y <= bot; y++)
      for (let x = 0; x < w; x++) {
        if (!opaque(x, y) || (x >= keep0 && x <= keep1)) continue;
        if (y > top0 + 3) hands.push([x, y]);
        d[(y * w + x) * 4 + 3] = 0; // the hanging arm goes
      }
  }
  const sleeve = mostColour(od, w, shoulder, "#444");
  const skin = box.skin || mostColour(od, w, hands, "#f2c7a0");
  g.putImageData(img, 0, 0);

  const rect = (x, y, rw, rh, col) => ((g.fillStyle = col), g.fillRect(x, y, rw, rh));
  if (!side) {
    // close the body's edge where the arms were
    for (let y = top0; y <= bot; y++) {
      let a = -1, z = -1;
      for (let x = 0; x < w; x++) if (opaque(x, y)) (a = a < 0 ? x : a), (z = x);
      if (a >= 0) (rect(a, y, 1, 1, OUTLINE), rect(z, y, 1, 1, OUTLINE));
    }
  }
  // one raised arm, outlined: a sleeve at the shoulder, the bare forearm, and a hand at the top that
  // leans in toward the other hand (whatever is held sits between them)
  const handY = Math.max(1, y0 + lift - RAISE);
  const AW = 3; // arm width, like the arms hanging in the sheet
  const arm = (ax, inward) => {
    const len = top0 + 2 - handY;
    rect(ax - 1, handY + 2, AW + 2, len - 1, OUTLINE);
    rect(ax, handY + 3, AW, len - 3, skin);
    if (sleeve !== skin) rect(ax, top0 - 2, AW, 3, sleeve); // the sleeve at the shoulder
    const hx = ax + inward;
    rect(hx - 1, handY - 1, AW + 2, 5, OUTLINE);
    rect(hx, handY, AW, 3, skin);
  };
  if (side) {
    // the near arm, up along the front of the head
    const s = dir === "left" ? -1 : 1;
    arm(s < 0 ? b.x0 + 1 : b.x1 - AW, s < 0 ? -1 : 1);
  } else {
    arm(x0 - 1, 1);
    arm(x1 - AW + 2, -1);
  }
  return out;
}

// Adds the holding rows under `src` (below everything already there) and returns the new canvas plus
// where they are. `cfg`, `framePos` and `steps` say where each direction's walking frames are.
export function addLiftFrames(src, cfg, framePos, steps) {
  const { w, h } = framePos(cfg, "down", 0);
  const rowY = src.height + GAP;
  const out = Object.assign(document.createElement("canvas"), {
    width: Math.max(src.width, steps * (w + GAP)),
    height: rowY + LIFT_DIRS.length * (h + GAP),
  });
  Object.assign(out, { sitRow: src.sitRow });
  const c = out.getContext("2d");
  c.imageSmoothingEnabled = false;
  c.drawImage(src, 0, 0);
  const front = armBox(src, framePos(cfg, "down", 0));
  LIFT_DIRS.forEach((dir, r) => {
    // the hands' skin is read from the front, where both hang clear of the body
    const box = { ...armBox(src, framePos(cfg, dir, 0)), skin: front.skin };
    for (let s = 0; s < steps; s++) c.drawImage(liftFrame(src, framePos(cfg, dir, s), dir, box), s * (w + GAP), rowY + r * (h + GAP));
  });
  return { canvas: out, rows: { y: rowY, w, h, step: w + GAP, steps } };
}

// where the holding frame facing `dir` on `step` is, in the same shape as framePos
export const liftFramePos = (rows, dir, step) => ({
  x: (step % rows.steps) * rows.step,
  y: rows.y + LIFT_DIRS.indexOf(dir) * (rows.h + GAP),
  w: rows.w,
  h: rows.h,
});
