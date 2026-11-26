import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { connectRadioToServer, receiveCommand } from "./radio.js";
import { createBoard, setupWall } from "./board.js";
import { createCapybara, CAPY_NEAR, CAPY_RADIUS } from "./capybara.js";

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
// phones/tablets: touch controls and lighter shadows
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
sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
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
const atlas = texLoader.load(TOWN.texture);
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
    scene.add(fbx);
    townMeshes = [];
    fbx.traverse((o) => o.isMesh && townMeshes.push(o));
    computePondBox();
    fbx.traverse((o) => {
      if (o.isMesh && /mailbox|sign|fence/i.test(o.name))
        solidBoxes.push(new THREE.Box3().setFromObject(o));
    });
    placeLampPairs();
    applyLook(dayAmount); // the pond pair's softer light
    candles.position.y = groundHeight(candles.position.x, candles.position.z);
    candles.updateMatrixWorld(true);
    solidBoxes.push(new THREE.Box3().setFromObject(candles).expandByScalar(0.15)); // nobody steps on them: a very small gap around
    placeBenches();
    board.position.y = groundHeight(board.position.x, board.position.z);
    placeCapybara();
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

new FBXLoader(manager).load(
  TOWN.fbx,
  (fbx) => {
    fbx.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.material = mats.map(
        (m) =>
          new THREE.MeshLambertMaterial({
            map: atlas,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
          }),
      );
      if (o.material.length === 1) o.material = o.material[0];
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
  light.shadow.mapSize.set(MOBILE ? 512 : 1024, MOBILE ? 512 : 1024);
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
// layout still gets them. Seats stay under MAX_SEATS (16 = 8 benches).
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
// Each entry is [night, day]; switching blends between them in about a second.
const LOOK = {
  background: ["#070a18", "#9fcdf2"],
  skyTop: ["#3a4a8a", "#d6ecff"],
  skyGround: ["#0b0f1a", "#5c6a44"],
  skyIntensity: [0.35, 1.1],
  sunColor: ["#7f95d8", "#fff1d8"],
  sunIntensity: [0.45, 1.9],
  lampIntensity: [150, 0], // lamps off by day
  glowOpacity: [0.35, 0],
  lantern: ["#ffdf7a", "#d8cfa8"], // unlit glass
  waterColor: ["#0b2d63", "#2a6db3"],
  waterEmissive: ["#020c22", "#06223f"],
  waterSpecular: ["#7a6440", "#ffffff"],
};
for (const k in LOOK)
  if (typeof LOOK[k][0] === "string") LOOK[k] = LOOK[k].map((c) => new THREE.Color(c));
const lampLights = lampPosts.flatMap((p) => p.children.filter((c) => c.isPointLight));
const lampGlows = lampPosts.flatMap((p) => p.children.filter((c) => c.isSprite));
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
const mixNum = ([a, b], t) => a + (b - a) * t;
const mixColor = (target, [a, b], t) => target.copy(a).lerp(b, t);
const OVERCAST_SKY = new THREE.Color("#7d8794");
const OVERCAST_LIGHT = new THREE.Color("#a3adbb");
let rainAmount = 0; // 0 = dry, 1 = full rain (eased in the loop)
// t: 0 = night, 1 = day
function applyLook(t) {
  mixColor(scene.background, LOOK.background, t);
  // overcast: by day the rain greys the sky; at night it only dims a little
  const overcast = rainAmount * t;
  scene.background.lerp(OVERCAST_SKY, 0.65 * overcast);
  scene.fog.color.copy(scene.background);
  // rain closes the fog in; at night it is always closed in, rain or not, so the town stays
  // dark around the lamps' pools of light
  const closed = Math.max(rainAmount, 1 - t);
  scene.fog.near = 50 - 12 * closed;
  scene.fog.far = 140 - 22 * closed;
  mixColor(skyLight.color, LOOK.skyTop, t);
  skyLight.color.lerp(OVERCAST_LIGHT, 0.5 * overcast);
  mixColor(skyLight.groundColor, LOOK.skyGround, t);
  const gloom = 1 - (0.2 + 0.2 * t) * closed;
  skyLight.intensity = mixNum(LOOK.skyIntensity, t) * gloom;
  mixColor(sun.color, LOOK.sunColor, t);
  sun.intensity = mixNum(LOOK.sunIntensity, t) * gloom;
  for (const l of lampLights) l.intensity = mixNum(LOOK.lampIntensity, t) * (l.userData.dim ?? 1);
  candleLight = mixNum(LOOK.lampIntensity, t) * 0.06;
  for (const g of lampGlows) g.material.opacity = mixNum(LOOK.glowOpacity, t);
  mixColor(lightMaterial.color, LOOK.lantern, t);
  mixColor(waterMaterial.color, LOOK.waterColor, t);
  mixColor(waterMaterial.emissive, LOOK.waterEmissive, t);
  mixColor(waterMaterial.specular, LOOK.waterSpecular, t);
}
let isDay = false;
try { isDay = localStorage.getItem("time-of-day") === "day"; } catch {}
let dayAmount = isDay ? 1 : 0; // eased toward isDay in the loop
applyLook(dayAmount);
const dayNightBtn = document.querySelector("#day-night");
function drawDayNight() {
  const label = isDay ? "make it night" : "make it day";
  dayNightBtn.innerHTML = isDay ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  dayNightBtn.setAttribute("aria-label", label);
}
function toggleDayNight() {
  isDay = !isDay;
  try { localStorage.setItem("time-of-day", isDay ? "day" : "night"); } catch {}
  drawDayNight();
}
drawDayNight();
dayNightBtn.addEventListener("click", (e) => {
  toggleDayNight();
  e.currentTarget.blur(); // give the keyboard back to the game
});
addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (!typing && !e.repeat && e.key.toLowerCase() === "n") toggleDayNight();
});

// Rain: thin streaks in a box that follows the player, splashes where they land (rings on the
// pond), shiny wet ground and a little fog.
// Only for you, remembered (like day/night). Nothing goes to the server.
let isRaining = false;
try { isRaining = localStorage.getItem("weather") === "rain"; } catch {}
if (isRaining) {
  rainAmount = 1;
  applyLook(dayAmount); // first frame already overcast
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
  if (wetReady || !townMeshes.length) return;
  wetReady = true;
  const swapped = new Map();
  for (const o of townMeshes) {
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

function updateRain(dt) {
  const target = isRaining ? 1 : 0;
  if (rainAmount !== target) {
    rainAmount += Math.sign(target - rainAmount) * Math.min(dt * 0.7, Math.abs(target - rainAmount));
    applyLook(dayAmount);
    applyWet();
  }
  if (isRaining) prepareWet();
  rainMesh.visible = splashMesh.visible = rainAmount > 0;
  if (!rainMesh.visible) return;
  rainUniforms.uOpacity.value = 0.45 * rainAmount;
  rainUniforms.uColor.value.set(dayAmount > 0.5 ? "#e8eef6" : "#b9c8e0");
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
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (!typing && !e.repeat && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r") toggleRain();
});

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
  if (insideSolid(x, z, r + 1.5) || inPond(x, z)) return false;
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
  for (let i = 0; i < lampPosts.length; i += 2) {
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
  // pond: straight box (with the body width), not following the irregular stones
  if (
    inPond(x - BODY_RADIUS, z) ||
    inPond(x + BODY_RADIUS, z) ||
    inPond(x, z - BODY_RADIUS) ||
    inPond(x, z + BODY_RADIUS)
  )
    return false;
  if (Math.hypot(x - capy.mesh.position.x, z - capy.mesh.position.z) < CAPY_RADIUS + BODY_RADIUS * 0.5) return false;
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
  const t = new THREE.CanvasTexture(generateOriginalTrainer(gender));
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  queueMicrotask(() => setFrame("down", 0));
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
    ws.send(JSON.stringify({ t: "gender", gender: GENDER }));
}
window.applyGender = applyGender; // used by the start screen

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
function generateOriginalTrainer(gender = "male") {
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
  return cv;
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
function removeBackground(t, cfg = CHARACTER.cfg) {
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
  ctx.putImageData(d, 0, 0);
  t.image = cv;
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
  for (const o of others.values()) setFeet(o.feet, o.mesh.position.x, o.mesh.position.y, o.mesh.position.z);
}

// ---- Movement ----
const keys = {};
let gamePaused = true;
addEventListener("game:pause", (e) => {
  gamePaused = e.detail;
  if (gamePaused) Object.keys(keys).forEach((k) => (keys[k] = false));
});
addEventListener("keydown", (e) => {
  if (["msg", "name-input", "enter-name"].includes(document.activeElement?.id)) return; // typing: don't walk
  keys[e.key.toLowerCase()] = true;
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

// What you hold while sitting: nothing, a laptop on your lap, a coffee or a book. Pixel art drawn
// in code on the trainer's own 32px frame, on a plane that sits exactly over the trainer and takes
// the same depth (its feet), so it is covered and uncovered together with the body.
const HELD = ["nothing", "a laptop", "a coffee", "a book"];
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
  const tick = Math.floor(performance.now() / (item === 1 ? 260 : item === 2 ? 320 : 400));
  // the screen's light, steam rising, or a page turning about every 4 seconds
  const frame = item === 1 ? FLICKER[tick % 8] : item === 2 ? tick % 4 : +(tick % 10 === 9);
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
// put the item over its trainer (or hide it when not seated or holding nothing)
function showHeld(mesh, body, cfg, item, seat) {
  mesh.visible = !!(item && seat);
  if (!mesh.visible) return;
  const shape = bodyShape(body.material.map, cfg, seat.dir);
  if (!shape) return void (mesh.visible = false);
  [mesh.material.map, mesh.material.emissiveMap] = heldTextures(item, seat.dir, shape);
  mesh.position.copy(body.position);
  mesh.rotation.copy(body.rotation);
}
const myHeld = createHeld(myFeet);
let myHold = 0;
try { myHold = [1, 2, 3].includes(+localStorage.getItem("hold")) ? +localStorage.getItem("hold") : 0; } catch {}
const sendHold = () => ws?.readyState === 1 && ws.send(JSON.stringify({ t: "hold", item: myHold }));
const holdBtn = document.querySelector("#hold");
// the button shows what you hold (the cup, unlit, when your hands are empty)
const CUP_ICON = holdBtn.querySelector("svg").innerHTML;
const HELD_ICONS = [
  CUP_ICON,
  '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  CUP_ICON,
  '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
];
let holdIcon = 0;
function updateHoldButton() {
  holdBtn.hidden = mySeat < 0;
  holdBtn.classList.toggle("on", myHold > 0);
  holdBtn.setAttribute("aria-label", "hold " + HELD[(myHold + 1) % HELD.length]);
  if (holdIcon !== myHold) holdBtn.querySelector("svg").innerHTML = HELD_ICONS[(holdIcon = myHold)];
}
let lastHold = 0;
function cycleHold() {
  const now = performance.now();
  if (gamePaused || mySeat < 0 || now - lastHold < 350) return; // stays under the server's rate limit
  lastHold = now;
  myHold = (myHold + 1) % HELD.length;
  try { localStorage.setItem("hold", myHold); } catch {}
  sendHold();
}
holdBtn.addEventListener("click", (e) => {
  cycleHold();
  e.currentTarget.blur(); // give the keyboard back to the game
});

// each sit/stand is numbered and the server's corrections carry the number back, so a late
// answer to an older request can't stand you up from the seat you have now
let sitN = 0;
const sendSeat = () => ws?.readyState === 1 && ws.send(JSON.stringify({ t: "sit", seat: mySeat, n: ++sitN }));
const seatTaken = (id) => [...others.values()].some((o) => o.seat === id);
function nearestFreeSeat() {
  let best = -1,
    bestD = SIT_RANGE;
  for (let id = 0; id < benches.length * SEATS_PER_BENCH; id++) {
    const s = seatSpot(id);
    const d = Math.hypot(s.x - pos.x, s.z - pos.z);
    if (d < bestD && !seatTaken(id)) (best = id), (bestD = d);
  }
  return best;
}
function sit(id) {
  const s = seatSpot(id);
  if (!s) return;
  mySeat = id;
  const [ox, oz] = [pos.x, pos.z];
  pos.set(s.x, s.y, s.z);
  glideFrom(ox, oz);
  dir = s.dir;
  sendSeat();
}
// Stand up on the nearest free spot around the bench, starting from the way you walked off
// (or its front), then tell the room
function standUp(notify = true, way = null) {
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
const MOVE_KEYS = { w: "up", arrowup: "up", s: "down", arrowdown: "down", a: "left", arrowleft: "left", d: "right", arrowright: "right" };
// at most one sit or stand per SIT_COOLDOWN ms, so mashing E stays under the server's rate limit
const SIT_COOLDOWN = 350;
let lastToggle = 0;
const toggleSit = () => {
  const now = performance.now();
  if (gamePaused || now - lastToggle < SIT_COOLDOWN) return;
  lastToggle = now;
  if (mySeat >= 0) return standUp();
  const id = nearestFreeSeat();
  if (id >= 0) sit(id);
};
addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  const k = e.key.toLowerCase();
  // by the message board, E opens it (unless you're seated: then it stands you up)
  if (!typing && !e.repeat && !e.ctrlKey && !e.metaKey && k === "q") cycleHold();
  if (!typing && !e.repeat && !e.ctrlKey && !e.metaKey && k === "e") (mySeat >= 0 || (!nearBoard() && !nearCapy())) && toggleSit();
  // a quick tap on a move key can end before the next frame: stand up right away
  else if (!typing && !gamePaused && mySeat >= 0 && MOVE_KEYS[k]) {
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
let ws = null;

function setFrameTex(tex, cfg, d, step) {
  const img = tex.image;
  if (!img || !img.width) return;
  const { x, y, w, h } = framePos(cfg, d, step);
  tex.repeat.set(w / img.width, h / img.height);
  tex.offset.set(x / img.width, 1 - (y + h) / img.height);
}

function createOther(p) {
  const g = p.gender === "female" ? "female" : "male";
  const available = sheetAvailable(g);
  const tex = available
    ? texLoader.load(
        SHEETS[g],
        () => {
          removeBackground(tex, CROP[g]);
          setFrameTex(tex, CROP[g], o.dir, o.step);
        },
        undefined,
        () => {
          failedSheets.add(g);
          o.cfg = GRID;
          tex.image = generateOriginalTrainer(g);
          tex.needsUpdate = true;
        },
      )
    : new THREE.CanvasTexture(generateOriginalTrainer(g));
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
    name: p.name,
    admin: !!p.admin,
  };
  mesh.position.copy(o.target);
  others.set(p.id, o);
  updateCount();
  return o;
}
function removeOther(id) {
  const o = others.get(id);
  if (!o) return;
  scene.remove(o.mesh);
  if (o.held) scene.remove(o.held), o.held.material.dispose();
  o.tex.dispose();
  others.delete(id);
  updateCount();
}
function updateCount() {
  const el = document.querySelector("#place small");
  if (el)
    el.textContent = `${others.size + 1} online`;
}

let meAdmin = false; // the server confirmed this connection is the admin
let deployed = ""; // the deploy this tab first connected to
let pendingPassword = ""; // typed after /admin, saved only if the server accepts it
let kicked = false; // kicked or banned: stay out instead of reconnecting
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${ROOM}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: "hello", v: 1, name: NAME, gender: GENDER, x: pos.x, z: pos.z, dir }));
    if (mySeat >= 0) sendSeat(); // reconnected while sitting
    if (myHold) sendHold();
    // a saved admin logs in again quietly, so everyone sees the admin badge
    let password = "";
    try { password = localStorage.getItem("admin-password") || ""; } catch {}
    if (password) ws.send(JSON.stringify({ t: "auth", password, quiet: true }));
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "you") {
      myId = m.id;
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
    else if (m.t === "chat") receiveChat(m.id, m.name, m.text, m.admin);
    else if (m.t === "history") {
      // what was said before we arrived (also on reconnect, so start clean)
      elMsgs.replaceChildren();
      m.messages.forEach((c) => addToHistory(c.name, c.text, c.id, c.admin));
      elMsgs.scrollTop = elMsgs.scrollHeight;
    }
    else if (m.t === "radio") receiveCommand(m.command);
    else if (m.t === "note") wall.onNote(m.note, m.total);
    else if (m.t === "note-edit") wall.onNoteEdited(m.note);
    else if (m.t === "note-del") wall.onNoteDeleted(m.id, m.total);
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
          gender: m.gender,
          admin: o.admin,
        };
        removeOther(m.id);
        createOther(p);
      }
    } else if (m.t === "hold") {
      const o = others.get(m.id);
      if (o) o.hold = m.item | 0;
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
      const o = others.get(m.id) || createOther(m);
      o.target.set(m.x, 0, m.z);
      o.dir = m.dir;
      o.step = m.step;
    }
  };
  ws.onclose = () => {
    [...others.keys()].forEach(removeOther);
    if (!kicked) setTimeout(connect, 2000); // reconnect
  };
}
const MULTIPLAYER = true;
if (MULTIPLAYER) {
  connect();
  // radio admin commands go to the server, with the saved password
  connectRadioToServer((idx) => {
    let password = "";
    try { password = localStorage.getItem("admin-password") || ""; } catch {}
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "radio", idx, password }));
  });
}

let lastSend = 0,
  lastState = "";
function sendPosition(now, step) {
  if (!ws || ws.readyState !== 1 || now - lastSend < 66) return; // ~15x/s
  const state = `${pos.x.toFixed(2)},${pos.z.toFixed(2)},${dir},${step}`;
  if (state === lastState) return;
  lastSend = now;
  lastState = state;
  ws.send(JSON.stringify({ t: "pos", x: pos.x, z: pos.z, dir, step }));
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
    m.rotation.copy(sprite.rotation);
    setFrameTex(o.tex, o.cfg, seat ? seat.dir : o.dir, seat ? 0 : o.step);
    if (o.held || (o.hold && seat)) showHeld((o.held ??= createHeld(o.feet)), m, o.cfg, o.hold, seat);
  }
}

// ---- Chat + bubble above the head ----
const elMsgs = document.querySelector("#msgs");
const elInput = document.querySelector("#msg");
const bubbles = new Map(); // owner (mesh) -> { el, until }
// any text field (chat or the admin login): game keys and the Enter shortcut stay out of it
const typing = () => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);

function addToHistory(name, text, id, admin) {
  const d = document.createElement("div");
  d.className = admin ? "m admin" : "m";
  const s = document.createElement("small");
  s.textContent = name;
  if (IS_ADMIN && id && id !== myId && id !== "me") {
    s.className = "mod";
    s.addEventListener("click", (e) => openModMenu(e, id, name));
  }
  const t = document.createElement("span");
  t.textContent = text; // textContent: no HTML from the chat
  d.append(s, t);
  // follow new messages only if already at the bottom (don't yank someone reading old ones)
  const atBottom = elMsgs.scrollHeight - elMsgs.scrollTop - elMsgs.clientHeight < 40;
  elMsgs.append(d);
  while (elMsgs.children.length > 60) elMsgs.firstChild.remove();
  if (atBottom || name === NAME) elMsgs.scrollTop = elMsgs.scrollHeight;
}

function showBubble(owner, text) {
  let b = bubbles.get(owner);
  if (!b) {
    b = {
      el: Object.assign(document.createElement("div"), { className: "bubble" }),
      until: 0,
    };
    document.body.append(b.el);
    bubbles.set(owner, b);
  }
  b.el.replaceChildren(
    Object.assign(document.createElement("span"), { textContent: text }),
  );
  b.el.style.opacity = 1;
  b.until = performance.now() + 4000 + text.length * 60; // stays longer if long
}

// ---- Admin: click a name (above a trainer or in the chat) to kick or ban ----
let IS_ADMIN = false;
try { IS_ADMIN = !!localStorage.getItem("admin-password"); } catch {}
const modMenu = Object.assign(document.createElement("div"), { id: "mod-menu", className: "glass", hidden: true });
document.body.append(modMenu);
function openModMenu(e, id, name) {
  e.stopPropagation();
  let password = "";
  try { password = localStorage.getItem("admin-password") || ""; } catch {}
  // ask the server who this is (IP tag and other names); the answer fills the menu in (showWho)
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "who", id, password }));
  modMenu.dataset.id = id;
  modMenu.replaceChildren(
    Object.assign(document.createElement("b"), { textContent: name }),
    Object.assign(document.createElement("small"), { className: "who", textContent: "…" }),
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
  modMenu.style.top = `${Math.min(e.clientY + 8, innerHeight - 110)}px`;
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
function nameTag(mesh, name, id, admin) {
  let el = nameTags.get(mesh);
  if (!el) {
    el = Object.assign(document.createElement("div"), { className: "tag" });
    el.append(
      Object.assign(document.createElement("b"), { className: "badge", textContent: "admin" }),
      Object.assign(document.createElement("span"), { className: "who" }),
    );
    if (IS_ADMIN && id) {
      el.classList.add("mod");
      el.addEventListener("click", (e) => openModMenu(e, id, el.lastChild.textContent));
    }
    document.body.append(el);
    nameTags.set(mesh, el);
  }
  if (el.lastChild.textContent !== name) el.lastChild.textContent = name;
  el.classList.toggle("admin", !!admin);
}
function updateNameTags() {
  nameTag(sprite, NAME, null, meAdmin);
  for (const [id, o] of others) nameTag(o.mesh, o.name || "trainer", id, o.admin);
  for (const [mesh, el] of nameTags) {
    if (!mesh.parent) { el.remove(); nameTags.delete(mesh); continue; }
    const baseY = mesh === sprite ? pos.y : mesh.position.y;
    _v.set(mesh.position.x, baseY + mesh.scale.y * 0.92, mesh.position.z).project(camera);
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
function updateSitPrompt(seat) {
  const s = seat >= 0 && !gamePaused && !typing() ? seatSpot(seat) : null;
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
    const baseY = owner === sprite ? pos.y : owner.position.y;
    _v.set(
      owner.position.x,
      baseY + owner.scale.y * 0.95,
      owner.position.z,
    ).project(camera);
    _v.y += 20 / (innerHeight / 2); // move above the name tag
    b.el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
    b.el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
  }
}

function receiveChat(id, name, text, admin) {
  addToHistory(name, text, id, admin);
  const owner = id === myId || id === "me" ? sprite : others.get(id)?.mesh;
  if (owner) showBubble(owner, text);
}

// tapping send must not steal focus from the box (it would close the phone keyboard)
document.querySelector("#send").addEventListener("pointerdown", (e) => e.preventDefault());
document.querySelector("#chat form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = elInput.value.trim().slice(0, 140);
  elInput.value = "";
  if (/^\/admin$/i.test(text)) return openAdminLogin();
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
  if (MULTIPLAYER && ws?.readyState === 1)
    ws.send(JSON.stringify({ t: "chat", text }));
  else receiveChat("me", NAME, text); // offline: show only to me
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
elInput.addEventListener("focus", () => {
  Object.keys(keys).forEach((k) => (keys[k] = false));
  if (!MOBILE) elInput.placeholder = "Esc or empty Enter to walk…";
});
elInput.addEventListener("blur", () => !MOBILE && (elInput.placeholder = idlePlaceholder));

// ---- Message wall ----
const wall = setupWall({ getName: () => NAME, getGender: () => GENDER, isAdmin: () => IS_ADMIN });
// near the board: a prompt over it ("E" or tap to read)
const wallPrompt = Object.assign(document.createElement("button"), { id: "wall-prompt", type: "button" });
wallPrompt.innerHTML = MOBILE ? "tap to read the wall" : "<kbd>E</kbd> read the wall";
wallPrompt.addEventListener("click", () => wall.show());
document.body.append(wallPrompt);
const nearBoard = () => Math.hypot(pos.x - board.position.x, pos.z - board.position.z - 1) < wall.NEAR;
addEventListener("keydown", (e) => {
  if (typing() || e.repeat || gamePaused || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if ((k === "e" && nearBoard()) || k === "b") wall.show();
});
// near the capybara: a prompt over it ("E" or tap to feed); feeding opens its ironic thank-you bubble
const capyPrompt = Object.assign(document.createElement("button"), { id: "capy-prompt", type: "button" });
capyPrompt.innerHTML = MOBILE ? "tap to feed the capybara" : "<kbd>E</kbd> feed the capybara";
const feedCapy = () => showBubble(capy.mesh, capy.feed(performance.now()));
capyPrompt.addEventListener("click", (e) => {
  feedCapy();
  e.currentTarget.blur(); // give the keyboard back to the game
});
document.body.append(capyPrompt);
const nearCapy = () =>
  mySeat < 0 && !nearBoard() && Math.hypot(pos.x - capy.mesh.position.x, pos.z - capy.mesh.position.z) < CAPY_NEAR;
addEventListener("keydown", (e) => {
  if (typing() || e.repeat || gamePaused || wall.isOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.toLowerCase() === "e" && nearCapy()) feedCapy();
});
function updateCapy() {
  capy.update(performance.now());
  capy.mesh.rotation.set(camera.rotation.x * 0.5, 0, 0); // faces the camera like the trainers
  const show = nearCapy() && !wall.isOpen() && !gamePaused && !bubbles.has(capy.mesh);
  capyPrompt.classList.toggle("on", show);
  if (!show) return;
  _v.set(capy.mesh.position.x, capy.mesh.position.y + 5, capy.mesh.position.z).project(camera);
  capyPrompt.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  capyPrompt.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
}
function updateWallPrompt() {
  const show = nearBoard() && !wall.isOpen() && !gamePaused;
  wallPrompt.classList.toggle("on", show);
  if (!show) return;
  _v.set(board.position.x, board.position.y + 7.4, board.position.z).project(camera);
  wallPrompt.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  wallPrompt.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
}

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
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
  const dayTarget = isDay ? 1 : 0;
  if (dayAmount !== dayTarget) {
    dayAmount += Math.sign(dayTarget - dayAmount) * Math.min(dt, Math.abs(dayTarget - dayAmount));
    applyLook(dayAmount);
  }
  updateRain(dt);
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
  if (mySeat >= 0 && (dx || dz)) standUp(true, [dx, dz]); // any move key gets you up, off that way
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
  setFrame(dir, currentStep, running);
  sendPosition(performance.now(), currentStep);
  const freeSeat = mySeat >= 0 ? -1 : nearestFreeSeat();
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
  updateOcclusion();
  // facing the camera, tilted only halfway (the shadow looks like a standing body)
  sprite.rotation.set(camera.rotation.x * 0.5, 0, 0);
  showHeld(myHeld, sprite, CHARACTER.cfg, myHold, mySeat >= 0 ? seatSpot(mySeat) : null);

  renderer.render(scene, camera);
  updateNameTags();
  updateBubbles();
  updateSitPrompt(freeSeat);
  updateWallPrompt();
  requestAnimationFrame(loop);
}
loop();
