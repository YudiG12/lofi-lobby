// Holiday decorations: from late November to Twelfth Night each house decorates in its own way
// (lights under the front edge of the roof, something on the door), a Christmas tree with lights
// and presents stands in town, and a snowman shows up when it snows (it grows as the snow
// settles and melts away after). Drawn in code, same low-poly look as the town. The lights follow
// the lamp posts and the candles: they come on at night (twinkling, with a faint coloured light on
// the walls and the snow) and go out by day, fading with them.
import * as THREE from "three";

// 20 November to 6 January, by the visitor's own clock
export function inHolidaySeason(d = new Date()) {
  const m = d.getMonth(),
    day = d.getDate();
  return (m === 10 && day >= 20) || m === 11 || (m === 0 && day <= 6);
}

// Where the decorations go on each house model, measured from its bounding box (both houses
// are used twice, moved but not turned: their fronts face +z, toward the camera).
// eave: height of the front edge of the roof; inset: how far in from the sides the string runs;
// door: centre of the door from the left side, the height of its top and how deep it sits.
const HOUSES = [
  { match: /HouseSmall/, eave: 6.15, back: 0.05, inset: 0.4, door: { x: 3.75, top: 5.1, depth: 0.68 } },
  { match: /HouseLarge/, eave: 9.25, back: 0.15, inset: 0.6, door: { x: 4.85, top: 5.1, depth: 0.48 } },
];
const hex = (list) => list.map((c) => new THREE.Color(c));
// every house its own style, in the order the town lists them
const STYLES = [
  { lights: "sag", colors: hex(["#ff4a4a", "#3fd16b", "#ffc93d", "#4aa8ff", "#ff8de0"]), door: "wreath" }, // the classic
  { lights: "icicle", colors: hex(["#fff1c9"]), door: "garland" }, // warm white icicles
  { lights: "sag", colors: hex(["#ff3b3b", "#f4f4f4"]), door: "canes" }, // candy cane red and white
  { lights: "icicle", colors: hex(["#6fb6ff", "#eaf4ff"]), door: "goldWreath" }, // frosty blue
];
const SPAN = 2.2; // between the hooks a sagging string hangs from
const PER_SPAN = 4; // bulbs on each span
const SAG = 0.4;

const lambert = (color, extra) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const leafMaterial = lambert("#2f7a43");
const pineMaterial = lambert("#245f39");
const trunkMaterial = lambert("#5a3a22");
const ribbonMaterial = lambert("#c8283a");
const goldMaterial = lambert("#e2b43c", { emissive: "#3a2a06" });
const whiteMaterial = lambert("#f4f4f4");
const berryMaterial = lambert("#e0303c", { emissive: "#40080c" });
const snowMaterial = lambert("#eef3fa", { emissive: "#1c2230" }); // a little light of its own, so it stays white at night
const coalMaterial = lambert("#22232a");
const carrotMaterial = lambert("#ef7a24");
const stickMaterial = lambert("#5b3b22");
const wireMaterial = new THREE.LineBasicMaterial({ color: "#1d2a22" });
const STAR = new THREE.Color("#ffd65a");
const starMaterial = new THREE.MeshBasicMaterial({ color: STAR.clone(), toneMapped: false });
// the bulbs carry their own colour and are not lit by the scene (they are the light)
const bulbMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });

// a soft round glow for the halos around the bulbs at night
const haloTexture = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,.35)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();

const mesh = (geometry, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

function wreath(bow = ribbonMaterial, berries = berryMaterial) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.TorusGeometry(0.55, 0.2, 5, 12), leafMaterial));
  const berry = new THREE.SphereGeometry(0.08, 5, 4);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    g.add(mesh(berry, berries, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.17));
  }
  // a bow at the bottom: two loops, the knot and two tails
  const loop = new THREE.BoxGeometry(0.34, 0.22, 0.08);
  for (const s of [-1, 1]) {
    const l = mesh(loop, bow, s * 0.2, -0.55, 0.2);
    l.rotation.z = s * 0.35;
    g.add(l);
    const tail = mesh(new THREE.BoxGeometry(0.08, 0.34, 0.05), bow, s * 0.09, -0.78, 0.22);
    tail.rotation.z = s * 0.25;
    g.add(tail);
  }
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.14, 0.1), bow, 0, -0.55, 0.24));
  return g;
}

// a candy cane: red and white rings up the stick, and the hook on top
function candyCane() {
  const g = new THREE.Group();
  const ring = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 6);
  for (let i = 0; i < 9; i++) g.add(mesh(ring, i % 2 ? whiteMaterial : ribbonMaterial, 0, 0.1 + i * 0.2, 0));
  const hook = mesh(new THREE.TorusGeometry(0.28, 0.1, 5, 8, Math.PI), ribbonMaterial, 0.28, 1.8, 0);
  g.add(hook);
  return g;
}

export function createHolidayDecor(scene) {
  const group = new THREE.Group();
  group.name = "HolidayDecor";
  scene.add(group);
  const bulbs = []; // { p: world position, c: colour, s: size }
  const solids = []; // boxes nobody walks through (the snowman's empties while there is no snow)
  let bulbMesh = null,
    halos = null,
    haloMaterial = null,
    snowman = null,
    snowmanBox = null,
    snowmanFull = null;
  const phase = [];
  const glows = []; // faint coloured lights, one per house and one in the tree: out by day
  const glow = (color, x, y, z, strength) => {
    const l = new THREE.PointLight(color, 0, 9, 1.6);
    l.position.set(x, y, z);
    l.userData.strength = strength;
    group.add(l);
    glows.push(l);
  };
  const _c = new THREE.Color();
  const bulb = (x, y, z, c, s = 1) => bulbs.push({ p: new THREE.Vector3(x, y, z), c, s });

  // lights along a house's eave, from x0 to x1 at height y, depth z
  function stringLights(style, x0, x1, y, z) {
    const n = Math.max(1, Math.round((x1 - x0) / SPAN));
    const wire = [];
    if (style.lights === "sag") {
      for (let s = 0; s < n; s++)
        for (let k = s ? 1 : 0; k <= 8; k++) {
          const u = k / 8;
          wire.push(new THREE.Vector3(x0 + ((s + u) / n) * (x1 - x0), y - SAG * Math.sin(Math.PI * u), z));
        }
      let i = 0;
      for (let s = 0; s < n; s++)
        for (let k = 0; k < PER_SPAN; k++) {
          const u = (k + 0.5) / PER_SPAN;
          bulb(x0 + ((s + u) / n) * (x1 - x0), y - SAG * Math.sin(Math.PI * u) - 0.16, z + 0.02, style.colors[i++ % style.colors.length]);
        }
    } else {
      // icicles: a straight wire with short strands hanging from it, long and short in turn
      wire.push(new THREE.Vector3(x0, y, z), new THREE.Vector3(x1, y, z));
      const strands = Math.round((x1 - x0) / 0.55);
      for (let i = 0; i <= strands; i++) {
        const x = x0 + (i / strands) * (x1 - x0);
        const len = [3, 1, 2, 1, 4, 2][i % 6];
        wire.push(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y - len * 0.26, z)); // pairs: drawn as segments
        for (let k = 1; k <= len; k++) bulb(x, y - k * 0.26, z + 0.02, style.colors[(i + k) % style.colors.length], 0.7);
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(wire);
    group.add(style.lights === "sag" ? new THREE.Line(geo, wireMaterial) : new THREE.LineSegments(geo, wireMaterial));
  }

  // what goes on (or by) the door: x, top and z of the door's face
  function doorDecor(style, x, top, z) {
    if (style.door === "wreath" || style.door === "goldWreath") {
      const w = style.door === "wreath" ? wreath() : wreath(goldMaterial, goldMaterial);
      w.position.set(x, top - 1.05, z + 0.12);
      group.add(w);
    } else if (style.door === "garland") {
      // a green swag over the door frame, with a few warm bulbs and a bow at the top
      const g = new THREE.Group();
      const tuft = new THREE.DodecahedronGeometry(0.22, 0);
      for (let i = 0; i <= 14; i++) {
        const u = i / 14;
        const gx = (u - 0.5) * 3.0;
        const gy = 0.25 - Math.cos((u - 0.5) * Math.PI) * -0.3 - (Math.abs(u - 0.5) > 0.45 ? 0.4 : 0);
        const t = mesh(tuft, leafMaterial, gx, gy, 0);
        t.rotation.set(i, i * 2, 0);
        g.add(t);
        if (i % 3 === 1) bulb(x + gx, top + gy - 0.12, z + 0.35, style.colors[0], 0.8);
      }
      // the bow: the wreath's own, without the ring and berries (its last five pieces)
      for (const k of wreath().children.slice(-5)) {
        k.position.y += 1.15;
        g.add(k);
      }
      g.position.set(x, top, z + 0.2);
      group.add(g);
    } else if (style.door === "canes") {
      for (const s of [-1, 1]) {
        const c = candyCane();
        c.position.set(x + s * 1.75, top - 4.1, z + 0.6);
        c.rotation.y = s > 0 ? Math.PI : 0; // hooks turned outward
        group.add(c);
      }
      const w = wreath();
      w.position.set(x, top - 1.05, z + 0.12);
      group.add(w);
    }
  }

  // A Christmas tree: three tiers of pine, a trunk, ornaments, a spiral of lights, a star and presents.
  function christmasTree(x, y, z) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 6), trunkMaterial, 0, 0.6, 0));
    const tiers = [
      [2.6, 3.0, 2.2],
      [2.0, 2.6, 3.9],
      [1.35, 2.2, 5.4],
    ];
    for (const [r, h, at] of tiers) g.add(mesh(new THREE.ConeGeometry(r, h, 8), pineMaterial, 0, at, 0));
    // ornaments: shiny balls on the tiers' lower edges
    const ball = new THREE.SphereGeometry(0.17, 6, 5);
    const ballMats = [ribbonMaterial, goldMaterial, lambert("#3c7bd9"), whiteMaterial];
    tiers.forEach(([r, h, at], t) => {
      for (let i = 0; i < 7 - t; i++) {
        const a = (i / (7 - t)) * Math.PI * 2 + t;
        g.add(mesh(ball, ballMats[(i + t) % 4], Math.cos(a) * r * 0.85, at - h * 0.4, Math.sin(a) * r * 0.85));
      }
    });
    // lights in a spiral from the bottom to the top
    const colors = hex(["#ff4a4a", "#ffc93d", "#3fd16b", "#4aa8ff", "#fff1c9"]);
    for (let i = 0; i < 34; i++) {
      const u = i / 34;
      const h = 0.9 + u * 5.6;
      const r = 2.45 * (1 - u) + 0.25;
      const a = u * Math.PI * 2 * 3.5;
      bulb(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r, colors[i % colors.length], 0.8);
    }
    // the star on top
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? 0.22 : 0.55;
      star[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
    }
    const starMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(star, { depth: 0.14, bevelEnabled: false }), starMaterial);
    starMesh.position.set(0, 7.0, -0.07);
    g.add(starMesh);
    bulb(x, y + 7.0, z, new THREE.Color("#ffd65a"), 0.01); // only its halo
    // presents under the tree
    const presents = [
      [1.5, 0.45, 1.6, 0.9, 0.9, 0.9, ribbonMaterial, goldMaterial],
      [-1.2, 0.35, 1.8, 0.7, 0.7, 1.0, lambert("#3c7bd9"), whiteMaterial],
      [0.2, 0.3, 2.3, 1.1, 0.6, 0.7, lambert("#2e8f53"), ribbonMaterial],
    ];
    for (const [px, h, pz, w, hh, d, box, rib] of presents) {
      g.add(mesh(new THREE.BoxGeometry(w, hh, d), box, px, h, pz));
      g.add(mesh(new THREE.BoxGeometry(w + 0.02, hh + 0.02, 0.14), rib, px, h, pz));
      g.add(mesh(new THREE.BoxGeometry(0.14, hh + 0.02, d + 0.02), rib, px, h, pz));
    }
    g.position.set(x, y, z);
    group.add(g);
    glow("#ffcf7a", x, y + 3.5, z + 2.4, 9);
    solids.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, y + 2, z + 0.3), new THREE.Vector3(4.2, 4, 4.4)));
  }

  // A snowman in a knit beanie, like the trainers wear in the snow.
  function makeSnowman(x, y, z, turn = 0) {
    const g = new THREE.Group();
    const ball = (r, at) => g.add(mesh(new THREE.IcosahedronGeometry(r, 1), snowMaterial, 0, at, 0));
    ball(1.1, 0.95);
    ball(0.8, 2.45);
    ball(0.58, 3.55);
    const coal = new THREE.SphereGeometry(0.08, 5, 4);
    for (const ex of [-0.2, 0.2]) g.add(mesh(coal, coalMaterial, ex, 3.68, 0.52));
    for (let i = 0; i < 5; i++) {
      const a = (i / 4 - 0.5) * 1.6;
      g.add(mesh(coal, coalMaterial, Math.sin(a) * 0.3, 3.38 + Math.cos(a) * 0.08 - 0.05, 0.5 + Math.cos(a) * 0.02));
    }
    for (const by of [2.75, 2.35, 1.95]) g.add(mesh(coal, coalMaterial, 0, by, 0.78));
    const nose = mesh(new THREE.ConeGeometry(0.09, 0.5, 6), carrotMaterial, 0, 3.55, 0.78);
    nose.rotation.x = Math.PI / 2;
    g.add(nose);
    // stick arms
    for (const s of [-1, 1]) {
      const arm = mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.6, 4), stickMaterial, s * 1.35, 2.75, 0);
      arm.rotation.z = s * -1.0;
      g.add(arm);
      const twig = mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.45, 4), stickMaterial, s * 1.95, 3.25, 0);
      twig.rotation.z = s * -0.2;
      g.add(twig);
    }
    // scarf: a ring round the neck and an end hanging down the front
    const scarf = mesh(new THREE.TorusGeometry(0.55, 0.13, 5, 12), ribbonMaterial, 0, 3.05, 0);
    scarf.rotation.x = Math.PI / 2;
    g.add(scarf);
    const end = mesh(new THREE.BoxGeometry(0.26, 0.7, 0.1), ribbonMaterial, 0.3, 2.75, 0.62);
    end.rotation.z = 0.15;
    g.add(end);
    // beanie: green with a ribbed cuff and a pom-pom
    const cap = mesh(new THREE.SphereGeometry(0.55, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), lambert("#3fa34d"), 0, 3.82, 0);
    g.add(cap);
    const cuff = mesh(new THREE.TorusGeometry(0.55, 0.1, 5, 12), lambert("#2e7d3a"), 0, 3.85, 0);
    cuff.rotation.x = Math.PI / 2;
    g.add(cuff);
    g.add(mesh(new THREE.IcosahedronGeometry(0.17, 0), snowMaterial, 0, 4.45, 0));
    g.position.set(x, y, z);
    g.rotation.y = turn;
    g.scale.setScalar(0.001);
    g.visible = false;
    group.add(g);
    snowman = g;
    snowmanFull = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, y + 1.5, z), new THREE.Vector3(2.2, 3, 2.2));
    snowmanBox = new THREE.Box3(); // empty until it snows
    solids.push(snowmanBox);
  }

  // Warm white lights wound round a lamp post's pole, and a red bow under the arm.
  const warm = hex(["#fff1c9", "#ffd98a"]);
  function lampLights(post) {
    const { x, z } = post.position;
    const y = post.position.y;
    const turns = 6,
      n = 30;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const a = u * Math.PI * 2 * turns;
      bulb(x + Math.cos(a) * 0.44, y + 1 + u * 5.8, z + Math.sin(a) * 0.44, warm[i % 2], 0.6);
    }
    const bow = new THREE.Group();
    for (const k of wreath().children.slice(-5)) bow.add(k); // the wreath's bow on its own
    bow.position.set(x, y + 7.45, z + 0.38);
    bow.scale.setScalar(1.3);
    group.add(bow);
  }

  // A string along the top rail of a fence, sagging a little between the posts.
  const fenceColors = hex(["#ff4a4a", "#ffc93d", "#3fd16b", "#4aa8ff"]);
  function fenceLights(o) {
    const b = new THREE.Box3().setFromObject(o);
    const along = b.max.x - b.min.x >= b.max.z - b.min.z;
    const len = along ? b.max.x - b.min.x : b.max.z - b.min.z;
    if (len < 1.5) return;
    const n = Math.max(2, Math.round(len / 0.6));
    const y = b.max.y - 0.12;
    const mid = along ? (b.min.z + b.max.z) / 2 : (b.min.x + b.max.x) / 2;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const t = (along ? b.min.x : b.min.z) + u * len;
      const sag = 0.12 * Math.sin(Math.PI * ((u * 3) % 1)); // three little dips per fence
      along ? bulb(t, y - sag, mid, fenceColors[i % 4], 0.6) : bulb(mid, y - sag, t, fenceColors[i % 4], 0.6);
    }
  }

  // Lights spiralling round some pines near the middle of town (every third one, so they don't all shine).
  function pineLights(pines) {
    const near = pines
      .map((o) => ({ o, b: new THREE.Box3().setFromObject(o) }))
      .filter(({ b }) => {
        const cx = (b.min.x + b.max.x) / 2,
          cz = (b.min.z + b.max.z) / 2;
        return Math.abs(cx) < 30 && cz > -16 && cz < 30;
      })
      .sort((p, q) => p.b.min.x - q.b.min.x || p.b.min.z - q.b.min.z)
      .filter((_, i) => i % 3 === 0);
    const colors = hex(["#ff4a4a", "#ffc93d", "#4aa8ff", "#fff1c9", "#3fd16b"]);
    for (const { b } of near) {
      const cx = (b.min.x + b.max.x) / 2,
        cz = (b.min.z + b.max.z) / 2;
      const r0 = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
      const y0 = b.min.y + (b.max.y - b.min.y) * 0.25,
        y1 = b.max.y - 0.6;
      const n = 26;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        const a = u * Math.PI * 2 * 3 + cx;
        const r = r0 * (0.92 - 0.75 * u) + 0.1; // follows the cone in
        bulb(cx + Math.cos(a) * r, y0 + u * (y1 - y0), cz + Math.sin(a) * r, colors[i % colors.length], 0.75);
      }
    }
  }

  // Under the front edge of the board's little roof.
  function boardLights(board) {
    board.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(board);
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = b.min.x + 0.2 + u * (b.max.x - b.min.x - 0.4);
      // the roof slopes down from the middle: follow it
      const y = b.max.y - 0.55 - Math.abs(u - 0.5) * 0.9 - 0.12 * Math.sin(Math.PI * ((u * 4) % 1));
      bulb(x, y, b.max.z + 0.05, fenceColors[i % 4], 0.6);
    }
  }

  // Puts everything up. findSpot(x, z, radius) gives the open spot nearest (x, z) as [x, y, z].
  // extras: { lamps: the lamp post groups, board: the message board group }
  function decorate(townMeshes, findSpot, extras = {}) {
    let i = 0;
    for (const o of townMeshes) {
      const kind = HOUSES.find((h) => h.match.test(o.name));
      if (!kind) continue;
      const style = STYLES[i++ % STYLES.length];
      const box = new THREE.Box3().setFromObject(o);
      stringLights(style, box.min.x + kind.inset, box.max.x - kind.inset, kind.eave, box.max.z - kind.back);
      // its own light on the front wall and the ground below, in the string's colour (mixed)
      const c = style.colors.reduce((a, b) => a.add(b), new THREE.Color(0, 0, 0)).multiplyScalar(1 / style.colors.length);
      glow(c, (box.min.x + box.max.x) / 2, kind.eave - 1.2, box.max.z + 1.6, 7);
      doorDecor(style, box.min.x + kind.door.x, kind.door.top, box.max.z - kind.door.depth);
    }
    // the tree on the lawn in front of the big house on the right (right of its door), the
    // snowman on the grass by the left side of the small house on the left; each keeps clear of
    // the other
    const tree = findSpot(19, 14.5, 3);
    if (tree) christmasTree(...tree);
    const man = findSpot(-21, 11, 1.6, (x, z) => !tree || Math.hypot(x - tree[0], z - tree[2]) > 5);
    if (man) makeSnowman(...man, 0.5);

    // more lights where people hang them: round the lamp posts, along the fences, on some of the
    // town's pines and under the message board's roof
    for (const p of extras.lamps ?? []) lampLights(p);
    for (const o of townMeshes) if (/Fence/.test(o.name)) fenceLights(o);
    pineLights(townMeshes.filter((o) => /TreePine/.test(o.name)));
    if (extras.board) boardLights(extras.board);
    if (!bulbs.length) return;
    bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 6, 4), bulbMaterial, bulbs.length);
    const m = new THREE.Matrix4();
    const halo = new Float32Array(bulbs.length * 3);
    const haloColor = new Float32Array(bulbs.length * 3);
    bulbs.forEach(({ p, c, s }, i) => {
      m.makeScale(s, s, s).setPosition(p);
      bulbMesh.setMatrixAt(i, m);
      phase.push(Math.random() * Math.PI * 2);
      bulbMesh.setColorAt(i, c);
      p.toArray(halo, i * 3);
      c.toArray(haloColor, i * 3);
    });
    group.add(bulbMesh);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute("position", new THREE.BufferAttribute(halo, 3));
    hg.setAttribute("color", new THREE.BufferAttribute(haloColor, 3));
    haloMaterial = new THREE.PointsMaterial({
      size: 1.4,
      map: haloTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    halos = new THREE.Points(hg, haloMaterial);
    group.add(halos);
  }

  // t: seconds; lit: how much the lamps are on (0 by day .. 1 at night, the same fade);
  // snow: how much snow lies on the town (0..1).
  function update(t, lit, snow) {
    if (snowman) {
      // the snowman is built as the snow settles and melts with it
      const k = THREE.MathUtils.smoothstep(snow, 0.35, 0.9);
      snowman.visible = k > 0.01;
      snowman.scale.set(0.6 + 0.4 * k, k, 0.6 + 0.4 * k);
      if (k > 0.5) snowmanBox.copy(snowmanFull);
      else snowmanBox.makeEmpty();
    }
    starMaterial.color.copy(STAR).multiplyScalar(0.45 + 0.55 * lit);
    for (const l of glows) l.intensity = l.userData.strength * lit * (0.9 + 0.1 * Math.sin(t * 1.3 + l.id));
    if (!bulbMesh) return;
    for (let i = 0; i < bulbs.length; i++) {
      const k = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.3 + phase[i]));
      // out: dull coloured glass; on: it shines and twinkles
      _c.copy(bulbs[i].c).multiplyScalar(0.3 + lit * (0.3 + 0.9 * k));
      bulbMesh.setColorAt(i, _c);
    }
    bulbMesh.instanceColor.needsUpdate = true;
    haloMaterial.opacity = 0.55 * lit;
    halos.visible = lit > 0.01;
  }

  // materials that catch the snow (the wreaths and the garland; the tree stays green, it is
  // looked after); solids go into the town's collision
  return { group, decorate, update, solids, materials: [leafMaterial] };
}
