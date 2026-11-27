// A trainer's look on top of the cap colour: hair, top, bottom and skin colours and two accessories
// (headphones, glasses). Everything is done on the trainer's own sheet in code, after its background
// is cleared and its cap recoloured, so there is nothing new to load and every frame gets it: walking,
// running and the sitting row drawn from them (src/ground-sit.js).
//
// The sheets share tones between parts: the male's hair, jacket and eyes are the same two greys, the
// female's hair, top and eyes the same two blues. So a part is found by where it is, not only by its
// colour, frame by frame:
//  - eyes: a hair tone inside the face (within a pixel of the row's skin) beside an eye white, or with
//    skin on both sides. They are never painted, and glasses are drawn around them;
//  - hair: the rest of those tones, grouped into touching pieces; a piece that starts high enough on
//    the frame is hair (it reaches up to the cap), one that starts lower is the top (jacket, shirt).
//  - bottom and skin: the jeans, the skirt and the skin have tones of their own.

// Each choice is a light and a dark tone; -1 (or anything not on the list) keeps the sheet's own.
// The server keeps the same counts (worker/index.js).
export const HAIRS = [
  { name: "black", swatch: "#3a3d46", tones: [[70, 74, 88], [40, 42, 52]] },
  { name: "brown", swatch: "#8a5a3a", tones: [[150, 98, 64], [98, 60, 40]] },
  { name: "blonde", swatch: "#f0d070", tones: [[248, 216, 120], [200, 160, 72]] },
  { name: "ginger", swatch: "#e07040", tones: [[232, 120, 64], [168, 72, 40]] },
  { name: "pink", swatch: "#f0a0c8", tones: [[248, 168, 208], [200, 104, 160]] },
  { name: "blue", swatch: "#5888d8", tones: [[96, 144, 224], [56, 88, 160]] },
  { name: "silver", swatch: "#c8c8d8", tones: [[216, 216, 232], [152, 152, 176]] },
];
export const TOPS = [
  { name: "black", swatch: "#3c4048", tones: [[72, 78, 90], [44, 48, 56]] },
  { name: "navy", swatch: "#384c80", tones: [[64, 88, 144], [40, 52, 96]] },
  { name: "red", swatch: "#c84848", tones: [[208, 80, 72], [144, 48, 48]] },
  { name: "green", swatch: "#48985a", tones: [[88, 168, 96], [48, 112, 64]] },
  { name: "purple", swatch: "#8058b0", tones: [[144, 104, 192], [96, 64, 136]] },
  { name: "mustard", swatch: "#d0a040", tones: [[224, 176, 72], [168, 120, 40]] },
  { name: "white", swatch: "#e0e0ec", tones: [[232, 232, 244], [176, 176, 200]] },
];
export const BOTTOMS = [
  { name: "denim", swatch: "#6088d0", tones: [[96, 136, 208], [64, 96, 160]] },
  { name: "black", swatch: "#3c4048", tones: [[72, 78, 90], [44, 48, 56]] },
  { name: "khaki", swatch: "#c8b080", tones: [[208, 184, 136], [160, 136, 96]] },
  { name: "red", swatch: "#d05848", tones: [[240, 104, 72], [192, 56, 56]] },
  { name: "pink", swatch: "#e890c0", tones: [[232, 144, 192], [192, 104, 152]] },
  { name: "green", swatch: "#58a068", tones: [[104, 176, 112], [64, 120, 80]] },
];
// skin: light and shade of the face, neck and hands (the sheets' own is the second lightest)
export const SKINS = [
  { name: "light", swatch: "#fce0cc", tones: [[252, 224, 204], [224, 180, 150]] },
  { name: "tan", swatch: "#e0ac80", tones: [[224, 172, 128], [184, 128, 88]] },
  { name: "olive", swatch: "#d0a878", tones: [[208, 168, 120], [168, 124, 80]] },
  { name: "brown", swatch: "#b07850", tones: [[176, 120, 80], [136, 88, 56]] },
  { name: "dark brown", swatch: "#805438", tones: [[128, 84, 56], [96, 60, 40]] },
  { name: "deep", swatch: "#60402c", tones: [[96, 64, 44], [72, 46, 32]] },
];
// worn on top of the sheet; `acc` is a set of these bits
export const ACCESSORIES = [
  { name: "headphones", bit: 1 },
  { name: "glasses", bit: 2 },
];
const ACC_ALL = ACCESSORIES.reduce((a, x) => a | x.bit, 0);

const pick = (n, list) => (Number.isInteger(n) && n >= 0 && n < list.length ? n : -1);
// a look from anywhere (storage, the server): every field checked, -1 = the sheet's own
export const lookOf = (l) => ({
  hair: pick(l?.hair, HAIRS),
  top: pick(l?.top, TOPS),
  bottom: pick(l?.bottom, BOTTOMS),
  skin: pick(l?.skin, SKINS),
  acc: Number.isInteger(l?.acc) ? l.acc & ACC_ALL : 0,
});
export const lookKey = (l) => `${l.hair},${l.top},${l.bottom},${l.skin},${l.acc}`;

// Each sheet's tones as "r,g,b". hair: [light, dark] (the top uses the same two); bottom: [light, dark]
// (the male's jeans have one); skin: [light, shade], only ever skin, so it is swapped by colour alone;
// hairStartsBy: how far below the top of the head a hair piece can start.
const SHEETS = {
  male: {
    hair: ["72,96,96", "56,64,64"],
    bottom: ["96,136,208"],
    skin: ["248,208,184", "216,160,120"],
    eyeWhite: ["168,160,200"],
    hairStartsBy: 12,
    eyesFromTop: 11, // eye row below the top of the head, for the back where no eye shows
  },
  female: {
    hair: ["56,96,136", "56,64,80"],
    bottom: ["240,104,72", "192,56,56"],
    skin: ["248,208,184", "216,160,120"],
    eyeWhite: ["168,160,200", "232,232,248"],
    hairStartsBy: 14,
    eyesFromTop: 12,
  },
};

const OUTLINE = [16, 16, 24];
const PHONES = [72, 192, 176]; // headphones: teal, so they read over a red cap, a white beanie and any hair
const PHONES_SHADE = [40, 128, 124];
const LENS = [200, 228, 248];

// Recolours hair, top, bottom and skin and draws the accessories on every frame in `frames`
// ({ x, y, w, h, dir }) of the sheet's pixels `d` (RGBA, `width` wide).
export function dressSheet(d, width, gender, look, frames) {
  const sheet = SHEETS[gender];
  if (!sheet) return;
  look = lookOf(look);
  if (look.hair < 0 && look.top < 0 && look.bottom < 0 && look.skin < 0 && !look.acc) return;
  for (const f of frames) applyToFrame(d, width, sheet, look, f);
  // the skin last: finding the eyes and placing the lenses go by the sheet's own skin
  const skin = SKINS[look.skin]?.tones;
  if (skin)
    for (const { x: fx, y: fy, w, h } of frames)
      for (let y = fy; y < fy + h; y++)
        for (let x = fx; x < fx + w; x++) {
          const i = (y * width + x) * 4;
          const k = sheet.skin.indexOf(`${d[i]},${d[i + 1]},${d[i + 2]}`);
          if (k >= 0 && d[i + 3] > 128) d.set(skin[k], i);
        }
}

function applyToFrame(d, width, sheet, look, { x: fx, y: fy, w, h, dir }) {
  const at = (x, y) => ((fy + y) * width + fx + x) * 4;
  const key = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? "" : `${d[at(x, y)]},${d[at(x, y) + 1]},${d[at(x, y) + 2]}`);
  const opaque = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[at(x, y) + 3] > 128;
  const isHairTone = (x, y) => opaque(x, y) && sheet.hair.includes(key(x, y));
  const isSkin = (x, y) => opaque(x, y) && sheet.skin.includes(key(x, y));
  const isWhite = (x, y) => opaque(x, y) && sheet.eyeWhite.includes(key(x, y));

  // the top of the head (the running frames sit a few rows higher than the walking ones)
  let headTop = -1;
  for (let y = 0; y < h && headTop < 0; y++) for (let x = 0; x < w; x++) if (opaque(x, y)) { headTop = y; break; }
  if (headTop < 0) return;
  // the skin's reach on each row (the face, the hands)
  const span = [];
  for (let y = 0; y < h; y++) {
    let a = w, b = -1;
    for (let x = 0; x < w; x++) if (isSkin(x, y)) (a = Math.min(a, x)), (b = x);
    span.push(b < 0 ? null : [a - 1, b + 1]);
  }
  // eyes: only on the face's rows (the hands and sleeves lower down have skin and whites too)
  const eye = new Set();
  for (let y = headTop + sheet.eyesFromTop - 2; y <= headTop + sheet.eyesFromTop + 2; y++)
    for (let x = 0; x < w; x++) {
      if (!isHairTone(x, y) || !span[y] || x < span[y][0] || x > span[y][1]) continue;
      const l = [x - 1, y], r = [x + 1, y];
      const besideWhite = isWhite(...l) || isWhite(...r);
      const inSkin = isSkin(...l) && isSkin(...r);
      const touchesHair = isHairTone(...l) || isHairTone(...r);
      if (inSkin || (besideWhite && !touchesHair)) eye.add(y * w + x);
    }

  // hair and top: pieces of the shared tones that touch each other (not across eyes)
  const part = new Map(); // pixel -> "hair" | "top"
  const seen = new Set();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen.has(i) || eye.has(i) || !isHairTone(x, y)) continue;
      const piece = [];
      const stack = [[x, y]];
      seen.add(i);
      while (stack.length) {
        const [px, py] = stack.pop();
        piece.push([px, py]);
        for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
          const ni = ny * w + nx;
          if (!seen.has(ni) && !eye.has(ni) && isHairTone(nx, ny)) seen.add(ni), stack.push([nx, ny]);
        }
      }
      const top = Math.min(...piece.map(([, py]) => py));
      const kind = top - headTop <= sheet.hairStartsBy ? "hair" : "top";
      for (const [px, py] of piece) part.set(py * w + px, kind);
    }

  const paint = [];
  const hair = HAIRS[look.hair]?.tones, topT = TOPS[look.top]?.tones, bottomT = BOTTOMS[look.bottom]?.tones;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue;
      const k = key(x, y);
      const kind = part.get(y * w + x);
      const shade = sheet.hair.indexOf(k); // 0 light, 1 dark
      if (kind === "hair" && hair) paint.push([x, y, hair[shade]]);
      else if (kind === "top" && topT) paint.push([x, y, topT[shade]]);
      else if (bottomT && sheet.bottom.includes(k)) paint.push([x, y, bottomT[sheet.bottom.indexOf(k)]]);
    }
  for (const [x, y, c] of paint) d.set(c, at(x, y));

  if (!look.acc) return;
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    d.set(c, at(x, y));
    d[at(x, y) + 3] = 255;
  };
  // the head's sides on the eye row
  const eyes = [...eye].map((i) => [i % w, Math.floor(i / w)]);
  const eyeRow = eyes.length ? Math.min(...eyes.map(([, y]) => y)) : headTop + sheet.eyesFromTop;
  // walking out from the middle of the head, so a hand raised beside it (running) isn't taken for it
  const mid = eyes.length ? Math.round(eyes.reduce((s, [x]) => s + x, 0) / eyes.length) : Math.round(w / 2);
  // and the narrowest of a few rows, since the hand can touch the head on one of them
  if (!opaque(mid, eyeRow)) return;
  let left = -1, right = w;
  for (let y = eyeRow - 2; y <= eyeRow; y++) {
    let l = mid, r = mid;
    while (opaque(l - 1, y)) l--;
    while (opaque(r + 1, y)) r++;
    left = Math.max(left, l);
    right = Math.min(right, r);
  }
  const side = dir === "left" || dir === "right";

  if (look.acc & 2 && eyes.length) {
    // glasses: a dark frame around each eye (its white included), a bridge between them, and from the
    // side an arm back to the ear. Skin inside a frame becomes a pale lens.
    const lenses = [];
    for (const [x, y] of [...eyes].sort((p, q) => p[0] - q[0])) {
      const last = lenses[lenses.length - 1];
      if (last && x - last.x1 <= 2) (last.x1 = Math.max(last.x1, x)), (last.y0 = Math.min(last.y0, y)), (last.y1 = Math.max(last.y1, y));
      else lenses.push({ x0: x, x1: x, y0: y, y1: y });
    }
    for (const l of lenses) {
      while (isWhite(l.x0 - 1, l.y0)) l.x0--;
      while (isWhite(l.x1 + 1, l.y0)) l.x1++;
      for (let y = l.y0 - 1; y <= l.y1 + 1; y++)
        for (let x = l.x0 - 1; x <= l.x1 + 1; x++) {
          const edge = y === l.y0 - 1 || y === l.y1 + 1 || x === l.x0 - 1 || x === l.x1 + 1;
          if (edge) put(x, y, OUTLINE);
          else if (isSkin(x, y)) put(x, y, LENS);
        }
    }
    const frameTop = Math.min(...lenses.map((l) => l.y0)) - 1;
    for (let i = 1; i < lenses.length; i++) for (let x = lenses[i - 1].x1 + 2; x < lenses[i].x0 - 1; x++) put(x, frameTop, OUTLINE);
    if (side) {
      const ear = Math.round((left + right) / 2);
      const [a, b] = dir === "left" ? [lenses[lenses.length - 1].x1 + 2, ear] : [ear, lenses[0].x0 - 2];
      for (let x = a; x <= b; x++) put(x, frameTop, OUTLINE);
    }
  }

  if (look.acc & 1) {
    // headphones: a cup over each ear and the band following the head's outline up and over it
    const cupTop = eyeRow - 2, cupBottom = eyeRow + 1;
    const cup = (x0, x1) => {
      for (let y = cupTop; y <= cupBottom; y++)
        for (let x = x0; x <= x1; x++) {
          const edge = y === cupTop || y === cupBottom || x === x0 || x === x1;
          put(x, y, edge ? OUTLINE : x === x0 + 1 ? PHONES : PHONES_SHADE);
        }
    };
    const firstOpaque = (y, from, step) => {
      for (let x = from; x >= 0 && x < w; x += step) if (opaque(x, y)) return x;
      return -1;
    };
    if (side) {
      // from the side: one cup on the ear and the band straight up over the head from it
      const m = Math.round((left + right) / 2) + (dir === "left" ? 1 : -1);
      for (let y = headTop - 1; y < cupTop; y++) {
        put(m, y, y === headTop - 1 ? OUTLINE : PHONES);
        put(m + 1, y, y === headTop - 1 ? OUTLINE : PHONES_SHADE);
      }
      cup(m - 1, m + 2);
    } else {
      // from the front or the back: the band over the top, down each side along the outline to a cup
      for (let y = headTop; y < cupTop; y++) {
        const l = firstOpaque(y, 0, 1), r = firstOpaque(y, w - 1, -1);
        if (l < 0) continue;
        put(l - 1, y, OUTLINE), put(l, y, PHONES);
        put(r + 1, y, OUTLINE), put(r, y, PHONES);
      }
      const l0 = firstOpaque(headTop, 0, 1), r0 = firstOpaque(headTop, w - 1, -1);
      for (let x = l0; x <= r0; x++) put(x, headTop - 1, OUTLINE), put(x, headTop, PHONES);
      cup(left - 2, left + 1);
      cup(right - 1, right + 2);
    }
  }
}
