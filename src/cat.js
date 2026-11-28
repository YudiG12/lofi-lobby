// Cat NPC: 4-direction procedural pixel-art sprite that roams the walkable town in sync with the
// room clock, sits and blinks during pauses, and eats a fish snack with an animated tail when fed.
// Configured as a list (`CATS`) so extra cats and coat patterns can be added with one entry each.
import * as THREE from "three";

export const CAT_NEAR = 4; // how close you must be to feed it
export const CAT_SIT_MS = 6000;
export const CAT_RIDE_MS = 18000; // how long a cat stays on a player's head (matches worker/index.js)

export const CATS = [
  { id: "black", palette: "black", seed: 101, speed: 2.6 },
  { id: "orange", palette: "orange", seed: 211, speed: 2.5 },
  { id: "calico", palette: "calico", seed: 307, speed: 2.4 },
  { id: "tuxedo", palette: "tuxedo", seed: 409, speed: 2.7 },
  { id: "siamese", palette: "siamese", seed: 503, speed: 2.5 },
];

export const CAT_PALETTES = {
  // Charcoal-slate tones keep a black cat readable against night shadows without losing its coat.
  black: {
    light: "#484d64",
    base: "#2c2f3e",
    dark: "#1b1d28",
    darker: "#12131c",
    outline: "#0b0c12",
    earIn: "#634b58",
    eye: "#ffd452",
    pupil: "#14141c",
    shine: "#ffffff",
    nose: "#85626d",
    fish: "#7eb6d9",
    fishFin: "#4f84a8",
  },
  orange: {
    light: "#f4aa52",
    base: "#de8232",
    dark: "#b55d1c",
    darker: "#863f12",
    outline: "#1b130e",
    earIn: "#e38c90",
    eye: "#46c26b",
    pupil: "#141c14",
    shine: "#ffffff",
    nose: "#d67a7e",
    fish: "#7eb6d9",
    fishFin: "#4f84a8",
    pattern: "tabby",
    stripe: "#9e4710",
    tailTip: "#9e4710",
  },
  calico: {
    light: "#f8f4eb",
    base: "#e7dfd1",
    dark: "#c7bcab",
    darker: "#9e9282",
    outline: "#1a1718",
    earIn: "#e29599",
    eye: "#f2b830",
    pupil: "#14141c",
    shine: "#ffffff",
    nose: "#d98b90",
    fish: "#7eb6d9",
    fishFin: "#4f84a8",
    pattern: "calico",
    patchA: "#df7e2c",
    patchB: "#2c2f3e",
    tailBase: "#2c2f3e",
    tailTip: "#df7e2c",
  },
  tuxedo: {
    light: "#484d64",
    base: "#2c2f3e",
    dark: "#1b1d28",
    darker: "#12131c",
    outline: "#0b0c12",
    earIn: "#8b6372",
    eye: "#a8e05f",
    pupil: "#141814",
    shine: "#ffffff",
    nose: "#d98a94",
    fish: "#7eb6d9",
    fishFin: "#4f84a8",
    pattern: "tuxedo",
    patchA: "#f4f2ec",
    tailTip: "#f4f2ec",
  },
  siamese: {
    light: "#f6eee0",
    base: "#e4d4be",
    dark: "#c2ae95",
    darker: "#9e8970",
    outline: "#1c1512",
    earIn: "#85675a",
    eye: "#59b8ff",
    pupil: "#121d2b",
    shine: "#ffffff",
    nose: "#4b362b",
    fish: "#7eb6d9",
    fishFin: "#4f84a8",
    pattern: "siamese",
    patchA: "#4b362b",
    patchB: "#33231b",
    tailBase: "#4b362b",
    tailTip: "#33231b",
  },
};

export const PHRASES = [
  "Miau. Isso era salmão ou projeto sem prazo? Comi mesmo assim.",
  "Obrigada pelo petisco. Agora finge que não me viu derrubar seu café.",
  "Aceito o suborno. Por cinco minutos não vou sentar no seu teclado.",
  "Nota 7 pelo peixinho. Teria sido 10 se viesse com sachê.",
  "Ronronando em produção. Se quebrar, a culpa é do humano.",
  "Dei uma chance pra sua oferenda. Aprovada pelo conselho felino.",
  "Mais rápido que o seu deploy de sexta-feira. Gostei.",
  "Tô de olho nesse código aí… mas o peixe tava bom.",
  "Comi. Agora preciso de três sonecas pra me recuperar desse esforço.",
  "Obrigado, humano. Você subiu uma posição no meu ranking de favoritos.",
  "Miau! Sabor 'feito às pressas antes da daily'. Surpreendentemente bom.",
  "Aceito pix em formato de atum também.",
  "Isso aqui resolveu meu humor melhor que qualquer refactor.",
  "Prometo não morder seu cabo USB pelos próximos dez minutos.",
  "Hmm, crocante. Só faltou a documentação dos ingredientes.",
  "LGTM: Lanchinho Gostoso, Tudo Certo, Miau.",
  "Valeu! Vou até balançar o rabo pra parecer agradecido.",
  "Esse petisco passou no meu code review. Pode commitar outro.",
  "Tava precisando de energia pra encarar o nada às três da manhã.",
  "Você tem potencial como mordomo. Continue trazendo peixe.",
  "Comida grátis sempre escala bem no meu roadmap.",
  "Miau. Fica tranquilo que não contei pra capivara.",
  "Bom lanche. Pena que veio sem ticket de prioridade alta.",
  "Zero bugs nesse peixinho. Aprovado em homologação e no estômago.",
  "Agora vou dar uma volta pela vila como se pagasse aluguel.",
];

// Said when the cat claims a player's head.
export const RIDE_PHRASES = [
  "Essa cabeça agora é minha. Pode continuar andando, motorista.",
  "Miau. Seu boné era quentinho demais pra ignorar.",
  "Não se mexa muito. Estou tentando cochilar aqui em cima.",
  "Upgrade de vista concluído. Obrigada pela carona.",
  "Fica tranquilo, eu só vou ficar aqui uns minutinhos. Ou horas.",
  "Cabeça confortável, nota 8. Faltou aquecimento no assento.",
  "Daqui de cima dá pra julgar todo mundo melhor.",
  "Você foi escolhido. Não pergunte por quê. Gatos não explicam.",
  "Pra onde vamos? Tanto faz, desde que tenha sachê.",
  "Shh. Finge que é um chapéu novo. Combina com você.",
];

// Sprite sheet layout: 4 columns x 10 rows, 24x24 logical pixels drawn at 2x (48x48 per cell):
//   row 0: walk down   (4 steps)
//   row 1: walk up     (4 steps)
//   row 2: walk left   (4 steps)
//   row 3: walk right  (4 steps, mirrored from left)
//   row 4: sit         (0-1 eyes open + tail sway, 2-3 blink + tail sway)
//   row 5: eat         (0-3 chewing fish snack + wagging tail)
//   row 6..9: perch    (down, up, left, right on a player's head; 0-1 open + tail, 2-3 blink + tail)
const W = 24;
const H = 24;
const P = 2;
const COLS = 4;
const ROWS = 10;
const DIR_ROW = { down: 0, up: 1, left: 2, right: 3 };
const PERCH_ROW = { down: 6, up: 7, left: 8, right: 9 };

function drawFrontHead(put, C, hx, hy, opts = {}) {
  const { back = false, eyes = "open", happy = false } = opts;
  // Fixed pointy ears
  for (const ex of [hx, hx + 7]) {
    put(ex + 1, hy - 3, C.light);
    put(ex, hy - 2, C.base);
    put(ex + 1, hy - 2, back ? C.base : C.earIn);
    put(ex + 2, hy - 2, C.base);
    put(ex, hy - 1, C.base);
    put(ex + 1, hy - 1, back ? C.dark : C.earIn);
    put(ex + 2, hy - 1, C.base);
  }
  // Rounded head block (10x7)
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 10; x++) {
      const corner = (y === 0 && (x === 0 || x === 9)) || (y === 6 && (x === 0 || x === 9));
      if (corner) continue;
      const col = y === 0 ? C.light : y >= 5 ? C.dark : C.base;
      put(hx + x, hy + y, col);
    }
  }
  if (back) return;
  if (eyes === "closed") {
    for (const ex of [hx + 2, hx + 6]) {
      put(ex, hy + 3, happy ? C.eye : C.darker);
      put(ex + 1, hy + 3, happy ? C.eye : C.darker);
      if (happy) put(ex + (ex === hx + 2 ? 0 : 1), hy + 4, C.dark);
    }
  } else {
    // Left eye (x+2..x+3) & right eye (x+6..x+7), 2x2 golden with glint + slit pupil
    put(hx + 2, hy + 3, C.eye);
    put(hx + 3, hy + 3, C.shine);
    put(hx + 2, hy + 4, C.eye);
    put(hx + 3, hy + 4, C.pupil);
    put(hx + 6, hy + 3, C.shine);
    put(hx + 7, hy + 3, C.eye);
    put(hx + 6, hy + 4, C.pupil);
    put(hx + 7, hy + 4, C.eye);
  }
  put(hx + 4, hy + 5, C.nose);
  put(hx + 5, hy + 5, C.nose);
}

function drawSideHead(put, C, hx, hy, opts = {}) {
  const { eyes = "open" } = opts;
  // Fixed pointy ears on top-back of side head
  put(hx + 2, hy - 3, C.light);
  put(hx + 2, hy - 2, C.base);
  put(hx + 3, hy - 2, C.earIn);
  put(hx + 5, hy - 3, C.light);
  put(hx + 5, hy - 2, C.dark);
  put(hx + 6, hy - 2, C.base);
  // 8x7 head facing left
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 8; x++) {
      const corner = (y === 0 && (x === 0 || x === 7)) || (y === 6 && x === 0) || (y < 2 && x === 0);
      if (corner) continue;
      const col = y === 0 ? C.light : y >= 5 ? C.dark : C.base;
      put(hx + x, hy + y, col);
    }
  }
  // Golden eye + glint + tiny muzzle nose (or closed eyelid during blink)
  if (eyes === "closed") {
    put(hx + 2, hy + 3, C.darker);
    put(hx + 3, hy + 3, C.darker);
  } else {
    put(hx + 2, hy + 2, C.shine);
    put(hx + 3, hy + 2, C.eye);
    put(hx + 2, hy + 3, C.eye);
    put(hx + 3, hy + 3, C.pupil);
  }
  put(hx, hy + 4, C.nose);
}

function drawTail(put, C, pts) {
  pts.forEach(([x, y], i) => {
    const last = i === pts.length - 1;
    const col = last && C.tailTip
      ? C.tailTip
      : C.pattern === "tabby" && i % 2 === 1
        ? C.stripe
        : C.tailBase
          ? C.tailBase
          : last
            ? C.light
            : i < 2
              ? C.dark
              : C.base;
    put(x, y, col);
  });
}

// Applies coat markings strictly to fur pixels before mirroring right-facing rows or adding the outline.
function applyCoatPattern(grid, row, C) {
  if (!C.pattern) return;
  const isFur = (col) => col === C.light || col === C.base || col === C.dark || col === C.darker;
  const isSide = row === 2 || row === 3 || row === 8 || row === 9;
  const isBack = row === 1 || row === 7;
  const isPerch = row >= 6;
  const hy = isPerch ? 9 : 7;
  const hx = row === 6 || isSide ? 4 : 7;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isFur(grid[y][x])) continue;
      if (C.pattern === "tabby") {
        const headStripe = y <= hy + 2 && x === hx + (isSide ? 4 : 4);
        const cheekStripe = !isSide && !isBack && y === hy + 4 && (x === hx || x === hx + 9);
        const bodyStripe = y >= hy + 6 && y <= 18 && (isSide ? x >= 9 && x <= 17 && x % 3 === 1 : (x + y) % 3 === 0);
        if (headStripe || cheekStripe || bodyStripe) grid[y][x] = C.stripe;
      } else if (C.pattern === "calico") {
        const orangePatch = isSide ? x >= hx + 3 && x <= hx + 7 && y <= hy + 5 : x <= hx + 3 && y <= hy + 8;
        const blackPatch = isSide
          ? x >= 14 && y >= 12 && y <= 19
          : (x >= hx + 6 && y <= hy + 3) || (x >= hx + 6 && y >= 15 && y <= 20);
        if (orangePatch) grid[y][x] = C.patchA;
        else if (blackPatch) grid[y][x] = C.patchB;
      } else if (C.pattern === "tuxedo") {
        const paw = y >= 20;
        const chest = !isSide && !isBack && x >= hx + 3 && x <= hx + 6 && y >= hy + 7 && y <= 19;
        const muzzle = isSide
          ? x <= hx + 2 && y >= hy + 4 && y <= hy + 6
          : !isBack && x >= hx + 3 && x <= hx + 6 && y >= hy + 5 && y <= hy + 6;
        if (paw || chest || muzzle) grid[y][x] = C.patchA;
      } else if (C.pattern === "siamese") {
        const ear = y < hy;
        const mask = isSide
          ? x <= hx + 4 && y >= hy + 2 && y <= hy + 6
          : !isBack && x >= hx + 2 && x <= hx + 7 && y >= hy + 2 && y <= hy + 6;
        if (ear || mask) grid[y][x] = C.patchA;
        else if (y >= 20) grid[y][x] = C.patchB;
      }
    }
  }
}

function buildFrameGrid(row, col, C) {
  const grid = Array.from({ length: H }, () => Array(W).fill(null));
  const put = (x, y, c) => {
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = c;
  };
  const rect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, c);
  };
  const bob = row <= 3 && col % 2 ? -1 : 0;

  if (row === 0 || row === 1) {
    // Walk down (front) or walk up (back)
    const back = row === 1;
    const leftLift = col === 1 ? -1 : 0;
    const rightLift = col === 3 ? -1 : 0;
    if (!back) {
      // Tail peeks behind torso and swings left/right
      const frontTails = [
        [[15, 15], [16, 14], [17, 13], [17, 12], [18, 11]],
        [[15, 14], [16, 13], [16, 12], [17, 11]],
        [[8, 15], [7, 14], [6, 13], [6, 12], [5, 11]],
        [[8, 14], [7, 13], [7, 12], [6, 11]],
      ];
      drawTail(put, C, frontTails[col]);
    }
    // Compact torso
    rect(8, 13 + bob, 8, 6, C.base);
    rect(9, 13 + bob, 6, 1, C.light);
    rect(8, 17 + bob, 8, 2, C.dark);
    if (!back) rect(10, 14 + bob, 4, 2, C.light); // chest highlight
    // Paws alternating walk stride
    rect(9, 19 + leftLift, 2, 3, C.dark);
    rect(9, 21 + leftLift, 2, 1, C.light);
    rect(13, 19 + rightLift, 2, 3, C.dark);
    rect(13, 21 + rightLift, 2, 1, C.light);
    drawFrontHead(put, C, 7, 7 + bob, { back });
    if (back) {
      // Raised tail clearly wagging side-to-side behind the back
      const backTails = [
        [[11, 16], [10, 15], [9, 14], [9, 12], [8, 11], [8, 10]],
        [[11, 16], [11, 15], [10, 14], [10, 12], [10, 11], [10, 10]],
        [[12, 16], [13, 15], [14, 14], [14, 12], [15, 11], [15, 10]],
        [[12, 16], [12, 15], [13, 14], [13, 12], [13, 11], [13, 10]],
      ];
      drawTail(put, C, backTails[col]);
    }
  } else if (row === 2 || row === 3) {
    // Walk left (row 3 mirrors horizontally into walk right)
    const sideTails = [
      [[18, 13 + bob], [19, 12 + bob], [20, 11 + bob], [20, 10 + bob], [21, 9 + bob], [20, 8 + bob]],
      [[18, 13 + bob], [19, 12 + bob], [19, 10 + bob], [19, 9 + bob], [18, 8 + bob], [17, 7 + bob]],
      [[18, 13 + bob], [19, 13 + bob], [20, 12 + bob], [21, 11 + bob], [21, 10 + bob], [22, 9 + bob]],
      [[18, 13 + bob], [19, 12 + bob], [20, 11 + bob], [21, 11 + bob], [22, 10 + bob], [21, 9 + bob]],
    ];
    drawTail(put, C, sideTails[col]);
    // Sleek cat body
    rect(8, 12 + bob, 10, 5, C.base);
    rect(9, 12 + bob, 8, 1, C.light);
    rect(9, 16 + bob, 8, 1, C.dark);
    // 4-step quadruped gait
    const strides = [
      [[8, 17, 5, C.dark], [11, 17, 4, C.darker], [15, 17, 5, C.dark], [17, 17, 4, C.darker]],
      [[9, 17, 4, C.dark], [11, 16, 4, C.darker], [15, 16, 4, C.dark], [17, 17, 4, C.darker]],
      [[9, 17, 4, C.darker], [11, 17, 5, C.dark], [14, 17, 4, C.darker], [17, 17, 5, C.dark]],
      [[8, 16, 4, C.darker], [10, 17, 4, C.dark], [15, 17, 4, C.darker], [16, 16, 4, C.dark]],
    ];
    for (const [lx, ly, lh, lc] of strides[col]) {
      rect(lx, ly, 2, lh, lc);
      put(lx, ly + lh - 1, C.darker);
    }
    drawSideHead(put, C, 4, 7 + bob);
  } else if (row === 6) {
    // Perch down: cosy loaf facing the camera, paws tucked in, tail curling down one side.
    const perchTails = [
      [[17, 20], [18, 19], [19, 18], [20, 17], [20, 16], [19, 15]],
      [[17, 20], [18, 20], [19, 20], [20, 19], [21, 18], [21, 17]],
    ];
    drawTail(put, C, perchTails[col % 2]);
    for (let y = 15; y < 22; y++) {
      for (let x = 5; x < 19; x++) {
        const corner =
          (y === 15 && (x < 7 || x > 16)) ||
          (y === 16 && (x === 5 || x === 18)) ||
          (y === 21 && (x === 5 || x === 18));
        if (corner) continue;
        put(x, y, y <= 16 ? C.light : y >= 20 ? C.dark : C.base);
      }
    }
    rect(7, 21, 2, 1, C.light);
    rect(11, 21, 2, 1, C.light);
    drawFrontHead(put, C, 4, 9, { eyes: col >= 2 ? "closed" : "open" });
  } else if (row === 7) {
    // Perch up: cosy loaf facing away from the camera, wagging tail curling up the back.
    for (let y = 14; y < 22; y++) {
      for (let x = 6; x < 18; x++) {
        const corner =
          (y === 14 && (x < 8 || x > 15)) ||
          (y === 15 && (x === 6 || x === 17)) ||
          (y === 21 && (x === 6 || x === 17));
        if (corner) continue;
        put(x, y, y <= 15 ? C.light : y >= 20 ? C.dark : C.base);
      }
    }
    drawFrontHead(put, C, 7, 9, { back: true });
    const backPerchTails = [
      [[11, 19], [10, 18], [9, 17], [9, 15], [8, 14]],
      [[12, 19], [13, 18], [14, 17], [14, 15], [15, 14]],
    ];
    drawTail(put, C, backPerchTails[col % 2]);
  } else if (row === 8 || row === 9) {
    // Perch left (row 9 mirrors horizontally into perch right): side-profile loaf on head.
    const sidePerchTails = [
      [[18, 19], [19, 18], [20, 17], [20, 15], [19, 14]],
      [[18, 19], [20, 19], [21, 18], [21, 16], [22, 15]],
    ];
    drawTail(put, C, sidePerchTails[col % 2]);
    for (let y = 15; y < 22; y++) {
      for (let x = 7; x < 19; x++) {
        const corner =
          (y === 15 && (x < 9 || x > 16)) ||
          (y === 16 && (x === 7 || x === 18)) ||
          (y === 21 && (x === 7 || x === 18));
        if (corner) continue;
        put(x, y, y <= 16 ? C.light : y >= 20 ? C.dark : C.base);
      }
    }
    rect(7, 20, 3, 2, C.dark); // tucked front paw
    rect(7, 21, 2, 1, C.light);
    drawSideHead(put, C, 4, 9, { eyes: col >= 2 ? "closed" : "open" });
  } else {
    // Row 4: sit (blink + tail wag) | Row 5: eat (chew fish + happy eyes + lively tail wag)
    const eat = row === 5;
    const chewBob = eat && col % 2 ? 1 : 0;
    const tailSwings = [
      [[16, 20], [17, 20], [18, 19], [19, 18], [19, 17], [18, 16]],
      [[16, 19], [17, 19], [19, 18], [20, 17], [20, 15], [19, 14]],
      [[16, 20], [17, 20], [18, 19], [19, 18], [20, 18], [20, 17]],
      [[16, 19], [18, 18], [19, 17], [20, 16], [20, 14], [21, 14]],
    ];
    drawTail(put, C, tailSwings[col % 4]);
    // Seated haunches + chest + paws together
    rect(7, 14, 9, 7, C.base);
    rect(8, 13, 7, 2, C.light);
    rect(14, 16, 3, 5, C.dark);
    rect(9, 14, 5, 7, C.base);
    rect(10, 14, 3, 2, C.light);
    rect(9, 20, 2, 2, C.light);
    rect(12, 20, 2, 2, C.light);
    put(11, 18, C.darker);
    put(11, 19, C.darker);
    put(11, 20, C.darker);
    put(11, 21, C.darker);
    const closed = eat ? col % 2 === 1 : col >= 2;
    drawFrontHead(put, C, 7, 7 + chewBob, {
      eyes: closed ? "closed" : "open",
      happy: eat,
    });
    if (eat) {
      // Little fish snack resting right in front of the cat's paws
      rect(10, 21, 3, 2, C.fish);
      put(9, 21, C.fishFin);
      put(13, 21, C.fishFin);
      put(13, 22, C.fishFin);
      put(10, 21, C.shine);
    }
  }

  applyCoatPattern(grid, row, C);
  if (row === 3 || row === 9) {
    for (let y = 0; y < H; y++) grid[y].reverse();
  }

  // Crisp 1px pixel-art outline around every non-empty pixel
  const out = grid.map((r) => r.slice());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!grid[y][x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => grid[y + ay]?.[x + ax])) {
        out[y][x] = C.outline;
      }
    }
  }
  return out;
}

export function createCat(paletteName = "black") {
  const pal = CAT_PALETTES[paletteName] || CAT_PALETTES.black;
  const cv = Object.assign(document.createElement("canvas"), {
    width: W * P * COLS,
    height: H * P * ROWS,
  });
  const ctx = cv.getContext("2d");
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const out = buildFrameGrid(row, col, pal);
      const x0 = col * W * P;
      const y0 = row * H * P;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (out[y][x]) {
            ctx.fillStyle = out[y][x];
            ctx.fillRect(x0 + x * P, y0 + y * P, P, P);
          }
        }
      }
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / COLS, 1 / ROWS);

  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.45, 0); // feet near origin, matching trainers and capybara
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
  );
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    map: tex,
    alphaTest: 0.5,
    depthPacking: THREE.RGBADepthPacking,
  });
  mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial({
    map: tex,
    alphaTest: 0.5,
  });
  mesh.castShadow = true;
  mesh.scale.set(3.5, 3.5, 1);

  let pose = "sit"; // "walk" | "sit" | "eat" | "perch"
  let dir = "down"; // "down" | "up" | "left" | "right"
  const setCell = (col, row) => {
    tex.offset.set(col / COLS, (ROWS - 1 - row) / ROWS);
  };
  setCell(0, 4);

  return {
    mesh,
    setPose(p) {
      pose = p;
    },
    setDir(d) {
      if (d in DIR_ROW) dir = d;
    },
    update(t) {
      if (pose === "walk") {
        setCell(Math.floor(t / 160) % 4, DIR_ROW[dir]);
      } else if (pose === "eat") {
        setCell(Math.floor(t / 170) % 4, 5);
      } else if (pose === "perch") {
        const row = PERCH_ROW[dir] ?? 6;
        const tail = Math.floor(t / 520) % 2;
        const blink = dir !== "up" && t % 3800 < 160 ? 2 : 0;
        setCell(tail + blink, row);
      } else {
        const tail = Math.floor(t / 520) % 2;
        const blink = t % 4200 < 160 ? 2 : 0;
        setCell(tail + blink, 4);
      }
    },
    dispose() {
      geo.dispose();
      mesh.material.dispose();
      mesh.customDepthMaterial.dispose();
      mesh.customDistanceMaterial.dispose();
      tex.dispose();
    },
  };
}
