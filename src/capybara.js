// Capybara: a pixel-art billboard in the middle of town, sitting by day and asleep at night. Walk up and press E to feed it;
// it thanks you, ironically, in a speech bubble (only you see it: nothing goes to the server).
import * as THREE from "three";

export const CAPY_NEAR = 4; // how close you must be to feed it
export const CAPY_RADIUS = 1.5; // nobody walks through it

export const PHRASES = [
  "Nossa, um capim. Que gesto inédito. Estou comovida.",
  "Obrigada pela migalha. Vou guardar no meu cofrinho de gratidão.",
  "Uau, comida. Você realmente se superou hoje.",
  "Agradeço. Vou colocar isso no meu currículo de sobrevivente.",
  "Que generosidade. Acho que vou chorar. Não vou, mas acho.",
  "Hmm, sabor 'feito com pressa'. Meu favorito.",
  "Obrigada! Era exatamente o mínimo que eu esperava.",
  "Muito bom. Nota 6. Mas a intenção vale 7.",
  "Gratidão eterna. Ou pelo menos até a próxima música.",
  "Que honra ser alimentada por alguém tão ocupado com lo-fi.",
  "Obrigada. Vou contar pra todo mundo da lagoa. Ninguém vai ligar.",
  "Ah, você lembrou que eu existo. Que surpresa agradável.",
  "Delicioso. Quase tão bom quanto ficar parada aqui pra sempre.",
  "Obrigada, de verdade. Meus 3 neurônios agradecem em coro.",
  "Que banquete. Vou precisar de uma soneca de 14 horas.",
  "Ótimo. Agora só falta um spa, um cafuné e um aumento.",
  "Obrigada! Prometo não fazer absolutamente nada com essa energia.",
  "Você é tipo um herói. Um herói bem pequenininho.",
  "Que atitude nobre. Vou mencionar você no meu discurso do Oscar.",
  "Valeu. Aceito pix também, só pra constar.",
];

// 5 frames side by side, 32x24 logical pixels each, drawn at 2x like the trainers:
// 0 sitting, 1 sitting + blink, 2-3 sitting + chewing (head bobs, mouth opens), 4 asleep (lying down)
const W = 32,
  H = 24,
  P = 2,
  FRAMES = 5;
export const SLEEP_FRAME = 4;
const C = {
  light: "#c08a55",
  base: "#9c6a3c",
  dark: "#74492a",
  darker: "#55331d",
  snout: "#5a3a26",
  outline: "#1b1b24",
  eye: "#1b1b24",
  shine: "#f4f4f4",
  mouth: "#3a2218",
};

function drawFrame(c, f) {
  const grid = Array.from({ length: H }, () => Array(W).fill(null));
  const fill = (x, y, col) => x >= 0 && x < W && y >= 0 && y < H && (grid[y][x] = col);
  // a tilted ellipse, lighter on top and darker underneath
  const blob = (cx, cy, rx, ry, tilt) => {
    const cs = Math.cos(tilt),
      sn = Math.sin(tilt);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = ((x - cx) * cs + (y - cy) * sn) / rx,
          v = (-(x - cx) * sn + (y - cy) * cs) / ry;
        if (u * u + v * v <= 1) fill(x, y, v < -0.45 ? C.light : v > 0.5 ? C.dark : C.base);
      }
  };
  // blocky head facing left, its top-left corner at (hx, hy)
  const head = (hx, hy, eyes, chew) => {
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 11; x++) {
        const corner = (x < 2 && (y < 2 || y > 7)) || (x > 9 && y < 1);
        if (!corner) fill(hx + x, hy + y, y < 3 ? C.light : y > 7 ? C.dark : C.base);
      }
    for (let y = 3; y < 7; y++) fill(hx, hy + y, C.snout), fill(hx + 1, hy + y, C.snout);
    fill(hx, hy + 4, C.outline); // nostril
    fill(hx + 9, hy - 2, C.dark), fill(hx + 10, hy - 2, C.dark), fill(hx + 9, hy - 1, C.darker), fill(hx + 10, hy - 1, C.dark); // ear
    if (eyes === "closed") fill(hx + 5, hy + 3, C.eye), fill(hx + 6, hy + 3, C.eye);
    else fill(hx + 5, hy + 2, C.eye), fill(hx + 6, hy + 2, C.eye), fill(hx + 5, hy + 3, C.eye), fill(hx + 6, hy + 3, C.shine);
    fill(hx + 1, hy + 8, C.mouth), fill(hx + 2, hy + 8, C.mouth);
    if (chew) fill(hx + 1, hy + 9, C.mouth), fill(hx - 1, hy + 9, "#7fbf4d"), fill(hx - 2, hy + 10, "#5e9a35");
  };
  if (f === SLEEP_FRAME) {
    // lying flat, legs tucked in, head resting on the ground with the eyes shut
    blob(18, 17.5, 12, 4.8, 0);
    head(3, 12, "closed", false);
  } else {
    const bob = f === 3 ? 1 : 0;
    // sitting: haunches on the ground at the back, chest raised, front legs straight
    blob(20, 15, 9.5, 6.2, 0.55);
    blob(24, 18, 5.5, 3.6, 0); // haunch
    for (const lx of [11, 14]) for (let y = 15; y < 22; y++) fill(lx, y, y > 19 ? C.darker : C.dark), fill(lx + 1, y, C.dark);
    for (let x = 22; x < 28; x++) fill(x, 21, C.darker); // back foot
    head(4, 3 + bob, f === 1 ? "closed" : "open", f >= 2);
  }
  // outline: every empty pixel touching the creature
  const out = grid.map((row) => row.slice());
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!grid[y][x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => grid[y + b]?.[x + a]))
        out[y][x] = C.outline;
  const x0 = f * W * P;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (out[y][x]) {
        c.fillStyle = out[y][x];
        c.fillRect(x0 + x * P, y * P, P, P);
      }
}

export function createCapybara() {
  const cv = Object.assign(document.createElement("canvas"), { width: W * P * FRAMES, height: H * P });
  const c = cv.getContext("2d");
  for (let f = 0; f < FRAMES; f++) drawFrame(c, f);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / FRAMES, 1);
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.45, 0); // feet near the origin, like the trainers
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  mesh.castShadow = true;
  mesh.scale.set(5, 3.75, 1); // same pixel size as a trainer (5 units per 32px)

  let chewUntil = 0,
    last = -1;
  const setFrame = (f) => (tex.offset.x = f / FRAMES);
  let asleep = false;
  return {
    mesh,
    // a new phrase each time, never the same one twice in a row
    feed(now) {
      chewUntil = now + 2200;
      let i;
      do i = Math.floor(Math.random() * PHRASES.length);
      while (i === last);
      last = i;
      return PHRASES[i];
    },
    // asleep at night: lies down (feeding wakes it up just long enough to chew and complain)
    setAsleep(v) {
      asleep = v;
    },
    isAsleep: (now) => asleep && now >= chewUntil,
    update(now) {
      if (now < chewUntil) setFrame(2 + (Math.floor(now / 180) % 2));
      else if (asleep) setFrame(SLEEP_FRAME);
      else setFrame(now % 4000 < 150 ? 1 : 0); // sitting, blinks every 4 s
    },
  };
}
