import * as THREE from "three";

export const TAVERN = {
  x: 200, z: 0, halfWidth: 19, halfDepth: 15, firstSeat: 37, seats: 12,
};
export const inTavern = (x, z) =>
  Math.abs(x - TAVERN.x) <= TAVERN.halfWidth && Math.abs(z - TAVERN.z) <= TAVERN.halfDepth;

const friendlyLines = {
  en: [
    "Come in. How was your day?",
    "A long day? Sit a while. The cocoa is warm.",
    "What made you smile today?",
    "Why did the developer bring a scarf? Too many cold starts.",
    "I named my mug Java. It runs on cocoa.",
    "One small win today is still a win.",
    "There is room at the table if you want to talk.",
  ],
  pt: [
    "Chega mais. Como foi o seu dia?",
    "Dia longo? Senta um pouquinho. O chocolate está quentinho.",
    "O que te fez sorrir hoje?",
    "Por que o dev trouxe um cachecol? Tinha muito cold start.",
    "Chamei minha caneca de Java. Ela roda com chocolate quente.",
    "Uma vitória pequena ainda é uma vitória.",
    "Tem lugar à mesa se quiser desabafar.",
  ],
};

export function createTavern(scene) {
  const room = new THREE.Group();
  room.position.set(TAVERN.x, 0, TAVERN.z);
  scene.add(room);
  const mat = (color, emissive = "#170e0c") => new THREE.MeshLambertMaterial({ color, emissive });
  const wood = mat("#75422d", "#241319"), darkWood = mat("#38232b");
  const plaster = mat("#482c32"), gold = mat("#d19c54", "#563319");
  const ivory = mat("#fff0ce", "#402a23"), green = mat("#265e4a"), red = mat("#a73246");
  const blue = new THREE.MeshBasicMaterial({ color: "#263c62" });
  const lit = ["#ffcf83", "#e96d72", "#79cfa7", "#a7bcff"].map(color => new THREE.MeshBasicMaterial({ color }));
  const seats = [];
  const obstacles = [];
  const mesh = (parent, geometry, material, x, y, z) => {
    const object = new THREE.Mesh(geometry, material);
    parent.add(object);
    object.position.set(x, y, z);
    return object;
  };
  const box = (parent, material, w, h, d, x, y, z) =>
    mesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z);
  const bulb = new THREE.IcosahedronGeometry(0.19, 0);
  const cube = (material, w, h, d, x, y, z) => box(room, material, w, h, d, x, y, z);
  const circle = (parent, material, radius, height, x, y, z) =>
    mesh(parent, new THREE.CylinderGeometry(radius, radius, height, 12), material, x, y, z);

  const planks = ["#744632", "#80513a", "#69402e", "#86563b"].map(color => mat(color));
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 8; col++) {
      const color = planks[(row * 3 + col * 5 + (row ^ col)) % planks.length];
      cube(color, 4.72, 0.25, 1.97, -16.625 + col * 4.75, -0.14, -14 + row * 2);
    }
  }
  cube(plaster, 38.4, 8.4, 0.48, 0, 4.1, -15);
  cube(plaster, 0.45, 8.4, 30, -19, 4.1, 0);
  cube(plaster, 0.45, 4.8, 30, 19, 2.3, 0);
  for (const y of [0.55, 3, 7.8]) cube(darkWood, 38, 0.28, 0.32, 0, y, -14.69);

  const rug = (x, z, w, d) => {
    cube(darkWood, w, 0.025, d, x, 0.018, z);
    cube(gold, w - 0.34, 0.024, d - 0.34, x, 0.031, z);
    cube(red, w - 0.65, 0.022, d - 0.65, x, 0.043, z);
    cube(darkWood, w - 1.2, 0.022, d - 1.14, x, 0.052, z);
  };
  rug(0, 9, 5.7, 10.8);
  rug(-10, 4.8, 8.9, 15);
  rug(10, 4.8, 8.9, 15);

  const snow = [];
  for (const x of [-11.8, 11.8]) {
    cube(gold, 6.1, 4.45, 0.20, x, 4.85, -14.64);
    cube(blue, 5.65, 4.0, 0.22, x, 4.85, -14.49);
    for (let i = 0; i < 16; i++) {
      const flake = cube(ivory, i % 3 ? 0.09 : 0.15, i % 3 ? 0.09 : 0.15, 0.045,
        x - 2.55 + (i * 1.67) % 5.1, 3 + (i * 1.37) % 3.65, -14.33);
      snow.push(flake);
    }
    cube(darkWood, 0.16, 4.0, 0.20, x, 4.85, -14.24);
    cube(darkWood, 5.7, 0.16, 0.20, x, 4.85, -14.24);
    cube(gold, 6.3, 0.28, 0.58, x, 2.68, -14.37);
  }

  const sign = document.createElement("canvas");
  sign.width = 384; sign.height = 80;
  const ink = sign.getContext("2d");
  ink.fillStyle = "#263c35"; ink.fillRect(0, 0, 384, 80);
  ink.strokeStyle = "#c99757"; ink.lineWidth = 4; ink.strokeRect(6, 6, 372, 68);
  ink.fillStyle = "#fff0ce"; ink.textAlign = "center"; ink.textBaseline = "middle";
  ink.font = "bold 32px monospace"; ink.fillText("WINTER TAVERN", 192, 42);
  const texture = new THREE.CanvasTexture(sign);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  mesh(room, new THREE.PlaneGeometry(8.5, 1.75), new THREE.MeshBasicMaterial({ map: texture }),
    0, 6.55, -14.56);
  const cord = [];
  for (let i = 0; i <= 46; i++) {
    const x = -18.4 + i * 0.8;
    const y = 7.95 - Math.abs(Math.sin(i * Math.PI / 12)) * 0.65;
    cord.push(new THREE.Vector3(x, y, -14.24));
    mesh(room, bulb, lit[i % lit.length], x, y - 0.15, -14.21);
  }
  room.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cord),
    new THREE.LineBasicMaterial({ color: "#558576" })));

  const cup = (parent, x, y, z) => {
    const mug = new THREE.Group();
    mug.position.set(x, y, z);
    parent.add(mug);
    circle(mug, ivory, 0.22, 0.37, 0, 0, 0);
    circle(mug, darkWood, 0.18, 0.018, 0, 0.19, 0);
    mesh(mug, new THREE.TorusGeometry(0.116, 0.037, 5, 9), ivory, 0.23, 0, 0);
    return mug;
  };
  const candle = (x, z) => {
    circle(room, gold, 0.41, 0.10, x, 1.94, z);
    circle(room, ivory, 0.20, 0.35, x, 2.11, z);
    mesh(room, bulb, lit[0], x, 2.38, z).scale.set(0.45, 0.95, 0.45);
  };

  function addSeat(x, z, dir, stool) {
    const y = stool ? 1.05 : 0.76;
    circle(room, darkWood, 0.22, y, x, y / 2, z);
    circle(room, stool ? red : green, 0.72, 0.20, x, y, z);
    if (!stool) cube(wood, 0.23, 0.80, 1.12, x + (dir === "right" ? -0.54 : 0.54), y + 0.42, z);
    seats.push({ x: TAVERN.x + x, y: y + 0.12, z, dir });
  }
  for (const x of [-10, 10]) {
    for (const z of [1.0, 8.6]) {
      circle(room, darkWood, 0.43, 1.8, x, 0.9, z);
      circle(room, wood, 1.72, 0.22, x, 1.82, z);
      candle(x, z);
      cup(room, x + 0.64, 2.14, z + 0.52);
      obstacles.push([x, z, 1.86]);
    }
  }
  for (const x of [-10, 10]) {
    for (const z of [1.0, 8.6]) {
      addSeat(x - 2.55, z, "right", false);
      addSeat(x + 2.55, z, "left", false);
    }
  }

  cube(green, 15.2, 2.0, 2.65, 0, 1.0, -7.3);
  cube(wood, 15.7, 0.23, 2.9, 0, 2.08, -7.3);
  cube(gold, 14.7, 0.18, 0.12, 0, 0.38, -5.94);
  // The bartender's worktop sits in front of the shelves, with room to turn.
  const steel = mat("#acbbc1", "#31343a");
  const basin = mat("#455864", "#161e27");
  cube(green, 8.7, 1.80, 1.75, 0, 0.90, -13.17);
  cube(wood, 8.96, 0.19, 1.98, 0, 1.89, -13.17);
  cube(darkWood, 0.06, 1.5, 0.045, 0, 0.90, -12.28);
  for (const x of [-2.19, 2.19]) cube(gold, 0.37, 0.08, 0.14, x, 1.34, -12.24);

  cube(steel, 2.24, 0.07, 1.25, 0.80, 2.02, -13.08);
  cube(basin, 1.75, 0.026, 0.88, 0.80, 2.067, -13.08);
  cube(steel, 0.12, 0.58, 0.12, 0.8, 2.32, -13.67);
  cube(steel, 0.12, 0.12, 0.45, 0.8, 2.58, -13.49);
  cube(steel, 0.12, 0.18, 0.12, 0.8, 2.52, -13.29);
  circle(room, basin, 0.072, 0.031, 0.80, 2.087, -13.08);

  cube(red, 1.91, 1.24, 1.07, -2.48, 2.59, -13.35);
  cube(steel, 1.94, 0.17, 1.21, -2.48, 3.26, -13.30);
  cube(darkWood, 1.57, 0.79, 0.07, -2.48, 2.54, -12.78);
  cube(steel, 1.72, 0.12, 0.55, -2.48, 2.09, -12.62);
  cube(steel, 0.34, 0.15, 0.27, -2.57, 2.72, -12.67);
  cube(lit[2], 0.12, 0.10, 0.028, -1.90, 2.88, -12.73);
  cup(room, -2.57, 2.31, -12.57);

  cube(darkWood, 8.4, 0.23, 0.85, 0, 3.52, -13.9);
  cube(darkWood, 8.4, 0.23, 0.85, 0, 4.55, -13.9);
  for (let i = 0; i < 8; i++) {
    const x = (i - 3.5) * 0.94;
    circle(room, i % 3 ? green : red, 0.23, 0.59 + (i % 3) * 0.14, x, 3.98, -13.83);
    circle(room, gold, 0.10, 0.23, x, 4.39, -13.83);
    cup(room, x, 4.9, -13.83);
  }
  for (const x of [-5.65, -2.0, 2.0, 5.65]) addSeat(x, -4.64, "up", true);
  for (const x of [-5.7, -4.95, 3.55, 4.35]) cup(room, x, 2.4, -7.05);

  // A small pixel-style bartender with a pivot at each shoulder.
  const bartender = new THREE.Group();
  bartender.position.set(0, 0, -10.0);
  room.add(bartender);
  const skin = mat("#e4a780", "#422620"), hair = mat("#4d2a27"), eyes = mat("#211d2b");
  box(bartender, green, 1.46, 1.55, 0.84, 0, 1.99, 0);
  box(bartender, ivory, 0.95, 1.25, 0.08, 0, 1.86, 0.45);
  box(bartender, red, 0.62, 0.23, 0.18, 0, 2.53, 0.47);
  box(bartender, skin, 1.39, 1.17, 1.06, 0, 3.13, 0);
  box(bartender, hair, 1.50, 0.36, 1.16, 0, 3.69, 0.01);
  box(bartender, red, 1.65, 0.33, 1.22, 0, 3.95, 0);
  box(bartender, ivory, 1.68, 0.13, 1.25, 0, 3.80, 0.01);
  box(bartender, ivory, 0.36, 0.36, 0.39, 0.60, 4.19, -0.12);
  for (const x of [-0.37, 0.37]) box(bartender, eyes, 0.13, 0.15, 0.06, x, 3.19, 0.55);
  box(bartender, hair, 0.52, 0.10, 0.07, 0, 2.94, 0.56);
  const arms = [-1, 1].map(side => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.83, 2.46, 0);
    bartender.add(arm);
    box(arm, green, 0.33, 0.32, 0.66, 0, -0.14, 0.24);
    box(arm, skin, 0.27, 0.26, 0.32, 0, -0.1, 0.66);
    return arm;
  });
  const handCup = cup(arms[0], 0.02, 0.07, 0.72);
  const towel = box(arms[1], ivory, 0.25, 0.16, 0.25, 0, 0.06, 0.66);

  // The tree, fireplace and lanterns leave the middle aisle clear.
  const tree = new THREE.Group();
  tree.position.set(15.65, 0, -9.9);
  room.add(tree);
  circle(tree, darkWood, 0.31, 1.1, 0, 0.5, 0);
  for (let tier = 0; tier < 4; tier++) {
    const radius = 2.1 - tier * 0.43, y = 1.85 + tier * 0.94;
    mesh(tree, new THREE.ConeGeometry(radius, 2.3, 8), green, 0, y, 0);
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9 + tier * 0.22;
      mesh(tree, bulb, lit[(i + tier) % lit.length], Math.cos(a) * radius * 0.89, y - 0.88, Math.sin(a) * radius * 0.89);
    }
  }
  mesh(tree, new THREE.OctahedronGeometry(0.50), lit[0], 0, 5.88, 0);
  cube(red, 0.95, 0.62, 0.85, 14.6, 0.32, -8.2);
  cube(gold, 0.19, 0.64, 0.88, 14.6, 0.34, -8.2);
  obstacles.push([15.65, -9.9, 1.9]);

  cube(darkWood, 4.7, 3.1, 0.55, -15.35, 1.55, -12.3);
  cube(wood, 4.9, 0.30, 0.75, -15.35, 3.1, -12.15);
  const flames = [-0.54, 0, 0.54].map(x =>
    mesh(room, new THREE.ConeGeometry(0.46, 1.48, 5), lit[0], -15.35 + x, 0.95, -11.93));
  const fire = new THREE.PointLight("#ff9a55", 35, 13, 1.7);
  fire.position.set(-15.35, 1.75, -11.1);
  room.add(fire);
  for (const x of [-9, 0, 9]) {
    const light = new THREE.PointLight("#ffd8a3", 58, 23, 1.55);
    light.position.set(x, 6, 1);
    room.add(light);
  }
  cube(gold, 4.5, 0.17, 0.42, 0, 0.09, 14.55);

  const lines = friendlyLines[navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en"];
  let time = 0, service = 0, lineIndex = Math.floor(Math.random() * lines.length);
  function update(dt) {
    time += dt;
    snow.forEach((flake, i) => { flake.position.y = 3 + ((4 - (time * (0.23 + i % 3 * 0.10) + i * 1.37) % 4) % 4); });
    flames.forEach((flame, i) => {
      flame.scale.y = 0.66 + 0.28 * Math.sin(time * 8 + i * 1.4);
    });
    fire.intensity = 30 + Math.sin(time * 6) * 5;
    if (service > 0) {
      service = Math.max(0, service - dt);
      const reach = Math.sin(Math.PI * (1 - service / 1.15));
      bartender.position.z = -10;
      bartender.rotation.y = 0;
      arms[0].position.z = reach * 1.47;
      arms[0].rotation.x = -0.42 * reach;
      arms[1].rotation.x = 0;
      towel.visible = false;
      return service === 0;
    }
    const sideWork = time % 13 > 9;
    bartender.rotation.y = THREE.MathUtils.lerp(bartender.rotation.y, sideWork ? Math.PI : 0, Math.min(1, dt * 5));
    bartender.position.z = THREE.MathUtils.lerp(bartender.position.z, sideWork ? -11.48 : -10, Math.min(1, dt * 4));
    arms[0].position.z = 0;
    arms[0].rotation.x = sideWork ? 0.24 + Math.sin(time * 7) * 0.13 : -0.25;
    arms[1].rotation.set(-0.35 + Math.sin(time * 8) * 0.20, 0, 0.24 + Math.cos(time * 8) * 0.23);
    towel.visible = !sideWork;
    handCup.visible = true;
    return false;
  }
  function isWalkable(x, z) {
    if (!inTavern(x, z)) return false;
    const localX = x - TAVERN.x;
    if (Math.abs(localX) > 17.9 || z < -11.7 || z > 14.1) return false;
    if (z < -5.95 && z > -8.64 && Math.abs(localX) < 8.05) return false;
    return obstacles.every(([cx, cz, r]) => Math.hypot(localX - cx, z - cz) > r);
  }
  return {
    seats, room, bartender, isWalkable, update,
    startServing() { if (service > 0) return false; service = 1.15; handCup.visible = true; return true; },
    cancelServing() { service = 0; },
    busy: () => service > 0,
    greeting: () => lines[(lineIndex + Math.floor(time / 8.5)) % lines.length],
  };
}
