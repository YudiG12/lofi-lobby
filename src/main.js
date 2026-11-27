import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { connectRadioToServer, receiveCommand } from "./radio.js";
import { setupSocial } from "./social.js";
import { createBoard, setupWall } from "./board.js";
import { createStones } from "./stones.js";
import { addSitFrames, sitFramePos } from "./ground-sit.js";
import { createCapybara, CAPY_NEAR, CAPY_RADIUS, PHRASES as CAPY_PHRASES } from "./capybara.js";
import { createOwl } from "./owl.js";
import { createLucario, LUCARIO_NEAR, LUCARIO_RADIUS } from "./lucario.js";
import { createFishing, createFishingGear, FISH_NEAR, FISH_LEAVE } from "./fishing.js";
import { createCat, CATS, CAT_NEAR, CAT_SIT_MS, CAT_RIDE_MS, PHRASES as CAT_PHRASES, RIDE_PHRASES as CAT_RIDE_PHRASES } from "./cat.js";
import { CAROUSEL, carouselSeat, createCarousel, inClearing, isCarouselSeat, onCarousel } from "./carousel.js";
import { WHEEL, wheelSeat, createFerrisWheel, inWheelClearing, isWheelSeat, onWheel } from "./ferris-wheel.js";
import { COASTER, coasterSeat, coasterCycle, coasterRiding, coasterBoardLeft, coasterBackIn, createCoaster, inCoasterClearing, isCoasterSeat, onCoaster } from "./roller-coaster.js";

// ---- Asset config (change here to use other files) ----
const TOWN = {
  fbx: "/assets/cidade/source/mdl_FBX_TwinLeafTown.fbx",
  texture: "/assets/cidade/textures/PNG_Twinleaf-Atlas.png",
};
// Character sprite sheet: a 4x4 block of frames in the top-left corner.
// Each frame is 32px with a 2px gap. Rows = directions, columns = steps.
// One sheet per gender. null = original trainer generated in pixel art;
// or the path of a sprite sheet with the same layout (4x4, 32px, 2px gap).
const SHEETS = {
  male: "/assets/personagens/male-character.png",
  female: "/assets/personagens/female-character.png",
};
let GENDER = "male";
try {
  GENDER = localStorage.getItem("gender") === "female" ? "female" : "male";
} catch {}
// Cap colours: the same 5 for every trainer. Each is a light, shade and dark tone that replaces
// the cap's own three (the male's red cap, the female's white beanie) on the head of every frame used.
const CAPS = [
  { name: "red", swatch: "#f06848", tones: [[240, 104, 72], [192, 56, 56], [120, 64, 64]] },
  { name: "blue", swatch: "#6098f0", tones: [[96, 152, 240], [56, 96, 192], [40, 56, 120]] },
  { name: "green", swatch: "#70c868", tones: [[112, 200, 104], [56, 144, 72], [40, 88, 56]] },
  { name: "pink", swatch: "#f8b8d8", tones: [[248, 184, 216], [224, 136, 184], [176, 96, 152]] },
  { name: "white", swatch: "#e8e8f8", tones: [[232, 232, 248], [200, 200, 216], [168, 160, 200]] },
];
// each sheet's own cap: which colour it already is, and its tones as "r,g,b" keys
const SHEET_CAP = { male: 0, female: 4 };
const capOf = (c) => (Number.isInteger(c) && c >= 0 && c < CAPS.length ? c : null);
// nothing chosen yet: each trainer keeps the cap its sheet was drawn with
let CAP = null;
try {
  CAP = capOf(Number(localStorage.getItem("cap") ?? NaN));
} catch {}
const myCap = () => CAP ?? SHEET_CAP[GENDER];
window.CAPS = CAPS; // the start screen draws its swatches from these
window.myCap = () => myCap();
// my trainer's front frame, for the start screen's preview
window.trainerFrame = () => {
  const img = sheetTex?.image;
  if (!img?.width || !(img instanceof HTMLCanvasElement)) return null;
  return { img, ...framePos(CHARACTER.cfg, "down", 0) };
};
// Any trainer's front frame, as a canvas of its own: the profile shows a player the way the town does
// (their trainer and cap colour). One per look, drawn once.
const looks = new Map();
function trainerLook(gender, cap) {
  const g = gender === "female" ? "female" : "male";
  const c = capOf(cap) ?? SHEET_CAP[g];
  if (!looks.has(g + c)) {
    looks.set(g + c, new Promise((done) => {
      const cut = (sheet, cfg) => {
        const f = framePos(cfg, "down", 0);
        const cv = Object.assign(document.createElement("canvas"), { width: f.w, height: f.h });
        cv.getContext("2d").drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
        done(cv);
      };
      const drawn = () => cut(generateOriginalTrainer(g, c), GRID); // no sheet: the trainer drawn in code
      if (!sheetAvailable(g)) return drawn();
      const img = new Image();
      img.onload = () => {
        const t = { image: img, dispose() {} }; // removeBackground works on a texture: this stands in for one
        removeBackground(t, CROP[g], g, c);
        cut(t.image, CROP[g]);
      };
      img.onerror = drawn;
      img.src = SHEETS[g];
    }));
  }
  return looks.get(g + c);
}
// The cap lives in the top rows of a frame; lower down the same tones are something else (the
// female's white scarf, bag and skirt). Where it ends is looked for frame by frame, between these two
// rows: the first row with the fewest cap pixels, which is the gap between the beanie and the scarf
// (the beanie sits a row or two lower on some frames, so one fixed row cut it short).
const HEAD_ROWS = { male: [18, 18], female: [17, 23] };
// The female's eye whites are the beanie's light tone too, and they touch its lower edge. What tells
// them apart: an eye white stands alone on its row (no cap tone to its left or right) with skin or
// the black of the eye beside it. Those pixels are left as they are. The tones that sit beside an
// eye white, as "r,g,b", per sheet.
const BESIDE_EYE = { male: [], female: ["216,160,120", "248,208,184", "0,0,0"] };
const EYES_FROM_ROW = 14; // no eye is higher than this on a frame (lone cap pixels up there are the beanie's tips)
function recolorCap(d, width, gender, cap) {
  const from = CAPS[SHEET_CAP[gender]].tones,
    to = CAPS[cap]?.tones;
  if (!to || cap === SHEET_CAP[gender]) return;
  const map = Object.fromEntries(from.map((t, i) => [t.join(","), to[i]]));
  for (const cfg of [CROP[gender], RUN_CROP[gender]])
    for (const dir of Object.keys(cfg.rows))
      for (let step = 0; step < cfg.steps; step++) {
        const { x, y, w } = framePos(cfg, dir, step);
        const [lo, hi] = HEAD_ROWS[gender];
        let rows = lo,
          fewest = Infinity;
        for (let r = lo; r <= hi && lo < hi; r++) {
          let n = 0;
          for (let xx = x; xx < x + w; xx++) {
            const i = ((y + r) * width + xx) * 4;
            if (map[`${d[i]},${d[i + 1]},${d[i + 2]}`]) n++;
          }
          if (n < fewest) (fewest = n), (rows = r);
        }
        const key = (xx, yy) => `${d[(yy * width + xx) * 4]},${d[(yy * width + xx) * 4 + 1]},${d[(yy * width + xx) * 4 + 2]}`;
        const beside = BESIDE_EYE[gender];
        const paint = [];
        for (let yy = y; yy < y + rows; yy++)
          for (let xx = x; xx < x + w; xx++) {
            const to = map[key(xx, yy)];
            if (!to) continue;
            const left = key(xx - 1, yy),
              right = key(xx + 1, yy);
            const eyeWhite = yy - y >= EYES_FROM_ROW && !map[left] && !map[right] && (beside.includes(left) || beside.includes(right));
            if (!eyeWhite) paint.push([(yy * width + xx) * 4, to]);
          }
        for (const [i, to] of paint) d.set(to, i); // after looking, so a painted pixel doesn't change its neighbours' answer
      }
}
// configured sheets that failed to load (missing file): use the original
const failedSheets = new Set();
const sheetAvailable = (g) => !!SHEETS[g] && !failedSheets.has(g);

// Layout of the original trainers (4x4 grid)
const GRID = {
  layout: "grid",
  frame: 32,
  gap: 2,
  origin: [2, 2],
  rows: { down: 0, up: 1, left: 2, right: 3 },
  steps: 4,
};
// Crop of each configured sheet. Two layouts:
//  - "grid": rows = directions, columns = steps (like GRID above)
//  - "strip": everything on a single row; each direction takes `steps` frames
//             in a row, in the order given by `rows` (0 = first block)
// frame = frame width (px) · height = frame height (px, if different)
// gap = space between frames · origin = [x, y] of the first frame's corner
const CROP = {
  male: {
    layout: "strip",
    frame: 32,
    gap: 3,
    origin: [17, 30],
    rows: { down: 0, left: 3, up: 2, right: 1 },
    steps: 3,
  },
  female: { ...GRID },
};
const RUN_CROP = {
  male: { ...CROP.male, origin: [17, 100] },
  female: { ...GRID, origin: [172, 2] },
};
const CHARACTER = {
  get sheet() {
    return SHEETS[GENDER];
  },
  get cfg() {
    return sheetAvailable(GENDER) ? CROP[GENDER] : GRID;
  },
  get layout() {
    return this.cfg.layout;
  },
  get frame() {
    return this.cfg.frame;
  },
  get height() {
    return this.cfg.height || this.cfg.frame;
  },
  get gap() {
    return this.cfg.gap;
  },
  get origin() {
    return this.cfg.origin;
  },
  get rows() {
    return this.cfg.rows;
  },
  get steps() {
    return this.cfg.steps;
  },
};
// (x, y) position of the frame in the sheet, for any layout
function framePos(cfg, dir, step) {
  const [ox, oy] = cfg.origin;
  const w = cfg.frame,
    h = cfg.height || cfg.frame,
    b = cfg.gap;
  if (cfg.layout === "strip") {
    const i = cfg.rows[dir] * cfg.steps + step;
    return { x: ox + i * (w + b), y: oy, w, h };
  }
  return { x: ox + step * (w + b), y: oy + cfg.rows[dir] * (h + b), w, h };
}

// ---- Scene ----
// phones/tablets: touch controls and less rain
const MOBILE = matchMedia("(pointer: coarse)").matches;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#070a18");
scene.fog = new THREE.Fog("#070a18", 50, 140);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);

// Night: weak bluish moonlight; the lamp posts are the main light.
// Colors and intensities here are overwritten by the day/night look (applyLook).
const skyLight = new THREE.HemisphereLight("#3a4a8a", "#0b0f1a", 0.35);
scene.add(skyLight);
const sun = new THREE.DirectionalLight("#7f95d8", 0.45); // moon (sun by day)
sun.position.set(40, 80, 30);
sun.castShadow = true;
// 1024 is enough for pixel-art shadows over the whole town; 2048 cost ~42 MB more of GPU memory
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {
  left: -80,
  right: 80,
  top: 80,
  bottom: -80,
  far: 300,
});
// Without bias the shadow map shades the surfaces it comes from (curved bands),
// hidden by the dim moon but obvious under the day sun.
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---- Town (FBX) ----
const texLoader = new THREE.TextureLoader();
// the atlas cuts out leaves and fences (alphaTest), in the lamp shadows too
const atlas = texLoader.load(TOWN.texture, () => markLampShadowsStale());
atlas.magFilter = THREE.NearestFilter;
atlas.minFilter = THREE.NearestFilter;
atlas.colorSpace = THREE.SRGBColorSpace;

let townBox = new THREE.Box3(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 0, 50),
);
// ---- Animated water ----
// Regular Phong + injected shader: ripples that perturb the normal (the glow of
// the lamps and the moon "dances" on the surface), moving light bands and sparkle.
const waterUniforms = { uTime: { value: 0 } };
const waterMaterial = new THREE.MeshPhongMaterial({
  // night: deep blue, no light of its own; the shine comes only from the lamps (and a hint of moon)
  color: "#0b2d63", // deep blue, less saturated
  emissive: "#020c22", // just a hint of its own blue so it doesn't turn black
  specular: "#7a6440", // warm, thin highlight (only where lamp light hits)
  shininess: 160,
  transparent: true,
  opacity: 0.92,
  side: THREE.DoubleSide,
});
waterMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = waterUniforms.uTime;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;")
    .replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
uniform float uTime;
varying vec3 vWorld;
float wave(vec2 p, vec2 d, float f, float v) { return sin(dot(p, d) * f + uTime * v); }`,
    )
    // perturb the normal with waves in several directions
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
vec2 pa = vWorld.xz * 1.6; // wave size: higher = finer
float dx = wave(pa, vec2(1.0, 0.3), 1.7, 1.6) * 0.5 + wave(pa, vec2(-0.4, 1.0), 2.9, 2.3) * 0.3 + wave(pa, vec2(0.7, -0.8), 5.3, 3.1) * 0.15;
float dz = wave(pa, vec2(0.2, 1.0), 2.1, 1.4) * 0.5 + wave(pa, vec2(1.0, -0.5), 3.7, 2.7) * 0.3 + wave(pa, vec2(-0.9, -0.6), 6.1, 3.5) * 0.15;
normal = normalize(normal + vec3(dx, 0.0, dz) * 0.18);`,
    )
    // light bands and sparkle added to the final color
    .replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
float band = smoothstep(0.75, 1.0, wave(vWorld.xz, vec2(0.6, 0.8), 0.9, 0.8) * wave(vWorld.xz, vec2(-0.8, 0.5), 1.3, 1.1));
float sparkle = pow(max(0.0, wave(vWorld.xz, vec2(1.0, 0.2), 7.0, 4.0) * wave(vWorld.xz, vec2(-0.3, 1.0), 6.0, 3.3)), 12.0);
gl_FragColor.rgb += vec3(0.10, 0.25, 0.6) * band * 0.06 + vec3(0.7, 0.8, 1.0) * sparkle * 0.07;`,
    );
};

// The FBX points to the texture at an absolute Windows path: redirect to the local atlas.
const manager = new THREE.LoadingManager();
manager.setURLModifier((url) =>
  /\.(png|jpg|tga)$/i.test(url) && !url.startsWith("/assets")
    ? TOWN.texture
    : url,
);
// Prepares any town (local FBX or the original village): scale, collision, lamp posts.
function prepareTown(fbx) {
    // normalize scale: town ~100 units wide
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    const s = 100 / Math.max(size.x, size.z);
    fbx.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(fbx);
    const c = box2.getCenter(new THREE.Vector3());
    fbx.position.x -= c.x;
    fbx.position.z -= c.z;
    fbx.position.y -= box2.min.y;
    townBox = new THREE.Box3().setFromObject(fbx);
    clearFairGround(fbx);
    scene.add(fbx);
    townMeshes = [];
    fbx.traverse((o) => o.isMesh && townMeshes.push(o));
    computePondBox();
    placeFair(); // before the lamps, benches and capybara look for open ground around it
    fbx.traverse((o) => {
      if (o.isMesh && /mailbox|sign|fence/i.test(o.name))
        solidBoxes.push(new THREE.Box3().setFromObject(o));
    });
    placeLampPairs();
    applyLook(currentLook); // the pond pair's softer light
    candles.position.y = groundHeight(candles.position.x, candles.position.z);
    candles.updateMatrixWorld(true);
    solidBoxes.push(new THREE.Box3().setFromObject(candles).expandByScalar(0.15)); // nobody steps on them: a very small gap around
    placeBenches();
    placeFireflies();
    board.position.y = groundHeight(board.position.x, board.position.z);
    placeCapybara();
    placeCapyWalk();
    placeOwl();
    mergeTown(fbx);
    markLampShadowsStale(); // the town, the lamps and everything around them just took their places
    buildCatNavGrid();
    placeLucarioWalk();
}

// ---- The fair: carousel and Ferris wheel ----
// The pines standing where the rides go (on each side of the pond, below it) come out of the town
// as it loads. Here, and not earlier or later: after the scaling and townBox (they stand on the
// town's edge, so earlier would shrink or move the town), and before townMeshes, since a hidden
// mesh would still block the way and hold up the ground (rays ignore visibility).
function clearFairGround(root) {
  const pines = [];
  const at = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !/tree/i.test(o.name)) return;
    new THREE.Box3().setFromObject(o).getCenter(at);
    if (inClearing(at.x, at.z) || inWheelClearing(at.x, at.z) || inCoasterClearing(at.x, at.z)) pines.push(o);
  });
  for (const o of pines) o.removeFromParent();
}
const carousel = createCarousel();
const wheel = createFerrisWheel();
const coaster = createCoaster();
let fairPlaced = false;
function placeFair() {
  carousel.root.position.y = groundHeight(CAROUSEL.x, CAROUSEL.z);
  wheel.root.position.y = groundHeight(WHEEL.x, WHEEL.z);
  coaster.root.position.y = groundHeight((COASTER.station.x0 + COASTER.station.x1) / 2, COASTER.station.z0 - 1);
  for (const p of fairPosts) p.position.y = groundHeight(p.position.x, p.position.z);
  if (!fairPlaced) scene.add(carousel.root, wheel.root, coaster.root);
  fairPlaced = true;
}
// the seats on a ride: their spot comes from the clock, they need no message while it turns
const isRideSeat = (id) => isCarouselSeat(id) || isWheelSeat(id) || isCoasterSeat(id);
// on the roller coaster while it is out on the track: no getting off until it is back at the station
const strappedIn = () => isCoasterSeat(mySeat) && coasterRiding(roomNow());
// solid ground of the rides, for everything that walks (you, the others' placement searches, the cats)
const onRide = (x, z, r) => onCarousel(x, z, r) || onWheel(x, z, r) || onCoaster(x, z, r);

// ---- Drawing the town in few draw calls ----
// The town comes as ~1,300 meshes sharing one or a few materials, and each one would be a draw call
// in every pass: the camera, the moon/sun's shadow and each of the 6 faces of each lamp's shadow.
// Their geometry is baked into one mesh per material, shadow setting and stretch of town. The
// originals stay where they are, hidden: collision, ground height, the water and the pond edge keep
// raycasting them (a ray ignores visibility), so all of that works exactly as before.
const TOWN_CHUNK = 25; // side of a stretch of town: the camera and each lamp still skip the ones they can't see
const DRAWN_ATTRIBUTES = /^(position|normal|uv|color)$/;
let townDrawn = []; // what is actually drawn: the merged meshes and whatever could not be merged
function mergeTown(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const center = new THREE.Vector3();
  townDrawn = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry;
    if (Array.isArray(o.material) || !g.attributes.position || Object.keys(g.morphAttributes).length) {
      townDrawn.push(o);
      return;
    }
    new THREE.Box3().setFromObject(o).getCenter(center);
    // geometries only merge with the same attributes, so they are part of the key
    const attrs = Object.entries(g.attributes)
      .filter(([n]) => DRAWN_ATTRIBUTES.test(n))
      .map(([n, a]) => `${n}:${a.itemSize}:${a.array.constructor.name}:${a.normalized}`)
      .sort()
      .join();
    const key = [o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder, attrs,
      Math.floor(center.x / TOWN_CHUNK), Math.floor(center.z / TOWN_CHUNK)].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const meshes of groups.values()) {
    const indexed = meshes.every((o) => o.geometry.index);
    const geos = meshes.map((o) => bakeGeometry(o, indexed));
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) {
      townDrawn.push(...meshes);
      continue;
    }
    const first = meshes[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = "TownMerged";
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.matrixAutoUpdate = false; // the geometry is already in world space
    scene.add(mesh);
    townDrawn.push(mesh);
    for (const o of meshes) o.visible = false;
  }
}
// A copy of the mesh's geometry in world space, with only what drawing needs.
function bakeGeometry(o, indexed) {
  let g = o.geometry.clone();
  for (const n of Object.keys(g.attributes)) if (!DRAWN_ATTRIBUTES.test(n)) g.deleteAttribute(n);
  g.clearGroups();
  if (!indexed && g.index) g = g.toNonIndexed();
  g.applyMatrix4(o.matrixWorld);
  // a mirrored mesh (negative scale) is drawn with its faces turned the other way; baked, its
  // triangles must be turned around instead, or lights and shadows would see their backs
  if (o.matrixWorld.determinant() < 0) {
    if (g.index) {
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
    } else {
      for (const a of Object.values(g.attributes)) {
        const s = a.itemSize, v = a.array;
        for (let t = 0; t < a.count; t += 3)
          for (let k = 0; k < s; k++) [v[(t + 1) * s + k], v[(t + 2) * s + k]] = [v[(t + 2) * s + k], v[(t + 1) * s + k]];
      }
    }
  }
  return g;
}

// ---- Original village (default on the published site) ----
// Everything built in code, no external assets: grass, crossed dirt road,
// houses with roofs, fences, mailboxes, trees and a pond with an edge.
// Mesh names follow the same collision conventions (Water, PondEdge,
// Fence, Mailbox), so water, edge and solid objects work the same way.
function createOriginalTown() {
  const town = new THREE.Group();
  town.name = "OriginalTown";
  const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const add = (geo, m, x, y, z, name = "", parent = town) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const M = {
    grass: mat("#4f9a3a"), dirt: mat("#c8a46a"), wall: mat("#e6d3b0"), wall2: mat("#d9c29a"),
    roofA: mat("#2f6f5a"), roofB: mat("#8a3b2e"), door: mat("#6b4428"), window: mat("#3a4f7a"),
    wood: mat("#8a5a34"), trunk: mat("#5a3a22"), leaf: mat("#2e6b34"), leaf2: mat("#3d8040"),
    stone: mat("#7d7a74"), mailbox: mat("#c0503a"), bed: mat("#3a5a7a"),
  };

  // ground and road (cross centered at x=0)
  add(new THREE.BoxGeometry(110, 1, 110), M.grass, 0, -0.5, 0, "Ground");
  add(new THREE.BoxGeometry(7, 0.12, 110), M.dirt, 0, 0.06, 0, "Ground_Path");
  add(new THREE.BoxGeometry(80, 0.12, 6), M.dirt, 0, 0.06, -6, "Ground_Path");

  // houses: body + hip roof + door and windows facing the road
  const house = (x, z, w, d, h, roof, facing) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    town.add(g);
    add(new THREE.BoxGeometry(w, h, d), facing > 0 ? M.wall : M.wall2, 0, h / 2, 0, "House", g);
    const top = add(new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.7, 4), roof, 0, h + h * 0.35, 0, "House_Roof", g);
    top.rotation.y = Math.PI / 4;
    top.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    const f = facing * (w / 2 + 0.05); // facade side (x axis)
    const door = add(new THREE.BoxGeometry(0.1, 2.4, 1.4), M.door, f, 1.2, 0, "House", g);
    door.castShadow = false;
    for (const dz of [-d / 3.2, d / 3.2]) add(new THREE.BoxGeometry(0.1, 1.1, 1.2), M.window, f, h * 0.62, dz, "House", g);
    // mailbox in front of the house
    add(new THREE.BoxGeometry(0.6, 0.6, 0.9), M.mailbox, f + facing * 2.2, 1.1, d / 2 - 0.5, "Mailbox", g);
    add(new THREE.BoxGeometry(0.15, 0.8, 0.15), M.wood, f + facing * 2.2, 0.4, d / 2 - 0.5, "Mailbox", g);
  };
  house(-14, -22, 12, 10, 5, M.roofA, 1);
  house(14, -22, 12, 10, 5, M.roofB, -1);
  house(-14, 10, 10, 9, 4.5, M.roofB, 1);
  house(14, 10, 14, 10, 6, M.roofA, -1);

  // low fences at the back
  for (let x = -40; x <= 40; x += 2.5) {
    if (Math.abs(x) < 5) continue; // road opening
    add(new THREE.BoxGeometry(0.25, 1.2, 0.25), M.wood, x, 0.6, -40, "Fence");
  }
  add(new THREE.BoxGeometry(35, 0.2, 0.15), M.wood, -22.5, 0.9, -40, "Fence");
  add(new THREE.BoxGeometry(35, 0.2, 0.15), M.wood, 22.5, 0.9, -40, "Fence");

  // trees (low-poly pines) along the edges
  const tree = (x, z, s = 1) => {
    add(new THREE.CylinderGeometry(0.3 * s, 0.4 * s, 1.6 * s, 6), M.trunk, x, 0.8 * s, z, "Tree");
    add(new THREE.ConeGeometry(2 * s, 3.6 * s, 7), M.leaf, x, 3.2 * s, z, "Tree");
    add(new THREE.ConeGeometry(1.5 * s, 2.8 * s, 7), M.leaf2, x, 4.8 * s, z, "Tree");
  };
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    tree(side * (42 + (i % 3) * 3), -45 + i * 6, 1 + (i % 3) * 0.15);
  }
  for (const [x, z] of [[-30, 30], [30, 32], [-36, -10], [36, -12], [-26, 46], [28, 48]]) tree(x, z, 1.2);

  // pond with a stone edge, below the road
  const pond = new THREE.Group();
  pond.position.set(0, 0, 34);
  town.add(pond);
  const edge = new THREE.Group();
  edge.name = "PondEdge";
  pond.add(edge);
  add(new THREE.BoxGeometry(26, 0.5, 14), M.bed, 0, -0.6, 0, "PondBed", pond);
  for (let x = -13; x <= 13; x += 2) {
    add(new THREE.BoxGeometry(2, 0.6, 1), M.stone, x, 0.3, -7, "PondEdge", edge);
    add(new THREE.BoxGeometry(2, 0.6, 1), M.stone, x, 0.3, 7, "PondEdge", edge);
  }
  for (let z = -6; z <= 6; z += 2) {
    add(new THREE.BoxGeometry(1, 0.6, 2), M.stone, -13, 0.3, z, "PondEdge", edge);
    add(new THREE.BoxGeometry(1, 0.6, 2), M.stone, 13, 0.3, z, "PondEdge", edge);
  }
  const water = new THREE.Group();
  water.name = "PondWater";
  pond.add(water);
  const surface = add(new THREE.PlaneGeometry(25, 13, 1, 1), waterMaterial, 0, 0.05, 0, "Water", water);
  surface.rotation.x = -Math.PI / 2;
  surface.castShadow = false;

  // register water and edge with the collision system
  town.traverse((o) => {
    if (!o.isMesh) return;
    if (o.parent === edge) edgeMeshes.add(o);
    if (o.parent === water) waterMeshes.add(o);
  });
  return town;
}

// Without the local town files, build an original low-poly village.
function loadOriginalTown() {
  document.querySelector("#place b").textContent = "Lofi Lobby";
  prepareTown(createOriginalTown());
}

const townMaterial = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
new FBXLoader(manager).load(
  TOWN.fbx,
  (fbx) => {
    fbx.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      // every part of the town uses the same atlas: one material for all (the whole mesh, so
      // no groups needed), which also lets them be drawn together (mergeTown)
      o.material = townMaterial;
      // water surface: translucent blue, slightly shiny, and blocks movement
      // the water name may be on the mesh or on a parent group (e.g. MainTownPondWater)
      let waterName = "";
      for (let p = o; p; p = p.parent)
        if (/water/i.test(p.name)) {
          waterName = p.name;
          break;
        }
      // pond edge (irregular stones): becomes a straight wall, nobody steps on it
      for (let p = o; p; p = p.parent)
        if (/pond.*edge|edge.*pond/i.test(p.name)) {
          edgeMeshes.add(o);
          break;
        }
      if (waterName && !/bed|edge/i.test(waterName)) {
        o.material = waterMaterial;
        o.castShadow = false;
        waterMeshes.add(o);
      }
    });
    prepareTown(fbx);
  },
  undefined,
  () => loadOriginalTown(), // local file doesn't exist (e.g. published site)
);

// ---- Lamp posts (original model, low-poly) ----
const ironMaterial = new THREE.MeshLambertMaterial({
  color: "#2f3b45",
  flatShading: true,
});
const lightMaterial = new THREE.MeshBasicMaterial({ color: "#ffdf7a" });
const glowTexture = (() => {
  const cv = Object.assign(document.createElement("canvas"), {
    width: 64,
    height: 64,
  });
  const ctx = cv.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
function createLampPost(x, z) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1, 0.7, 6),
    ironMaterial,
  );
  base.position.y = 0.35;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.36, 7, 6),
    ironMaterial,
  );
  pole.position.y = 4;
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.28, 0.28),
    ironMaterial,
  );
  arm.position.y = 7.4;
  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.6, 1.4, 4),
    lightMaterial,
  );
  lantern.position.y = 8.2;
  lantern.rotation.y = Math.PI / 4;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.8, 4), ironMaterial);
  cap.position.y = 9.3;
  cap.rotation.y = Math.PI / 4;
  // only base and pole cast shadows; the top wraps the bulb and would darken everything
  [base, pole].forEach((m) => (m.castShadow = true));
  const light = new THREE.PointLight("#ffc95a", 150, 22, 1.6); // ~2700K, warm yellow
  light.position.set(0.9, 7.6, 0); // a bit out from the pole, under the arm
  light.castShadow = true;
  // a point light's shadow is 6 maps (one per cube face), colour and depth: ~13 MB of GPU memory
  // each at 512, ~50 MB at 1024 for no visible gain once the soft edge (radius) blurs it
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.05;
  light.shadow.radius = 4;
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: "#ffd45e",
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.scale.set(6, 6, 1);
  glow.position.y = 8.2;
  g.add(glow);
  g.add(base, pole, arm, lantern, cap, light);
  g.position.set(x, 0, z);
  scene.add(g);
  return g;
}
// positions along the paths (tweak freely)
const LAMP_POSTS = [
  [-6, -14],
  [6, -14],
  [-10.5, 24], // at the two ends of the pond, with the two benches between them
  [10.5, 24],
];
const lampPosts = LAMP_POSTS.map(([x, z]) => createLampPost(x, z));
// Lamps around the rides, two on each side, their arm toward the ride. They stand where they are
// put (not in pairs along the road) and their light casts no shadow: a shadowed point light is 6
// shadow passes each time something moves near it, and the rides already glow.
const FAIR_POSTS = [
  [-27, 31, CAROUSEL],
  [-11, 46, CAROUSEL],
  [27, 31, WHEEL],
  [11, 46, WHEEL],
];
const fairPosts = FAIR_POSTS.map(([x, z, ride]) => {
  const p = createLampPost(x, z);
  p.rotation.y = Math.atan2(-(ride.z - z), ride.x - x); // the arm (+x) toward the ride
  const light = p.children.find((c) => c.isPointLight);
  light.castShadow = false;
  light.userData.dim = 0.8;
  return p;
});
lampPosts.push(...fairPosts); // they light up at dusk like the others, and nobody walks through them
const lampPostSolids = lampPosts.flatMap((p) => p.children.filter((c) => c.isMesh));
// message wall: a cork board under the lamp light, in front of the lower-left house's window
const BOARD_AT = [-7.5, 15];
const board = createBoard(scene);
board.position.set(BOARD_AT[0], 0, BOARD_AT[1]);

// ---- Benches ----
// Built in code (no new art), two seats each, facing the road. A seat is numbered
// bench * 2 + side; that number is all the server stores (MAX_SEATS in worker/index.js).
const SEATS_PER_BENCH = 2;
const SEAT_GAP = 1.1; // seat center, sideways from the bench center
// There is no sitting frame: a sitter is the whole standing frame raised so the
// hips rest on the seat and the short legs hang in front of it.
const SIT_LIFT = 0.95; // height of the sprite's origin (feet) over the ground
const SIT_RANGE = 3.6; // how close you must be to a seat to sit
const SIDE_SEAT_FORWARD = 0.2; // on side benches, how far from the seat's middle toward its front
const FACING = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const benches = []; // { x, y, z, face }
const benchBoxes = [];
// Park bench in the town's low-poly look: wooden slats in two tones over cast-iron
// ends, the same iron as the lamp posts.
const woodLight = new THREE.MeshLambertMaterial({ color: "#b07a45", flatShading: true });
const woodDark = new THREE.MeshLambertMaterial({ color: "#8a5a34", flatShading: true });
function createBench(x, y, z, face) {
  const g = new THREE.Group();
  const part = (mat, w, h, d, px, py, pz, tilt = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(px, py, pz);
    m.rotation.x = tilt;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  // local front is +z. Iron ends: front leg, back leg rising into the backrest,
  // rail under the seat, armrest on top
  for (const sx of [-2.15, 2.15]) {
    part(ironMaterial, 0.22, 1.45, 0.22, sx, 0.72, 0.55);
    part(ironMaterial, 0.22, 2.75, 0.22, sx, 1.37, -0.68, -0.08);
    part(ironMaterial, 0.2, 0.18, 1.45, sx, 1.33, -0.05);
    part(ironMaterial, 0.26, 0.16, 1.2, sx, 2.15, 0.05);
  }
  // seat: three slats with gaps, alternating tones (top at ~1.6, where a sitter's hips go)
  [0.5, 0, -0.5].forEach((sz, i) =>
    part(i % 2 ? woodDark : woodLight, 4.5, 0.18, 0.4, 0, 1.51, sz),
  );
  // backrest: two slats leaning back a little
  part(woodDark, 4.5, 0.36, 0.14, 0, 2.0, -0.78, -0.08);
  part(woodLight, 4.5, 0.36, 0.14, 0, 2.55, -0.83, -0.08);
  g.position.set(x, y, z);
  g.rotation.y = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 }[face];
  scene.add(g);
  g.updateMatrixWorld(true);
  benches.push({ x, y, z, face });
  const box = new THREE.Box3().setFromObject(g);
  solidBoxes.push(box); // nobody walks through it
  benchBoxes.push(box); // and it hides whoever stands behind it (updateOcclusion)
}
// Each bench goes on the open spot nearest its wish (spiral search), so a town with another
// layout still gets them. Bench seats stay under 16 (8 benches): 16..23 are the carousel horses.
function placeBenches() {
  const clear = (x, z) =>
    isOpen(x, z, 2.6) &&
    benches.every((b) => Math.hypot(b.x - x, b.z - z) > 6) &&
    lampPosts.every((l) => Math.hypot(l.position.x - x, l.position.z - z) > 4.5) &&
    Math.hypot(board.position.x - x, board.position.z - z) > 7; // keep clear of the message board
  for (const [x0, z0, face, exact] of BENCH_SPOTS)
    if (exact) createBench(x0, groundHeight(x0, z0), z0, face);
    else search: for (let r = 0; r <= 8; r += 0.5)
      for (let a = 0; a < 16; a++) {
        const x = x0 + Math.cos((a / 16) * Math.PI * 2) * r;
        const z = z0 + Math.sin((a / 16) * Math.PI * 2) * r;
        if (clear(x, z)) {
          createBench(x, groundHeight(x, z), z, face);
          break search;
        }
        if (r === 0) break; // the center has only one point to try
      }
}
// Wished spots and facing (tweak freely); a spot marked true is used as is, the others move to the nearest open ground. Side benches ("right"/"left") stand on the edge of
// a path, so whoever sits is on the path's line. Skip the gaps between the back and front houses:
// the front roofs hide anything there from the camera.
const BENCH_SPOTS = [
  // two on the grass tile in front of the pond, between the lamps at its ends, looking at the water (placed as is)
  [-4, 23, "down", true],
  [4, 23, "down", true],
  [-23, 18.5, "right"], // left end of the sand path in front of the houses
  [-4.5, -23.7, "right"], // back of the road, by the big house on the left
  [3, -29, "left"], // right edge of the road at the very back, past the houses
];
// Where a seat is, and which way the sitter looks (null if that bench doesn't exist)
function seatSpot(id) {
  // a carousel horse: where it is right now, by the room's clock
  if (isCarouselSeat(id)) return fairPlaced ? carouselSeat(id - CAROUSEL.firstSeat, roomNow(), carousel.root.position.y) : null;
  // a Ferris wheel gondola: the same, up and down
  if (isWheelSeat(id)) return fairPlaced ? wheelSeat(id - WHEEL.firstSeat, roomNow(), wheel.root.position.y) : null;
  // a seat in the roller coaster's sleigh: at the station, or wherever it is on the track
  if (isCoasterSeat(id)) return fairPlaced ? coasterSeat(id - COASTER.firstSeat, roomNow(), coaster.root.position.y) : null;
  if (id >= benches.length * SEATS_PER_BENCH) return null;
  const b = benches[id >> 1];
  if (!b) return null;
  const [fx, fz] = FACING[b.face];
  const side = id & 1 ? 1 : -1;
  // On a bench facing the camera the billboard leans back, so its hips must start past the
  // seat's front edge (0.75) or the seat and backrest cut through other players' sprites.
  // A side bench runs along the billboard, so the sitter goes on the middle of the seat.
  const fwd = fz ? 1.05 : SIDE_SEAT_FORWARD;
  return {
    x: b.x - fz * side * SEAT_GAP + fx * fwd,
    z: b.z + fx * side * SEAT_GAP + fz * fwd,
    y: b.y + SIT_LIFT,
    dir: b.face,
  };
}

// ---- Day / night ----
// Only for you, like mute: it changes how you see the town, not the room.
// Cycles through night, day, or a client-side automatic cycle (night -> dawn -> day -> golden hour -> dusk -> night).
const NIGHT_SPEC = {
  daylight: 0,
  background: "#070a18",
  skyTop: "#3a4a8a",
  skyGround: "#0b0f1a",
  skyIntensity: 0.35,
  sunColor: "#7f95d8",
  sunIntensity: 0.45,
  sunPos: [40, 80, 30],
  lampIntensity: 150,
  glowOpacity: 0.35,
  lantern: "#ffdf7a",
  waterColor: "#0b2d63",
  waterEmissive: "#020c22",
  waterSpecular: "#7a6440",
};
const DAY_SPEC = {
  daylight: 1,
  background: "#9fcdf2",
  skyTop: "#d6ecff",
  skyGround: "#5c6a44",
  skyIntensity: 1.1,
  sunColor: "#fff1d8",
  sunIntensity: 1.9,
  sunPos: [40, 80, 30],
  lampIntensity: 0,
  glowOpacity: 0,
  lantern: "#d8cfa8",
  waterColor: "#2a6db3",
  waterEmissive: "#06223f",
  waterSpecular: "#ffffff",
};
const MOONSET_SPEC = {
  daylight: 0.08,
  background: "#161938",
  skyTop: "#9da5de",
  skyGround: "#282b4a",
  skyIntensity: 0.68,
  sunColor: "#8b98cf",
  sunIntensity: 0,
  sunPos: [18, 72, 30],
  lampIntensity: 145,
  glowOpacity: 0.33,
  lantern: "#ffdf7a",
  waterColor: "#0e2f66",
  waterEmissive: "#040d24",
  waterSpecular: "#856d4c",
};
const TWILIGHT_SPEC = {
  daylight: 0.1,
  background: "#201c40",
  skyTop: "#b59ee6",
  skyGround: "#2c2445",
  skyIntensity: 0.72,
  sunColor: "#9c7eb8",
  sunIntensity: 0,
  sunPos: [-58, 42, 28],
  lampIntensity: 145,
  glowOpacity: 0.33,
  lantern: "#ffdf7a",
  waterColor: "#102f66",
  waterEmissive: "#060e26",
  waterSpecular: "#967450",
};
// Duplicate keyframes at p = 0.185 and p = 0.815 reposition the directional light while
// sunIntensity === 0 so shadows never sweep backwards between moon and sun.
const CYCLE_SPECS = [
  { p: 0.0, ...NIGHT_SPEC },
  { p: 0.15, ...NIGHT_SPEC, sunPos: [28, 78, 30] },
  { p: 0.185, ...MOONSET_SPEC },
  { p: 0.185, ...MOONSET_SPEC, sunPos: [58, 42, 28] },
  {
    p: 0.23,
    daylight: 0.3,
    background: "#5e4b73",
    skyTop: "#a888b0",
    skyGround: "#362b3d",
    skyIntensity: 0.74,
    sunColor: "#f2a494",
    sunIntensity: 0.55,
    sunPos: [56, 46, 28],
    lampIntensity: 105,
    glowOpacity: 0.24,
    lantern: "#ffdf7a",
    waterColor: "#1d427d",
    waterEmissive: "#0c1633",
    waterSpecular: "#c9927a",
  },
  {
    p: 0.28,
    daylight: 0.68,
    background: "#f2bfa0",
    skyTop: "#ffdec4",
    skyGround: "#665848",
    skyIntensity: 0.9,
    sunColor: "#ffd099",
    sunIntensity: 1.38,
    sunPos: [50, 58, 28],
    lampIntensity: 20,
    glowOpacity: 0.05,
    lantern: "#ebd7aa",
    waterColor: "#28609e",
    waterEmissive: "#0e1f38",
    waterSpecular: "#ffe0bd",
  },
  { p: 0.35, ...DAY_SPEC },
  { p: 0.65, ...DAY_SPEC, sunPos: [-15, 78, 30] },
  {
    p: 0.72,
    daylight: 0.72,
    background: "#f0a975",
    skyTop: "#ffd099",
    skyGround: "#664d3b",
    skyIntensity: 0.92,
    sunColor: "#ffb86b",
    sunIntensity: 1.45,
    sunPos: [-35, 58, 28],
    lampIntensity: 35,
    glowOpacity: 0.08,
    lantern: "#f2d896",
    waterColor: "#265794",
    waterEmissive: "#121a30",
    waterSpecular: "#ffd094",
  },
  {
    p: 0.78,
    daylight: 0.35,
    background: "#c96862",
    skyTop: "#e88a78",
    skyGround: "#3b2434",
    skyIntensity: 0.76,
    sunColor: "#ff7e52",
    sunIntensity: 0.72,
    sunPos: [-52, 46, 28],
    lampIntensity: 110,
    glowOpacity: 0.25,
    lantern: "#ffdf7a",
    waterColor: "#1d386e",
    waterEmissive: "#12122b",
    waterSpecular: "#e89264",
  },
  { p: 0.815, ...TWILIGHT_SPEC },
  { p: 0.815, ...TWILIGHT_SPEC, sunPos: [52, 74, 30] },
  { p: 0.85, ...NIGHT_SPEC, sunPos: [52, 74, 30] },
  { p: 1.0, ...NIGHT_SPEC },
];
const LOOK_COLORS = [
  "background",
  "skyTop",
  "skyGround",
  "sunColor",
  "lantern",
  "waterColor",
  "waterEmissive",
  "waterSpecular",
];
const LOOK_NUMS = ["daylight", "skyIntensity", "sunIntensity", "lampIntensity", "glowOpacity"];
function makeLook(spec) {
  const out = { p: spec.p ?? 0, sunPos: new THREE.Vector3(...spec.sunPos) };
  for (const k of LOOK_COLORS) out[k] = new THREE.Color(spec[k]);
  for (const k of LOOK_NUMS) out[k] = spec[k];
  return out;
}
function copyLook(dst, src) {
  dst.sunPos.copy(src.sunPos);
  for (const k of LOOK_COLORS) dst[k].copy(src[k]);
  for (const k of LOOK_NUMS) dst[k] = src[k];
}
function lerpLook(dst, a, b, t) {
  dst.sunPos.copy(a.sunPos).lerp(b.sunPos, t);
  for (const k of LOOK_COLORS) dst[k].copy(a[k]).lerp(b[k], t);
  for (const k of LOOK_NUMS) dst[k] = a[k] + (b[k] - a[k]) * t;
}
const NIGHT_LOOK = makeLook(NIGHT_SPEC);
const DAY_LOOK = makeLook(DAY_SPEC);
const CYCLE = CYCLE_SPECS.map(makeLook);
function sampleCycle(p, dst) {
  const phase = ((p % 1) + 1) % 1;
  for (let i = 0; i < CYCLE.length - 1; i++) {
    const a = CYCLE[i],
      b = CYCLE[i + 1];
    if (b.p > a.p && phase >= a.p && phase <= b.p) {
      lerpLook(dst, a, b, (phase - a.p) / (b.p - a.p));
      return dst;
    }
  }
  copyLook(dst, CYCLE[CYCLE.length - 1]);
  return dst;
}
const currentLook = makeLook(NIGHT_SPEC);
const fromLook = makeLook(NIGHT_SPEC);
const targetLook = makeLook(NIGHT_SPEC);

const lampLights = lampPosts.flatMap((p) => p.children.filter((c) => c.isPointLight));
const lampGlows = lampPosts.flatMap((p) => p.children.filter((c) => c.isSprite));

// ---- Lamp shadows on demand ----
// A lamp's shadow is 6 renders (one per cube face) of everything within its reach, which three.js
// would redo every frame: 24 extra passes for the 4 lamps, more than half of all draw calls.
// Houses, trees, benches and the wall never move, so a lamp redraws its shadow only when it can
// change: once the town is in place, when it comes on at dusk, and when something that moves (a
// trainer, the capybara) changed within its reach. By day the lamps are off and nothing is redrawn.
// Something moving redraws them when it has gone SHADOW_STEP since the last drawing, changed its
// animation frame, or stopped (so the shadow settles exactly under it): every frame or so for a
// walking trainer, about 10 times a second for the capybara, which strolls by the pond all night.
for (const l of lampLights) (l.shadow.autoUpdate = false), (l.userData.shadowStale = true);
function markLampShadowsStale() {
  for (const l of lampLights) l.userData.shadowStale = true;
}
const SHADOW_REACH = 8; // tall sprites can project their shadow several units beyond the light's ground footprint
const SHADOW_STEP = 0.25; // about one texel of a lamp's 512 shadow map, a few units from the lamp
const drawnMovers = new Map(); // object -> { x, y, z, look, px, py, pz }: where its shadow was drawn, and last frame's spot
const _lampAt = new THREE.Vector3();
function updateLampShadows(movers) {
  // where a shadow must change this frame: where it was drawn and where it goes (one that left, only the old)
  const changed = [];
  const seen = new Set();
  for (const o of movers) {
    seen.add(o);
    const { x, y, z } = o.position;
    // the frame of the sheet it casts its shadow with (the capybara uses its own material's)
    const map = (o.customDistanceMaterial || o.material)?.map;
    const look = [o.visible, map?.id, map?.image?.width, map?.offset.x, map?.offset.y, map?.repeat.x].join();
    const d = drawnMovers.get(o);
    if (!d) {
      changed.push({ x, z });
      drawnMovers.set(o, { x, y, z, look, px: x, py: y, pz: z });
      continue;
    }
    const away = Math.hypot(x - d.x, y - d.y, z - d.z);
    const stopped = x === d.px && y === d.py && z === d.pz;
    Object.assign(d, { px: x, py: y, pz: z });
    if (look === d.look && away < SHADOW_STEP && !(stopped && away > 0)) continue;
    changed.push({ x: d.x, z: d.z }, { x, z });
    Object.assign(d, { x, y, z, look });
  }
  for (const [o, d] of drawnMovers) if (!seen.has(o)) changed.push(d), drawnMovers.delete(o);
  for (const l of lampLights) {
    if (l.intensity <= 0) {
      l.userData.shadowStale = true; // off: redraw once it comes back on
      continue;
    }
    l.getWorldPosition(_lampAt);
    const reach = l.distance + SHADOW_REACH;
    if (l.userData.shadowStale || changed.some((c) => Math.hypot(c.x - _lampAt.x, c.z - _lampAt.z) < reach)) {
      l.shadow.needsUpdate = true; // three.js clears it once drawn
      l.userData.shadowStale = false;
    }
  }
}
// A few candles on the grass between the two pond benches, so sitters aren't in the dark (the posts
// are far, at the pond's ends): chunky square wax stubs of different heights, small flames, and a
// very faint warm light that wavers. No shadows, and out by day with the lamps.
const candles = new THREE.Group();
const candleFlames = [];
{
  const wax = new THREE.MeshLambertMaterial({ color: "#efe3c4", emissive: "#8a7650" }); // lit from inside by its own flame
  const fire = new THREE.MeshBasicMaterial({ color: "#ffd27a" });
  // [x, z, height]
  for (const [x, z, h] of [[-0.5, 0.1, 0.6], [0.4, -0.2, 0.95], [0.15, 0.55, 0.4]]) {
    const stub = new THREE.Mesh(new THREE.BoxGeometry(0.36, h, 0.36), wax);
    stub.position.set(x, h / 2, z);
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), fire);
    flame.position.set(x, h + 0.2, z);
    candles.add(stub, flame);
    candleFlames.push(flame);
  }
}
const benchGlow = new THREE.PointLight("#ffb14a", 0, 10, 1.6);
benchGlow.position.y = 1.1;
let candleLight = 0; // steady strength; the flicker plays around it each frame
candles.add(benchGlow);
candles.position.set(0, 0, 23.6);
scene.add(candles);
const OVERCAST_SKY = new THREE.Color("#7d8794");
const OVERCAST_LIGHT = new THREE.Color("#a3adbb");
let rainAmount = 0; // 0 = dry, 1 = full rain (eased in the loop)
let dayAmount = 0;
function applyLook(look) {
  const t = look.daylight;
  dayAmount = t;
  sun.position.copy(look.sunPos);
  scene.background.copy(look.background);
  // overcast: by day the rain greys the sky; at night it only dims a little
  const overcast = rainAmount * t;
  scene.background.lerp(OVERCAST_SKY, 0.65 * overcast);
  scene.fog.color.copy(scene.background);
  // rain closes the fog in; at night it is always closed in, rain or not, so the town stays
  // dark around the lamps' pools of light
  const closed = Math.max(rainAmount, 1 - t);
  scene.fog.near = 50 - 12 * closed;
  scene.fog.far = 140 - 22 * closed;
  skyLight.color.copy(look.skyTop).lerp(OVERCAST_LIGHT, 0.5 * overcast);
  skyLight.groundColor.copy(look.skyGround);
  const gloom = 1 - (0.2 + 0.2 * t) * closed;
  skyLight.intensity = look.skyIntensity * gloom;
  sun.color.copy(look.sunColor);
  sun.intensity = look.sunIntensity * gloom;
  for (const l of lampLights) l.intensity = look.lampIntensity * (l.userData.dim ?? 1);
  candleLight = look.lampIntensity * 0.06;
  for (const g of lampGlows) g.material.opacity = look.glowOpacity;
  lightMaterial.color.copy(look.lantern);
  waterMaterial.color.copy(look.waterColor);
  waterMaterial.emissive.copy(look.waterEmissive);
  waterMaterial.specular.copy(look.waterSpecular);
}

const TIME_MODES = ["night", "day", "auto"];
const DEFAULT_CYCLE_MS = 10 * 60 * 1000;
let cycleDurationMs = DEFAULT_CYCLE_MS;
const lookBlendSec = () => Math.min(1, Math.max(0.25, (cycleDurationMs / 1000) * 0.05));
const AUTO_START_PHASE = 0.63; // late day so switching from day -> auto starts smoothly before golden hour
let timeMode = "night";
try {
  const savedMode = localStorage.getItem("time-of-day");
  if (TIME_MODES.includes(savedMode)) timeMode = savedMode;
} catch {}
let cycleEpoch = Date.now() - AUTO_START_PHASE * cycleDurationMs;
try {
  const raw = localStorage.getItem("time-of-day-epoch");
  const savedEpoch = raw === null || raw === "" ? NaN : Number(raw);
  if (Number.isFinite(savedEpoch)) cycleEpoch = savedEpoch;
} catch {}
let lookBlend = 1;
const cyclePhase = () => (((Date.now() - cycleEpoch) / cycleDurationMs) % 1 + 1) % 1;
function setCycleDuration(ms) {
  const p = cyclePhase();
  cycleDurationMs = ms;
  cycleEpoch = Date.now() - p * cycleDurationMs;
  if (timeMode === "auto") {
    try { localStorage.setItem("time-of-day-epoch", String(cycleEpoch)); } catch {}
  }
}
function fillTargetLook() {
  if (timeMode === "night") copyLook(targetLook, NIGHT_LOOK);
  else if (timeMode === "day") copyLook(targetLook, DAY_LOOK);
  else sampleCycle(cyclePhase(), targetLook);
}
fillTargetLook();
copyLook(currentLook, targetLook);
applyLook(currentLook);

const dayNightBtn = document.querySelector("#day-night");
const DAY_NIGHT_META = {
  night: {
    label: "make it day",
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  },
  day: {
    label: "auto cycle",
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  },
  auto: {
    label: "make it night",
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/><circle cx="12" cy="12" r="2.5"/></svg>',
  },
};
function drawDayNight() {
  const { label, icon } = DAY_NIGHT_META[timeMode];
  dayNightBtn.innerHTML = icon;
  dayNightBtn.classList.toggle("on", timeMode === "auto");
  dayNightBtn.setAttribute("aria-label", label);
}
function toggleDayNight() {
  copyLook(fromLook, currentLook);
  lookBlend = 0;
  timeMode = TIME_MODES[(TIME_MODES.indexOf(timeMode) + 1) % TIME_MODES.length];
  if (timeMode === "auto") {
    cycleEpoch = Date.now() - AUTO_START_PHASE * cycleDurationMs;
    try { localStorage.setItem("time-of-day-epoch", String(cycleEpoch)); } catch {}
  }
  try { localStorage.setItem("time-of-day", timeMode); } catch {}
  drawDayNight();
}
function updateTimeOfDay(dt) {
  if (timeMode !== "auto" && lookBlend >= 1) return;
  fillTargetLook();
  if (lookBlend < 1) {
    lookBlend = Math.min(1, lookBlend + dt / lookBlendSec());
    lerpLook(currentLook, fromLook, targetLook, lookBlend);
  } else {
    copyLook(currentLook, targetLook);
  }
  applyLook(currentLook);
}
drawDayNight();
dayNightBtn.addEventListener("click", (e) => {
  toggleDayNight();
  e.currentTarget.blur(); // give the keyboard back to the game
});
addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (!typing && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") toggleDayNight();
});

// ---- Frames per second ----
// Beside the player count, for whoever wants to see how the game runs on their machine: P (or a tap on
// the count, on phones) shows or hides it, and it is remembered. Counted over half a second; the title
// adds the slowest frame of that half second and the draw calls of the last frame.
const elFps = document.querySelector("#fps");
const FPS_EVERY_MS = 500;
const fpsCount = { frames: 0, since: performance.now(), last: performance.now(), worst: 0 };
let fpsOn = false;
try { fpsOn = localStorage.getItem("fps") === "1"; } catch {}
elFps.hidden = !fpsOn;
function setFps(on) {
  fpsOn = on;
  elFps.hidden = !on;
  try { localStorage.setItem("fps", on ? "1" : "0"); } catch {}
  Object.assign(fpsCount, { frames: 0, since: performance.now(), last: performance.now(), worst: 0 });
  if (on) elFps.textContent = "… fps";
}
function countFrame() {
  if (!fpsOn) return;
  const now = performance.now();
  const frame = now - fpsCount.last;
  fpsCount.last = now;
  // back from a hidden tab (no frames meanwhile): start the count again
  if (frame > 1000) return void Object.assign(fpsCount, { frames: 0, since: now, worst: 0 });
  fpsCount.frames++;
  fpsCount.worst = Math.max(fpsCount.worst, frame);
  const span = now - fpsCount.since;
  if (span < FPS_EVERY_MS) return;
  const fps = Math.round((fpsCount.frames * 1000) / span);
  elFps.textContent = `${fps} fps`;
  elFps.classList.toggle("slow", fps < 45 && fps >= 25);
  elFps.classList.toggle("bad", fps < 25);
  elFps.title = `${(span / fpsCount.frames).toFixed(1)} ms a frame, slowest ${fpsCount.worst.toFixed(1)} ms · ${renderer.info.render.calls} draw calls`;
  Object.assign(fpsCount, { frames: 0, since: now, worst: 0 });
}
document.querySelector("#online").addEventListener("click", () => setFps(!fpsOn));
addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (!typing && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "p") setFps(!fpsOn);
});


// Rain: thin streaks in a box that follows the player, splashes where they land (rings on the
// pond), shiny wet ground and a little fog.
// Only for you, remembered (like day/night). Nothing goes to the server.
let isRaining = false;
try { isRaining = localStorage.getItem("weather") === "rain"; } catch {}
if (isRaining) {
  rainAmount = 1;
  applyLook(currentLook); // first frame already overcast
}
const RAIN = { count: MOBILE ? 600 : 1800, radius: 40, height: 40, fall: 38, wind: 5 };
const rainDrops = new Float32Array(RAIN.count * 3); // x, y, z of each drop's head
const rainFloor = new Float32Array(RAIN.count); // where each drop stops (ground, roof or water)
const rainLen = new Float32Array(RAIN.count);
const rainSpeed = new Float32Array(RAIN.count);
for (let i = 0; i < RAIN.count; i++) {
  rainDrops[i * 3] = (Math.random() * 2 - 1) * RAIN.radius;
  rainDrops[i * 3 + 1] = Math.random() * RAIN.height;
  rainDrops[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN.radius;
  rainFloor[i] = -1e3;
  rainLen[i] = 0.5 + Math.random() * 0.9;
  rainSpeed[i] = 0.8 + Math.random() * 0.4;
}
const rainLines = new Float32Array(RAIN.count * 6); // head + tail per drop
const rainAlpha = new Float32Array(RAIN.count * 2); // head brighter than the tail
for (let i = 0; i < RAIN.count; i++) {
  rainAlpha[i * 2] = 0.5 + Math.random() * 0.5;
  rainAlpha[i * 2 + 1] = 0;
}
const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainLines, 3).setUsage(THREE.DynamicDrawUsage));
rainGeometry.setAttribute("alpha", new THREE.BufferAttribute(rainAlpha, 1));
const rainUniforms = { uOpacity: { value: 0 }, uColor: { value: new THREE.Color("#dfe7f2") } };
const rainMaterial = new THREE.ShaderMaterial({
  uniforms: rainUniforms,
  transparent: true,
  depthWrite: false,
  vertexShader: `attribute float alpha; varying float vA;
    void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vA;
    void main() { gl_FragColor = vec4(uColor, vA * uOpacity); }`,
});
const rainMesh = new THREE.LineSegments(rainGeometry, rainMaterial);
rainMesh.frustumCulled = false; // positions move every frame
rainMesh.visible = false;
scene.add(rainMesh);

// Where a drop stops: highest surface (so it stops on roofs), and whether it is the pond.
// Cached on a 1-unit grid; at most a few new raycasts per frame.
const surfaceCache = new Map();
let surfaceBudget = 0;
function surfaceAt(x, z) {
  const key = Math.round(x) * 1000 + Math.round(z);
  let s = surfaceCache.get(key);
  if (s) return s;
  if (!townMeshes.length || surfaceBudget <= 0) return null;
  surfaceBudget--;
  ray.set(new THREE.Vector3(Math.round(x), 200, Math.round(z)), DOWN);
  const hits = ray.intersectObjects(townMeshes, false);
  const wet = hits.find((h) => waterMeshes.has(h.object));
  s = wet ? { y: wet.point.y, water: true } : hits[0] ? { y: hits[0].point.y, water: false } : { y: 0, water: false };
  surfaceCache.set(key, s);
  return s;
}

// Splashes: expanding rings that fade (small on the ground, bigger on the pond).
const SPLASH = MOBILE ? 150 : 400;
const splashPos = new Float32Array(SPLASH * 3);
const splashAge = new Float32Array(SPLASH).fill(1);
const splashSize = new Float32Array(SPLASH);
let splashNext = 0;
// Each splash is a small flat square lying on the surface (instanced), so the ground, trees and
// houses in front cover it normally. The ring is drawn in the fragment shader.
const splashGeometry = new THREE.InstancedBufferGeometry();
const splashBase = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
splashGeometry.index = splashBase.index;
splashGeometry.setAttribute("position", splashBase.attributes.position);
splashGeometry.setAttribute("uv", splashBase.attributes.uv);
splashGeometry.setAttribute("offset", new THREE.InstancedBufferAttribute(splashPos, 3).setUsage(THREE.DynamicDrawUsage));
splashGeometry.setAttribute("age", new THREE.InstancedBufferAttribute(splashAge, 1).setUsage(THREE.DynamicDrawUsage));
splashGeometry.setAttribute("size", new THREE.InstancedBufferAttribute(splashSize, 1).setUsage(THREE.DynamicDrawUsage));
splashGeometry.instanceCount = SPLASH;
const splashMaterial = new THREE.ShaderMaterial({
  uniforms: rainUniforms,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  vertexShader: `attribute vec3 offset; attribute float age; attribute float size;
    varying float vAge; varying vec2 vUv;
    void main() {
      vAge = age; vUv = uv;
      float s = age >= 1.0 ? 0.0 : size * (0.4 + age) * 0.45;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position * s + offset, 1.0);
    }`,
  fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vAge; varying vec2 vUv;
    void main() {
      float d = length(vUv * 2.0 - 1.0);
      float ring = smoothstep(0.2, 0.0, abs(d - 0.75));
      float a = ring * (1.0 - vAge) * uOpacity * 2.2;
      if (a < 0.01) discard;
      gl_FragColor = vec4(uColor, a);
    }`,
});
const splashMesh = new THREE.Mesh(splashGeometry, splashMaterial);
splashMesh.frustumCulled = false;
splashMesh.visible = false;
splashMesh.renderOrder = 10; // after the water and its light patches
scene.add(splashMesh);
function splash(x, y, z, water) {
  const i = splashNext;
  splashNext = (splashNext + 1) % SPLASH;
  splashPos[i * 3] = x;
  splashPos[i * 3 + 1] = y + 0.05;
  splashPos[i * 3 + 2] = z;
  splashAge[i] = 0;
  splashSize[i] = water ? 2.2 + Math.random() * 1.0 : 0.7 + Math.random() * 0.4;
}

const wetMaterials = [];
let wetReady = false;
// Wet look: the town's materials become shiny (Phong) and a bit darker while it rains,
// so the ground catches the lamps and the sky like a wet street. No extra meshes.
function prepareWet() {
  if (wetReady || !townDrawn.length) return;
  wetReady = true;
  const swapped = new Map();
  for (const o of townDrawn) {
    const swap = (m) => {
      if (!m || m === waterMaterial || !m.isMeshLambertMaterial) return m;
      if (!swapped.has(m)) {
        const p = new THREE.MeshPhongMaterial({
          map: m.map, color: m.color, alphaTest: m.alphaTest, side: m.side,
          flatShading: m.flatShading, transparent: m.transparent, opacity: m.opacity,
          specular: "#000000", shininess: 40,
        });
        // only surfaces facing up shine (ground, roads), not tree sides or the pond edge
        p.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nvarying float vUp;")
            .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvUp = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz).y;");
          sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying float vUp;")
            .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.directSpecular *= smoothstep(0.9, 0.98, abs(vUp));");
        };
        wetMaterials.push({ m: p, base: m.color.clone() });
        swapped.set(m, p);
      }
      return swapped.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  }
  applyWet();
}
const WET_SHINE = new THREE.Color("#8a96aa");
function applyWet() {
  const k = 1 - 0.18 * rainAmount;
  for (const { m, base } of wetMaterials) {
    m.color.copy(base).multiplyScalar(k);
    m.specular.copy(WET_SHINE).multiplyScalar(rainAmount);
  }
}

const RAIN_NIGHT = new THREE.Color("#b9c8e0");
const RAIN_DAY = new THREE.Color("#e8eef6");
function updateRain(dt) {
  const target = isRaining ? 1 : 0;
  if (rainAmount !== target) {
    rainAmount += Math.sign(target - rainAmount) * Math.min(dt * 0.7, Math.abs(target - rainAmount));
    applyLook(currentLook);
    applyWet();
  }
  if (isRaining) prepareWet();
  rainMesh.visible = splashMesh.visible = rainAmount > 0;
  if (!rainMesh.visible) return;
  rainUniforms.uOpacity.value = 0.45 * rainAmount;
  rainUniforms.uColor.value.copy(RAIN_NIGHT).lerp(RAIN_DAY, dayAmount);
  surfaceBudget = 40;
  const { radius, height, fall, wind } = RAIN;
  const top = pos.y + height;
  for (let i = 0; i < RAIN.count; i++) {
    const j = i * 3;
    const v = fall * rainSpeed[i];
    let x = rainDrops[j] + wind * dt;
    let y = rainDrops[j + 1] - v * dt;
    let z = rainDrops[j + 2];
    // keep the drops in a box around the player (wrap around its edges)
    if (x - pos.x > radius) x -= radius * 2;
    else if (x - pos.x < -radius) x += radius * 2;
    if (z - pos.z > radius) z -= radius * 2;
    else if (z - pos.z < -radius) z += radius * 2;
    if (rainFloor[i] < -100) rainFloor[i] = surfaceAt(x, z)?.y ?? pos.y;
    if (y < rainFloor[i]) {
      const s = surfaceAt(x, z);
      if (s && Math.random() < (s.water ? 0.9 : 0.5) * rainAmount) splash(x, s.y, z, s.water);
      x = pos.x + (Math.random() * 2 - 1) * radius;
      z = pos.z + (Math.random() * 2 - 1) * radius;
      y = top - Math.random() * 6;
      rainFloor[i] = surfaceAt(x, z)?.y ?? pos.y;
    }
    rainDrops[j] = x;
    rainDrops[j + 1] = y;
    rainDrops[j + 2] = z;
    const len = rainLen[i];
    const k = i * 6;
    rainLines[k] = x;
    rainLines[k + 1] = y;
    rainLines[k + 2] = z;
    rainLines[k + 3] = x - (wind / v) * len;
    rainLines[k + 4] = y + len;
    rainLines[k + 5] = z;
  }
  rainGeometry.attributes.position.needsUpdate = true;
  for (let i = 0; i < SPLASH; i++) if (splashAge[i] < 1) splashAge[i] = Math.min(1, splashAge[i] + dt * 3.2);
  splashGeometry.attributes.offset.needsUpdate = true;
  splashGeometry.attributes.age.needsUpdate = true;
  splashGeometry.attributes.size.needsUpdate = true;
}
const rainBtn = document.querySelector("#rain");
function drawRain() {
  const label = isRaining ? "stop the rain" : "make it rain";
  rainBtn.classList.toggle("on", isRaining);
  rainBtn.setAttribute("aria-label", label);
}
function toggleRain() {
  isRaining = !isRaining;
  try { localStorage.setItem("weather", isRaining ? "rain" : "clear"); } catch {}
  drawRain();
}
drawRain();
rainBtn.addEventListener("click", (e) => {
  toggleRain();
  e.currentTarget.blur(); // give the keyboard back to the game
});
addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (typing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== "r") return;
  if (nearLucario()) interactLucario("aura"); else toggleRain();
});

// ---- Fireflies ----
// Little blinking lights drifting around the pond at night. Gone by day and in the rain
// (same fade as the look). Only for you, nothing goes to the server.
const FIREFLIES = { count: MOBILE ? 40 : 90, margin: 12, wander: 1.5 };
const fireflyBase = new Float32Array(FIREFLIES.count * 3); // where each one hovers around
const fireflyPos = new Float32Array(FIREFLIES.count * 3);
const fireflyPhase = new Float32Array(FIREFLIES.count);
const fireflySpeed = new Float32Array(FIREFLIES.count);
for (let i = 0; i < FIREFLIES.count; i++) {
  fireflyPhase[i] = Math.random() * Math.PI * 2;
  fireflySpeed[i] = 0.6 + Math.random() * 0.8;
}
const fireflyGeometry = new THREE.BufferGeometry();
fireflyGeometry.setAttribute("position", new THREE.BufferAttribute(fireflyPos, 3).setUsage(THREE.DynamicDrawUsage));
fireflyGeometry.setAttribute("phase", new THREE.BufferAttribute(fireflyPhase, 1));
fireflyGeometry.setAttribute("speed", new THREE.BufferAttribute(fireflySpeed, 1));
const fireflyUniforms = { uOpacity: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color("#d8ff8a") } };
const fireflyMesh = new THREE.Points(
  fireflyGeometry,
  new THREE.ShaderMaterial({
    uniforms: fireflyUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float phase; attribute float speed; uniform float uTime; varying float vGlow;
      void main() {
        // blinks: mostly dim, a short bright pulse now and then
        vGlow = pow(0.5 + 0.5 * sin(uTime * speed * 1.7 + phase), 4.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (300.0 + 200.0 * vGlow) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vGlow;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * (0.15 + 0.85 * vGlow) * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  }),
);
fireflyMesh.frustumCulled = false; // positions move every frame
fireflyMesh.visible = false;
scene.add(fireflyMesh);
let firefliesPlaced = false;
// In a ring around the pond, on land, at about knee to head height.
function placeFireflies() {
  if (!pondBox) return;
  const { min, max } = pondBox;
  const m = FIREFLIES.margin;
  for (let i = 0, tries = 0; i < FIREFLIES.count && tries < 2000; tries++) {
    const x = min.x - m + Math.random() * (max.x - min.x + 2 * m);
    const z = min.z - m + Math.random() * (max.z - min.z + 2 * m);
    if (inPond(x, z)) continue;
    fireflyBase[i * 3] = x;
    fireflyBase[i * 3 + 1] = groundHeight(x, z) + 0.6 + Math.random() * 1.8;
    fireflyBase[i * 3 + 2] = z;
    i++;
  }
  firefliesPlaced = true;
}
function updateFireflies() {
  const opacity = THREE.MathUtils.clamp(1 - dayAmount * 2, 0, 1) * (1 - rainAmount);
  fireflyMesh.visible = firefliesPlaced && opacity > 0.01;
  if (!fireflyMesh.visible) return;
  const t = waterUniforms.uTime.value;
  fireflyUniforms.uOpacity.value = opacity;
  fireflyUniforms.uTime.value = t;
  const w = FIREFLIES.wander;
  for (let i = 0; i < FIREFLIES.count; i++) {
    const j = i * 3;
    const p = fireflyPhase[i];
    const s = fireflySpeed[i] * 0.4;
    // slow wandering loop around the base, a little up and down
    fireflyPos[j] = fireflyBase[j] + w * Math.sin(t * s + p) * Math.cos(t * s * 0.7);
    fireflyPos[j + 1] = fireflyBase[j + 1] + 0.5 * Math.sin(t * s * 1.3 + p * 2);
    fireflyPos[j + 2] = fireflyBase[j + 2] + w * Math.cos(t * s * 0.9 + p);
  }
  fireflyGeometry.attributes.position.needsUpdate = true;
}

let townMeshes = [];
const waterMeshes = new Set();
const edgeMeshes = new Set();
const solidBoxes = [];
// extra margin in front (camera side, +z) and on the sides: the sprite is
// wide and stands upright, so it "enters" the object before the feet touch it
function insideSolid(x, z, r, front = r * 2) {
  return solidBoxes.some(
    (b) =>
      x > b.min.x - r * 1.3 &&
      x < b.max.x + r * 1.3 &&
      z > b.min.z - r &&
      z < b.max.z + front,
  );
}
// Straight box around the whole pond (edge + water): clean collision, no steps
let pondBox = null;
function computePondBox() {
  const all = [...waterMeshes, ...edgeMeshes];
  if (!all.length) return;
  pondBox = new THREE.Box3();
  all.forEach((m) => pondBox.expandByObject(m));
}
function inPond(x, z) {
  return (
    !!pondBox &&
    x > pondBox.min.x &&
    x < pondBox.max.x &&
    z > pondBox.min.z &&
    z < pondBox.max.z
  );
}
function isWater(x, z) {
  if (!waterMeshes.size) return false;
  ray.set(new THREE.Vector3(x, 200, z), DOWN);
  const hits = ray.intersectObjects(townMeshes, false);
  return (
    hits.length > 0 &&
    (waterMeshes.has(hits[0].object) || edgeMeshes.has(hits[0].object))
  );
}
const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
// Height of the highest surface at that point (ground, or top of house/tree/fence)
function topHeight(x, z) {
  if (!townMeshes.length) return 0;
  ray.set(new THREE.Vector3(x, 200, z), DOWN);
  // ignore the pond edge stones: they are walls, not floor
  const hits = ray
    .intersectObjects(townMeshes, false)
    .filter((h) => !edgeMeshes.has(h.object));
  return hits.length ? hits[0].point.y : 0;
}
// Ground height: lowest surface (ignores roofs above)
function groundHeight(x, z) {
  if (!townMeshes.length) return 0;
  ray.set(new THREE.Vector3(x, 200, z), DOWN);
  const hits = ray.intersectObjects(townMeshes, false);
  return hits.length ? hits[hits.length - 1].point.y : 0;
}

// A point is "open" if the ground is flat within radius r (nothing tall nearby)
function isOpen(x, z, r) {
  // a lamp post doesn't sit right next to a mailbox/sign/fence or in the pond
  if (insideSolid(x, z, r + 1.5) || inPond(x, z) || onRide(x, z, r + 1.5)) return false;
  const y = groundHeight(x, z);
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    for (const d of [0, r * 0.5, r]) {
      const px = x + Math.cos(ang) * d,
        pz = z + Math.sin(ang) * d;
      if (Math.abs(topHeight(px, pz) - y) > 0.4) return false;
    }
  }
  return true;
}
// Lamp posts in mirrored pairs on both sides of the main dirt road:
// same z on both sides, same distance from the center. If a point isn't
// free, the whole PAIR slides together along the road (z axis only).
const ROAD_CENTER_X = 0;
const OFFSET = 4.6; // ideal distance from the road center to each post (on the grass, right by the dirt)
const OFFSET_MIN = 3.8; // the closest it can get (edge of the dirt)
function placeLampPairs() {
  for (let i = 0; i < LAMP_POSTS.length; i += 2) { // the road's pairs; the fair's posts stay put
    const a = lampPosts[i],
      b = lampPosts[i + 1];
    const z0 = a.position.z;
    // a pair asked for farther out (the pond's ends) keeps that distance instead of hugging the road
    const wide = Math.abs(a.position.x - ROAD_CENTER_X);
    const [offMax, offMin] = wide > OFFSET + 1 ? [wide, wide - 1] : [OFFSET, OFFSET_MIN];
    // first try moving closer to the road (out from under roof eaves);
    // only slide along the road if it doesn't fit even close to it
    const fits = (off, z) =>
      isOpen(ROAD_CENTER_X - off, z, 2.4) &&
      (!b || isOpen(ROAD_CENTER_X + off, z, 2.4));
    let zOk = z0,
      offOk = offMax;
    search: for (let d = 0; d <= 16; d += 0.5) {
      for (const z of [z0 + d, z0 - d]) {
        for (let off = offMax; off >= offMin; off -= 0.25) {
          if (fits(off, z)) {
            zOk = z;
            offOk = off;
            break search;
          }
        }
      }
    }
    if (wide > OFFSET + 1 && b) {
      // far apart, the two face each other: the right one turns its arm (and its light) inward too,
      // so their shadows fall the same way on both sides; a little softer, being close to the benches
      b.rotation.y = Math.PI;
      for (const post of [a, b]) post.children.find((c) => c.isPointLight).userData.dim = 0.7;
    }
    a.position.set(
      ROAD_CENTER_X - offOk,
      groundHeight(ROAD_CENTER_X - offOk, zOk),
      zOk,
    );
    if (b)
      b.position.set(
        ROAD_CENTER_X + offOk,
        groundHeight(ROAD_CENTER_X + offOk, zOk),
        zOk,
      );
  }
}
// Move the post to the nearest open point (spiral search)
function placeLampPost(p) {
  const x0 = p.position.x,
    z0 = p.position.z;
  for (let r = 0; r <= 20; r += 0.75) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = x0 + Math.cos(ang) * r,
        z = z0 + Math.sin(ang) * r;
      if (
        isOpen(x, z, 2.2) &&
        lampPosts.every(
          (o) => o === p || Math.hypot(o.position.x - x, o.position.z - z) > 4,
        )
      ) {
        p.position.set(x, groundHeight(x, z), z);
        return;
      }
    }
  }
}

// ---- Owl (on the message wall's roof; flies to the two nearest lamp posts and back) ----
const owl = createOwl();
scene.add(owl.mesh);
// perches: the top of the wall's roof and the caps of the two lamp posts closest to the wall
function placeOwl() {
  const b = board.position;
  const posts = [...lampPosts].sort((p, q) => p.position.distanceTo(b) - q.position.distanceTo(b)).slice(0, 2);
  owl.setPerches(
    [new THREE.Vector3(b.x, b.y + 6.85, b.z), ...posts.map((p) => p.position.clone().add(new THREE.Vector3(0, 9.55, 0)))],
    performance.now(),
  );
}

// ---- Capybara (middle of town; E feeds it) ----
const capy = createCapybara();
capy.mesh.position.set(6, 0, 4);
scene.add(capy.mesh);
// the open spot nearest the middle, off the spawn point and clear of benches, posts and the board
function placeCapybara() {
  for (let r = 0; r <= 14; r += 0.5)
    for (let a = 0; a < 16; a++) {
      const x = 6 + Math.cos((a / 16) * Math.PI * 2) * r,
        z = 4 + Math.sin((a / 16) * Math.PI * 2) * r;
      if (
        isOpen(x, z, 2.4) &&
        Math.hypot(x, z) > 4 &&
        benches.every((b) => Math.hypot(b.x - x, b.z - z) > 5) &&
        lampPosts.every((l) => Math.hypot(l.position.x - x, l.position.z - z) > 3.5) &&
        Math.hypot(board.position.x - x, board.position.z - z) > 7
      ) {
        capy.mesh.position.set(x, groundHeight(x, z), z);
        return;
      }
    }
}

// The capybara's walk: it goes left and right on the right end of the lower road (the sand path), in
// front of the house on the right, and sits down to eat when someone feeds it. It is the same for
// everyone, frame by frame: where it is depends only on the room's clock and on `capyFed`, the last
// feeding, which the room keeps and sends to all (worker/index.js, "capy"). Nothing here may depend
// on one player (day or night, who stands near): that would put it somewhere else on their screen.
const CAPY_ROAD_Z = 19.4; // the lower half of the path, off the line people walk
const CAPY_REACH = 20; // how far from the middle it goes, at most
const CAPY_SPEED = 1.5; // units per second: a slow stroll
const capyWalk = { on: false, min: 0, max: 0, yAt: NaN };
let clockOffset = 0; // the room's clock minus this device's (from the "you" message)
function placeCapyWalk() {
  const z = CAPY_ROAD_Z;
  const clear = (x) =>
    !inPond(x, z) && !insideSolid(x, z, 1, 1) && Math.abs(topHeight(x, z) - groundHeight(x, z)) < 0.4 &&
    lampPosts.every((l) => Math.hypot(l.position.x - x, l.position.z - z) > 2.5) &&
    benches.every((b) => Math.hypot(b.x - x, b.z - z) > 3.2);
  // a house front looks at this stretch of road: a ray going north at window height meets a wall facing us
  const houseBehind = (x) => {
    ray.set(new THREE.Vector3(x, groundHeight(x, z) + 4.4, z), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObjects(townMeshes, false)[0];
    return !!hit?.face && hit.distance < 14 && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).z > 0.8;
  };
  // the first run of road on the right side with a house behind it
  let min = NaN,
    max = NaN;
  for (let x = 0.5; x <= CAPY_REACH; x += 0.5) {
    if (clear(x) && houseBehind(x)) (max = x), Number.isNaN(min) && (min = x);
    else if (!Number.isNaN(min)) break;
  }
  if (!(max - min >= 6)) return; // no such road in this town: it stays where it is
  Object.assign(capyWalk, { on: true, min, max });
  capy.mesh.position.z = z;
  capy.setPose("walk");
}
// The last feeding: it sat from `at` to `until` (room clock, ms); `lost` is all the sitting before that.
let capyFed = { at: 0, until: 0, lost: 0 };
const roomNow = () => Date.now() + clockOffset;
// where the room's clock puts it: there and back at one speed, standing still on the clock while it sits
function walkCapy(t) {
  const eating = t >= capyFed.at && t < capyFed.until;
  capy.setPose(eating ? "eat" : capyWalk.on ? "walk" : "sit");
  if (!capyWalk.on) return;
  const walked = (t < capyFed.at ? t : eating ? capyFed.at : t - (capyFed.until - capyFed.at)) - capyFed.lost;
  const length = capyWalk.max - capyWalk.min;
  const along = ((walked / 1000) * CAPY_SPEED) % (2 * length);
  const m = capy.mesh.position;
  m.x = capyWalk.min + (along < length ? along : 2 * length - along);
  if (!(Math.abs(m.x - capyWalk.yAt) < 0.5)) m.y = groundHeight((capyWalk.yAt = m.x), m.z); // follows the ground, checked every half unit
  capy.setFacing(along < length ? 1 : -1);
}
// the room says it was fed (to everyone at once), or on joining says how things stand (no phrase)
function capyWasFed(m) {
  if (![m.at, m.until, m.lost].every(Number.isFinite)) return;
  capyFed = { at: m.at, until: m.until, lost: m.lost };
  if (Number.isInteger(m.phrase)) showBubble(capy.mesh, CAPY_PHRASES[Math.abs(m.phrase) % CAPY_PHRASES.length]);
}

// ---- Cats (free-roaming across walkable town, synced by the room clock) ----
function makeCatEntry(cfg) {
  const sprite = createCat(cfg.palette);
  sprite.mesh.position.set(0, 0, 5);
  scene.add(sprite.mesh);
  return {
    ...cfg,
    sprite,
    mesh: sprite.mesh,
    feet: useFeetDepth(sprite.mesh),
    fed: { at: 0, until: 0, lost: 0 },
    leg: null,
    pose: "sit",
    dir: "down",
    ride: null,
    rideAnim: null,
    hopOff: null,
    afterRide: null,
    lastRideAt: null,
    ridingMesh: null,
    ridingFeet: null,
  };
}
const cats = CATS.map(makeCatEntry);
const CAT_NAV_STEP = 2;
const CAT_LEG_MS = 26000;
const CAT_MIN_SIT_MS = 4500;
const CAT_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
let catNav = { nodes: [], buildMs: 0 };

function buildCatNavGrid() {
  const t0 = performance.now();
  const nodes = [];
  if (!townMeshes.length) {
    catNav = { nodes, buildMs: performance.now() - t0 };
    return;
  }
  const groundCache = new Map();
  const sampleGround = (x, z) => {
    const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
    let hit = groundCache.get(key);
    if (hit) return hit;
    ray.set(new THREE.Vector3(x, 200, z), DOWN);
    const hits = ray.intersectObjects(townMeshes, false);
    const water = hits.length > 0 && (waterMeshes.has(hits[0].object) || edgeMeshes.has(hits[0].object));
    const floorHits = hits.filter((h) => !edgeMeshes.has(h.object));
    hit = {
      hasHit: hits.length > 0 && floorHits.length > 0,
      water,
      topY: floorHits.length ? floorHits[0].point.y : 0,
      groundY: hits.length ? hits[hits.length - 1].point.y : 0,
    };
    groundCache.set(key, hit);
    return hit;
  };
  const pointFree = (x, z, refY = null) => {
    if (
      x < townBox.min.x + 1.5 ||
      x > townBox.max.x - 1.5 ||
      z < townBox.min.z + 1.5 ||
      z > townBox.max.z - 1.5
    )
      return false;
    if (insideSolid(x, z, BODY_RADIUS * 0.9, BODY_RADIUS * 1.7)) return false;
    if (onCarousel(x, z, BODY_RADIUS) || onWheel(x, z, BODY_RADIUS)) return false; // cats walk around the rides, not through them
    if (onRide(x, z, BODY_RADIUS)) return false; // cats walk around the rides, not through them
    if (
      inPond(x, z) ||
      inPond(x - BODY_RADIUS, z) ||
      inPond(x + BODY_RADIUS, z) ||
      inPond(x, z - BODY_RADIUS) ||
      inPond(x, z + BODY_RADIUS)
    )
      return false;
    if (Math.abs(x - board.position.x) < 3.8 + BODY_RADIUS * 0.6 && Math.abs(z - board.position.z) < 0.5 + BODY_RADIUS * 0.6)
      return false;
    for (const p of lampPosts)
      if (Math.hypot(p.position.x - x, p.position.z - z) < POST_RADIUS + BODY_RADIUS * 0.6) return false;
    const center = sampleGround(x, z);
    if (!center.hasHit || center.water) return false;
    const base = refY ?? center.groundY;
    const pts = [[0, 0], [BODY_RADIUS, 0], [-BODY_RADIUS, 0], [0, BODY_RADIUS], [0, -BODY_RADIUS]];
    return pts.every(([ox, oz]) => {
      const s = ox === 0 && oz === 0 ? center : sampleGround(x + ox, z + oz);
      return s.hasHit && !s.water && s.topY - base <= MAX_STEP && Math.abs(s.topY - center.groundY) <= MAX_STEP;
    });
  };
  let startX = 0,
    startZ = 0,
    found = pointFree(0, 0);
  if (!found) {
    search: for (let r = CAT_NAV_STEP; r <= 20; r += CAT_NAV_STEP) {
      for (let gx = -r; gx <= r; gx += CAT_NAV_STEP) {
        for (let gz = -r; gz <= r; gz += CAT_NAV_STEP) {
          if (pointFree(gx, gz)) {
            startX = gx;
            startZ = gz;
            found = true;
            break search;
          }
        }
      }
    }
  }
  if (found) {
    const byCell = new Map();
    const cellKey = (x, z) => `${Math.round(x / CAT_NAV_STEP)},${Math.round(z / CAT_NAV_STEP)}`;
    const addNode = (x, z) => {
      const y = sampleGround(x, z).groundY;
      const idx = nodes.length;
      nodes.push({ x, z, y, adj: [] });
      byCell.set(cellKey(x, z), idx);
      return idx;
    };
    const startIdx = addNode(startX, startZ);
    const queue = [startIdx];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      const nu = nodes[u];
      for (let d = 0; d < CAT_DIRS.length; d++) {
        const [dx, dz] = CAT_DIRS[d];
        const nx = nu.x + dx * CAT_NAV_STEP;
        const nz = nu.z + dz * CAT_NAV_STEP;
        const key = cellKey(nx, nz);
        let v = byCell.get(key);
        const mx = (nu.x + nx) * 0.5;
        const mz = (nu.z + nz) * 0.5;
        if (!pointFree(nx, nz, nu.y) || !pointFree(mx, mz, nu.y)) continue;
        const ny = sampleGround(nx, nz).groundY;
        if (Math.abs(ny - nu.y) > MAX_STEP) continue;
        if (v === undefined) {
          v = addNode(nx, nz);
          queue.push(v);
        }
        nu.adj.push([v, d]);
      }
    }
  }
  catNav = { nodes, buildMs: performance.now() - t0 };
  const fallbackY = groundHeight(0, 5);
  for (const cat of cats) {
    cat.leg = null;
    if (!nodes.length) cat.mesh.position.set(0, fallbackY, 5);
  }
}

function catHash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function findCatPath(startIdx, endIdx) {
  const nodes = catNav.nodes;
  if (startIdx === endIdx) return [nodes[startIdx]];
  const n = nodes.length;
  const parent = new Int32Array(n).fill(-1);
  const parentDir = new Int8Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0,
    tail = 0;
  parent[startIdx] = startIdx;
  queue[tail++] = startIdx;
  while (head < tail) {
    const u = queue[head++];
    if (u === endIdx) break;
    const adj = nodes[u].adj;
    const pref = parentDir[u];
    // Expand the straight-ahead neighbor first so paths make clean L-turns across plazas.
    for (let pass = pref >= 0 ? 0 : 1; pass < 2; pass++) {
      for (let i = 0; i < adj.length; i++) {
        const [v, d] = adj[i];
        if ((pass === 0) !== (d === pref) || parent[v] !== -1) continue;
        parent[v] = u;
        parentDir[v] = d;
        queue[tail++] = v;
        if (v === endIdx) {
          head = tail;
          break;
        }
      }
      if (head === tail) break;
    }
  }
  if (parent[endIdx] === -1) return [nodes[startIdx]];
  const path = [];
  for (let cur = endIdx; ; cur = parent[cur]) {
    path.push(nodes[cur]);
    if (cur === startIdx) break;
  }
  path.reverse();
  return path;
}

function getCatLeg(cat, slot) {
  if (cat.leg && cat.leg.slot === slot) return cat.leg;
  const nodes = catNav.nodes;
  const startIdx = cat.afterRide?.nextSlot === slot ? cat.afterRide.nodeIdx : catHash(cat.seed, slot) % nodes.length;
  const endIdx = catHash(cat.seed, slot + 1) % nodes.length;
  const path = findCatPath(startIdx, endIdx);
  const cumDist = [0];
  let totalDist = 0;
  for (let i = 1; i < path.length; i++) {
    totalDist += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    cumDist.push(totalDist);
  }
  const walkMs = totalDist > 0 ? Math.min(CAT_LEG_MS - CAT_MIN_SIT_MS, (totalDist / cat.speed) * 1000) : 0;
  return (cat.leg = { slot, path, cumDist, totalDist, walkMs });
}

const CAT_HEAD_OFFSET_Y = 3.85;
const CAT_GROUND_SCALE = 3.5;
const CAT_PERCH_SCALE = 2.8;
const CAT_HOP_MS = 450;
const CAT_APPROACH_MAX_MS = 2800;
const CAT_APPROACH_SPEED = 8.5;

function nearestCatNode(x, z) {
  const nodes = catNav.nodes;
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.hypot(nodes[i].x - x, nodes[i].z - z);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function resolveRideTarget(playerId) {
  if (!playerId) return null;
  if (playerId === myId || playerId === "me") {
    return {
      mesh: sprite,
      feet: myFeet,
      baseY: pos.y,
      grounded: onGround,
      dir: mySeat >= 0 ? (seatSpot(mySeat)?.dir || dir) : dir,
      name: NAME,
    };
  }
  const o = others.get(playerId);
  if (!o) return null;
  return {
    mesh: o.mesh,
    feet: o.feet,
    baseY: o.mesh.position.y + (o.mesh.userData.lift || 0),
    grounded: !!o.ground,
    dir: o.seat >= 0 ? (seatSpot(o.seat)?.dir || o.dir) : o.dir,
    name: o.name || "trainer",
  };
}

const headCatLift = (mesh) => (cats.some((c) => c.ridingMesh === mesh) ? 2.2 : 0);

function catSlotAt(cat, t) {
  const eating = t >= cat.fed.at && t < cat.fed.until;
  const activeMs = (t < cat.fed.at ? t : eating ? cat.fed.at : t - (cat.fed.until - cat.fed.at)) - cat.fed.lost;
  return Math.floor(activeMs / CAT_LEG_MS);
}

function measurePath(path) {
  const cumDist = [0];
  let totalDist = 0;
  for (let i = 1; i < path.length; i++) {
    totalDist += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    cumDist.push(totalDist);
  }
  return { cumDist, totalDist };
}

function samplePathPoint(path, cumDist, totalDist, dist) {
  let seg = 1;
  while (seg < cumDist.length - 1 && cumDist[seg] < dist) seg++;
  const a = path[seg - 1];
  const b = path[seg];
  const segLen = cumDist[seg] - cumDist[seg - 1];
  const frac = segLen > 0 ? (dist - cumDist[seg - 1]) / segLen : 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return {
    x: a.x + dx * frac,
    y: a.y + (b.y - a.y) * frac,
    z: a.z + dz * frac,
    dirX: dx,
    dirZ: dz,
    dir: Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? "right" : "left") : dz >= 0 ? "down" : "up",
  };
}

function finishLanding(cat, t, landIdx) {
  const nodes = catNav.nodes;
  if (nodes.length) {
    const land = nodes[landIdx];
    cat.mesh.position.set(land.x, land.y, land.z);
    const slot = catSlotAt(cat, t);
    cat.afterRide = { landSlot: slot, nextSlot: slot + 1, nodeIdx: landIdx };
  }
  cat.leg = null;
  cat.ride = null;
  cat.rideAnim = null;
  cat.hopOff = null;
  cat.ridingMesh = null;
  cat.ridingFeet = null;
  cat.mesh.scale.setScalar(CAT_GROUND_SCALE);
  cat.mesh.renderOrder = 10;
}

function startHopOff(cat, t) {
  const nodes = catNav.nodes;
  const m = cat.mesh.position;
  const landIdx = nodes.length ? nearestCatNode(m.x, m.z) : 0;
  if (m.y > groundHeight(m.x, m.z) + 0.4 || cat.ridingMesh) {
    cat.hopOff = { at: t, until: t + CAT_HOP_MS, from: m.clone(), landIdx };
  } else {
    finishLanding(cat, t, landIdx);
  }
  cat.ride = null;
  cat.rideAnim = null;
}

function walkCat(cat, t) {
  const m = cat.mesh.position;
  const nodes = catNav.nodes;

  if (cat.hopOff) {
    const u = Math.min(1, Math.max(0, (t - cat.hopOff.at) / Math.max(1, cat.hopOff.until - cat.hopOff.at)));
    if (u >= 1) {
      finishLanding(cat, t, cat.hopOff.landIdx);
    } else {
      const land = nodes[cat.hopOff.landIdx] || { x: cat.hopOff.from.x, y: groundHeight(cat.hopOff.from.x, cat.hopOff.from.z), z: cat.hopOff.from.z };
      m.set(
        THREE.MathUtils.lerp(cat.hopOff.from.x, land.x, u),
        THREE.MathUtils.lerp(cat.hopOff.from.y, land.y, u) + 2.6 * 4 * u * (1 - u),
        THREE.MathUtils.lerp(cat.hopOff.from.z, land.z, u),
      );
      cat.mesh.scale.setScalar(THREE.MathUtils.lerp(CAT_PERCH_SCALE, CAT_GROUND_SCALE, u));
      cat.mesh.renderOrder = 12;
      cat.ridingMesh = null;
      cat.ridingFeet = null;
      cat.pose = "sit";
      cat.sprite.setPose("sit");
      return;
    }
  }

  if (cat.ride) {
    const target = resolveRideTarget(cat.ride.playerId);
    if (!target) {
      startHopOff(cat, t);
      return;
    }
    const rideDuration = Math.max(1, cat.ride.until - cat.ride.at);
    if (!cat.rideAnim || cat.rideAnim.at !== cat.ride.at) {
      const startPos = m.clone();
      const approachPath = nodes.length
        ? findCatPath(nearestCatNode(startPos.x, startPos.z), nearestCatNode(target.mesh.position.x, target.mesh.position.z))
        : [{ x: startPos.x, y: startPos.y, z: startPos.z }];
      const { cumDist, totalDist } = measurePath(approachPath);
      const rawApproach = totalDist > 0 ? Math.min(CAT_APPROACH_MAX_MS, (totalDist / CAT_APPROACH_SPEED) * 1000) : 0;
      const approachEnd = Math.min(rawApproach, Math.max(0, rideDuration - CAT_HOP_MS * 2));
      const hopOnEnd = Math.min(approachEnd + CAT_HOP_MS, Math.max(approachEnd, rideDuration - CAT_HOP_MS));
      const hopOffStart = Math.max(hopOnEnd, rideDuration - CAT_HOP_MS);
      cat.rideAnim = {
        at: cat.ride.at,
        startPos,
        approachPath,
        cumDist,
        totalDist,
        approachEnd,
        hopOnEnd,
        hopOffStart,
        hopOffFrom: null,
        landIdx: null,
      };
    }
    const anim = cat.rideAnim;
    const elapsed = Math.max(0, t - cat.ride.at);
    const hx = target.mesh.position.x;
    const hy = target.baseY + (target.grounded ? CAT_HEAD_OFFSET_Y - 0.47 : CAT_HEAD_OFFSET_Y);
    const hz = target.mesh.position.z;

    if (t >= cat.ride.until) {
      const landIdx = anim.landIdx ?? (nodes.length ? nearestCatNode(hx, hz) : 0);
      finishLanding(cat, t, landIdx);
    } else if (elapsed < anim.approachEnd) {
      const pt = samplePathPoint(anim.approachPath, anim.cumDist, anim.totalDist, (elapsed / anim.approachEnd) * anim.totalDist);
      m.set(pt.x, pt.y, pt.z);
      cat.mesh.scale.setScalar(CAT_GROUND_SCALE);
      cat.mesh.renderOrder = 10;
      cat.ridingMesh = null;
      cat.ridingFeet = null;
      cat.dir = pt.dir;
      cat.pose = "walk";
      cat.sprite.setDir(cat.dir);
      cat.sprite.setPose("walk");
      return;
    } else if (elapsed < anim.hopOnEnd) {
      const from = anim.approachPath[anim.approachPath.length - 1] || anim.startPos;
      const u = (elapsed - anim.approachEnd) / Math.max(1, anim.hopOnEnd - anim.approachEnd);
      m.set(
        THREE.MathUtils.lerp(from.x, hx, u),
        THREE.MathUtils.lerp(from.y, hy, u) + 3.2 * 4 * u * (1 - u),
        THREE.MathUtils.lerp(from.z, hz, u),
      );
      cat.mesh.scale.setScalar(THREE.MathUtils.lerp(CAT_GROUND_SCALE, CAT_PERCH_SCALE, u));
      cat.mesh.renderOrder = 12;
      cat.ridingMesh = target.mesh;
      cat.ridingFeet = target.feet;
      cat.dir = target.dir;
      cat.pose = "perch";
      cat.sprite.setDir(cat.dir);
      cat.sprite.setPose("perch");
      return;
    } else if (elapsed < anim.hopOffStart) {
      m.set(hx, hy, hz);
      cat.mesh.scale.setScalar(CAT_PERCH_SCALE);
      cat.mesh.renderOrder = 12;
      cat.ridingMesh = target.mesh;
      cat.ridingFeet = target.feet;
      cat.dir = target.dir;
      cat.pose = "perch";
      cat.sprite.setDir(cat.dir);
      cat.sprite.setPose("perch");
      return;
    } else {
      if (!anim.hopOffFrom) {
        anim.hopOffFrom = { x: hx, y: hy, z: hz };
        anim.landIdx = nodes.length ? nearestCatNode(hx, hz) : 0;
      }
      const land = nodes[anim.landIdx] || { x: hx, y: groundHeight(hx, hz), z: hz };
      const u = Math.min(1, (elapsed - anim.hopOffStart) / Math.max(1, rideDuration - anim.hopOffStart));
      m.set(
        THREE.MathUtils.lerp(anim.hopOffFrom.x, land.x, u),
        THREE.MathUtils.lerp(anim.hopOffFrom.y, land.y, u) + 2.6 * 4 * u * (1 - u),
        THREE.MathUtils.lerp(anim.hopOffFrom.z, land.z, u),
      );
      cat.mesh.scale.setScalar(THREE.MathUtils.lerp(CAT_PERCH_SCALE, CAT_GROUND_SCALE, u));
      cat.mesh.renderOrder = 12;
      cat.ridingMesh = null;
      cat.ridingFeet = null;
      cat.pose = "sit";
      cat.sprite.setPose("sit");
      return;
    }
  }

  cat.mesh.scale.setScalar(CAT_GROUND_SCALE);
  cat.mesh.renderOrder = 10;
  cat.ridingMesh = null;
  cat.ridingFeet = null;

  const eating = t >= cat.fed.at && t < cat.fed.until;
  if (!nodes.length) {
    cat.pose = eating ? "eat" : "sit";
    cat.sprite.setPose(cat.pose);
    return;
  }
  const activeMs = (t < cat.fed.at ? t : eating ? cat.fed.at : t - (cat.fed.until - cat.fed.at)) - cat.fed.lost;
  const slot = Math.floor(activeMs / CAT_LEG_MS);
  if (cat.afterRide) {
    if (slot === cat.afterRide.landSlot) {
      const p = nodes[cat.afterRide.nodeIdx];
      m.set(p.x, p.y, p.z);
      cat.pose = eating ? "eat" : "sit";
      cat.sprite.setPose(cat.pose);
      return;
    }
    if (slot > cat.afterRide.nextSlot) cat.afterRide = null;
  }
  const inSlotMs = ((activeMs % CAT_LEG_MS) + CAT_LEG_MS) % CAT_LEG_MS;
  const leg = getCatLeg(cat, slot);
  if (leg.totalDist === 0 || inSlotMs >= leg.walkMs) {
    const end = leg.path[leg.path.length - 1];
    m.set(end.x, end.y, end.z);
    cat.pose = eating ? "eat" : "sit";
    cat.sprite.setPose(cat.pose);
    return;
  }
  const pt = samplePathPoint(leg.path, leg.cumDist, leg.totalDist, (inSlotMs / leg.walkMs) * leg.totalDist);
  m.set(pt.x, pt.y, pt.z);
  cat.dir = pt.dir;
  cat.pose = eating ? "eat" : "walk";
  cat.sprite.setDir(cat.dir);
  cat.sprite.setPose(cat.pose);
}

function catWasFed(m) {
  const cat = cats.find((c) => c.id === m.id);
  if (!cat || ![m.at, m.until, m.lost].every(Number.isFinite)) return;
  cat.fed = { at: m.at, until: m.until, lost: m.lost };
  if (Number.isInteger(m.phrase)) showBubble(cat.mesh, CAT_PHRASES[Math.abs(m.phrase) % CAT_PHRASES.length]);
}

function catRideUpdate(m) {
  const cat = cats.find((c) => c.id === m.id);
  if (!cat) return;
  const now = roomNow();
  if (!m.playerId || !(m.until > m.at) || m.until <= now) {
    if (cat.ride) startHopOff(cat, now);
    return;
  }
  cat.ride = { playerId: m.playerId, at: m.at, until: m.until };
  cat.hopOff = null;
  cat.rideAnim = null;
  if (Number.isInteger(m.phrase) && cat.lastRideAt !== m.at) {
    cat.lastRideAt = m.at;
    showBubble(cat.mesh, CAT_RIDE_PHRASES[Math.abs(m.phrase) % CAT_RIDE_PHRASES.length]);
  }
}

// ---- Collision ----
const BODY_RADIUS = 0.9; // character "width"
const MAX_STEP = 1.2; // height difference it can climb
const POST_RADIUS = 1.1;
function isFree(x, z, currentY) {
  if (
    x < townBox.min.x ||
    x > townBox.max.x ||
    z < townBox.min.z ||
    z > townBox.max.z
  )
    return false;
  if (insideSolid(x, z, BODY_RADIUS * 0.8, BODY_RADIUS * 1.6)) return false;
  if (onCarousel(x, z, BODY_RADIUS * 0.5)) return false; // round, so not a box: you can walk all around it
  if (onWheel(x, z, BODY_RADIUS * 0.5)) return false;
  if (onRide(x, z, BODY_RADIUS * 0.5)) return false; // the carousel is round, so not a box: you can walk all around it
  // pond: straight box (with the body width), not following the irregular stones
  if (
    inPond(x - BODY_RADIUS, z) ||
    inPond(x + BODY_RADIUS, z) ||
    inPond(x, z - BODY_RADIUS) ||
    inPond(x, z + BODY_RADIUS)
  )
    return false;
  // the capybara is solid, but it moves: a step that takes you away from it is always allowed
  const toCapy = Math.hypot(x - capy.mesh.position.x, z - capy.mesh.position.z);
  if (toCapy < CAPY_RADIUS + BODY_RADIUS * 0.5 && toCapy < Math.hypot(pos.x - capy.mesh.position.x, pos.z - capy.mesh.position.z)) return false;
  const toLucario = Math.hypot(x - lucario.mesh.position.x, z - lucario.mesh.position.z);
  if (lucario.mesh.visible && toLucario < LUCARIO_RADIUS + BODY_RADIUS * 0.5 && toLucario < Math.hypot(pos.x - lucario.mesh.position.x, pos.z - lucario.mesh.position.z)) return false;
  if (Math.abs(x - board.position.x) < 3.8 + BODY_RADIUS * 0.5 && Math.abs(z - board.position.z) < 0.5 + BODY_RADIUS * 0.5) return false;
  for (const p of lampPosts)
    if (
      Math.hypot(p.position.x - x, p.position.z - z) <
      POST_RADIUS + BODY_RADIUS * 0.5
    )
      return false;
  // test the center and 4 points around the body
  const pts = [
    [0, 0],
    [BODY_RADIUS, 0],
    [-BODY_RADIUS, 0],
    [0, BODY_RADIUS],
    [0, -BODY_RADIUS],
  ];
  return pts.every(
    ([ox, oz]) =>
      topHeight(x + ox, z + oz) - currentY <= MAX_STEP &&
      !isWater(x + ox, z + oz),
  );
}

// ---- Character (billboard sprite) ----
// Without a configured sheet, uses an original trainer generated in pixel art.
function createCharacterTexture(gender) {
  const path = sheetAvailable(gender) ? SHEETS[gender] : null;
  if (path) {
    const t = texLoader.load(
      path,
      (t) => {
        t.magFilter = t.minFilter = THREE.NearestFilter;
        t.colorSpace = THREE.SRGBColorSpace;
        removeBackground(t);
        setFrame("down", 0);
        dispatchEvent(new Event("trainer:look")); // the start screen's preview
      },
      undefined,
      () => {
        // asset unavailable: fall back to the original trainer
        failedSheets.add(gender);
        if (gender === GENDER) applyGender(GENDER);
      },
    );
    return t;
  }
  const t = new THREE.CanvasTexture(generateOriginalTrainer(gender, myCap()));
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  queueMicrotask(() => {
    setFrame("down", 0);
    dispatchEvent(new Event("trainer:look"));
  });
  return t;
}
let sheetTex = createCharacterTexture(GENDER);

// Switch my character's gender (new texture on the 3 materials)
function applyGender(gender) {
  GENDER = gender === "female" ? "female" : "male";
  try {
    localStorage.setItem("gender", GENDER);
  } catch {}
  const old = sheetTex;
  sheetTex = createCharacterTexture(GENDER);
  sprite.material.map = sheetTex;
  sprite.customDepthMaterial.map = sheetTex;
  sprite.customDistanceMaterial.map = sheetTex;
  [
    sprite.material,
    sprite.customDepthMaterial,
    sprite.customDistanceMaterial,
  ].forEach((m) => (m.needsUpdate = true));
  old.dispose();
  if (typeof ws !== "undefined" && ws?.readyState === 1)
    ws.send(JSON.stringify({ t: "gender", gender: GENDER, cap: myCap() }));
}
window.applyGender = applyGender; // used by the start screen
// Switch my cap colour (0-2): redraws my sheet and tells the room
window.applyCap = (cap) => {
  CAP = capOf(cap) ?? 0;
  try {
    localStorage.setItem("cap", CAP);
  } catch {}
  applyGender(GENDER);
};

// Switch mid-game: HUD button or the G key (outside the chat)
const toggleGender = () =>
  applyGender(GENDER === "female" ? "male" : "female");
document.querySelector("#switch-trainer").addEventListener("click", (e) => {
  toggleGender();
  e.currentTarget.blur(); // give the keyboard back to the game
});
addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(
    document.activeElement?.tagName,
  );
  if (!typing && !e.repeat && e.key.toLowerCase() === "g") toggleGender();
});

// Original trainers, same layout as the configurable sheet
// (4 directions x 4 steps, 32px frames, 2px gap).
// male: green cap, orange jacket, purple backpack.
// female: coral beanie, long hair, teal coat, skirt, yellow bag.
// a trainer's sheet with its sitting-on-the-ground frames drawn under it (src/ground-sit.js); the row's
// place rides on the canvas
function withSitFrames(cv, cfg) {
  const { canvas, row } = addSitFrames(cv, cfg, framePos);
  canvas.sitRow = row;
  return canvas;
}
function generateOriginalTrainer(gender = "male", cap = null) {
  const fem = gender === "female";
  const {
    frame: Q,
    gap: B,
    origin: [ox, oy],
  } = GRID;
  const cv = Object.assign(document.createElement("canvas"), {
    width: ox + 4 * (Q + B),
    height: oy + 4 * (Q + B),
  });
  const c = cv.getContext("2d");
  const P = 2; // 1 character "pixel" = 2px in the frame (16x16 logical)
  const px = (x0, y0, x, y, w, h, color) => {
    c.fillStyle = color;
    c.fillRect(x0 + x * P, y0 + y * P, w * P, h * P);
  };
  const COLOR = fem
    ? {
        skin: "#f4caa6",
        hair: "#5a3524",
        cap: "#ef6f5e",
        brim: "#c24f40",
        jacket: "#2f8f9d",
        jacket2: "#226b76",
        pants: "#33334a",
        shoes: "#f4f4f4",
        backpack: "#f2c14e",
        eye: "#1b1b24",
        outline: "#1b1b24",
      }
    : {
        skin: "#f2c29a",
        hair: "#3b2a20",
        cap: "#2f9e6b",
        brim: "#1f6e4a",
        jacket: "#f08a3c",
        jacket2: "#c96524",
        pants: "#2c3550",
        shoes: "#f4f4f4",
        backpack: "#6b4fa3",
        eye: "#1b1b24",
        outline: "#1b1b24",
      };
  if (CAPS[cap]) {
    // the generated trainer's cap in the chosen colour (a darker brim under it)
    COLOR.cap = CAPS[cap].swatch;
    COLOR.brim = "#" + new THREE.Color(COLOR.cap).multiplyScalar(0.7).getHexString();
  }
  const dirs = ["down", "up", "left", "right"];
  dirs.forEach((dir, row) => {
    for (let step = 0; step < 4; step++) {
      const x0 = ox + step * (Q + B),
        y0 = oy + row * (Q + B);
      const bob = step % 2 ? 1 : 0; // bobs up and down while walking
      const leg = step === 1 ? 1 : step === 3 ? -1 : 0;
      const y = (v) => v - bob;
      // legs and shoes
      px(x0, y0, 5, y(12), 2, 2 + (leg > 0 ? 1 : 0), COLOR.pants);
      px(x0, y0, 9, y(12), 2, 2 + (leg < 0 ? 1 : 0), COLOR.pants);
      px(x0, y0, 5, y(14 + (leg > 0 ? 1 : 0)), 2, 1, COLOR.shoes);
      px(x0, y0, 9, y(14 + (leg < 0 ? 1 : 0)), 2, 1, COLOR.shoes);
      // body
      px(x0, y0, 4, y(7), 8, 5, COLOR.jacket);
      px(x0, y0, 4, y(11), 8, 1, COLOR.jacket2);
      if (dir === "up") px(x0, y0, 5, y(7), 6, 4, COLOR.backpack);
      if (dir === "left") px(x0, y0, 10, y(7), 2, 4, COLOR.backpack);
      if (dir === "right") px(x0, y0, 4, y(7), 2, 4, COLOR.backpack);
      // arms
      if (dir === "down" || dir === "up") {
        px(x0, y0, 3, y(8), 1, 3, COLOR.skin);
        px(x0, y0, 12, y(8), 1, 3, COLOR.skin);
      }
      // head
      px(x0, y0, 4, y(2), 8, 5, dir === "up" ? COLOR.hair : COLOR.skin);
      px(x0, y0, 4, y(1), 8, 2, COLOR.cap);
      if (dir === "down") {
        px(x0, y0, 4, y(3), 8, 1, COLOR.brim);
        px(x0, y0, 6, y(4), 1, 1, COLOR.eye);
        px(x0, y0, 9, y(4), 1, 1, COLOR.eye);
      }
      if (dir === "left") {
        px(x0, y0, 2, y(3), 4, 1, COLOR.brim);
        px(x0, y0, 5, y(4), 1, 1, COLOR.eye);
        px(x0, y0, 9, y(2), 3, 4, COLOR.hair);
      }
      if (dir === "right") {
        px(x0, y0, 10, y(3), 4, 1, COLOR.brim);
        px(x0, y0, 10, y(4), 1, 1, COLOR.eye);
        px(x0, y0, 4, y(2), 3, 4, COLOR.hair);
      }
      if (fem) {
        // long hair falling over the shoulders + skirt over the pants
        if (dir === "down") {
          px(x0, y0, 3, y(3), 1, 6, COLOR.hair);
          px(x0, y0, 12, y(3), 1, 6, COLOR.hair);
        }
        if (dir === "up") px(x0, y0, 4, y(4), 8, 5, COLOR.hair);
        if (dir === "left") px(x0, y0, 9, y(5), 3, 4, COLOR.hair);
        if (dir === "right") px(x0, y0, 4, y(5), 3, 4, COLOR.hair);
        px(x0, y0, 4, y(11), 8, 2, COLOR.jacket2);
      }
    }
  });
  return withSitFrames(cv, GRID);
}
// Lit "billboard" plane: receives lamp light and casts a shadow
// with the sprite's cutout (alphaTest on the depth materials too).
const characterGeo = new THREE.PlaneGeometry(1, 1);
characterGeo.translate(0, 0.45, 0); // feet near the origin
const sprite = new THREE.Mesh(
  characterGeo,
  new THREE.MeshLambertMaterial({
    map: sheetTex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  }),
);
sprite.customDepthMaterial = new THREE.MeshDepthMaterial({
  map: sheetTex,
  alphaTest: 0.5,
  depthPacking: THREE.RGBADepthPacking,
});
sprite.customDistanceMaterial = new THREE.MeshDistanceMaterial({
  map: sheetTex,
  alphaTest: 0.5,
});
sprite.castShadow = true;
sprite.receiveShadow = false;
sprite.scale.set(5, 5, 1);
scene.add(sprite);

// very light contact shadow, just to "seat" the feet on the ground
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.7, 16),
  new THREE.MeshBasicMaterial({
    map: glowTexture,
    color: 0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  }),
);
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

// Replace the sheet's background color (pixel 0,0 of the first frame) with transparent
function removeBackground(t, cfg = CHARACTER.cfg, gender = GENDER, cap = myCap()) {
  const img = t.image;
  const cv = Object.assign(document.createElement("canvas"), {
    width: img.width,
    height: img.height,
  });
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  const [ox, oy] = cfg.origin;
  const i0 = (oy * cv.width + ox) * 4;
  const bg = [d.data[i0], d.data[i0 + 1], d.data[i0 + 2]];
  for (let i = 0; i < d.data.length; i += 4) {
    if (
      Math.abs(d.data[i] - bg[0]) < 8 &&
      Math.abs(d.data[i + 1] - bg[1]) < 8 &&
      Math.abs(d.data[i + 2] - bg[2]) < 8
    )
      d.data[i + 3] = 0;
  }
  recolorCap(d.data, cv.width, gender, cap);
  ctx.putImageData(d, 0, 0);
  // the sitting row makes the image taller, and a texture already on the GPU can't change size:
  // dispose of it so the next frame uploads a new one with the new image
  t.dispose();
  t.image = withSitFrames(cv, cfg);
  t.needsUpdate = true;
}

function setFrame(dir, step, running = false) {
  const img = sheetTex.image;
  if (!img || !img.width) return;
  const cfg = running && SHEETS[GENDER] ? RUN_CROP[GENDER] : CHARACTER.cfg;
  const { x, y, w, h } = framePos(cfg, dir, step);
  sheetTex.repeat.set(w / img.width, h / img.height);
  sheetTex.offset.set(x / img.width, 1 - (y + h) / img.height);
}

// ---- 2.5D-style occlusion ----
// Decided by the feet position: if nothing is between the camera and the feet,
// the whole sprite is drawn in front of everything (the body isn't cut by
// walls/roofs behind it). If something is in front, it occludes normally.
// Every sprite pixel uses the depth of the FEET (pulled slightly forward):
// whatever is in front of the feet covers the whole body; whatever is behind never cuts it.
// Every trainer does this the same way (yours and the others'), so between two trainers the one
// whose feet are nearer the camera is always the one in front, from head to toe.
function useFeetDepth(mesh, feet = new THREE.Vector3(), order = 10) {
  const uFeet = { value: feet };
  mesh.renderOrder = order;
  mesh.material.depthTest = true;
  mesh.material.depthWrite = true;
  mesh.material.onBeforeCompile = (shader) => {
    shader.uniforms.uFeet = uFeet;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uFeet;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vec4 feetClip = projectionMatrix * viewMatrix * vec4(uFeet, 1.0);
gl_Position.z = (feetClip.z / feetClip.w) * gl_Position.w;`,
      );
  };
  return uFeet.value;
}
const myFeet = useFeetDepth(sprite);
const capyFeet = useFeetDepth(capy.mesh);
const owlFeet = useFeetDepth(owl.mesh);
const lucario = createLucario();
scene.add(lucario.mesh, lucario.aura);
lucario.mesh.visible = false;
const lucarioFeet = useFeetDepth(lucario.mesh);
// Use the same contact-shadow setup as the player: a flat circle with the
// shared radial glow texture, placed directly on the sampled ground.
const lucarioGroundShadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.55, 20),
  new THREE.MeshBasicMaterial({
    map: glowTexture,
    color: 0x000000,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  }),
);
lucarioGroundShadow.rotation.x = -Math.PI / 2;
lucarioGroundShadow.visible = false;
scene.add(lucarioGroundShadow);

const _toCam = new THREE.Vector3();
const occlusionRay = new THREE.Ray();
const _hit = new THREE.Vector3();
// reference point for a trainer standing at (x, y, z): the feet, pulled a bit toward the camera
function setFeet(feet, x, y, z) {
  feet.set(x, y + 0.2, z);
  // 2.4: covers the body height seen from above (tops of objects right behind
  // are closer to the camera than the feet). Smaller = objects behind cut the head;
  // larger = the sprite starts drawing over things that are in front of it.
  _toCam.copy(camera.position).sub(feet).normalize();
  // the message board is thin, so right behind it the full margin would put the feet in front of it:
  // there the margin shrinks to what fits between the feet and the board's back
  let margin = 2.4;
  // ...and never past a bench in front of you, or you'd be drawn over it while behind it
  occlusionRay.set(feet, _toCam);
  for (const box of benchBoxes) {
    if (box.containsPoint(feet)) continue; // sitting on it (side benches)
    if (occlusionRay.intersectBox(box, _hit)) margin = Math.min(margin, Math.max(0, feet.distanceTo(_hit) - 0.1));
  }
  // (the same for the candles on the grass, which are small and low)
  for (const [thing, halfWidth] of [[board, 5], [candles, 1.6]]) {
    const behind = thing.position.z - z;
    if (behind > 0 && Math.abs(x - thing.position.x) < halfWidth)
      margin = Math.max(0, Math.min(margin, behind * _toCam.z - 0.3));
  }
  feet.addScaledVector(_toCam, margin);
}
function updateOcclusion() {
  setFeet(myFeet, pos.x + slide.x, pos.y, pos.z + slide.z);
  setFeet(capyFeet, capy.mesh.position.x, capy.mesh.position.y, capy.mesh.position.z);
  setFeet(owlFeet, owl.mesh.position.x, owl.mesh.position.y, owl.mesh.position.z);
  if (lucario.mesh.visible) setFeet(lucarioFeet, lucario.mesh.position.x, lucario.mesh.position.y, lucario.mesh.position.z);
  for (const o of others.values()) setFeet(o.feet, o.mesh.position.x, o.mesh.position.y, o.mesh.position.z);
  // After trainers: a perched cat shares its rider's depth nudged slightly forward so it sits
  // over the cap without Z-fighting while still hiding behind walls/benches in front of the rider.
  for (const cat of cats) {
    if (cat.ridingFeet) {
      _toCam.copy(camera.position).sub(cat.ridingFeet).normalize();
      cat.feet.copy(cat.ridingFeet).addScaledVector(_toCam, 0.05);
    } else setFeet(cat.feet, cat.mesh.position.x, cat.mesh.position.y, cat.mesh.position.z);
  }
}

// ---- Movement ----
const keys = {};
let gamePaused = true;
addEventListener("game:pause", (e) => {
  gamePaused = e.detail;
  if (gamePaused) Object.keys(keys).forEach((k) => (keys[k] = false));
});
// typing anywhere (the chat, a private chat's window, a name, the wall): the keys are letters, not steps
const inTextField = (el = document.activeElement) => ["INPUT", "TEXTAREA"].includes(el?.tagName) || !!el?.isContentEditable;
addEventListener("keydown", (e) => {
  if (inTextField()) return;
  keys[e.key.toLowerCase()] = true;
});
// a key held while a text field takes the focus would never be released for the game: let go of all
addEventListener("focusin", (e) => {
  if (inTextField(e.target)) Object.keys(keys).forEach((k) => (keys[k] = false));
});
addEventListener("keyup", (e) => (keys[e.key.toLowerCase()] = false));

// Touch: a floating joystick. Put a finger anywhere on the scene and drag;
// pushing past ~90% of the ring runs.
const STICK_R = 56;
const stick = { id: null, ox: 0, oy: 0, x: 0, z: 0, mag: 0 };
const elStick = Object.assign(document.createElement("div"), { id: "stick" });
elStick.append(Object.assign(document.createElement("div"), { className: "knob" }));
document.body.append(elStick);
const canvasEl = renderer.domElement;
canvasEl.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch" || stick.id !== null || gamePaused) return;
  document.activeElement?.blur?.(); // close the keyboard
  stick.id = e.pointerId;
  stick.ox = e.clientX;
  stick.oy = e.clientY;
  elStick.style.left = `${e.clientX}px`;
  elStick.style.top = `${e.clientY}px`;
  elStick.classList.add("on");
  canvasEl.setPointerCapture(e.pointerId);
});
canvasEl.addEventListener("pointermove", (e) => {
  if (e.pointerId !== stick.id) return;
  let vx = e.clientX - stick.ox,
    vy = e.clientY - stick.oy;
  const len = Math.hypot(vx, vy);
  if (len > STICK_R) {
    vx = (vx / len) * STICK_R;
    vy = (vy / len) * STICK_R;
  }
  stick.mag = Math.min(1, len / STICK_R);
  stick.x = stick.mag > 0.2 ? vx / STICK_R : 0; // small dead zone
  stick.z = stick.mag > 0.2 ? vy / STICK_R : 0;
  elStick.firstChild.style.transform = `translate(${vx}px, ${vy}px)`;
});
const releaseStick = (e) => {
  if (e.pointerId !== stick.id) return;
  Object.assign(stick, { id: null, x: 0, z: 0, mag: 0 });
  elStick.classList.remove("on");
  elStick.firstChild.style.transform = "";
};
canvasEl.addEventListener("pointerup", releaseStick);
canvasEl.addEventListener("pointercancel", releaseStick);
const pos = new THREE.Vector3(0, 0, 0);
// sitting or standing moves you at once; the sprite and camera glide over from where you were
const slide = { x: 0, z: 0 };
const glideFrom = (x, z) => ((slide.x += x - pos.x), (slide.z += z - pos.z));
let dir = "down",
  tAnim = 0;
// come back where you left: the position is remembered in this browser
try {
  const saved = JSON.parse(localStorage.getItem("position") || "null");
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.z)) {
    pos.set(saved.x, 0, saved.z);
    if (["down", "up", "left", "right"].includes(saved.dir)) dir = saved.dir;
  }
} catch {}
// a saved spot can be invalid if the town changed: check it once the town exists
let savedPosChecked = false;
function checkSavedPosition() {
  if (savedPosChecked || (!townMeshes.length && !waterMeshes.size)) return;
  savedPosChecked = true;
  // judged at the ground height of each spot (unknown when restoring). The saved spot can be a
  // hair inside a lamp post or the pond edge (movement is checked one axis at a time), so look
  // for the nearest free spot around it before giving up
  const free = (x, z) => isFree(x, z, topHeight(x, z));
  if (free(pos.x, pos.z)) return;
  for (let r = 0.25; r <= 2; r += 0.25)
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
      if (free(x, z)) return void pos.set(x, pos.y, z);
    }
  pos.set(0, 0, 0);
}
let lastSaved = 0,
  lastSavedState = "";
function savePosition(now) {
  if (mySeat >= 0 || now - lastSaved < 1000) return;
  lastSaved = now;
  const state = JSON.stringify({ x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), dir });
  if (state === lastSavedState) return;
  lastSavedState = state;
  try { localStorage.setItem("position", state); } catch {}
}
const SPEED = 9;

// ---- Sitting ----
let mySeat = -1;

// What you hold while sitting: nothing, a laptop on your lap, a coffee or a book. The coffee also stays
// in your hand while you stand still (it goes away while you walk). Pixel art drawn
// in code on the trainer's own 32px frame, on a plane that sits exactly over the trainer and takes
// the same depth (its feet), so it is covered and uncovered together with the body.
const HELD = ["nothing", "a laptop", "a coffee", "a book", "a cigarette"];
// each view: [colour, x, y, w, h, glows, puff, only] rectangles on the 32x32 frame, drawn for a body
// whose middle is on column 16 (front and back views) or whose front edge is on column 22 (side view,
// looking right); bodyShape() measures the real sprite and the art moves to fit it.
// A rectangle with `puff` is steam: it rises and sways over the 4 frames.
// A rectangle with `only` is drawn on that frame alone (the book's page turning).
const HELD_ART = {
  // laptop from the front: on the lap, under the chin; you see the back of the lid and its small light
  "1down": [["#11131a", 10, 22, 13, 6], ["#3a4052", 11, 23, 11, 4], ["#565d75", 11, 23, 11, 1], ["#bfe3ff", 16, 25, 1, 1, 1], ["#23262f", 9, 28, 15, 1]],
  // from the side: base on the knees, lid standing straight at its far end, lit screen turned to the
  // sitter, and the hand reaching forward to rest on the keyboard ("skin" is the trainer's own skin colour)
  "1right": [["#23262f", 18, 28, 8, 1], ["#3a4052", 18, 27, 8, 1], ["#3a4052", 25, 21, 1, 6], ["#bfe3ff", 24, 22, 1, 4, 1], ["skin", 22, 26, 3, 1]],
  // from behind the body hides it: only the screen's light shows past the elbows
  "1up": [["#bfe3ff", 8, 26, 1, 1, 1], ["#bfe3ff", 24, 26, 1, 1, 1]],
  // coffee: a paper cup in one hand, steam above
  "2down": [["#f4ead2", 21, 22, 3, 4], ["#6b4a2f", 21, 23, 3, 2], ["#ffffff", 20, 21, 5, 1], ["#e8e8ee", 22, 19, 1, 2, 1, 0], ["#e8e8ee", 22, 19, 1, 1, 1, 2]],
  // from the side: right against the chest, below the chin, so neither the cup nor the steam crosses the face
  "2right": [["#f4ead2", 22, 24, 3, 4], ["#6b4a2f", 22, 25, 3, 2], ["#ffffff", 21, 23, 5, 1], ["#e8e8ee", 25, 21, 1, 2, 1, 0], ["#e8e8ee", 25, 21, 1, 1, 1, 2]],
  "2up": [["#f4ead2", 23, 23, 2, 3], ["#6b4a2f", 23, 24, 2, 1], ["#ffffff", 23, 22, 2, 1], ["#e8e8ee", 24, 19, 1, 2, 1, 0], ["#e8e8ee", 24, 19, 1, 1, 1, 2]],
  // book from the front: held open under the chin, pages turned to the reader, so you see the
  // cover (two halves around the spine, a gold title on each) and the page edges along the top
  "3down": [["#f4ead2", 10, 22, 6, 1], ["#f4ead2", 17, 22, 6, 1], ["#7a2430", 10, 23, 6, 5], ["#7a2430", 17, 23, 6, 5],
    ["#4e1520", 16, 22, 1, 6], ["#e8c060", 12, 25, 2, 1], ["#e8c060", 19, 25, 2, 1], ["skin", 9, 25, 1, 2], ["skin", 23, 25, 1, 2]],
  // from the side: open in front of the chest, pages up toward the face, the hand under the cover;
  // now and then a page lifts as it turns
  "3right": [["#7a2430", 21, 27, 6, 1], ["#f4ead2", 21, 25, 6, 2], ["#d8ccb0", 21, 26, 6, 1], ["#ffffff", 22, 25, 4, 1],
    ["skin", 22, 27, 2, 1], ["#f4ead2", 24, 23, 1, 2, 0, undefined, 1], ["#f4ead2", 25, 22, 1, 1, 0, undefined, 1]],
  // from behind the body hides it: only the cover's corners show past the elbows
  "3up": [["#7a2430", 8, 25, 1, 2], ["#7a2430", 24, 25, 1, 2]],
  // cigarette from the front: between the fingers of the hand at the side, the ember glowing at its
  // tip (brighter on one frame, a drag) and a thin trail of smoke rising and swaying past the shoulder
  "4down": [["skin", 21, 24, 2, 2], ["#f4f1ea", 23, 24, 3, 1], ["#d9a35b", 22, 24, 1, 1], ["#ff6a2a", 26, 24, 1, 1, 1],
    ["#ffd36b", 26, 24, 1, 1, 1, undefined, 1], ["#b8b8c6", 26, 22, 1, 1, 1, 0], ["#9c9cac", 26, 22, 1, 1, 1, 2]],
  // from the side: the hand in front of the chest, below the chin, a short cigarette pointing forward
  "4right": [["skin", 22, 25, 1, 1], ["#f4f1ea", 23, 25, 1, 1], ["#ff6a2a", 24, 25, 1, 1, 1],
    ["#ffd36b", 24, 25, 1, 1, 1, undefined, 1], ["#b8b8c6", 24, 23, 1, 1, 1, 0], ["#9c9cac", 24, 23, 1, 1, 1, 2]],
  // from behind the body hides it: only the ember past the elbow and the smoke above it
  "4up": [["#ff6a2a", 24, 24, 1, 1, 1], ["#b8b8c6", 24, 22, 1, 1, 1, 0], ["#9c9cac", 24, 22, 1, 1, 1, 2]],
};
const FACE_LIGHT = [0.34, 0.22, 0.4, 0.28]; // how strong the screen's light is on each frame
const FLICKER = [0, 1, 0, 2, 3, 1, 2, 0]; // uneven, like a screen changing
// What a trainer's standing frame looks like for one direction, read from its own sheet: the skin
// pixels of the face (where the laptop's light falls) and how far the body is from where the art
// expects it. Measured once per sheet and direction.
const shapes = new Map();
function bodyShape(tex, cfg, d) {
  const img = tex.image;
  if (!img || !img.width) return null; // sheet still loading
  let bySheet = shapes.get(img);
  if (!bySheet) shapes.set(img, (bySheet = { id: shapes.size }));
  if (bySheet[d]) return bySheet[d];
  const { x, y, w, h } = framePos(cfg, d, 0);
  const cv = document.createElement("canvas");
  cv.width = cv.height = 32;
  const c = cv.getContext("2d", { willReadFrequently: true });
  c.drawImage(img, x, y, w, h, 0, 0, 32, 32);
  const px = c.getImageData(0, 0, 32, 32).data;
  const at = (i, j) => px.subarray((j * 32 + i) * 4, (j * 32 + i) * 4 + 4);
  const [br, bg, bb] = at(0, 0); // a sheet without transparency has its background in the corner
  const solid = (i, j) => { const [r, g, b, a] = at(i, j); return a > 127 && !(r === br && g === bg && b === bb); };
  const skin = (i, j) => { const [r, g, b] = at(i, j); return solid(i, j) && r > 200 && g > 140 && g < 225 && b < 190 && r - b > 40; };
  const face = [];
  const tone = [0, 0, 0, 0]; // r, g, b sums and how many pixels
  let min = 32, max = -1;
  for (let j = 0; j < 32; j++)
    for (let i = 0; i < 32; i++) {
      if (j >= 14 && j <= 22 && skin(i, j)) face.push([i, j]), at(i, j).forEach((v, k) => (tone[k] += k < 3 ? v : 1));
      if (j >= 23 && j <= 26 && solid(i, j)) (min = Math.min(min, i)), (max = Math.max(max, i));
    }
  // hands are skin too: keep only the face, the skin above the body's first row that has none in the middle
  const lastFaceRow = Math.max(...face.filter(([i]) => Math.abs(i - (min + max) / 2) < 3).map(([, j]) => j), 0);
  // from the front the middle is the face's (a bag or an arm on one side would pull the body's off)
  const fx = face.map(([i]) => i);
  const middle = d === "down" && fx.length ? (Math.min(...fx) + Math.max(...fx)) / 2 : (min + max) / 2;
  const shift = max < 0 ? 0 : d === "right" ? max - 22 : d === "left" ? 31 - min - 22 : Math.round(middle) - 16;
  // seen from the front, the art sits right under the chin (row 21 on the sheet it was drawn for)
  const drop = d === "down" && lastFaceRow ? lastFaceRow - 21 : 0;
  return (bySheet[d] = { face: face.filter(([, j]) => j <= Math.max(lastFaceRow, 21)), shift, drop, key: "s" + bySheet.id,
    skin: tone[3] ? `rgb(${tone.slice(0, 3).map((v) => Math.round(v / tone[3])).join(",")})` : "#f0b890" });
}
const heldTex = {};
function heldTextures(item, d, shape) {
  const tick = Math.floor(performance.now() / (item === 1 ? 260 : item === 2 ? 320 : item === 4 ? 420 : 400));
  // the screen's light, steam or smoke rising, or a page turning about every 4 seconds
  const frame = item === 1 ? FLICKER[tick % 8] : item === 2 || item === 4 ? tick % 4 : +(tick % 10 === 9);
  const key = item + d + frame + (shape?.key || "");
  if (heldTex[key]) return heldTex[key];
  const art = HELD_ART[item + (d === "left" ? "right" : d)] || HELD_ART[item + "down"];
  const make = (glowOnly) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 32;
    const c = cv.getContext("2d");
    if (glowOnly) (c.fillStyle = "#000"), c.fillRect(0, 0, 32, 32);
    // the laptop's bluish light, only on the face's own pixels
    if (item === 1 && shape) {
      c.fillStyle = glowOnly ? "rgb(50,90,160)" : `rgba(110,170,255,${FACE_LIGHT[frame]})`;
      for (const [i, j] of shape.face) c.fillRect(i, j, 1, 1);
    }
    if (d === "left") c.setTransform(-1, 0, 0, 1, 32, 0); // mirror the side view
    for (const [color, x, y, w, h, glows, puff, only] of art) {
      if (only !== undefined && only !== frame) continue;
      c.globalAlpha = glowOnly && !glows ? 0.3 : 1; // the rest glows a little too, to stay readable at night
      const rise = puff === undefined ? 0 : (frame + puff) % 4; // 0..3 pixels up, then it starts again
      c.fillStyle = color === "skin" ? shape?.skin || "#f0b890" : color;
      c.fillRect(x + (shape?.shift || 0) + (rise % 2), y + (shape?.drop || 0) - rise, w, h);
    }
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const made = [make(false), make(true)];
  if (shape) heldTex[key] = made; // without the sheet yet, try again next frame
  return made;
}
// the plane for one trainer's item; `feet` is that trainer's depth point
function createHeld(feet) {
  const mesh = new THREE.Mesh(
    characterGeo,
    new THREE.MeshLambertMaterial({ map: glowTexture, emissiveMap: glowTexture, emissive: 0xffffff, emissiveIntensity: 0.9, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }),
  );
  mesh.scale.set(5, 5, 1);
  mesh.visible = false;
  useFeetDepth(mesh, feet, 11); // right after the trainer, at the same depth
  scene.add(mesh);
  return mesh;
}
// which way the item is drawn for a trainer, or null when it doesn't show: anything on a bench,
// and the coffee or the cigarette while standing still
const COFFEE = 2;
const ON_FOOT = [COFFEE, 4]; // what stays in your hand on your feet
const heldDir = (item, seat, still, d) => (!item ? null : seat ? seat.dir : ON_FOOT.includes(item) && still ? d : null);
// put the item over its trainer, seen from direction d (or hide it: d is null)
function showHeld(mesh, body, cfg, item, d) {
  mesh.visible = !!(item && d);
  if (!mesh.visible) return;
  const shape = bodyShape(body.material.map, cfg, d);
  if (!shape) return void (mesh.visible = false);
  [mesh.material.map, mesh.material.emissiveMap] = heldTextures(item, d, shape);
  mesh.position.copy(body.position);
  mesh.rotation.copy(body.rotation);
}
const myHeld = createHeld(myFeet);
let myHold = 0;
try { myHold = [1, 2, 3, 4].includes(+localStorage.getItem("hold")) ? +localStorage.getItem("hold") : 0; } catch {}
const sendHold = () => ws?.readyState === 1 && ws.send(JSON.stringify({ t: "hold", item: myHold }));
const holdBtn = document.querySelector("#hold");
// the button shows what you hold (the cup, unlit, when your hands are empty)
const CUP_ICON = holdBtn.querySelector("svg").innerHTML;
const HELD_ICONS = [
  CUP_ICON,
  '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  CUP_ICON,
  '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  '<path d="M17 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h14"/><path d="M18 8c0-2.5-2-2.5-2-5"/><path d="M21 16a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M22 8c0-2.5-2-2.5-2-5"/><path d="M7 12v4"/>',
];
let holdIcon = 0;
// Q on a bench goes through everything; standing, it goes coffee, cigarette, empty hands
const FOOT_CYCLE = [0, ...ON_FOOT];
function nextHold() {
  if (mySeat >= 0) return (myHold + 1) % HELD.length;
  const i = FOOT_CYCLE.indexOf(myHold);
  return i < 0 ? COFFEE : FOOT_CYCLE[(i + 1) % FOOT_CYCLE.length]; // a laptop or a book in hand gives way to the coffee
}
function updateHoldButton() {
  const shown = mySeat >= 0 || ON_FOOT.includes(myHold) ? myHold : 0; // a laptop or a book waits for a bench
  holdBtn.hidden = false;
  holdBtn.classList.toggle("on", shown > 0);
  holdBtn.setAttribute("aria-label", "hold " + HELD[nextHold()]);
  if (holdIcon !== shown) holdBtn.querySelector("svg").innerHTML = HELD_ICONS[(holdIcon = shown)];
}
let lastHold = 0;
function cycleHold() {
  const now = performance.now();
  if (gamePaused || now - lastHold < 350) return; // stays under the server's rate limit
  lastHold = now;
  myHold = nextHold();
  try { localStorage.setItem("hold", myHold); } catch {}
  sendHold();
}
holdBtn.addEventListener("click", (e) => {
  cycleHold();
  e.currentTarget.blur(); // give the keyboard back to the game
});

// ---- Sitting on the ground (C, or the button in the top card) ----
// You sit down facing the way you stand; everyone sees it, also whoever joins later. Walking, sitting on
// a bench or pressing C again gets you up.
let onGround = false,
  lastGround = 0;
const sendGround = () => ws?.readyState === 1 && ws.send(JSON.stringify({ t: "ground", on: onGround }));
const groundBtn = document.querySelector("#ground-sit");
function setGround(on) {
  const now = performance.now();
  if (on && (gamePaused || mySeat >= 0 || now - lastGround < 350)) return; // stays under the server's rate limit
  if (on === onGround) return;
  lastGround = now;
  onGround = on;
  groundBtn.classList.toggle("on", on);
  groundBtn.setAttribute("aria-label", on ? "stand up" : "sit on the ground");
  sendGround();
}
// the sitting frame facing `d` (false if this texture has none yet)
function setSitFrameTex(tex, d) {
  const img = tex.image,
    row = img?.sitRow;
  if (!row) return false;
  const { x, y, w, h } = sitFramePos(row, d);
  tex.repeat.set(w / img.width, h / img.height);
  tex.offset.set(x / img.width, 1 - (y + h) / img.height);
  return true;
}
groundBtn.addEventListener("click", (e) => {
  setGround(!onGround);
  e.currentTarget.blur(); // give the keyboard back to the game
});
addEventListener("keydown", (e) => {
  if (typing() || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.toLowerCase() === "c") setGround(!onGround);
});

// each sit/stand is numbered and the server's corrections carry the number back, so a late
// answer to an older request can't stand you up from the seat you have now
let sitN = 0;
const sendSeat = () => ws?.readyState === 1 && ws.send(JSON.stringify({ t: "sit", seat: mySeat, n: ++sitN }));
const seatTaken = (id) => [...others.values()].some((o) => o.seat === id);
function nearestFreeSeat() {
  let best = -1,
    bestD = SIT_RANGE;
  const consider = (id) => {
    const s = seatSpot(id);
    if (!s || s.board === false) return; // a gondola is boarded only near the bottom
    const d = Math.hypot(s.x - pos.x, s.z - pos.z);
    if (d < bestD && !seatTaken(id)) (best = id), (bestD = d);
  };
  for (let id = 0; id < benches.length * SEATS_PER_BENCH; id++) consider(id);
  for (let i = 0; i < CAROUSEL.seats; i++) consider(CAROUSEL.firstSeat + i);
  for (let i = 0; i < WHEEL.seats; i++) consider(WHEEL.firstSeat + i);
  for (let i = 0; i < COASTER.seats; i++) consider(COASTER.firstSeat + i); // only while it is at the station (board)
  return best;
}
function sit(id) {
  const s = seatSpot(id);
  if (!s) return;
  setGround(false);
  mySeat = id;
  if (isCoasterSeat(id)) myRide = coasterCycle(roomNow()); // the ride you board: off when the next cycle begins
  const [ox, oz] = [pos.x, pos.z];
  pos.set(s.x, s.y, s.z);
  glideFrom(ox, oz);
  dir = s.dir;
  sendSeat();
}
// Stand up on the nearest free spot around the bench, starting from the way you walked off
// (or its front), then tell the room
function standUp(notify = true, way = null) {
  if (isCarouselSeat(mySeat)) return getOffCarousel(notify);
  if (isWheelSeat(mySeat)) return getOffWheel(notify);
  if (isCoasterSeat(mySeat)) return getOffCoaster(notify);
  const s = seatSpot(mySeat);
  const side = mySeat & 1 ? 1 : -1;
  mySeat = -1;
  if (s) {
    const [fx, fz] = FACING[s.dir];
    // walking toward the other seat (across the bench) gets you off its front instead
    if (way && way[0] * fz * side - way[1] * fx * side > 0.7 * Math.hypot(way[0], way[1])) (way = null), (dir = s.dir);
    const front = way ? Math.atan2(way[1], way[0]) : Math.atan2(fz, fx);
    const ground = groundHeight(s.x, s.z);
    search: for (let d = 2.4; d <= 7; d += 0.4)
      for (let i = 0; i < 16; i++) {
        // that way first, then alternating to each side, the opposite way last
        const a = front + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
        const x = s.x + Math.cos(a) * d,
          z = s.z + Math.sin(a) * d;
        if (isFree(x, z, ground)) {
          const [ox, oz] = [pos.x, pos.z];
          pos.set(x, ground, z);
          glideFrom(ox, oz);
          break search;
        }
      }
  }
  if (notify) sendSeat();
}
// Off a horse: onto the grass just outside the base, beside where the horse is now, then further
// around it (another rider may be getting off there too)
function getOffCarousel(notify) {
  const s = seatSpot(mySeat);
  mySeat = -1;
  if (s) {
    const from = Math.atan2(s.x - CAROUSEL.x, s.z - CAROUSEL.z); // its angle, as carouselSeat measures it
    search: for (let d = CAROUSEL.base + 1; d <= CAROUSEL.base + 4; d += 0.5)
      for (let i = 0; i < 24; i++) {
        const a = from + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
        const x = CAROUSEL.x + Math.sin(a) * d,
          z = CAROUSEL.z + Math.cos(a) * d;
        const ground = groundHeight(x, z);
        if (isFree(x, z, ground)) {
          const [ox, oz] = [pos.x, pos.z];
          pos.set(x, ground, z);
          glideFrom(ox, oz);
          break search;
        }
      }
  }
  if (notify) sendSeat();
}
// Off the roller coaster's sleigh: onto the grass north of the station, by your seat, then further along
let myRide = -1; // the coaster cycle you boarded in
function getOffCoaster(notify) {
  const s = seatSpot(mySeat);
  mySeat = -1;
  if (s) {
    const z = COASTER.exitZ;
    const S = COASTER.station;
    const x0 = Math.max(S.x0, Math.min(S.x1, s.x));
    search: for (let d = 0; d <= 8; d += 0.5)
      for (const x of [x0 + d, x0 - d]) {
        const ground = groundHeight(x, z);
        if (isFree(x, z, ground)) {
          const [ox, oz] = [pos.x, pos.z];
          pos.set(x, ground, z);
          glideFrom(ox, oz);
          break search;
        }
      }
  }
  if (notify) sendSeat();
}
// The ride is over once its cycle is: everyone gets off at the station, so the next riders can board.
// Checked every frame, and every second too, since a tab in the background draws no frames
function leaveFinishedRide() {
  if (isCoasterSeat(mySeat) && coasterCycle(roomNow()) > myRide) standUp();
}
setInterval(leaveFinishedRide, 1000);
// Off a gondola: onto the grass in front of the wheel, below where it is (from up high too: the
// glide brings you down), then further along
function getOffWheel(notify) {
  const s = seatSpot(mySeat);
  mySeat = -1;
  if (s) {
    const z = WHEEL.z + WHEEL.halfDepth + 1.4;
    const x0 = Math.max(WHEEL.x - WHEEL.west, Math.min(WHEEL.x + WHEEL.east, s.x));
    search: for (let d = 0; d <= 6; d += 0.5)
      for (const x of [x0 + d, x0 - d]) {
        const ground = groundHeight(x, z);
        if (isFree(x, z, ground)) {
          const [ox, oz] = [pos.x, pos.z];
          pos.set(x, ground, z);
          glideFrom(ox, oz);
          break search;
        }
      }
  }
  if (notify) sendSeat();
}
const MOVE_KEYS = { w: "up", arrowup: "up", s: "down", arrowdown: "down", a: "left", arrowleft: "left", d: "right", arrowright: "right" };
// at most one sit or stand per SIT_COOLDOWN ms, so mashing E stays under the server's rate limit
const SIT_COOLDOWN = 350;
let lastToggle = 0;
const toggleSit = () => {
  const now = performance.now();
  if (gamePaused || now - lastToggle < SIT_COOLDOWN) return;
  lastToggle = now;
  if (strappedIn()) return; // strapped in until the sleigh is back
  if (mySeat >= 0) return standUp();
  const id = nearestFreeSeat();
  if (id >= 0) sit(id);
};
addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  const k = e.key.toLowerCase();
  if (!typing && !e.repeat && !e.ctrlKey && !e.metaKey && k === "q") cycleHold();
  if (!typing && !e.repeat && !e.ctrlKey && !e.metaKey && k === "e") (mySeat >= 0 || (!nearBoard() && !nearCapy() && !nearCat())) && toggleSit();
  // a quick tap on a move key can end before the next frame: stand up right away
  if (!typing && !gamePaused && mySeat >= 0 && !strappedIn() && MOVE_KEYS[k]) {
    dir = MOVE_KEYS[k];
    standUp(true, FACING[dir]);
  }
});
// respawn asks for a second click, so a curious click doesn't teleport you
let respawnTimer = 0;
document.querySelector("#respawn").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  if (!btn.classList.contains("confirm")) {
    btn.classList.add("confirm");
    clearTimeout(respawnTimer);
    respawnTimer = setTimeout(() => btn.classList.remove("confirm"), 3000);
    return;
  }
  clearTimeout(respawnTimer);
  btn.classList.remove("confirm");
  if (mySeat >= 0) standUp(); // free the seat first, or the room keeps you on the bench
  pos.set(0, 0, 0);
  lastSaved = 0;
  savePosition(performance.now());
  e.currentTarget.blur();
});

const clock = new THREE.Clock();
// ---- Multiplayer ----
// Other players use their configured sheets, with independent textures and crops.
// Position comes over the WebSocket and is smoothed.
const ROOM = "lobby"; // v1: one room only (the server refuses any other)
let NAME = "trainer";
try {
  NAME =
    localStorage.getItem("name") ||
    `trainer${Math.floor(Math.random() * 900 + 100)}`;
} catch {}
NAME = NAME.slice(0, 16);
try {
  localStorage.setItem("name", NAME);
} catch {}

// Change the name in-game: click the name at the top of the chat
const elName = document.querySelector("#my-name");
elName.textContent = NAME;
function changeName(newName) {
  newName = newName.replace(/\s+/g, " ").trim().slice(0, 16);
  if (!newName || newName === NAME) return;
  NAME = newName;
  elName.textContent = NAME;
  try {
    localStorage.setItem("name", NAME);
  } catch {}
  if (MULTIPLAYER && ws?.readyState === 1)
    ws.send(JSON.stringify({ t: "name", name: NAME }));
}
// the enter/pause screen has its own name field: fill it in and apply it on enter
window.applyName = changeName;
const elEnterName = document.querySelector("#enter-name");

// Name colour: the player picks one on the enter/pause screen; a first visit gets a random one.
// Only the colour's name travels (the server refuses anything outside its list); the hex lives here.
// All light and saturated enough to read on the dark chat panel and, outlined, over the grass.
// No gold: that is the admin's.
const NAME_COLORS = {
  coral: "#ff8a7a", peach: "#ffb07a", lime: "#b6e36a", mint: "#6fe3b0", aqua: "#5fd8e8",
  sky: "#7db8ff", lilac: "#b9a2ff", orchid: "#de8cf0", pink: "#ff9ad5", rose: "#ff7fa8",
};
// paint an element with a player's colour (CSS reads --name); an unknown colour keeps the default
const paintName = (el, color) =>
  NAME_COLORS[color] ? el.style.setProperty("--name", NAME_COLORS[color]) : el.style.removeProperty("--name");
let COLOR = "";
try { COLOR = localStorage.getItem("name-color"); } catch {}
if (!NAME_COLORS[COLOR]) {
  const all = Object.keys(NAME_COLORS);
  COLOR = all[Math.floor(Math.random() * all.length)];
  try { localStorage.setItem("name-color", COLOR); } catch {}
}
// the same row of swatches twice: on the enter/pause screen and, in-game, behind the dot next to "you: <name>"
const colorButtons = [];
for (const row of document.querySelectorAll("#name-colors, #my-colors"))
  for (const [name, hex] of Object.entries(NAME_COLORS)) {
    const b = Object.assign(document.createElement("button"), { type: "button", title: name });
    b.dataset.color = name;
    b.style.setProperty("--c", hex);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", name);
    b.addEventListener("click", () => {
      applyColor(name);
      elMyColors.hidden = true; // the in-game row closes once you pick
    });
    row.append(b);
    colorButtons.push(b);
  }
const elMyColors = document.querySelector("#my-colors");
document.querySelector("#my-color").addEventListener("click", () => (elMyColors.hidden = !elMyColors.hidden));
function applyColor(color) {
  const changed = color !== COLOR;
  COLOR = color;
  for (const b of colorButtons) {
    b.classList.toggle("on", b.dataset.color === COLOR);
    b.setAttribute("aria-checked", b.dataset.color === COLOR);
  }
  paintName(document.querySelector("#place .me"), COLOR); // the name and the dot next to it
  paintName(elEnterName, COLOR);
  if (!changed) return;
  try { localStorage.setItem("name-color", COLOR); } catch {}
  if (MULTIPLAYER && ws?.readyState === 1)
    ws.send(JSON.stringify({ t: "color", color: COLOR }));
}
applyColor(COLOR);
elEnterName.value = NAME;
addEventListener("game:pause", (e) => e.detail && (elEnterName.value = NAME));
elName.addEventListener("click", () => {
  const inp = Object.assign(document.createElement("input"), {
    value: NAME,
    maxLength: 16,
    id: "name-input",
  });
  elName.replaceWith(inp);
  inp.focus();
  inp.select();
  let closed = false;
  const close = (save) => {
    if (closed) return; // Enter fires blur right after: close only once
    closed = true;
    if (save) changeName(inp.value);
    if (inp.isConnected) inp.replaceWith(elName);
  };
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation(); // don't walk or open the chat while editing
    if (e.key === "Enter") close(true);
    if (e.key === "Escape") close(false);
  });
  inp.addEventListener("blur", () => inp.isConnected && close(true));
});
const others = new Map(); // id -> { mesh, tex, cfg, target, dir, step, name }
let myId = null;
let myLeaveToken = "";
let ws = null;
let pingTimer = 0;
let reconnectTimer = 0;
let pageUnloading = false;
const PING_EVERY_MS = 25_000;

function setFrameTex(tex, cfg, d, step) {
  const img = tex.image;
  if (!img || !img.width) return;
  const { x, y, w, h } = framePos(cfg, d, step);
  tex.repeat.set(w / img.width, h / img.height);
  tex.offset.set(x / img.width, 1 - (y + h) / img.height);
}

function createOther(p) {
  if (others.has(p.id)) removeOther(p.id);
  const g = p.gender === "female" ? "female" : "male";
  const cap = capOf(p.cap) ?? SHEET_CAP[g]; // none sent: the cap that trainer is drawn with (red cap, white beanie)
  const available = sheetAvailable(g);
  const tex = available
    ? texLoader.load(
        SHEETS[g],
        () => {
          removeBackground(tex, CROP[g], g, cap);
          setFrameTex(tex, CROP[g], o.dir, o.step);
        },
        undefined,
        () => {
          failedSheets.add(g);
          o.cfg = GRID;
          tex.dispose(); // a different size from the sheet: a new texture on the GPU
          tex.image = generateOriginalTrainer(g, cap);
          tex.needsUpdate = true;
        },
      )
    : new THREE.CanvasTexture(generateOriginalTrainer(g, cap));
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    characterGeo,
    new THREE.MeshLambertMaterial({
      map: tex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    }),
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
  mesh.scale.set(5, 5, 1);
  scene.add(mesh);
  const o = {
    mesh,
    feet: useFeetDepth(mesh),
    tex,
    cfg: available ? CROP[g] : GRID,
    target: new THREE.Vector3(p.x, 0, p.z),
    dir: p.dir || "down",
    step: p.step || 0,
    seat: Number.isInteger(p.seat) ? p.seat : -1,
    hold: p.hold | 0,
    ground: !!p.ground, // on joining: someone already sitting on the ground
    fish: fishTarget(p.fish), // on joining: someone whose line is already out
    name: p.name,
    gender: g,
    cap, // for the profile
    color: p.color,
    admin: !!p.admin,
    prs: p.prs | 0, // merged pull requests: the contributor badge
    n: Number.isInteger(p.n) ? p.n : -1, // account number (-1: no account), for the profile
  };
  mesh.position.copy(o.target);
  others.set(p.id, o);
  updateCount();
  return o;
}
// Another player's line, as the room sent it ([x, z] of the bobber, or nothing): null if it isn't out
// or isn't two numbers. Its height is found later, on the water (waterY).
const fishTarget = (v) => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? { x: v[0], y: null, z: v[1] } : null);
// that player's rod, line and bobber, made the first time they are needed
const otherGear = (o) =>
  (o.gear ??= createFishingGear({
    scene,
    camera,
    feetDepth: (mesh) => useFeetDepth(mesh, o.feet, 12),
    shape: (d) => bodyShape(o.tex, o.cfg, d),
  }));
function removeOther(id) {
  const o = others.get(id);
  if (!o) return;
  scene.remove(o.mesh);
  if (o.held) scene.remove(o.held), o.held.material.dispose();
  o.gear?.dispose();
  o.tex.dispose();
  others.delete(id);
  updateCount();
}
function updateCount() {
  const el = document.querySelector("#online");
  if (el)
    el.textContent = `${others.size + 1} online`;
}

let meAdmin = false; // the server confirmed this connection is the admin
let myPrs = 0; // my merged pull requests, once the server knows my GitHub login (/github)
let deployed = ""; // the deploy this tab first connected to
let pendingPassword = ""; // typed after /admin, saved only if the server accepts it
let kicked = false; // kicked or banned: stay out instead of reconnecting
function connect() {
  clearTimeout(reconnectTimer);
  if (pageUnloading) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/ws/${ROOM}`);
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (sock.readyState === 1) sock.send("ping");
    }, PING_EVERY_MS);
    sock.send(JSON.stringify({ t: "hello", v: 1, name: NAME, gender: GENDER, color: COLOR, cap: myCap(), x: pos.x, z: pos.z, dir }));
    if (mySeat >= 0) sendSeat(); // reconnected while sitting
    if (myHold) sendHold();
    if (onGround) sendGround(); // reconnected while sitting on the ground
    if (fishing.spot()) sendFish(fishing.spot().target); // reconnected (or reloaded) with the line out
    // a saved admin logs in again quietly, so everyone sees the admin badge
    let password = "";
    try { password = localStorage.getItem("admin-password") || ""; } catch {}
    if (password) sock.send(JSON.stringify({ t: "auth", password, quiet: true }));
    // and so does a contributor who logged in with GitHub before
    const session = githubSession();
    if (session) sock.send(JSON.stringify({ t: "github", session }));
  };
  sock.onmessage = (ev) => {
    if (ws !== sock || ev.data === "pong") return;
    const m = JSON.parse(ev.data);
    if (m.t === "you") {
      myId = m.id;
      if (Number.isFinite(m.now)) clockOffset = m.now - Date.now(); // the capybara walks by the room's clock
      myLeaveToken = m.token || "";
      // the room reconnected us to a newer deploy than the one this tab loaded with: reload to get
      // it, but not in the middle of something being written
      if (deployed && m.v && m.v !== deployed) {
        const busy = () => wall.isOpen() || elInput.value || document.activeElement?.id === "name-input";
        const go = () => (busy() ? setTimeout(go, 2000) : location.reload());
        go();
      }
      deployed ||= m.v;
    }
    else if (m.t === "state") m.players.forEach(createOther);
    else if (m.t === "joined") createOther(m.player);
    else if (m.t === "left") removeOther(m.id);
    else if (m.t === "chat") receiveChat(m.id, m.name, m.text, m.admin, m.color, m.prs, m.n);
    else if (social.onMessage(m)) {} // accounts, profiles, friends and private chat (src/social.js)
    else if (m.t === "acct") {
      const o = others.get(m.id);
      if (o) o.n = m.n;
    }
    else if (m.t === "history") {
      // what was said before we arrived (also on reconnect, so start clean)
      elMsgs.replaceChildren();
      m.messages.forEach((c) => addToHistory(c.name, c.text, c.id, c.admin, c.color, c.prs, c.n));
      elMsgs.scrollTop = elMsgs.scrollHeight;
    }
    else if (m.t === "radio") receiveCommand(m.command);
    else if (m.t === "note") wall.onNote(m.note, m.total);
    else if (m.t === "note-edit") wall.onNoteEdited(m.note);
    else if (m.t === "note-del") wall.onNoteDeleted(m.id, m.total);
    else if (m.t === "note-like") wall.onNoteLiked(m.id, m.likes);
    else if (m.t === "capy") capyWasFed(m);
    else if (m.t === "stone") stoneThrown(m);
    else if (m.t === "cat") catWasFed(m);
    else if (m.t === "cat-ride") catRideUpdate(m);
    else if (m.t === "error" || m.t === "notice") addToHistory("system", m.msg);
    else if (m.t === "rename") {
      // the server refused our name and gave us another one
      NAME = m.name;
      elName.textContent = NAME;
      elEnterName.value = NAME;
      try { localStorage.setItem("name", NAME); } catch {}
      addToHistory("system", m.msg);
    } else if (m.t === "who") showWho(m);
    else if (m.t === "admin") {
      if (m.id === myId) meAdmin = true;
      const o = others.get(m.id);
      if (o) o.admin = true;
    }
    else if (m.t === "contrib") {
      if (m.id === myId) myPrs = m.prs | 0;
      const o = others.get(m.id);
      if (o) o.prs = m.prs | 0;
    }
    else if (m.t === "github-code") showGithubCode(m);
    else if (m.t === "github-ok") {
      try { localStorage.setItem("github-session", m.session); } catch {}
      closeGithubLogin();
      addToHistory("system", m.prs > 0 ? `github ok: ${m.login}, ${prsText(m.prs)} merged` : `github ok: ${m.login}, no merged PR yet (the badge comes with the first one)`);
    }
    else if (m.t === "github-fail") {
      closeGithubLogin();
      addToHistory("system", m.msg);
    }
    else if (m.t === "github-out") {
      // the server no longer knows this session
      try { localStorage.removeItem("github-session"); } catch {}
    }
    else if (m.t === "admin-ok") {
      // the server accepted the password typed after /admin: keep it and reload to show the controls
      try { localStorage.setItem("admin-password", pendingPassword); } catch {}
      addToHistory("system", "admin ok");
      setTimeout(() => location.reload(), 600);
    } else if (m.t === "kicked") {
      kicked = true;
      addToHistory("system", m.msg);
    }
    else if (m.t === "name") {
      const o = others.get(m.id);
      if (o) o.name = m.name;
    } else if (m.t === "color") {
      const o = others.get(m.id);
      if (o) o.color = m.color;
    } else if (m.t === "gender") {
      // recreate the character with the other gender's look, keeping the position
      const o = others.get(m.id);
      if (o) {
        const p = {
          id: m.id,
          x: o.target.x,
          z: o.target.z,
          dir: o.dir,
          step: o.step,
          seat: o.seat,
          name: o.name,
          color: o.color,
          gender: m.gender,
          cap: m.cap,
          admin: o.admin,
          prs: o.prs,
          n: o.n,
        };
        removeOther(m.id);
        createOther(p);
      }
    } else if (m.t === "hold") {
      const o = others.get(m.id);
      if (o) o.hold = m.item | 0;
    } else if (m.t === "ground") {
      const o = others.get(m.id);
      if (o) o.ground = !!m.on;
    } else if (m.t === "fish") {
      // someone's line went out (where the bobber floats) or came back in
      const o = others.get(m.id);
      if (!o) return;
      o.fish = fishTarget(m.fish);
      if (o.fish && !document.hidden) otherGear(o).cast(); // seen live: the throw is shown
    } else if (m.t === "seat") {
      // the server says who sits where. About you, it only answers a refused or dropped sit:
      // you're not on the seat you asked for, so stand up; or the room still has you seated
      // after you stood up, so say it again
      if (m.id === myId) {
        if (m.n !== sitN) return;
        if (m.seat !== mySeat && mySeat >= 0) standUp(m.seat >= 0);
        else if (m.seat >= 0 && mySeat < 0) setTimeout(sendSeat, 1000);
      } else {
        const o = others.get(m.id);
        if (o) o.seat = m.seat;
      }
    } else if (m.t === "pos") {
      const o = others.get(m.id);
      if (!o) return;
      if (o.target.x !== m.x || o.target.z !== m.z) o.movedAt = performance.now();
      o.target.set(m.x, 0, m.z);
      o.dir = m.dir;
      o.step = m.step;
      o.run = !!m.run;
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    clearInterval(pingTimer);
    pingTimer = 0;
    myLeaveToken = "";
    [...others.keys()].forEach(removeOther);
    if (!kicked && !pageUnloading) reconnectTimer = setTimeout(connect, 2000); // reconnect
  };
}
const MULTIPLAYER = true;
if (MULTIPLAYER) {
  connect();
  const leaveNow = () => {
    pageUnloading = true;
    clearInterval(pingTimer);
    pingTimer = 0;
    clearTimeout(reconnectTimer);
    if (myId && myLeaveToken && navigator.sendBeacon) {
      try { navigator.sendBeacon("/api/leave", JSON.stringify({ id: myId, token: myLeaveToken })); } catch {}
      myLeaveToken = "";
    }
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
      try { ws.close(1000, "pagehide"); } catch {}
    }
  };
  addEventListener("pagehide", leaveNow);
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    pageUnloading = false;
    if (!kicked && (!ws || ws.readyState > 1)) connect();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ws?.readyState === 1) ws.send("ping");
  });
  // radio admin commands go to the server, with the saved password
  connectRadioToServer((idx) => {
    let password = "";
    try { password = localStorage.getItem("admin-password") || ""; } catch {}
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "radio", idx, password }));
  });
}

let lastSend = 0,
  lastState = "";
function sendPosition(now, step, running) {
  if (!ws || ws.readyState !== 1 || now - lastSend < 66) return; // ~15x/s
  const state = `${pos.x.toFixed(2)},${pos.z.toFixed(2)},${dir},${step},${running}`;
  if (state === lastState) return;
  lastSend = now;
  lastState = state;
  ws.send(JSON.stringify({ t: "pos", x: pos.x, z: pos.z, dir, step, ...(running && { run: 1 }) }));
}

function updateOthers(dt) {
  for (const o of others.values()) {
    const m = o.mesh;
    m.position.x = THREE.MathUtils.lerp(
      m.position.x,
      o.target.x,
      Math.min(1, dt * 10),
    );
    m.position.z = THREE.MathUtils.lerp(
      m.position.z,
      o.target.z,
      Math.min(1, dt * 10),
    );
    const seat = o.seat >= 0 ? seatSpot(o.seat) : null;
    if (seat) {
      m.position.set(seat.x, seat.y, seat.z);
      o.target.set(seat.x, 0, seat.z);
    } else m.position.y = topHeight(m.position.x, m.position.z);
    m.castShadow = !isRideSeat(o.seat); // see the loop: riders cast no shadow
    m.rotation.copy(sprite.rotation);
    // running uses the run frames of the same sheet, like your own trainer (not on the code-drawn fallback)
    const running = o.run && !seat && o.cfg === CROP[o.gender];
    // on the ground, facing the way they stood (walking or a bench gets them up)
    if (o.ground && (seat || o.step)) o.ground = false;
    const grounded = o.ground && setSitFrameTex(o.tex, o.dir);
    if (!grounded) setFrameTex(o.tex, running ? RUN_CROP[o.gender] : o.cfg, seat ? seat.dir : o.dir, seat ? 0 : o.step);
    m.userData.lift = running && o.gender === "male" ? 0.8 : 0; // the male run frames sit higher in their cell
    m.position.y -= m.userData.lift;
    // standing still: on the standing frame, a moment after the last step arrived
    const still = !o.step && performance.now() - (o.movedAt || 0) > 300;
    const hd = grounded ? null : heldDir(o.hold, seat, still, o.dir); // the coffee is drawn for a standing body
    if (o.held || hd) showHeld((o.held ??= createHeld(o.feet)), m, o.cfg, o.hold, hd);
    // their rod, line and bobber while their line is out (the bobber's height once the pond is loaded)
    if (o.fish && o.fish.y === null) o.fish.y = waterY(o.fish.x, o.fish.z);
    const fishes = o.fish && o.fish.y !== null;
    if (fishes || o.gear) otherGear(o).draw(Date.now(), m, seat ? seat.dir : o.dir, fishes ? "focus" : "idle", o.fish);
  }
}

// ---- Chat + bubble above the head ----
const elMsgs = document.querySelector("#msgs");
const elInput = document.querySelector("#msg");
const bubbles = new Map(); // owner (mesh) -> { el, until }
// any text field (chat or the admin login): game keys and the Enter shortcut stay out of it
const typing = () => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);

// ---- Mentions: "@name" in the chat ----
// Everyone sees the message; it's highlighted only for whoever it names. Names aren't unique and can
// have spaces, so "@" is matched against the names in the room (the longest that fits wins), without
// telling upper from lower case, and must end where the name ends (not in the middle of a word).
const roomNames = () => {
  const all = new Map(); // lower case -> { name, color }
  for (const o of others.values()) if (o.name) all.set(o.name.toLowerCase(), { name: o.name, color: o.color });
  all.set(NAME.toLowerCase(), { name: NAME, color: COLOR });
  return [...all.values()].sort((a, b) => b.name.length - a.name.length);
};
const endsWord = (text, i) => i >= text.length || !/[\p{L}\p{N}_]/u.test(text[i]);
// the text split into plain parts and mentions: [{ text }, { text, at: { name, color } }, ...]
function mentionParts(text) {
  const names = roomNames(),
    lower = text.toLowerCase(),
    parts = [];
  let from = 0;
  for (let i = text.indexOf("@"); i >= 0; i = text.indexOf("@", i + 1)) {
    const hit = names.find((n) => lower.startsWith(n.name.toLowerCase(), i + 1) && endsWord(text, i + 1 + n.name.length));
    if (!hit) continue;
    const end = i + 1 + hit.name.length;
    if (i > from) parts.push({ text: text.slice(from, i) });
    parts.push({ text: text.slice(i, end), at: hit });
    from = end;
    i = end - 1; // the next "@" is searched for after this mention
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}
const mentionsMe = (parts) => parts.some((p) => p.at && p.at.name.toLowerCase() === NAME.toLowerCase());
// the message's text with each "@name" in bold, in that player's name colour (textContent only: no HTML)
function mentionText(el, parts) {
  el.replaceChildren(
    ...parts.map((p) => {
      if (!p.at) return document.createTextNode(p.text);
      const b = Object.assign(document.createElement("b"), { className: "at", textContent: p.text });
      paintName(b, p.at.color);
      return b;
    }),
  );
}

const prsText = (n) => `${n} PR${n === 1 ? "" : "s"}`;
// Red 1–10, blue 11–20, black 21–50, then the purple Master Ball at 51+.
// Highest threshold first; its index runs backwards through the four balls in the sprite sheet.
const PR_TIERS = [{ from: 51 }, { from: 21 }, { from: 11 }, { from: 1 }];
/** Fills el with the ball for prs merged pull requests and the count (nothing for 0). */
function showPrs(el, prs) {
  if (el.dataset.prs === String(prs)) return;
  el.dataset.prs = prs;
  el.replaceChildren();
  el.title = prs > 0 ? `${prsText(prs)} merged` : "";
  if (!(prs > 0)) return;
  const tier = PR_TIERS.findIndex((t) => prs >= t.from);
  const ball = Object.assign(document.createElement("i"), { ariaHidden: "true" });
  ball.style.backgroundPosition = `${(PR_TIERS.length - 1 - tier) * (100 / (PR_TIERS.length - 1))}% 0`;
  el.append(ball, prsText(prs));
}
function addToHistory(name, text, id, admin, color, prs = 0, n = -1) {
  const d = document.createElement("div");
  d.className = admin ? "m admin" : "m";
  const s = document.createElement("small");
  s.textContent = name;
  if (prs > 0) showPrs(s.appendChild(Object.assign(document.createElement("span"), { className: "prs" })), prs);
  paintName(s, color);
  // a name opens that player's profile (the admin gets the kick and ban menu, with the profile in it)
  if (id && name !== "system") {
    s.className = "mod";
    s.addEventListener("click", (e) => nameClicked(e, id, { name, color, prs, n }));
  }
  const t = document.createElement("span");
  if (name === "system") t.textContent = text; // textContent: no HTML from the chat
  else {
    const parts = mentionParts(text);
    mentionText(t, parts);
    // someone else named you: highlighted for you only
    if (mentionsMe(parts) && id !== myId && id !== "me") d.classList.add("mention");
  }
  d.append(s, t);
  // follow new messages only if already at the bottom (don't yank someone reading old ones)
  const atBottom = elMsgs.scrollHeight - elMsgs.scrollTop - elMsgs.clientHeight < 40;
  elMsgs.append(d);
  while (elMsgs.children.length > 60) elMsgs.firstChild.remove();
  if (atBottom || name === NAME) elMsgs.scrollTop = elMsgs.scrollHeight;
}

function showBubble(owner, text, mention = false, durationMs = null) {
  let b = bubbles.get(owner);
  if (!b) {
    b = {
      el: Object.assign(document.createElement("div"), { className: "bubble" }),
      until: 0,
    };
    document.body.append(b.el);
    bubbles.set(owner, b);
  }
  b.el.classList.toggle("mention", mention);
  b.el.replaceChildren(
    Object.assign(document.createElement("span"), { textContent: text }),
  );
  b.el.style.opacity = 1;
  b.until = performance.now() + (durationMs ?? 4000 + text.length * 60); // optional short-lived NPC reactions
}

// ---- Admin: click a name (above a trainer or in the chat) to kick or ban ----
let IS_ADMIN = false;
try { IS_ADMIN = !!localStorage.getItem("admin-password"); } catch {}
const modMenu = Object.assign(document.createElement("div"), { id: "mod-menu", className: "glass", hidden: true });
document.body.append(modMenu);
// A click on a name: whose it is now (they may have logged in since that chat line), then the profile
function nameClicked(e, id, seen) {
  const mine = !id || id === myId || id === "me";
  const o = mine ? null : others.get(id);
  const who = mine
    ? { ...seen, name: NAME, color: COLOR, gender: GENDER, cap: myCap(), n: social.myAccount(), online: true }
    : { ...seen, ...(o && { name: o.name, color: o.color, gender: o.gender, cap: o.cap, n: o.n, online: true }) };
  if (IS_ADMIN && !mine) return openModMenu(e, id, who.name, who);
  social.openProfile(who.n ?? -1, who);
}
function openModMenu(e, id, name, who) {
  e.stopPropagation();
  let password = "";
  try { password = localStorage.getItem("admin-password") || ""; } catch {}
  // ask the server who this is (IP tag and other names); the answer fills the menu in (showWho)
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "who", id, password }));
  modMenu.dataset.id = id;
  modMenu.replaceChildren(
    Object.assign(document.createElement("b"), { textContent: name }),
    Object.assign(document.createElement("small"), { className: "who", textContent: "…" }),
    (() => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: "profile" });
      b.addEventListener("click", () => ((modMenu.hidden = true), social.openProfile(who?.n ?? -1, who || { name })));
      return b;
    })(),
    ...["kick", "ban"].map((action) => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: action });
      b.addEventListener("click", () => {
        let password = "";
        try { password = localStorage.getItem("admin-password") || ""; } catch {}
        if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "mod", action, id, password }));
        modMenu.hidden = true;
      });
      return b;
    }),
  );
  modMenu.style.left = `${Math.min(e.clientX, innerWidth - 140)}px`;
  modMenu.style.top = `${Math.min(e.clientY + 8, innerHeight - 140)}px`;
  modMenu.hidden = false;
}
addEventListener("pointerdown", (e) => {
  if (!modMenu.hidden && !modMenu.contains(e.target)) modMenu.hidden = true;
});
function showWho(m) {
  const el = modMenu.querySelector(".who");
  if (!el || modMenu.dataset.id !== m.id) return;
  const lines = [`#${m.tag}`];
  if (m.sameTag.length) lines.push(`online too: ${m.sameTag.join(", ")}`);
  if (m.names.length) lines.push(`also was: ${m.names.join(", ")}`);
  el.textContent = lines.join("\n");
}

// ---- Name above each trainer ----
const nameTags = new Map(); // mesh -> div
function nameTag(mesh, name, id, admin, color, prs = 0) {
  let el = nameTags.get(mesh);
  if (!el) {
    el = Object.assign(document.createElement("div"), { className: "tag" });
    el.append(
      Object.assign(document.createElement("b"), { className: "badge", textContent: "admin" }),
      Object.assign(document.createElement("b"), { className: "contrib" }),
      Object.assign(document.createElement("span"), { className: "who" }),
    );
    // a name opens that player's profile (yours too); the admin gets the kick and ban menu first
    el.classList.add("mod");
    el.addEventListener("click", (e) => nameClicked(e, id || myId, { name: el.lastChild.textContent, color: el.dataset.color }));
    document.body.append(el);
    nameTags.set(mesh, el);
  }
  if (el.lastChild.textContent !== name) el.lastChild.textContent = name;
  if (el.dataset.color !== (color || "")) paintName(el, (el.dataset.color = color || ""));
  el.classList.toggle("admin", !!admin);
  // contributor: a ball and the merged pull requests
  showPrs(el.children[1], prs | 0);
}
function updateNameTags() {
  nameTag(sprite, NAME, null, meAdmin, COLOR, myPrs);
  for (const [id, o] of others) nameTag(o.mesh, o.name || "trainer", id, o.admin, o.color, o.prs);
  for (const [mesh, el] of nameTags) {
    if (!mesh.parent) { el.remove(); nameTags.delete(mesh); continue; }
    const baseY = mesh === sprite ? pos.y : mesh.position.y + (mesh.userData.lift || 0);
    _v.set(mesh.position.x, baseY + mesh.scale.y * 0.92 + headCatLift(mesh), mesh.position.z).project(camera);
    el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
    el.style.display = _v.z < 1 ? "" : "none";
  }
}

const _v = new THREE.Vector3();
// "press E to sit" over the nearest free seat, while you're close enough to take it
const sitPrompt = document.querySelector("#sit-prompt");
sitPrompt.addEventListener("click", (e) => {
  toggleSit();
  e.currentTarget.blur(); // give the keyboard back to the game
});
// The roller coaster's countdown over its station, for whoever is near it or riding: the seconds left
// to board while the train waits, then the seconds until it is back
const coasterSign = document.querySelector("#coaster-sign");
const COASTER_SIGN_NEAR = 18;
const COASTER_SIGN_AT = { x: (COASTER.station.x0 + COASTER.station.x1) / 2, z: COASTER.station.z1 };
function updateCoasterSign() {
  const near = Math.hypot(pos.x - COASTER_SIGN_AT.x, pos.z - COASTER_SIGN_AT.z) < COASTER_SIGN_NEAR || isCoasterSeat(mySeat);
  const now = roomNow();
  const board = coasterBoardLeft(now);
  coasterSign.hidden = !fairPlaced || gamePaused || !near;
  if (coasterSign.hidden) return;
  const html = board ? `all aboard! leaves in <b>${board}s</b>` : `back at the station in <b>${coasterBackIn(now) || 1}s</b>`;
  if (coasterSign.innerHTML !== html) coasterSign.innerHTML = html;
  coasterSign.classList.toggle("go", !!board);
  _v.set(COASTER_SIGN_AT.x, coaster.root.position.y + 7.4, COASTER_SIGN_AT.z).project(camera); // over the garland
  coasterSign.hidden = _v.z > 1; // behind the camera
  coasterSign.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  coasterSign.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
}
function updateSitPrompt(seat) {
  const s = seat >= 0 && !gamePaused && !typing() && !nearBoard() && !nearCapy() && !nearCat() ? seatSpot(seat) : null;
  sitPrompt.hidden = !s;
  if (!s) return;
  _v.set(s.x, s.y + 5.2, s.z).project(camera); // above a standing trainer's name tag
  sitPrompt.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  sitPrompt.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
}
function updateBubbles() {
  const now = performance.now();
  for (const [owner, b] of bubbles) {
    if (!owner.parent || now > b.until) {
      b.el.style.opacity = 0;
      if (!owner.parent || now > b.until + 400) {
        b.el.remove();
        bubbles.delete(owner);
      }
      continue;
    }
    // point above the head, projected onto the screen
    const baseY = owner === sprite ? pos.y : owner.position.y + (owner.userData.lift || 0);
    _v.set(
      owner.position.x,
      baseY + owner.scale.y * 0.95 + headCatLift(owner),
      owner.position.z,
    ).project(camera);
    _v.y += 20 / (innerHeight / 2); // move above the name tag
    b.el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
    b.el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
  }
}

function receiveChat(id, name, text, admin, color, prs, n) {
  addToHistory(name, text, id, admin, color, prs, n);
  const owner = id === myId || id === "me" ? sprite : others.get(id)?.mesh;
  if (owner) showBubble(owner, text, owner !== sprite && mentionsMe(mentionParts(text)));
}

// tapping send must not steal focus from the box (it would close the phone keyboard)
document.querySelector("#send").addEventListener("pointerdown", (e) => e.preventDefault());
document.querySelector("#chat form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = elInput.value.trim().slice(0, 140);
  elInput.value = "";
  if (/^\/admin$/i.test(text)) return openAdminLogin();
  // contributors: /github proves your GitHub login, and the room shows your merged pull requests
  if (/^\/github$/i.test(text)) return startGithubLogin();
  if (/^\/github (out|logout)$/i.test(text)) {
    const session = githubSession();
    try { localStorage.removeItem("github-session"); } catch {}
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "github-out", session }));
    return addToHistory("system", "github: logged out");
  }
  if (/^\/github (out|logout)$/i.test(text)) return githubLogout();
  if (/^\/logout$/i.test(text)) {
    try { localStorage.removeItem("admin-password"); } catch {}
    location.reload();
    return;
  }
  // the box stays open to keep talking; Enter on an empty box (or Esc) goes back to walking
  if (!text) {
    if (!MOBILE) elInput.blur();
    return;
  }
  // admin: /unban lifts every ban (kick and ban are on the names, see openModMenu)
  if (/^\/unban$/i.test(text) && MULTIPLAYER && ws?.readyState === 1) {
    let password = "";
    try { password = localStorage.getItem("admin-password") || ""; } catch {}
    ws.send(JSON.stringify({ t: "mod", action: "unban", password }));
    return;
  }
  if (social.sendChat(text)) return; // a private chat's tab is open: it goes to that friend only
  if (MULTIPLAYER && ws?.readyState === 1)
    ws.send(JSON.stringify({ t: "chat", text }));
  else receiveChat("me", NAME, text, false, COLOR); // offline: show only to me
});
// Enter opens the chat; Esc leaves it
addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !typing()) {
    e.preventDefault();
    elInput.focus();
  } else if (e.key === "Escape" && typing()) elInput.blur();
});
const idlePlaceholder = elInput.placeholder;
// admin login: its own modal with a password field, so the password can never end up in the chat
const adminLogin = document.querySelector("#admin-login");
const adminPw = adminLogin.querySelector("input");
function openAdminLogin() {
  elInput.blur();
  adminPw.value = "";
  adminLogin.hidden = false;
  adminPw.focus();
}
function closeAdminLogin() {
  adminPw.value = "";
  adminLogin.hidden = true;
}
adminLogin.addEventListener("submit", (e) => {
  e.preventDefault();
  pendingPassword = adminPw.value;
  closeAdminLogin();
  if (pendingPassword && ws?.readyState === 1)
    ws.send(JSON.stringify({ t: "auth", password: pendingPassword }));
});
adminLogin.querySelector("[data-cancel]").addEventListener("click", closeAdminLogin);
adminPw.addEventListener("keydown", (e) => e.key === "Escape" && closeAdminLogin());
// GitHub login (device flow): the room hands out a code, the player types it at github.com and the room
// learns their login. No password or GitHub token ever reaches this page; it keeps a session of the room's.
const githubLogin = document.querySelector("#github-login");
let githubPoll = 0;
function githubSession() {
  try { return localStorage.getItem("github-session") || ""; } catch { return ""; }
}
function githubLogout() {
  const session = githubSession();
  try { localStorage.removeItem("github-session"); } catch {}
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "github-out", session }));
  addToHistory("system", "github: logged out");
}
function startGithubLogin() {
  if (!MULTIPLAYER || ws?.readyState !== 1) return addToHistory("system", "github login needs the room: you are offline");
  ws.send(JSON.stringify({ t: "github-start" }));
}
function showGithubCode(m) {
  closeGithubLogin();
  githubLogin.querySelector("code").textContent = m.code;
  githubLogin.querySelector("a").href = m.url;
  githubLogin.hidden = false;
  elInput.blur();
  // ask the room now and then if the code was typed, until it says ok, fails or the code runs out
  githubPoll = setInterval(() => {
    if (Date.now() > m.until + 5000) return closeGithubLogin();
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "github-poll" }));
  }, (m.every + 1) * 1000);
}
function closeGithubLogin() {
  clearInterval(githubPoll);
  githubLogin.hidden = true;
}
githubLogin.querySelector("[data-cancel]").addEventListener("click", closeGithubLogin);
githubLogin.querySelector("[data-copy]").addEventListener("click", (e) => {
  const button = e.currentTarget;
  navigator.clipboard?.writeText(githubLogin.querySelector("code").textContent).then(() => {
    button.textContent = "copied!";
    button.classList.add("done");
    setTimeout(() => (button.classList.remove("done"), (button.textContent = "copy")), 1500);
  }, () => {});
});
elInput.addEventListener("focus", () => {
  Object.keys(keys).forEach((k) => (keys[k] = false));
  if (!MOBILE) elInput.placeholder = "Esc or empty Enter to walk…";
});
elInput.addEventListener("blur", () => !MOBILE && (elInput.placeholder = idlePlaceholder));

// Typing "@" lists the players in the room whose names start with what follows; arrows pick,
// Tab or Enter puts the name in, Esc closes the list.
const atList = Object.assign(document.createElement("div"), { id: "at-list", hidden: true });
atList.setAttribute("role", "listbox");
document.querySelector("#chat form").before(atList);
let atPick = 0,
  atFrom = -1;
const atMatches = () => {
  const caret = elInput.selectionStart ?? elInput.value.length;
  const before = elInput.value.slice(0, caret);
  const i = before.lastIndexOf("@");
  if (i < 0 || (i > 0 && !/\s/.test(before[i - 1]))) return null; // "@" starts a word
  const query = before.slice(i + 1).toLowerCase();
  if (query.length > 16) return null;
  const names = roomNames()
    .filter((n) => n.name.toLowerCase() !== NAME.toLowerCase() && n.name.toLowerCase().startsWith(query))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);
  return names.length ? { at: i, names } : null;
};
function drawAtList() {
  const m = atMatches();
  atList.hidden = !m;
  if (!m) return;
  atFrom = m.at;
  atPick = Math.min(atPick, m.names.length - 1);
  atList.replaceChildren(
    ...m.names.map((n, i) => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: "@" + n.name });
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", i === atPick);
      b.classList.toggle("on", i === atPick);
      paintName(b, n.color);
      b.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the focus (and the phone keyboard) in the box
      b.addEventListener("click", () => putAt(n.name));
      return b;
    }),
  );
}
function putAt(name) {
  const caret = elInput.selectionStart ?? elInput.value.length;
  const v = elInput.value;
  const text = (v.slice(0, atFrom) + "@" + name + " " + v.slice(caret)).slice(0, 140);
  elInput.value = text;
  const at = Math.min(140, atFrom + name.length + 2);
  elInput.setSelectionRange(at, at);
  atList.hidden = true;
  atPick = 0;
}
elInput.addEventListener("input", () => ((atPick = 0), drawAtList()));
elInput.addEventListener("click", drawAtList);
elInput.addEventListener("blur", () => (atList.hidden = true));
elInput.addEventListener("keydown", (e) => {
  if (atList.hidden) return;
  const n = atList.children.length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    atPick = (atPick + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    drawAtList();
  } else if (e.key === "Tab" || e.key === "Enter") {
    e.preventDefault(); // pick the name instead of sending
    e.stopPropagation();
    atList.children[atPick]?.click();
  } else if (e.key === "Escape") {
    e.stopPropagation(); // close the list, stay in the box
    atList.hidden = true;
  }
});

// ---- Message wall ----
const wall = setupWall({ getName: () => NAME, getGender: () => GENDER, isAdmin: () => IS_ADMIN });
// accounts, profiles, friends and private chat
const social = setupSocial({
  send: (msg) => MULTIPLAYER && ws?.readyState === 1 && (ws.send(JSON.stringify(msg)), true),
  paintName,
  showPrs,
  login: startGithubLogin,
  logout: githubLogout,
  say: (text) => addToHistory("system", text),
  me: () => ({ name: NAME, color: COLOR, gender: GENDER, cap: myCap() }),
  look: trainerLook,
  elMsgs,
  elInput,
});
// near the board: a prompt over it ("E" or tap to read)
const wallPrompt = Object.assign(document.createElement("button"), { id: "wall-prompt", type: "button" });
wallPrompt.innerHTML = MOBILE ? "tap to read the wall" : "<kbd>E</kbd> read the wall";
wallPrompt.addEventListener("click", () => wall.show());
document.body.append(wallPrompt);
const nearBoard = () => Math.hypot(pos.x - board.position.x, pos.z - board.position.z - 1) < wall.NEAR;
addEventListener("keydown", (e) => {
  if (typing() || e.repeat || gamePaused || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "b") wall.show();
});
// near the capybara: a prompt over it ("E" or tap to feed); feeding opens its ironic thank-you bubble
const capyPrompt = Object.assign(document.createElement("button"), { id: "capy-prompt", type: "button" });
capyPrompt.innerHTML = MOBILE ? "tap to feed the capybara" : "<kbd>E</kbd> feed the capybara";
// feeding goes to the room, which tells everyone (you included); offline, it happens only here
const CAPY_SIT_MS = 6000;
const feedCapy = () => {
  if (MULTIPLAYER && ws?.readyState === 1) return ws.send(JSON.stringify({ t: "capy" }));
  const now = roomNow();
  if (now < capyFed.until) return;
  capyWasFed({ at: now, until: now + CAPY_SIT_MS, lost: capyFed.lost + capyFed.until - capyFed.at, phrase: Math.floor(Math.random() * 1000) });
};
capyPrompt.addEventListener("click", (e) => {
  feedCapy();
  e.currentTarget.blur(); // give the keyboard back to the game
});
document.body.append(capyPrompt);
const catPrompt = Object.assign(document.createElement("button"), { id: "cat-prompt", type: "button" });
catPrompt.innerHTML = MOBILE ? "tap to feed the cat" : "<kbd>E</kbd> feed the cat";
const feedCat = (cat) => {
  if (!cat) return;
  if (CATS.some((c) => c.id === cat.id) && MULTIPLAYER && ws?.readyState === 1) return ws.send(JSON.stringify({ t: "cat", id: cat.id }));
  const now = roomNow();
  if (now < cat.fed.until) return;
  catWasFed({ id: cat.id, at: now, until: now + CAT_SIT_MS, lost: cat.fed.lost + cat.fed.until - cat.fed.at, phrase: Math.floor(Math.random() * 1000) });
};
catPrompt.addEventListener("click", (e) => {
  feedCat(nearCat());
  e.currentTarget.blur(); // give the keyboard back to the game
});
document.body.append(catPrompt);
// ---- Lucario: permanent NPC using the town's shared cat navigation grid ----
// ---- Lucario: random, obstacle-aware patrol around the pond and fairground ----
const LUCARIO_LEG_MS=26000;
const LUCARIO_SPEED=1.85;
const LUCARIO_REPLAN_MS=850;
const LUCARIO_ACTOR_CLEARANCE=3.25;
let lucarioPatrolNodes=[];
let lucarioPatrolSet=new Set();
let lucarioPausedMs=0;
let lucarioInteraction=null;
let lucarioRoute={slot:-1,path:[],cumDist:[],totalDist:0,distance:0,targetIdx:-1,lastPlan:0,lastTick:0};

function lucarioClearOfFixedObjects(node){
  return !insideSolid(node.x,node.z,1.7,2.4)&&
    Math.hypot(node.x-board.position.x,node.z-board.position.z)>5.5&&
    lampPosts.every(p=>Math.hypot(p.position.x-node.x,p.position.z-node.z)>2.8)&&
    benches.every(b=>Math.hypot(b.x-node.x,b.z-node.z)>3.2)&&
    !onRide(node.x,node.z,1.8);
}
function placeLucarioWalk(){
  const nodes=catNav.nodes;
  if(!nodes.length||!pondBox){lucario.mesh.visible=false;return;}
  // Keep patrol points on the public side of the village. The houses behind the
  // back road are intentionally outside this corridor.
  const frontLimit=Math.max(townBox.min.z+12,pondBox.min.z-10);
  const suitable=(node)=>{
    if(node.z<frontLimit||!lucarioClearOfFixedObjects(node))return false;
    if(Math.hypot(node.x-capy.mesh.position.x,node.z-capy.mesh.position.z)<7)return false;
    const fromPond=pondDistance(node.x,node.z);
    const nearPond=fromPond>=2.2&&fromPond<=12;
    const wheelDistance=Math.hypot(node.x-WHEEL.x,node.z-WHEEL.z);
    const carouselDistance=Math.hypot(node.x-CAROUSEL.x,node.z-CAROUSEL.z);
    const nearFair=(wheelDistance>=WHEEL.halfWidth+2&&wheelDistance<=19)||
      (carouselDistance>=CAROUSEL.base+2&&carouselDistance<=16);
    return nearPond||nearFair;
  };
  const routeNodes=nodes.map((node,index)=>({node,index}))
    .filter(({node})=>node.z>frontLimit&&lucarioClearOfFixedObjects(node)&&
      Math.hypot(node.x-capy.mesh.position.x,node.z-capy.mesh.position.z)>5.5)
    .map(({index})=>index);
  // The corridor is broader than the waypoint ring: it connects the pond and
  // fairground while still excluding the rear-house side of the village.
  lucarioPatrolSet=new Set(routeNodes);
  lucarioPatrolNodes=routeNodes.filter(index=>suitable(nodes[index]));
  if(lucarioPatrolNodes.length<8){
    const center=townBox.getCenter(new THREE.Vector3());
    lucarioPatrolNodes=routeNodes.filter(index=>{
      const n=nodes[index];
      return Math.hypot(n.x-center.x,n.z-center.z)<34;
    });
  }
  if(lucarioPatrolNodes.length<2){lucario.mesh.visible=false;return;}
  const initial=lucarioPatrolNodes[Math.floor(lucarioPatrolNodes.length*.5)];
  const first=nodes[initial];
  lucario.mesh.position.set(first.x,groundHeight(first.x,first.z),first.z);
  lucario.mesh.visible=true;
  lucarioRoute={slot:-1,path:[],cumDist:[],totalDist:0,distance:0,targetIdx:-1,lastPlan:0,lastTick:performance.now()};
}

function lucarioActorPositions(){
  const actors=[{x:pos.x,z:pos.z,r:LUCARIO_ACTOR_CLEARANCE}];
  for(const o of others.values()){
    if(o.seat>=0)continue;
    actors.push({x:o.mesh.position.x,z:o.mesh.position.z,r:LUCARIO_ACTOR_CLEARANCE});
  }
  actors.push({x:capy.mesh.position.x,z:capy.mesh.position.z,r:CAPY_RADIUS+1.6});
  for(const cat of cats){
    if(cat.ride||cat.hopOff)continue;
    actors.push({x:cat.mesh.position.x,z:cat.mesh.position.z,r:2.15});
  }
  return actors;
}
function lucarioNodeBlocked(node,actors,allowIdx=-1,index=-1){
  if(index===allowIdx)return false;
  if(!lucarioClearOfFixedObjects(node))return true;
  return actors.some(actor=>Math.hypot(node.x-actor.x,node.z-actor.z)<actor.r);
}
function findLucarioPath(startIdx,endIdx,actors=[]){
  const nodes=catNav.nodes;
  if(startIdx===endIdx)return [nodes[startIdx]];
  if(!lucarioPatrolSet.has(startIdx)||!lucarioPatrolSet.has(endIdx))return [];
  const parent=new Int32Array(nodes.length).fill(-1);
  const queue=new Int32Array(nodes.length);
  let head=0,tail=0;
  parent[startIdx]=startIdx;queue[tail++]=startIdx;
  while(head<tail){
    const u=queue[head++];
    if(u===endIdx)break;
    for(const [v] of nodes[u].adj){
      if(!lucarioPatrolSet.has(v)||parent[v]!==-1)continue;
      if(lucarioNodeBlocked(nodes[v],actors,startIdx,v))continue;
      parent[v]=u;queue[tail++]=v;
      if(v===endIdx){head=tail;break;}
    }
  }
  if(parent[endIdx]===-1)return [];
  const path=[];
  for(let cur=endIdx;;cur=parent[cur]){path.push(nodes[cur]);if(cur===startIdx)break;}
  return path.reverse();
}
function lucarioTarget(slot,previous=-1,actors=[]){
  // Seeded pseudo-random selection: every browser picks the same waypoint for a
  // given room-clock slot, while the route still feels different each time.
  let seed=(Math.imul(slot+1,0x45d9f3b)^0x6d2b79f5)>>>0;
  seed^=seed>>>16;seed=Math.imul(seed,0x45d9f3b);seed^=seed>>>16;
  const current=lucario.mesh.position;
  const candidates=lucarioPatrolNodes.filter(i=>i!==previous&&
    actors.every(actor=>{
      const n=catNav.nodes[i];
      return Math.hypot(n.x-actor.x,n.z-actor.z)>actor.r+1.2;
    })&&Math.hypot(catNav.nodes[i].x-current.x,catNav.nodes[i].z-current.z)>6);
  return candidates.length?candidates[(seed>>>0)%candidates.length]:lucarioPatrolNodes[0];
}
function lucarioNearestPatrolNode(x,z){
  let best=-1,bestDistance=Infinity;
  for(const index of lucarioPatrolNodes){
    const n=catNav.nodes[index],d=Math.hypot(n.x-x,n.z-z);
    if(d<bestDistance){best=index;bestDistance=d;}
  }
  return best;
}
function planLucarioRoute(slot,now){
  const nodes=catNav.nodes;
  const current=lucario.mesh.position;
  const startIdx=lucarioNearestPatrolNode(current.x,current.z);
  if(startIdx<0)return false;
  const actors=lucarioActorPositions();
  const targetIdx=lucarioTarget(slot,lucarioRoute.targetIdx,actors);
  // The current node may be inside the player's personal-space radius; allow
  // Lucario to leave it, but all later nodes must give people room.
  const pathNodes=findLucarioPath(startIdx,targetIdx,actors);
  if(pathNodes.length<2)return false;
  const path=[{x:current.x,y:groundHeight(current.x,current.z),z:current.z},...pathNodes];
  const measured=measurePath(path);
  lucarioRoute={slot,path,cumDist:measured.cumDist,totalDist:measured.totalDist,
    distance:0,targetIdx,lastPlan:now,lastTick:now};
  return true;
}
function replanLucarioAroundActors(now){
  const route=lucarioRoute;
  if(now-route.lastPlan<LUCARIO_REPLAN_MS||(!route.waiting&&route.path.length<2))return;
  const actors=lucarioActorPositions();
  const current=lucario.mesh.position;
  const next=route.path.length>1?samplePathPoint(route.path,route.cumDist,route.totalDist,
    Math.min(route.totalDist,route.distance+2.2)):current;
  const blocked=route.waiting||actors.some(a=>distanceToSegment(a.x,a.z,current.x,current.z,next.x,next.z)<a.r+0.35);
  if(!blocked){route.lastPlan=now;return;}
  const startIdx=lucarioNearestPatrolNode(current.x,current.z);
  if(startIdx<0){route.lastPlan=now;return;}
  const detour=findLucarioPath(startIdx,route.targetIdx,actors);
  route.lastPlan=now;
  if(detour.length<2){route.waiting=true;return;} // wait rather than push through a player
  const path=[{x:current.x,y:groundHeight(current.x,current.z),z:current.z},...detour];
  const measured=measurePath(path);
  route.path=path;route.cumDist=measured.cumDist;route.totalDist=measured.totalDist;route.distance=0;route.waiting=false;
}
function distanceToSegment(px,pz,ax,az,bx,bz){
  const dx=bx-ax,dz=bz-az,len2=dx*dx+dz*dz;
  const u=len2?THREE.MathUtils.clamp(((px-ax)*dx+(pz-az)*dz)/len2,0,1):0;
  return Math.hypot(px-(ax+u*dx),pz-(az+u*dz));
}
function walkLucario(t){
  const nodes=catNav.nodes;
  if(!lucario.mesh.visible||lucarioPatrolNodes.length<2||!nodes.length){lucario.setPose("idle");return;}
  const now=performance.now();
  if(lucarioInteraction){
    if(now<lucarioInteraction.until){lucario.setPose(lucarioInteraction.action==="aura"?"aura":"pet");lucarioRoute.lastTick=now;return;}
    lucarioPausedMs+=Math.max(0,t-lucarioInteraction.startedAt);
    lucarioInteraction=null;
    lucarioRoute.lastTick=now;
  }
  const patrolTime=Math.max(0,t-lucarioPausedMs);
  const slot=Math.floor(patrolTime/LUCARIO_LEG_MS);
  if(slot!==lucarioRoute.slot){
    if(!planLucarioRoute(slot,now)){
      lucario.setPose("idle");
      lucarioRoute.lastTick=now;
      return;
    }
  }
  replanLucarioAroundActors(now);
  if(lucarioRoute.waiting||lucarioRoute.path.length<2){lucario.setPose("idle");return;}
  const dt=Math.min(.08,Math.max(0,(now-lucarioRoute.lastTick)/1000));
  lucarioRoute.lastTick=now;
  if(lucarioRoute.distance>=lucarioRoute.totalDist){
    lucario.setPose("idle");
    return;
  }
  lucarioRoute.distance=Math.min(lucarioRoute.totalDist,lucarioRoute.distance+dt*LUCARIO_SPEED);
  const point=samplePathPoint(lucarioRoute.path,lucarioRoute.cumDist,lucarioRoute.totalDist,lucarioRoute.distance);
  lucario.mesh.position.set(point.x,groundHeight(point.x,point.z),point.z);
  lucario.setDirection(point.dirX,point.dirZ);
  lucario.setPose("walk");
}
function nearLucario(){
  return lucario.mesh.visible&&!gamePaused&&mySeat<0&&!wall.isOpen()&&!nearBoard()&&
    Math.hypot(pos.x-lucario.mesh.position.x,pos.z-lucario.mesh.position.z)<LUCARIO_NEAR;
}
function interactLucario(action){
  if(!nearLucario()||(lucarioInteraction&&performance.now()<lucarioInteraction.until))return;
  lucario.setDirection(
    pos.x-lucario.mesh.position.x,
    pos.z-lucario.mesh.position.z,
  );
  lucarioInteraction={action,startedAt:roomNow(),until:performance.now()+(action==="aura"?2400:1900)};
  lucario.setPose(action==="aura"?"aura":"pet");
  const phrases=action==="aura"
    ?["Lucario fecha os olhos. Uma aura azul envolve vocês por um instante.","Ele parece perceber algo tranquilo na sua aura.","Por um momento, vocês conseguem se entender sem palavras."]
    :["Lucario abaixa a cabeça, aceitando o carinho.","Lucario parece gostar da sua companhia.","Ele fecha os olhos e solta um pequeno suspiro satisfeito."];
  showBubble(lucario.mesh,phrases[Math.floor(Math.random()*phrases.length)],false,1800);
}
// Two native prompt buttons, matching the capybara and cat interactions.
const lucarioPrompt=Object.assign(document.createElement("div"),{id:"lucario-prompt"});
Object.assign(lucarioPrompt.style,{
  position:"fixed",transform:"translate(-50%,-100%)",zIndex:"4",display:"none",gap:"6px",whiteSpace:"nowrap",
});
const makeLucarioAction=(key,label,action)=>{
  const button=Object.assign(capyPrompt.cloneNode(false),{id:"",type:"button"});
  button.innerHTML=MOBILE?label:`<kbd>${key}</kbd> ${label}`;
  button.addEventListener("click",e=>{interactLucario(action);e.currentTarget.blur();});
  return button;
};
lucarioPrompt.append(makeLucarioAction("E","fazer carinho","pet"),makeLucarioAction("R","sentir aura","aura"));
document.body.append(lucarioPrompt);
function updateLucario(){
  const t=roomNow();walkLucario(t);
  lucario.update(performance.now());
  lucario.mesh.rotation.set(camera.rotation.x*.5,0,0);
  const lx=lucario.mesh.position.x,lz=lucario.mesh.position.z;
  lucarioGroundShadow.visible = lucario.mesh.visible;
  // Match the player's contact shadow offset; the sprite and shadow share the same ground sample.
  lucarioGroundShadow.position.set(lx, lucario.mesh.position.y + 0.002, lz);
  lucarioGroundShadow.material.opacity = lucarioInteraction?.action === "aura" ? 0.22 : 0.35;
  lucario.mesh.castShadow = true;
  lucario.aura.position.set(lx,lucario.mesh.position.y+.08,lz);
  const show=nearLucario()&&!typing()&&!bubbles.has(lucario.mesh);
  lucarioPrompt.style.display=show?"flex":"none";
  if(show){
    _v.set(lucario.mesh.position.x,lucario.mesh.position.y+4.2,lucario.mesh.position.z).project(camera);
    lucarioPrompt.style.left=`${(_v.x*.5+.5)*innerWidth}px`;
    lucarioPrompt.style.top=`${(-_v.y*.5+.5)*innerHeight}px`;
  }
}
// Pick at most one closest animal in interaction range so prompts and E never collide.
function closestAnimal() {
  if (mySeat >= 0 || nearBoard()) return null;
  let best = null;
  let bestDist = Infinity;
  const capyDist = Math.hypot(pos.x - capy.mesh.position.x, pos.z - capy.mesh.position.z);
  if (capyDist < CAPY_NEAR) {
    best = { kind: "capy" };
    bestDist = capyDist;
  }
  for (const cat of cats) {
    if (cat.ride || cat.hopOff) continue; // on a player's head or hopping down: not feedable
    const d = Math.hypot(pos.x - cat.mesh.position.x, pos.z - cat.mesh.position.z);
    if (d < CAT_NEAR && d < bestDist) {
      best = { kind: "cat", cat };
      bestDist = d;
    }
  }
  return best;
}
const nearCapy = () => closestAnimal()?.kind === "capy";
const nearCat = () => {
  const a = closestAnimal();
  return a?.kind === "cat" ? a.cat : null;
};
function updateCapy() {
  const t = roomNow();
  walkCapy(t);
  capy.update(t);
  capy.mesh.rotation.set(camera.rotation.x * 0.5, 0, 0); // faces the camera like the trainers
  const show = eNow === "capy" && !bubbles.has(capy.mesh);
  capyPrompt.classList.toggle("on", show);
  if (!show) return;
  _v.set(capy.mesh.position.x, capy.mesh.position.y + 5, capy.mesh.position.z).project(camera);
  capyPrompt.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  capyPrompt.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
}
// ---- Skipping stones (T by the pond) ----
// You plan the throw (where the stone touches the water), see it at once, and the room sends it to
// everyone; others animate the same path from your hand (src/stones.js).
const stones = createStones(scene, { surfaceY: (x, z) => topHeight(x, z), camera });
const STONE_NEAR = 4.5; // how close to the pond you must be
const STONE_EVERY_MS = 1200;
let lastStone = 0;
const handOf = (p) => ({ x: p.x, y: p.y + 2.0, z: p.z });
// distance from (x, z) to the pond, 0 inside it
function pondDistance(x, z) {
  if (!pondBox) return Infinity;
  const dx = Math.max(pondBox.min.x - x, 0, x - pondBox.max.x),
    dz = Math.max(pondBox.min.z - z, 0, z - pondBox.max.z);
  return Math.hypot(dx, dz);
}
const nearPond = () => !gamePaused && pondDistance(pos.x, pos.z) < STONE_NEAR;
// Toward the middle of the pond: the first touch a little past the water's edge, then up to four
// skips, each shorter, bending a little, while they stay on the water. The last touch is where it sinks.
function planThrow(x, z) {
  const c = pondBox.getCenter(new THREE.Vector3());
  let dx = c.x - x,
    dz = c.z - z;
  const n = Math.hypot(dx, dz) || 1;
  (dx /= n), (dz /= n);
  let ex = NaN,
    ez = NaN;
  for (let d = 0.5; d < 40; d += 0.5)
    if (isWater(x + dx * d, z + dz * d) && isWater(x + dx * (d + 2), z + dz * (d + 2))) {
      (ex = x + dx * (d + 2)), (ez = z + dz * (d + 2));
      break;
    }
  if (Number.isNaN(ex)) return null;
  const touches = [[ex, ez]];
  const skips = 1 + Math.floor(Math.random() * 4);
  let ang = Math.atan2(dz, dx);
  for (const len of [2.4, 1.9, 1.4, 1.0].slice(0, skips)) {
    ang += (Math.random() - 0.5) * 0.3;
    const [px, pz] = touches.at(-1);
    const nx = px + Math.cos(ang) * len,
      nz = pz + Math.sin(ang) * len;
    if (!isWater(nx, nz)) break; // the next hop would land on the bank: it sinks where it is
    touches.push([nx, nz]);
  }
  return { touches: touches.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), dx, dz };
}
function throwStone() {
  const now = performance.now();
  if (!nearPond() || mySeat >= 0 || now - lastStone < STONE_EVERY_MS) return;
  const plan = planThrow(pos.x, pos.z);
  if (!plan) return;
  lastStone = now;
  dir = Math.abs(plan.dx) > Math.abs(plan.dz) ? (plan.dx > 0 ? "right" : "left") : plan.dz > 0 ? "down" : "up"; // face the water
  stones.launch(handOf(sprite.position), plan.touches);
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "stone", pts: plan.touches }));
}
// someone else threw one: the same path, from their hand
function stoneThrown(m) {
  // with the tab hidden nothing is drawn: a stone thrown now would wait, and all the stones thrown
  // meanwhile would fly at once when you come back. It was thrown while you weren't looking: skip it
  if (document.hidden) return;
  const o = others.get(m.id);
  const pts = Array.isArray(m.pts) ? m.pts.filter((p) => Array.isArray(p) && p.every(Number.isFinite)).slice(0, 6) : [];
  if (o && pts.length) stones.launch(handOf(o.mesh.position), pts);
}
// "T skip a stone" over you while you stand by the pond
const stonePrompt = Object.assign(document.createElement("button"), { id: "stone-prompt", type: "button" });
stonePrompt.innerHTML = MOBILE ? "tap to skip a stone" : "<kbd>T</kbd> skip a stone";
stonePrompt.addEventListener("click", (e) => {
  throwStone();
  e.currentTarget.blur(); // give the keyboard back to the game
});
document.body.append(stonePrompt);
addEventListener("keydown", (e) => {
  if (typing() || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.toLowerCase() === "t") throwStone();
});
function updateStonePrompt() {
  const show = nearPond() && mySeat < 0 && !wall.isOpen() && !bubbles.has(sprite);
  stonePrompt.classList.toggle("on", show);
  if (!show) return;
  _v.set(sprite.position.x, sprite.position.y + 6.2, sprite.position.z).project(camera);
  stonePrompt.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  stonePrompt.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
}
function updateWallPrompt() {
  const show = eNow === "wall";
  wallPrompt.classList.toggle("on", show);
  if (!show) return;
  _v.set(board.position.x, board.position.y + 7.4, board.position.z).project(camera);
  wallPrompt.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  wallPrompt.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
}

function updateCats() {
  const t = roomNow();
  for (const cat of cats) {
    walkCat(cat, t);
    cat.sprite.update(t);
    cat.mesh.rotation.set(camera.rotation.x * 0.5, 0, 0);
  }
  const active = nearCat();
  const show = eNow === "cat" && !!active && !bubbles.has(active.mesh);
  catPrompt.classList.toggle("on", show);
  if (!show) return;
  _v.set(active.mesh.position.x, active.mesh.position.y + 4.2, active.mesh.position.z).project(camera);
  catPrompt.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  catPrompt.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
}

const fishing = createFishing({
  scene,
  button: document.querySelector("#fish"),
  say: (text) => showBubble(sprite, text),
  feetDepth: (mesh) => useFeetDepth(mesh, myFeet, 12),
  camera,
  shape: (d) => bodyShape(sprite.material.map, CHARACTER.cfg, d),
  onChange: (target) => sendFish(target),
});
// tells the room your line is out (where the bobber is) or back in, so the others see it; the
// timer stays yours. A function declaration: createFishing above may call it while it starts
// (a saved line whose fish got away while the tab was closed).
function sendFish(target) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(target ? { t: "fish", on: true, x: target.x, z: target.z } : { t: "fish", on: false }));
}
const _waterFrom = new THREE.Vector3();
/** @returns {number | null} the height of the water at (x, z), or null where there is none (or the town isn't loaded yet) */
function waterY(x, z) {
  ray.set(_waterFrom.set(x, 200, z), DOWN);
  const hit = ray.intersectObjects([...waterMeshes], false)[0];
  return hit ? hit.point.y : null;
}
/**
 * Where you could cast from: at the pond's edge (standing or seated), facing the water.
 * @returns {{x: number, z: number, d: number, face: string, seat: number} | null} d: distance to the pond's box
 */
function fishSpot() {
  if (!pondBox) return null;
  const s = mySeat >= 0 ? seatSpot(mySeat) : null;
  const x = s ? s.x : pos.x,
    z = s ? s.z : pos.z,
    face = s ? s.dir : dir;
  const { min, max } = pondBox;
  const cx = THREE.MathUtils.clamp(x, min.x, max.x),
    cz = THREE.MathUtils.clamp(z, min.z, max.z);
  const d = Math.hypot(cx - x, cz - z);
  if (!d || d > FISH_NEAR) return null;
  const [fx, fz] = FACING[face];
  if ((fx * (cx - x) + fz * (cz - z)) / d < 0.5) return null;
  return { x, z, d, face, seat: mySeat };
}
/** Casts from where you are now, if still at the edge; the bobber lands a few steps out. */
function castHere(minutes) {
  const s = fishSpot();
  if (!s) return;
  const [fx, fz] = FACING[s.face];
  const { min, max } = pondBox;
  const tx = THREE.MathUtils.clamp(s.x + fx * (s.d + 3.5), min.x + 1.5, max.x - 1.5),
    tz = THREE.MathUtils.clamp(s.z + fz * (s.d + 3.5), min.z + 1.5, max.z - 1.5);
  fishing.cast({ x: s.x, z: s.z, face: s.face, seat: s.seat, target: { x: tx, y: waterY(tx, tz) ?? pos.y, z: tz } }, minutes);
}
/** @param {number} id seat @returns {number} distance from you to that seat */
const seatDistance = (id) => {
  const s = seatSpot(id);
  return s ? Math.hypot(s.x - pos.x, s.z - pos.z) : Infinity;
};

let eNow = null;
/**
 * What E does right now: the line if it is out, standing up if seated, then the wall, the closest
 * animal (capybara or cat), and last the pond's edge or the free seat, whichever is closer.
 * Only that action's prompt shows.
 * @param {number} [seat] nearest free seat, if already known this frame
 * @returns {"fish" | "stand" | "wall" | "capy" | "cat" | "lucario" | "cast" | "sit" | null}
 */
function eAction(seat = nearestFreeSeat()) {
  if (gamePaused || wall.isOpen()) return null;
  if (mySeat >= 0) return "stand";
  if (nearBoard()) return "wall";
  if (nearLucario()) return "lucario";
  const p = fishing.phase();
  if (p === "focus" || p === "bite") return "fish";
  const animal = closestAnimal();
  if (animal) return animal.kind;
  const spot = fishSpot();
  if (spot && (seat < 0 || spot.d < seatDistance(seat))) return "cast";
  return seat >= 0 ? "sit" : null;
}
/** Runs an action from eAction (E, a prompt or the fish button). */
function doE(action = eAction()) {
  if (action === "fish") fishing.press();
  else if (action === "cast") fishSpot() && fishing.choose(castHere);
  else if (action === "wall") wall.show();
  else if (action === "capy") feedCapy();
  else if (action === "cat") feedCat(nearCat());
  else if (action === "lucario") interactLucario("pet");
  else if (action === "stand" || action === "sit") toggleSit();
}
addEventListener("keydown", (e) => {
  if (typing() || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.toLowerCase() === "e") doE();
});
const fishBtn = document.querySelector("#fish");
fishBtn.addEventListener("click", (e) => {
  if (!gamePaused) doE(fishing.phase() === "idle" ? "cast" : "fish");
  e.currentTarget.blur();
});
const fishPrompt = Object.assign(document.createElement("button"), { id: "fish-prompt", type: "button" });
fishPrompt.addEventListener("click", (e) => {
  doE(fishPrompt.dataset.action);
  e.currentTarget.blur();
});
document.body.append(fishPrompt);
let fishRestored = false;
/**
 * Each frame: puts you back where a line was cast after a reload, reels it in if you walk away,
 * draws the gear and places the fish prompt.
 */
function updateFishing() {
  const now = Date.now();
  let s = fishing.spot();
  if (!fishRestored && savedPosChecked && pondBox) {
    fishRestored = true;
    if (s && s.seat >= 0 && seatSpot(s.seat)) sit(s.seat);
    else if (s && isFree(s.x, s.z, topHeight(s.x, s.z))) pos.set(s.x, topHeight(s.x, s.z), s.z), (dir = s.face);
  }
  if (fishing.choosing() && (gamePaused || !fishSpot())) fishing.closePicker();
  if (fishRestored && s && Math.hypot(pos.x - s.x, pos.z - s.z) > FISH_LEAVE) fishing.reelIn(), (s = null);
  fishing.draw(now, sprite, dir);
  const p = fishing.phase(now),
    here = s ? null : fishSpot();
  fishBtn.hidden = p === "idle" && !here;
  const text = eNow === "cast" ? "fish" : eNow === "fish" && p === "bite" ? "pull it in!" : eNow === "fish" && fishing.confirming() ? "again to reel in" : "";
  const show = !!text && !typing() && !!(s || here);
  fishPrompt.classList.toggle("on", show);
  fishPrompt.classList.toggle("bite", p === "bite");
  if (!show) return;
  const html = MOBILE ? `tap ${text === "fish" ? "to fish" : text === "pull it in!" ? "to pull it in!" : "again to reel in"}` : `<kbd>E</kbd> ${text}`;
  if (fishPrompt.innerHTML !== html) fishPrompt.innerHTML = html;
  fishPrompt.dataset.action = eNow;
  if (s) _v.set(s.target.x, s.target.y + 2.2, s.target.z);
  else {
    const [fx, fz] = FACING[here.face];
    _v.set(here.x + fx * (here.d + 2.5), pos.y + 2.2, here.z + fz * (here.d + 2.5));
  }
  _v.project(camera);
  fishPrompt.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  fishPrompt.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
}

if (import.meta.env.DEV) {
  import("./debug.js").then(({ setupDebug }) => {
    setupDebug({
      THREE,
      renderer,
      scene,
      cats,
      baseCatCount: CATS.length,
      createCat,
      useFeetDepth,
      bubbles,
      getCatNav: () => catNav,
      measureCats: updateCats,
      getPlayerCount: () => others.size + 1,
      roomNow,
      getMyId: () => myId,
      catRideMs: CAT_RIDE_MS,
      catRideUpdate,
      resolveRideTarget,
      getTimeMode: () => timeMode,
      getCyclePhase: cyclePhase,
      getCycleDurationMs: () => cycleDurationMs,
      setCycleDuration,
      getLook: () => currentLook,
      getRainAmount: () => rainAmount,
      getLampIntensity: () => lampLights[0]?.intensity ?? 0,
    });
  });
}

function loop() {
  const now = performance.now();
  const dt = Math.min(clock.getDelta(), 0.05);
  countFrame();
  checkSavedPosition();
  savePosition(performance.now());
  waterUniforms.uTime.value += dt;
  // candles: the light and the flames waver a little
  const waver = 0.85 + 0.15 * Math.sin(waterUniforms.uTime.value * 9) * Math.sin(waterUniforms.uTime.value * 5.3);
  benchGlow.intensity = candleLight * waver;
  candleFlames.forEach((f, i) => {
    f.visible = candleLight > 0.01;
    f.scale.y = 1 + 0.25 * Math.sin(waterUniforms.uTime.value * (11 + i * 3) + i);
  });
  updateTimeOfDay(dt);
  updateRain(dt);
  stones.update(dt);
  updateFireflies();
  let dx = 0,
    dz = 0;
  if (keys.arrowup || keys.w) {
    dz -= 1;
    dir = "up";
  }
  if (keys.arrowdown || keys.s) {
    dz += 1;
    dir = "down";
  }
  if (keys.arrowleft || keys.a) {
    dx -= 1;
    dir = "left";
  }
  if (keys.arrowright || keys.d) {
    dx += 1;
    dir = "right";
  }
  if (stick.x || stick.z) {
    dx = stick.x;
    dz = stick.z;
    // facing follows the stronger axis
    dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "down" : "up";
  }
  if (gamePaused || wall.isOpen()) {
    dx = 0;
    dz = 0;
  }
  const run = keys.shift || stick.mag > 0.9;
  leaveFinishedRide();
  if (strappedIn()) (dx = 0), (dz = 0); // the move keys do nothing while the sleigh is out
  if (mySeat >= 0 && (dx || dz)) standUp(true, [dx, dz]); // any move key gets you up, off that way
  const riding = isRideSeat(mySeat);
  if (riding) {
    // the horse or gondola carries you: follow it, facing the way the ride says
    const s = seatSpot(mySeat);
    pos.x = s.x;
    pos.z = s.z;
    dir = s.dir;
  }
  const walking = dx || dz;
  if (walking) {
    const n = Math.hypot(dx, dz);
    const speed = SPEED * (run ? 1.5 : 1);
    // move axis by axis to slide along walls
    const nx = pos.x + (dx / n) * speed * dt;
    if (isFree(nx, pos.z, pos.y)) pos.x = nx;
    const nz = pos.z + (dz / n) * speed * dt;
    if (isFree(pos.x, nz, pos.y)) pos.z = nz;
    tAnim += dt * 8 * (speed / SPEED);
  } else tAnim = 0;
  const currentStep = walking ? Math.floor(tAnim) % CHARACTER.steps : 0;
  const running = Boolean(walking && run);
  if (onGround && walking) setGround(false); // moving gets you up
  const grounded = onGround && setSitFrameTex(sheetTex, dir); // facing the way you stood
  if (!grounded) setFrame(dir, currentStep, running);
  // a rider's spot comes from the seat and the clock in every browser: nothing to send while it turns
  if (!riding) sendPosition(now, currentStep, running);
  const freeSeat = mySeat >= 0 ? -1 : nearestFreeSeat();
  eNow = eAction(freeSeat);
  updateHoldButton();
  updateOthers(dt);

  // smooth the height so it doesn't jitter on small terrain steps
  pos.y = THREE.MathUtils.lerp(
    pos.y,
    mySeat >= 0 ? seatSpot(mySeat).y : topHeight(pos.x, pos.z),
    Math.min(1, dt * 12),
  );
  const k = Math.exp(-dt * 9);
  slide.x = Math.abs(slide.x * k) < 0.01 ? 0 : slide.x * k;
  slide.z = Math.abs(slide.z * k) < 0.01 ? 0 : slide.z * k;
  sprite.position.set(pos.x + slide.x, pos.y, pos.z + slide.z);
  if (running && GENDER === "male") sprite.position.y -= 0.8;
  shadow.position.set(pos.x + slide.x, pos.y + 0.05, pos.z + slide.z);
  shadow.visible = mySeat < 0; // would float under the hanging feet
  camera.position.set(pos.x + slide.x, pos.y + 38, pos.z + 42 + slide.z);
  camera.lookAt(pos.x + slide.x, pos.y + 1, pos.z + slide.z);
  updateCapy();
  owl.update(performance.now(), pos);
  owl.mesh.rotation.set(camera.rotation.x * 0.5, 0, 0); // faces the camera like the trainers
  updateFishing();
  updateCats();
  updateLucario();
  updateOcclusion();
  // facing the camera, tilted only halfway (the shadow looks like a standing body)
  sprite.rotation.set(camera.rotation.x * 0.5, 0, 0);
  showHeld(myHeld, sprite, CHARACTER.cfg, myHold, grounded ? null : heldDir(myHold, mySeat >= 0 ? seatSpot(mySeat) : null, !walking, dir));

  carousel.update(roomNow(), dayAmount);
  wheel.update(roomNow(), dayAmount);
  coaster.update(roomNow(), dayAmount);
  // Riders cast no shadow and are no lamp's concern: the lamps by the pond reach the rides, and
  // someone going round would make them redraw their 6 shadow passes every frame, all night
  sprite.castShadow = !riding;
  const movers = [...others.values()].filter((o) => !isRideSeat(o.seat)).map((o) => o.mesh);
  updateLampShadows([...(riding ? [] : [sprite]), capy.mesh, owl.mesh, lucario.mesh, ...cats.map((c) => c.mesh), ...movers]);
  renderer.render(scene, camera);
  updateNameTags();
  updateBubbles();
  updateSitPrompt(eNow === "sit" ? freeSeat : -1);
  updateCoasterSign();
  updateWallPrompt();
  updateStonePrompt();
  requestAnimationFrame(loop);
}
loop();
