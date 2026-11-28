// The Lago, built from the town's own pieces wherever it has them: its atlas tiles for the ground,
// the dirt path's edges, the banks, the cliff and the pier; its pine trees, its animated water, its
// lamp post, benches, notice board, and the stone rim around its pond. Only what the town doesn't
// have is new (waterfalls and their river, round trees, cattails, picnic tables, the swing), drawn
// in the same palette and pixel size, and as big as the town's benches.
// Cheap to draw: the ground, banks, cliff and pier are one mesh; everything repeated is instanced.
// Where everything goes: src/lake-layout.js.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  MAP, ROWS, COLS, T, BOUNDS, WATER_Y, PIER_Y, CLIFF_H, FALLS, ATLAS,
  kind, cx, cz, groundTile, lakeLayout, createBlocker, TABLE_BENCH,
} from "./lake-layout.js";

const BED_Y = WATER_Y - 0.7; // the lake's floor, seen through the water
const RIVER_Y = CLIFF_H - 0.45; // the river on the cliff top, feeding the falls
const RIVER_BED = RIVER_Y - 0.7;
const RIM_TOP = 0.55; // the stone rim stands this much over the grass, like the town pond's
const inFall = (c) => FALLS.some(([a, b]) => c >= a && c <= b);

// the UV rectangle of an atlas tile (16 px every 18 px from (3, 3), image flipped like three does)
function tileRect([col, row], wide = 1) {
  const x0 = 3 + col * 18,
    y0 = 3 + row * 18,
    w = 16 * wide + 2 * (wide - 1);
  const e = 0.02; // a hair inside, so a neighbouring tile never bleeds in
  return { u0: (x0 + e) / 256, u1: (x0 + w - e) / 256, v0: 1 - (y0 + 16 - e) / 256, v1: 1 - (y0 + e) / 256 };
}
// squeeze a geometry's own 0..1 UVs into one tile
// (top: how much of the tile, from its top edge — the pine-needle tiles fray into holes at the bottom)
function onTile(geo, tile, wide, top = 1) {
  const r = tileRect(tile, wide);
  r.v0 = r.v1 - (r.v1 - r.v0) * top;
  const uv = geo.attributes.uv;
  // (polyhedra fix their seam with u past 1: clamp, so nothing reaches into the next tile)
  const k = (t) => Math.min(1, Math.max(0, t));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + k(uv.getX(i)) * (r.u1 - r.u0), r.v0 + k(uv.getY(i)) * (r.v1 - r.v0));
  return geo;
}

// Quads collected into one geometry: [4 corners], tile, and how much of the tile to show (for banks)
function quadBuilder() {
  const pos = [],
    uv = [],
    nor = [],
    idx = [];
  // corners in order: top-left, top-right, bottom-left, bottom-right (as the tile is drawn)
  function quad(a, b, c, d, tile, { wide = 1, vFrom = 0, vTo = 1, uFrom = 0, uTo = 1 } = {}) {
    const r = tileRect(tile, wide);
    const u = (t) => r.u0 + (r.u1 - r.u0) * t,
      v = (t) => r.v1 - (r.v1 - r.v0) * t; // t from the tile's top
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize().negate();
    const base = pos.length / 3;
    for (const p of [a, b, c, d]) pos.push(p.x, p.y, p.z), nor.push(n.x, n.y, n.z);
    uv.push(u(uFrom), v(vFrom), u(uTo), v(vFrom), u(uFrom), v(vTo), u(uTo), v(vTo));
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  function build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
  return { quad, build };
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// a flat tile at height y, its top edge to the north
const flat = (q, c, r, y, tile) => {
  const x0 = BOUNDS.minX + c * T,
    z0 = BOUNDS.minZ + r * T;
  q.quad(V(x0, y, z0), V(x0 + T, y, z0), V(x0, y, z0 + T), V(x0 + T, y, z0 + T), tile);
};
// a wall along one side of a cell, from yBot to yTop, facing out of the cell toward (dc, dr)
function wall(q, c, r, dc, dr, yBot, yTop, opts) {
  const x0 = BOUNDS.minX + c * T,
    z0 = BOUNDS.minZ + r * T;
  // the two ends of that side, ordered so the wall faces outward
  const ends = {
    "0,1": [V(x0, 0, z0 + T), V(x0 + T, 0, z0 + T)], // south side, seen from the south
    "0,-1": [V(x0 + T, 0, z0), V(x0, 0, z0)],
    "1,0": [V(x0 + T, 0, z0 + T), V(x0 + T, 0, z0)],
    "-1,0": [V(x0, 0, z0), V(x0, 0, z0 + T)],
  }[`${dc},${dr}`];
  const [a, b] = ends;
  q.quad(V(a.x, yTop, a.z), V(b.x, yTop, b.z), V(a.x, yBot, a.z), V(b.x, yBot, b.z), ATLAS.bank, { wide: 2, uTo: 0.5, ...opts });
}

// A pixel-art waterfall strip: light blue with white curls, scrolled down every frame
function waterfallTexture() {
  const cv = Object.assign(document.createElement("canvas"), { width: 16, height: 32 });
  const c = cv.getContext("2d");
  c.fillStyle = "#7cc4ef";
  c.fillRect(0, 0, 16, 32);
  const px = (x, y, col) => ((c.fillStyle = col), c.fillRect(x, y, 1, 1));
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 16; x++) {
      // vertical streaks, and a white scalloped band every 8 rows like falling water seen from the side
      if ((x * 7 + y * 3) % 11 === 0) px(x, y, "#a9dcf7");
      const band = (y + Math.round(2 * Math.sin(x * 0.8))) % 8;
      if (band === 0) px(x, y, "#ffffff");
      else if (band === 1) px(x, y, "#dff2fd");
    }
  for (let y = 0; y < 32; y++) px(0, y, "#5aaee0"), px(15, y, "#5aaee0");
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function foamTexture() {
  const cv = Object.assign(document.createElement("canvas"), { width: 16, height: 8 });
  const c = cv.getContext("2d");
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 16; x++) {
      const on = y < 3 || (y < 6 && (x * 5 + y * 3) % 4 !== 0) || (x * 3 + y) % 7 === 0;
      if (!on) continue;
      c.fillStyle = y < 2 ? "#ffffff" : "#e4f5ff";
      c.fillRect(x, y, 1, 1);
    }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// a pine from code, only if the town's own model didn't load
function fallbackPine() {
  const tiers = [[2.4, 3, 2], [1.8, 2.6, 3.7], [1.1, 2.2, 5.2]].map(([r, h, y]) => new THREE.ConeGeometry(r, h, 8).translate(0, y, 0));
  const g = mergeGeometries([new THREE.CylinderGeometry(0.3, 0.4, 1.2, 6).translate(0, 0.6, 0), ...tiers]);
  return { geometry: g, material: new THREE.MeshLambertMaterial({ color: "#3d7a3a", flatShading: true }) };
}

// kit: what the town lends — { atlas, water (material), pine?, flower?, lamp(x, z), board(parent) }
export function createLake(kit) {
  const layout = lakeLayout();
  const group = new THREE.Group();
  group.name = "Lago";
  const own = []; // geometries, materials and textures made here, freed by dispose()
  const keep = (x) => (own.push(x), x);
  const atlasMat = keep(new THREE.MeshLambertMaterial({ map: kit.atlas, alphaTest: 0.5, side: THREE.DoubleSide }));
  const m4 = new THREE.Matrix4(),
    q4 = new THREE.Quaternion(),
    UP = new THREE.Vector3(0, 1, 0),
    v3 = new THREE.Vector3(),
    s3 = new THREE.Vector3();
  const place = (mesh, i, x, y, z, rot = 0, sx = 1, sy = sx, sz = sx) =>
    mesh.setMatrixAt(i, m4.compose(v3.set(x, y, z), q4.setFromAxisAngle(UP, rot), s3.set(sx, sy, sz)));
  const instanced = (geo, mat, list, put, shadows = true) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    mesh.count = list.length;
    list.forEach((o, i) => put(mesh, i, o));
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  };

  // ---- ground: town tiles, banks, cliff and lake floor, one mesh ----
  const q = quadBuilder();
  const wet = (k) => k === "~" || k === "=";
  // past the map's edges the land goes on as it was at the edge (the lake westward, the cliff north,
  // grass and pines south and east), so the camera never looks into the void; you can't walk there
  const EXTRA = 9;
  const far = (c, r) => {
    const k = kind(Math.max(0, Math.min(COLS - 1, c)), Math.max(0, Math.min(ROWS - 1, r)));
    return k === "=" ? "~" : k === "d" && (c < 0 || c >= COLS || r < 0) ? "g" : k;
  };
  const kindAt = (c, r) => (c >= 0 && c < COLS && r >= 0 && r < ROWS ? kind(c, r) : far(c, r));
  for (let r = -EXTRA; r < ROWS + EXTRA; r++)
    for (let c = -EXTRA; c < COLS + EXTRA; c++) {
      const k = kindAt(c, r);
      if (k === "g" || k === "d") {
        flat(q, c, r, 0, c >= 0 && c < COLS && r >= 0 && r < ROWS ? groundTile(c, r) : ATLAS.grass);
        // the bank: where this land meets water, the earth drops down to the lake floor
        for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]])
          if (wet(kindAt(c + dc, r + dr))) wall(q, c, r, dc, dr, BED_Y, 0, { vTo: 0.35 });
      } else if (k === "C") {
        const river = inFall(c);
        flat(q, c, r, river ? RIVER_BED : CLIFF_H, river ? ATLAS.bank : ATLAS.grass);
        // the cliff's faces toward the water and the grass: two tiles of the earth wall, stacked
        // (each without its darker bottom row, so no seam line runs across the cliff)
        for (const [dc, dr] of [[0, 1], [1, 0], [-1, 0]]) {
          const n = kindAt(c + dc, r + dr);
          const top = river ? RIVER_BED : CLIFF_H;
          if (n === "C") {
            // the river's banks, down from the cliff top
            if (!river && inFall(c + dc)) wall(q, c, r, dc, dr, RIVER_BED, CLIFF_H, { vTo: 0.5 });
            continue;
          }
          const foot = wet(n) ? BED_Y : 0;
          const mid = foot + (top - foot) / 2;
          wall(q, c, r, dc, dr, mid, top, { vTo: 0.88 });
          wall(q, c, r, dc, dr, foot, mid, { vTo: 0.88 });
        }
      } else flat(q, c, r, BED_Y, ATLAS.bank); // under the water
    }
  const ground = new THREE.Mesh(keep(q.build()), atlasMat);
  ground.name = "Ground";
  ground.receiveShadow = true;
  group.add(ground);

  // ---- the lake: the town's own animated water, over every wet cell ----
  const wq = quadBuilder();
  for (let r = -EXTRA; r < ROWS + EXTRA; r++) for (let c = -EXTRA; c < COLS + EXTRA; c++) if (wet(kindAt(c, r))) flat(wq, c, r, WATER_Y, ATLAS.grass);
  // the river on the cliff top, from past the map's north edge down to each fall's lip
  for (let r = -EXTRA; r < 2; r++) for (let c = 0; c < COLS; c++) if (inFall(c) && kindAt(c, r) === "C") flat(wq, c, r, RIVER_Y, ATLAS.grass);
  const water = new THREE.Mesh(keep(wq.build()), kit.water);
  water.name = "Water";
  group.add(water);

  // ---- waterfalls down the cliff, and foam where they land ----
  const fallTex = keep(waterfallTexture());
  const foamTex = keep(foamTexture());
  const glowing = [];
  const falls = [],
    foams = [];
  const faceZ = BOUNDS.minZ + 2 * T; // the cliff's south face
  for (const [a, b] of FALLS) {
    const w = (b - a + 1) * T - 0.6,
      h = RIVER_Y - WATER_Y + 0.3;
    const tex = fallTex.clone();
    tex.repeat.set(w / T, h / (2 * T)); // the town's pixel size: 16 px per tile
    tex.needsUpdate = true;
    own.push(tex);
    // partly self-lit, like falling water catching the sky: brighter by day, dimmer at night
    const mat = keep(new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: "#ffffff", emissiveIntensity: 0.5 }));
    glowing.push(mat);
    const fall = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), mat);
    fall.position.set((cx(a) + cx(b)) / 2, WATER_Y + h / 2 - 0.3, faceZ + 0.08);
    // a lip where it pours over the top
    const lip = new THREE.Mesh(keep(new THREE.BoxGeometry(w, 0.12, 0.9)), mat);
    lip.position.set(fall.position.x, RIVER_Y + 0.02, faceZ - 0.35);
    const ft = foamTex.clone();
    ft.repeat.set((w + 1.2) / T, 1);
    ft.needsUpdate = true;
    own.push(ft);
    const foam = new THREE.Mesh(keep(new THREE.PlaneGeometry(w + 1.2, 1.8).rotateX(-Math.PI / 2)), keep(new THREE.MeshLambertMaterial({ map: ft, transparent: true, emissive: "#3a5f75", depthWrite: false })));
    foam.position.set(fall.position.x, WATER_Y + 0.04, faceZ + 0.95);
    group.add(fall, lip, foam);
    falls.push(tex);
    foams.push(ft);
  }

  // ---- the pier: planks over the water, on bark posts ----
  const pier = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAP[r][c] === "=") pier.push([c, r]);
  const pq = quadBuilder();
  for (const [c, r] of pier) {
    flat(pq, c, r, PIER_Y, ATLAS.planks);
    for (const [dc, dr] of [[0, 1], [0, -1], [-1, 0]])
      if (kind(c + dc, r + dr) === "~") {
        const x0 = BOUNDS.minX + c * T,
          z0 = BOUNDS.minZ + r * T;
        const s = { "0,1": [V(x0, 0, z0 + T), V(x0 + T, 0, z0 + T)], "0,-1": [V(x0 + T, 0, z0), V(x0, 0, z0)], "-1,0": [V(x0, 0, z0), V(x0, 0, z0 + T)] }[`${dc},${dr}`];
        pq.quad(V(s[0].x, PIER_Y, s[0].z), V(s[1].x, PIER_Y, s[1].z), V(s[0].x, PIER_Y - 0.4, s[0].z), V(s[1].x, PIER_Y - 0.4, s[1].z), ATLAS.plankLight, { vTo: 0.3 });
      }
  }
  const deck = new THREE.Mesh(keep(pq.build()), atlasMat);
  deck.name = "Pier";
  deck.castShadow = deck.receiveShadow = true;
  group.add(deck);
  const pierMinX = Math.min(...pier.map(([c]) => c)), pierMaxX = Math.max(...pier.map(([c]) => c));
  const pierMinR = Math.min(...pier.map(([, r]) => r)), pierMaxR = Math.max(...pier.map(([, r]) => r));
  const posts = [];
  for (let c = pierMinX; c <= pierMaxX + 1; c++)
    for (const r of [pierMinR, pierMaxR + 1]) posts.push({ x: BOUNDS.minX + c * T + (c === pierMinX ? 0.3 : c > pierMaxX ? -0.3 : 0), z: BOUNDS.minZ + r * T + (r === pierMinR ? 0.3 : -0.3) });
  instanced(keep(onTile(new THREE.BoxGeometry(0.5, 1.6, 0.5).translate(0, -0.4, 0), ATLAS.bark)), atlasMat, posts, (m, i, p) => place(m, i, p.x, PIER_Y, p.z));
  // crates on the pier
  instanced(keep(onTile(new THREE.BoxGeometry(1.1, 1, 1.1).translate(0, 0.5, 0), ATLAS.planks)), atlasMat, layout.crates, (m, i, p) => place(m, i, p.x, PIER_Y + p.y, p.z, i * 0.3));

  // ---- the town's: pines, the notice board, a lamp post ----
  const pine = kit.pine || fallbackPine();
  if (!kit.pine) own.push(pine.geometry, pine.material);
  instanced(pine.geometry, pine.material, layout.pines, (m, i, p) => place(m, i, p.x, 0, p.z, p.rot, p.s));
  const board = kit.board(group);
  board.position.set(layout.board.x, 0, layout.board.z);
  const lamp = kit.lamp(layout.lamp.x, layout.lamp.z);
  group.add(lamp);

  // ---- rocks (the town's stone tile), lily pads (its lily), flowers (its flowers) ----
  instanced(keep(onTile(new THREE.DodecahedronGeometry(0.9, 0).scale(1, 0.65, 1), ATLAS.stone)), keep(new THREE.MeshLambertMaterial({ map: kit.atlas, flatShading: true })), layout.rocks,
    (m, i, r) => place(m, i, r.x, (r.wet ? WATER_Y : 0) + 0.2 * r.s, r.z, r.rot, r.s));
  instanced(keep(onTile(new THREE.CircleGeometry(0.8, 8).rotateX(-Math.PI / 2), ATLAS.lily)), atlasMat, layout.lilies, (m, i, l) => place(m, i, l.x, WATER_Y + 0.05, l.z, l.rot, l.s), false);
  const cross = (tile) => {
    const a = onTile(new THREE.PlaneGeometry(0.9, 0.9).translate(0, 0.45, 0), tile);
    const b = a.clone().rotateY(Math.PI / 2);
    const g = mergeGeometries([a, b]);
    a.dispose(), b.dispose();
    return keep(g);
  };
  [ATLAS.flowerWhite, ATLAS.flowerBlue, [8, 11]].forEach((tile, t) =>
    instanced(cross(tile), atlasMat, layout.flowers.filter((f) => f.tint === t), (m, i, f) => place(m, i, f.x, 0, f.z, f.x, 1.1), false),
  );

  // ---- new: round trees, cattails ----
  const leaves = keep(new THREE.MeshLambertMaterial({ map: kit.atlas, flatShading: true }));
  const crown = keep(mergeGeometries([
    onTile(new THREE.IcosahedronGeometry(2.2, 0).translate(0, 4.6, 0), [7, 13], 1, 0.5),
    onTile(new THREE.IcosahedronGeometry(1.7, 0).translate(1.3, 3.8, 0.4), [8, 13], 1, 0.5),
    onTile(new THREE.IcosahedronGeometry(1.6, 0).translate(-1.2, 3.9, -0.3), [8, 13], 1, 0.5),
    onTile(new THREE.IcosahedronGeometry(1.4, 0).translate(0.2, 5.9, -0.2), [7, 13], 1, 0.5),
  ]));
  const trunk = keep(onTile(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 6).translate(0, 1.7, 0), ATLAS.bark));
  instanced(trunk, atlasMat, layout.roundTrees, (m, i, t) => place(m, i, t.x, 0, t.z, t.x, t.s));
  instanced(crown, leaves, layout.roundTrees, (m, i, t) => place(m, i, t.x, 0, t.z, t.x, t.s));

  const reedMat = keep(new THREE.MeshLambertMaterial({ color: "#6c9a3e", flatShading: true }));
  const headMat = keep(new THREE.MeshLambertMaterial({ color: "#8a5530", flatShading: true }));
  instanced(keep(new THREE.BoxGeometry(0.08, 1, 0.08).translate(0, 0.5, 0)), reedMat, layout.cattails, (m, i, c) => place(m, i, c.x, 0, c.z, 0, 1, c.h, 1), false);
  instanced(keep(new THREE.BoxGeometry(0.2, 0.45, 0.2)), headMat, layout.cattails, (m, i, c) => place(m, i, c.x, c.h * 0.85, c.z, c.x), false);
  instanced(keep(new THREE.PlaneGeometry(0.14, 1.2).translate(0.15, 0.6, 0)), reedMat, layout.cattails, (m, i, c) => place(m, i, c.x, 0, c.z, c.x * 5, 1, c.h * 0.8, 1), false);

  // ---- the town's stone rim, around the lake, along the cliff's edge and the river ----
  // (the town pond's own edge piece, repeated; a box of its stone tile if the model didn't load)
  const rims = [];
  const rimAt = (c, r, dc, dr, top) => {
    const x = BOUNDS.minX + (c + 0.5 + dc / 2) * T,
      z = BOUNDS.minZ + (r + 0.5 + dr / 2) * T;
    rims.push({ x, z, rot: dc ? Math.PI / 2 : 0, top });
  };
  for (let r = -EXTRA; r < ROWS + EXTRA; r++)
    for (let c = -EXTRA; c < COLS + EXTRA; c++) {
      const k = kindAt(c, r);
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      if (k === "g" || k === "d") {
        for (const [dc, dr] of dirs) if (kindAt(c + dc, r + dr) === "~") rimAt(c, r, dc, dr, RIM_TOP);
      } else if (k === "C" && !inFall(c)) {
        for (const [dc, dr] of dirs) {
          const n = kindAt(c + dc, r + dr);
          if (n !== "C" || inFall(c + dc)) rimAt(c, r, dc, dr, CLIFF_H + RIM_TOP);
        }
      }
    }
  const rimPiece = kit.rim || { geometry: keep(onTile(new THREE.BoxGeometry(2.56, 1.6, 0.9).translate(0, 0.8, 0), [11, 1])), material: atlasMat };
  const rimH = (rimPiece.geometry.boundingBox || rimPiece.geometry.computeBoundingBox() || rimPiece.geometry.boundingBox).max.y;
  const rimLen = 2.56;
  instanced(rimPiece.geometry, rimPiece.material, rims, (m, i, e) => place(m, i, e.x, e.top - rimH, e.z, e.rot, (T / rimLen) * 1.04, 1, 1));
  // stones where the falls pour over and land
  const fallRocks = FALLS.flatMap(([a, b]) => [
    { x: cx(a) - 1.4, y: WATER_Y, z: faceZ + 0.8, s: 1.3 },
    { x: cx(b) + 1.4, y: WATER_Y, z: faceZ + 0.9, s: 1.1 },
    { x: cx(a) - 1.2, y: CLIFF_H, z: faceZ - 0.9, s: 0.9 },
    { x: cx(b) + 1.2, y: CLIFF_H, z: faceZ - 0.8, s: 0.8 },
  ]);
  instanced(keep(onTile(new THREE.DodecahedronGeometry(0.9, 0).scale(1, 0.7, 1), ATLAS.stone)), keep(new THREE.MeshLambertMaterial({ map: kit.atlas, flatShading: true })), fallRocks,
    (m, i, r) => place(m, i, r.x, r.y + 0.2, r.z, r.x, r.s));

  // ---- seats: the town's benches, picnic tables and the swing, all on the town's bench size ----
  const seatBoxes = []; // they hide whoever stands behind them (main.js, updateOcclusion)
  const boxOf = (o) => (o.updateMatrixWorld(true), new THREE.Box3().setFromObject(o));
  for (const b of layout.benches) {
    const bench = kit.bench(b.face);
    bench.position.set(b.x, 0, b.z);
    group.add(bench);
    seatBoxes.push(boxOf(bench));
  }
  // picnic tables: a long top at table height and a bench on each side at the town bench's height
  const tableGeo = keep(mergeGeometries([
    onTile(new THREE.BoxGeometry(4.8, 0.24, 2.3), ATLAS.plankLight).translate(0, 2.35, 0),
    ...[-1, 1].flatMap((side) => [
      onTile(new THREE.BoxGeometry(4.8, 0.2, 0.75), ATLAS.plankLight).translate(0, 1.5, side * TABLE_BENCH),
      onTile(new THREE.BoxGeometry(0.24, 0.2, 2 * TABLE_BENCH + 0.75), ATLAS.planks).translate(side * 1.9, 1.3, 0),
      onTile(new THREE.BoxGeometry(0.24, 1.4, 0.24), ATLAS.planks).translate(side * 1.9, 0.7, TABLE_BENCH),
      onTile(new THREE.BoxGeometry(0.24, 1.4, 0.24), ATLAS.planks).translate(side * 1.9, 0.7, -TABLE_BENCH),
      onTile(new THREE.BoxGeometry(0.26, 2.3, 0.26), ATLAS.planks).translate(side * 1.9, 1.15, 0),
    ]),
    onTile(new THREE.BoxGeometry(0.5, 0.45, 0.5), ATLAS.red).translate(0, 2.7, 0),
  ]));
  const tables = instanced(tableGeo, atlasMat, layout.tables, (m, i, t) => place(m, i, t.x, 0, t.z));
  instanced(cross(ATLAS.flowerBlue), atlasMat, layout.tables, (m, i, t) => place(m, i, t.x, 2.9, t.z, 0.4, 1.1), false);
  // only the top: someone on the far bench is behind it (it hides their legs), someone on the near
  // bench is in front of it
  for (const t of layout.tables) seatBoxes.push(new THREE.Box3(V(t.x - 2.4, 0, t.z - 1.15), V(t.x + 2.4, 2.5, t.z + 1.15)));
  void tables;

  // the swing: a wooden A-frame with a bench seat hanging from it, swaying when nobody sits
  const swing = new THREE.Group();
  swing.position.set(layout.swing.x, 0, layout.swing.z);
  const beam = (w, h, d, x, y, z, rz = 0, rx = 0, tile = ATLAS.planks) => {
    const b = new THREE.Mesh(keep(onTile(new THREE.BoxGeometry(w, h, d), tile)), atlasMat);
    b.position.set(x, y, z);
    b.rotation.set(rx, 0, rz);
    b.castShadow = b.receiveShadow = true;
    swing.add(b);
    return b;
  };
  const TOP = 5.4;
  for (const side of [-1, 1])
    for (const fz of [-1, 1]) beam(0.36, TOP + 0.3, 0.36, side * 3.05, TOP / 2, fz * 0.75, 0, fz * 0.26);
  beam(6.9, 0.42, 0.42, 0, TOP, 0, 0, 0, ATLAS.bark);
  const seat = new THREE.Group();
  seat.position.set(0, TOP, 0);
  const plank = (w, h, d, x, y, z, rx = 0, tile = ATLAS.plankLight) => {
    const b = new THREE.Mesh(keep(onTile(new THREE.BoxGeometry(w, h, d), tile)), atlasMat);
    b.position.set(x, y, z);
    b.rotation.x = rx;
    b.castShadow = b.receiveShadow = true;
    seat.add(b);
  };
  // the town bench's seat (1.5 high, 4.5 wide, three slats) and backrest
  [0.5, 0, -0.5].forEach((z, i) => plank(4.5, 0.18, 0.4, 0, 1.51 - TOP, z, 0, i % 2 ? ATLAS.planks : ATLAS.plankLight));
  plank(4.5, 0.36, 0.14, 0, 2.0 - TOP, -0.78, -0.08, ATLAS.planks);
  plank(4.5, 0.36, 0.14, 0, 2.55 - TOP, -0.83, -0.08);
  for (const x of [-2.1, 2.1]) {
    const rope = new THREE.Mesh(keep(new THREE.BoxGeometry(0.08, TOP - 1.5, 0.08).translate(0, -(TOP - 1.5) / 2, 0)), headMat);
    rope.position.x = x;
    seat.add(rope);
  }
  swing.add(seat);
  group.add(swing);
  seatBoxes.push(boxOf(swing));

  const blocked = createBlocker(layout);
  const box = new THREE.Box3(V(BOUNDS.minX, BED_Y, BOUNDS.minZ), V(BOUNDS.maxX, CLIFF_H, BOUNDS.maxZ));
  // fireflies over the shore and the water by the pier
  const fireflies = new THREE.Box3(V(cx(2), 0, cz(4)), V(cx(13), 0, cz(17)));

  return {
    group,
    walk: [ground, deck, water], // what the trainers stand on (and the rain lands on)
    water,
    box,
    blocked,
    fireflies,
    board,
    seats: layout.seats.map((b) => ({ ...b, y: 0 })), // { x, y, z, face }: two seats each, as main.js's benches
    seatBoxes,
    // night: 0 by day, 1 at night; swingBusy: someone sits on it, so it holds still
    update(t, night, swingBusy) {
      for (const m of glowing) m.emissiveIntensity = 0.55 - 0.4 * night;
      for (const tex of falls) tex.offset.y = t * 0.9; // pouring down
      for (const tex of foams) tex.offset.x = Math.sin(t * 0.7) * 0.15; // churning
      seat.rotation.x = swingBusy ? seat.rotation.x * 0.9 : Math.sin(t * 1.3) * 0.06;
    },
    dispose() {
      group.removeFromParent();
      group.traverse((o) => o.isInstancedMesh && o.dispose());
      own.forEach((x) => x.dispose?.());
    },
  };
}
