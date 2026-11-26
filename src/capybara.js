// Capybara: a pixel-art billboard in the middle of town. Walk up and press E to feed it;
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

// 4 frames side by side, 32x24 logical pixels each, drawn at 2x like the trainers:
// 0 idle, 1 blink, 2-3 chewing (head bobs, mouth opens)
const W = 32,
  H = 24,
  P = 2,
  FRAMES = 4;
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
  const chew = f >= 2;
  const bob = f === 3 ? 1 : 0;
  // body: an ellipse, lighter on top and darker underneath
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x - 19) / 10.5,
        dy = (y - 14) / 6.5;
      if (dx * dx + dy * dy <= 1) fill(x, y, dy < -0.45 ? C.light : dy > 0.5 ? C.dark : C.base);
    }
  // legs (short and stubby)
  for (const lx of [10, 13, 23, 26])
    for (let y = 18; y < 22; y++) fill(lx, y, y > 19 ? C.darker : C.dark), fill(lx + 1, y, C.dark);
  // head: a blocky capybara head facing left, bobbing while chewing
  for (let y = 5; y < 15; y++)
    for (let x = 2; x < 14; x++) {
      const corner = (x < 4 && (y < 7 || y > 13)) || (x > 11 && y < 6);
      if (!corner) fill(x, y + bob, y < 8 ? C.light : y > 12 ? C.dark : C.base);
    }
  // snout tip and nostril
  for (let y = 8; y < 12; y++) fill(2, y + bob, C.snout), fill(3, y + bob, C.snout);
  fill(2, 9 + bob, C.outline);
  // ear
  fill(11, 3 + bob, C.dark), fill(12, 3 + bob, C.dark), fill(11, 4 + bob, C.darker), fill(12, 4 + bob, C.dark);
  // eye: blinks on frame 1
  if (f === 1) fill(7, 8 + bob, C.eye), fill(8, 8 + bob, C.eye);
  else fill(7, 7 + bob, C.eye), fill(8, 7 + bob, C.eye), fill(7, 8 + bob, C.eye), fill(8, 8 + bob, C.shine);
  // mouth: a line, open while chewing (with a blade of grass)
  fill(3, 13 + bob, C.mouth), fill(4, 13 + bob, C.mouth);
  if (chew) fill(3, 14 + bob, C.mouth), fill(1, 14 + bob, "#7fbf4d"), fill(0, 15 + bob, "#5e9a35");
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
    update(now) {
      if (now < chewUntil) setFrame(2 + (Math.floor(now / 180) % 2));
      else setFrame(now % 4000 < 150 ? 1 : 0); // blinks every 4 s
    },
  };
}
