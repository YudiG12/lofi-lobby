// Sitting on the ground, facing any of the four ways.
// The sheets have no sitting frames, so they are drawn in code from each trainer's own standing frame
// of that direction (after its cap colour is applied) and added as an extra row at the bottom of the
// same texture: nothing new to load, and every trainer and cap gets them.
//
//  - front and back: the body drops 3 px and the legs become a lap across the bottom (trousers or
//    skirt colour, a shade under it) with the shoes at its ends (only the heels from the back);
//  - sideways: the body drops and the legs run from the hip, under the body, out in front of it to
//    the shoe. The body is drawn over the legs, so only the shoe shows past it.

export const SIT_DIRS = ["down", "left", "right", "up"]; // the row's order
const GAP = 2;
const DROP = 3; // how far the body comes down
const OUTLINE = "#000000";

// the box of the opaque pixels of a frame
function bounds(d, w, h) {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
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

// one sitting frame from the standing frame `p` ({ x, y, w, h } in `src`), facing `dir`
function sitFrame(src, p, dir) {
  const { w, h } = p;
  const f = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const fc = f.getContext("2d");
  fc.drawImage(src, p.x, p.y, w, h, 0, 0, w, h);
  const d = fc.getImageData(0, 0, w, h).data;
  const opaque = (x, y) => d[(y * w + x) * 4 + 3] > 128;
  const { x0, x1, y1 } = bounds(d, w, h);

  // the colours of the legs and the shoes: the most used (non-outline) colour of their rows
  const most = (y) => {
    const count = {};
    for (let x = x0; x <= x1; x++) {
      if (!opaque(x, y)) continue;
      const i = (y * w + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] < 30) continue; // the outline
      const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      count[k] = (count[k] || 0) + 1;
    }
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0].split(",").map(Number) : [80, 80, 80];
  };
  const legTop = y1 - 2; // the legs are the last three rows (trousers or skirt, shoes, outline)
  const rgb = (c) => `rgb(${c.join(",")})`;
  const legRGB = most(legTop);
  const leg = rgb(legRGB),
    shade = rgb(legRGB.map((v) => Math.round(v * 0.78))),
    shoe = rgb(most(y1 - 1));

  // the hips: how wide the body is just above the legs
  let hx0 = w,
    hx1 = -1;
  for (let x = 0; x < w; x++) if (opaque(x, legTop - 1)) (hx0 = Math.min(hx0, x)), (hx1 = Math.max(hx1, x));
  const cx = Math.round((hx0 + hx1) / 2);
  const ly = legTop + DROP - 1; // the row the legs rest on

  const out = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = out.getContext("2d");
  g.imageSmoothingEnabled = false;
  const rect = (x, y, rw, rh, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, rw, rh);
  };
  const body = () => g.drawImage(f, 0, 0, w, legTop, 0, DROP, w, legTop); // without the legs, lowered

  body();
  if (dir === "down" || dir === "up") {
    // a lap across the bottom, a little wider than the hips, centred on the whole body (the hips'
    // own row can be lopsided: a bag, a hand lower on one side)
    const mid = Math.round((x0 + x1) / 2);
    const L = mid - 6,
      R = mid + 6;
    rect(L - 1, ly - 1, R - L + 3, 4, OUTLINE);
    rect(L, ly, R - L + 1, 1, leg);
    rect(L, ly + 1, R - L + 1, 1, shade);
    if (dir === "down") {
      // the shoes at both ends, toes to us
      rect(L, ly, 2, 2, shoe);
      rect(R - 1, ly, 2, 2, shoe);
      rect(L + 2, ly, 1, 2, OUTLINE);
      rect(R - 2, ly, 1, 2, OUTLINE);
      rect(mid, ly, 1, 1, OUTLINE); // where the knees meet
    } else {
      // from the back, only the heels
      rect(L, ly + 1, 2, 1, shoe);
      rect(R - 1, ly + 1, 2, 1, shoe);
    }
  } else {
    // sideways: from the back of the hip, under the body, out past its front to the shoe
    const s = dir === "left" ? -1 : 1;
    const hip = s < 0 ? hx1 - 3 : hx0 + 3;
    const tip = (s < 0 ? hx0 : hx1) + s * 2; // just the shoe past the body's front
    const a = Math.min(hip, tip),
      b = Math.max(hip, tip);
    const y = ly - 1;
    const shoeAt = s < 0 ? a : b - 1;
    const drawShoe = () => {
      rect(shoeAt, y - 2, 2, 4, OUTLINE);
      rect(shoeAt, y - 1, 2, 3, shoe);
      rect(s < 0 ? a + 2 : b - 2, y, 1, 2, OUTLINE); // the ankle
    };
    rect(a - 1, y - 1, b - a + 3, 4, OUTLINE);
    rect(a, y, b - a + 1, 1, leg);
    rect(a, y + 1, b - a + 1, 1, shade);
    drawShoe();
    body(); // the body in front of the legs: they start under it
    drawShoe();
  }
  // the body's last rows (hands, hem) over the top edge of the legs
  g.drawImage(f, 0, legTop - 2, w, 2, 0, legTop - 2 + DROP, w, 2);
  return out;
}

// Adds the sitting row under `src` (a sheet already cleaned and recoloured) and returns the new canvas
// plus where the row is. `cfg` and `framePos` say where each direction's standing frame is.
export function addSitFrames(src, cfg, framePos) {
  const { w, h } = framePos(cfg, "down", 0);
  const rowY = src.height + GAP;
  const out = Object.assign(document.createElement("canvas"), {
    width: Math.max(src.width, SIT_DIRS.length * (w + GAP)),
    height: rowY + h + GAP,
  });
  const c = out.getContext("2d");
  c.imageSmoothingEnabled = false;
  c.drawImage(src, 0, 0);
  SIT_DIRS.forEach((dir, i) => c.drawImage(sitFrame(src, framePos(cfg, dir, 0), dir), i * (w + GAP), rowY));
  return { canvas: out, row: { y: rowY, w, h, step: w + GAP } };
}

// where the sitting frame facing `dir` is, in the same shape as framePos
export const sitFramePos = (row, dir) => ({ x: SIT_DIRS.indexOf(dir) * row.step, y: row.y, w: row.w, h: row.h });
