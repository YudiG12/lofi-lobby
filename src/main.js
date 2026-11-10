import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { connectRadioToServer, receiveCommand } from "./radio.js";

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

// Night: weak bluish moonlight; the lamp posts are the main light
scene.add(new THREE.HemisphereLight("#3a4a8a", "#0b0f1a", 0.35));
const sun = new THREE.DirectionalLight("#7f95d8", 0.45); // moon
sun.position.set(40, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -80,
  right: 80,
  top: 80,
  bottom: -80,
  far: 300,
});
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
  light.shadow.mapSize.set(1024, 1024);
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
  [-6, 24],
  [6, 24],
];
const lampPosts = LAMP_POSTS.map(([x, z]) => createLampPost(x, z));
const lampPostSolids = lampPosts.flatMap((p) => p.children.filter((c) => c.isMesh));

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
    // first try moving closer to the road (out from under roof eaves);
    // only slide along the road if it doesn't fit even close to it
    const fits = (off, z) =>
      isOpen(ROAD_CENTER_X - off, z, 2.4) &&
      (!b || isOpen(ROAD_CENTER_X + off, z, 2.4));
    let zOk = z0,
      offOk = OFFSET;
    search: for (let d = 0; d <= 16; d += 0.5) {
      for (const z of [z0 + d, z0 - d]) {
        for (let off = OFFSET; off >= OFFSET_MIN; off -= 0.25) {
          if (fits(off, z)) {
            zOk = z;
            offOk = off;
            break search;
          }
        }
      }
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
sprite.renderOrder = 10;
const feetUniforms = { uFeet: { value: new THREE.Vector3() } };
sprite.material.depthTest = true;
sprite.material.depthWrite = true;
sprite.material.onBeforeCompile = (shader) => {
  shader.uniforms.uFeet = feetUniforms.uFeet;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nuniform vec3 uFeet;")
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
vec4 feetClip = projectionMatrix * viewMatrix * vec4(uFeet, 1.0);
gl_Position.z = (feetClip.z / feetClip.w) * gl_Position.w;`,
    );
};
function updateOcclusion() {
  // reference point: the feet, pulled a bit toward the camera
  const feet = new THREE.Vector3(pos.x, pos.y + 0.2, pos.z);
  // 2.4: covers the body height seen from above (tops of objects right behind
  // are closer to the camera than the feet). Smaller = objects behind cut the head;
  // larger = the sprite starts drawing over things that are in front of it.
  const toCam = camera.position
    .clone()
    .sub(feet)
    .normalize()
    .multiplyScalar(2.4);
  feetUniforms.uFeet.value.copy(feet.add(toCam));
}

// ---- Movement ----
const keys = {};
let gamePaused = true;
addEventListener("game:pause", (e) => {
  gamePaused = e.detail;
  if (gamePaused) Object.keys(keys).forEach((k) => (keys[k] = false));
});
addEventListener("keydown", (e) => {
  if (["msg", "name-input"].includes(document.activeElement?.id)) return; // typing: don't walk
  keys[e.key.toLowerCase()] = true;
});
addEventListener("keyup", (e) => (keys[e.key.toLowerCase()] = false));
const pos = new THREE.Vector3(0, 0, 0);
let dir = "down",
  tAnim = 0;
const SPEED = 9;

const clock = new THREE.Clock();
// ---- Multiplayer ----
// Other players use their configured sheets, with independent textures and crops.
// Position comes over the WebSocket and is smoothed.
const ROOM = new URLSearchParams(location.search).get("room") || "lobby";
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
  mesh.scale.copy(sprite.scale);
  scene.add(mesh);
  const o = {
    mesh,
    tex,
    cfg: available ? CROP[g] : GRID,
    target: new THREE.Vector3(p.x, 0, p.z),
    dir: p.dir || "down",
    step: p.step || 0,
    name: p.name,
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
  o.tex.dispose();
  others.delete(id);
  updateCount();
}
function updateCount() {
  const el = document.querySelector("#place small");
  if (el)
    el.textContent = `room ${ROOM} · ${others.size + 1} trainer${others.size ? "s" : ""}`;
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${ROOM}`);
  ws.onopen = () =>
    ws.send(JSON.stringify({ t: "hello", name: NAME, gender: GENDER }));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "you") myId = m.id;
    else if (m.t === "state") m.players.forEach(createOther);
    else if (m.t === "joined") createOther(m.player);
    else if (m.t === "left") removeOther(m.id);
    else if (m.t === "chat") receiveChat(m.id, m.name, m.text);
    else if (m.t === "radio") receiveCommand(m.command);
    else if (m.t === "error") addToHistory("system", m.msg);
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
          name: o.name,
          gender: m.gender,
        };
        removeOther(m.id);
        createOther(p);
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
    setTimeout(connect, 2000); // reconnect
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
    m.position.y = topHeight(m.position.x, m.position.z);
    m.rotation.copy(sprite.rotation);
    setFrameTex(o.tex, o.cfg, o.dir, o.step);
  }
}

// ---- Chat + bubble above the head ----
const elMsgs = document.querySelector("#msgs");
const elInput = document.querySelector("#msg");
const bubbles = new Map(); // owner (mesh) -> { el, until }
const typing = () => document.activeElement === elInput;

function addToHistory(name, text) {
  const d = document.createElement("div");
  d.className = "m";
  const s = document.createElement("small");
  s.textContent = name;
  const t = document.createElement("span");
  t.textContent = text; // textContent: no HTML from the chat
  d.append(s, t);
  elMsgs.append(d);
  while (elMsgs.children.length > 60) elMsgs.firstChild.remove();
  elMsgs.scrollTop = elMsgs.scrollHeight;
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

// ---- Name above each trainer ----
const nameTags = new Map(); // mesh -> div
function nameTag(mesh, name) {
  let el = nameTags.get(mesh);
  if (!el) {
    el = Object.assign(document.createElement("div"), { className: "tag" });
    document.body.append(el);
    nameTags.set(mesh, el);
  }
  if (el.textContent !== name) el.textContent = name;
}
function updateNameTags() {
  nameTag(sprite, NAME);
  for (const o of others.values()) nameTag(o.mesh, o.name || "trainer");
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

function receiveChat(id, name, text) {
  addToHistory(name, text);
  const owner = id === myId || id === "me" ? sprite : others.get(id)?.mesh;
  if (owner) showBubble(owner, text);
}

document.querySelector("#chat form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = elInput.value.trim().slice(0, 140);
  elInput.value = "";
  elInput.blur();
  if (!text) return;
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
elInput.addEventListener("focus", () =>
  Object.keys(keys).forEach((k) => (keys[k] = false)),
);

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  waterUniforms.uTime.value += dt;
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
  if (gamePaused) {
    dx = 0;
    dz = 0;
  }
  const walking = dx || dz;
  if (walking) {
    const n = Math.hypot(dx, dz);
    const speed = SPEED * (keys.shift ? 1.5 : 1);
    // move axis by axis to slide along walls
    const nx = pos.x + (dx / n) * speed * dt;
    if (isFree(nx, pos.z, pos.y)) pos.x = nx;
    const nz = pos.z + (dz / n) * speed * dt;
    if (isFree(pos.x, nz, pos.y)) pos.z = nz;
    tAnim += dt * 8 * (speed / SPEED);
  } else tAnim = 0;
  const currentStep = walking ? Math.floor(tAnim) % CHARACTER.steps : 0;
  const running = Boolean(walking && keys.shift);
  setFrame(dir, currentStep, running);
  sendPosition(performance.now(), currentStep);
  updateOthers(dt);

  // smooth the height so it doesn't jitter on small terrain steps
  pos.y = THREE.MathUtils.lerp(
    pos.y,
    topHeight(pos.x, pos.z),
    Math.min(1, dt * 12),
  );
  sprite.position.copy(pos);
  if (running && GENDER === "male") sprite.position.y -= 0.8;
  shadow.position.set(pos.x, pos.y + 0.05, pos.z);
  updateOcclusion();
  camera.position.set(pos.x, pos.y + 38, pos.z + 42);
  camera.lookAt(pos.x, pos.y + 1, pos.z);
  // facing the camera, tilted only halfway (the shadow looks like a standing body)
  sprite.rotation.set(camera.rotation.x * 0.5, 0, 0);

  renderer.render(scene, camera);
  updateNameTags();
  updateBubbles();
  requestAnimationFrame(loop);
}
loop();
