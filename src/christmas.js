// Christmas in town (src/main.js decides when: the season or the player's switch). Everything here is
// made in code and only drawn while it is on: nothing to load, nothing sent to the room.
import * as THREE from "three";

// ---- Snow ----
// Flakes drift down in a box around the player (wrapping at its edges, like the rain) and settle on
// whatever surface is under them; the town turns white where it faces up (roofs, ground, the top of
// the pines). It fades in and out over a few seconds, and the flakes stop while it rains.
export function createSnow({ scene, count, floorAt }) {
  const BOX = { radius: 36, height: 30 };
  const flakes = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  const sway = new Float32Array(count);
  const floor = new Float32Array(count).fill(-1e3);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    flakes[i * 3] = (Math.random() * 2 - 1) * BOX.radius;
    flakes[i * 3 + 1] = Math.random() * BOX.height;
    flakes[i * 3 + 2] = (Math.random() * 2 - 1) * BOX.radius;
    speed[i] = 1.6 + Math.random() * 1.6;
    sway[i] = Math.random() * Math.PI * 2;
    size[i] = 2 + Math.random() * 2.5;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(flakes, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const uniforms = { uOpacity: { value: 0 }, uColor: { value: new THREE.Color("#ffffff") } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `attribute float size;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (60.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    // square flakes, like the rest of the pixel art
    fragmentShader: `uniform float uOpacity; uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // positions move every frame
  points.visible = false;
  scene.add(points);

  // the white on the town: a mix towards snow where a surface faces up, by `cover`
  const cover = { uSnow: { value: 0 } };
  const covered = new WeakSet();
  function coverMaterial(m) {
    if (!m || covered.has(m)) return;
    covered.add(m);
    const before = m.onBeforeCompile;
    const beforeKey = m.customProgramCacheKey?.bind(m);
    m.onBeforeCompile = (sh, renderer) => {
      before?.call(m, sh, renderer);
      sh.uniforms.uSnow = cover.uSnow;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vSnowUp;")
        .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvSnowUp = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz).y;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uSnow;\nvarying float vSnowUp;")
        .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.98), uSnow * smoothstep(0.3, 0.7, vSnowUp));");
    };
    m.customProgramCacheKey = () => (beforeKey ? beforeKey() : "") + "|snow";
    m.needsUpdate = true;
  }

  let on = false,
    amount = 0;
  return {
    coverMaterial,
    setOn(v) {
      on = v;
    },
    // center: the player; day: 0 night .. 1 day; rain: 0..1
    update(dt, center, day, rain) {
      const target = on ? 1 : 0;
      if (amount !== target) amount += Math.sign(target - amount) * Math.min(dt * 0.4, Math.abs(target - amount));
      cover.uSnow.value = 0.85 * amount;
      const falling = amount * (1 - rain);
      points.visible = falling > 0.01;
      if (!points.visible) return;
      uniforms.uOpacity.value = 0.85 * falling;
      uniforms.uColor.value.setRGB(0.82 + 0.18 * day, 0.86 + 0.14 * day, 0.95 + 0.05 * day);
      const top = center.y + BOX.height;
      const t = performance.now() / 1000;
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        let x = flakes[j] + Math.sin(t * 0.8 + sway[i]) * 0.6 * dt + 0.4 * dt;
        let y = flakes[j + 1] - speed[i] * dt;
        let z = flakes[j + 2] + Math.cos(t * 0.6 + sway[i]) * 0.4 * dt;
        if (x - center.x > BOX.radius) x -= BOX.radius * 2;
        else if (x - center.x < -BOX.radius) x += BOX.radius * 2;
        if (z - center.z > BOX.radius) z -= BOX.radius * 2;
        else if (z - center.z < -BOX.radius) z += BOX.radius * 2;
        // where it settles: asked a few at a time (floorAt may say "not yet"), the ground meanwhile
        if (floor[i] < -100) floor[i] = floorAt(x, z) ?? -1e3;
        if (y < (floor[i] > -100 ? floor[i] : center.y - 1)) {
          // settled: back up in the sky somewhere else in the box
          x = center.x + (Math.random() * 2 - 1) * BOX.radius;
          z = center.z + (Math.random() * 2 - 1) * BOX.radius;
          y = top - Math.random() * 4;
          floor[i] = floorAt(x, z) ?? -1e3;
        }
        flakes[j] = x;
        flakes[j + 1] = y;
        flakes[j + 2] = z;
      }
      geometry.attributes.position.needsUpdate = true;
    },
  };
}

// ---- Lights on the houses ----
// A string of coloured bulbs across the front of each house (the side that faces the camera), hung
// just under the lowest point of the roof's front edge and against the wall, which a ray finds. They
// twinkle, each at its own pace, glow on their own (no real light, so the lamps' shadows cost nothing
// more) and are brighter at night.
const BULBS = [new THREE.Color("#ff4d4d"), new THREE.Color("#ffd24a"), new THREE.Color("#4dd27a"), new THREE.Color("#5aa8ff")];
export function createHouseLights({ scene, houses, roofAt, wallAt }) {
  const pts = [],
    colors = [],
    phases = [];
  let n = 0;
  for (const box of houses) {
    // the eave: the lowest the roof comes down along the front
    let eave = Infinity;
    for (let x = box.min.x + 0.4; x <= box.max.x - 0.4; x += 0.5) {
      const y = roofAt(x, box.max.z - 0.35);
      if (y > box.min.y + 1) eave = Math.min(eave, y);
    }
    if (!Number.isFinite(eave)) continue;
    const y0 = eave - 0.5;
    for (let x = box.min.x + 1; x <= box.max.x - 1; x += 0.8) {
      const wall = wallAt(x, y0, box.max.z + 2);
      if (!(wall > box.min.z)) continue; // nothing to hang on there
      // a gentle sag between every other bulb, like a hanging string
      pts.push(x, y0 - (n % 2) * 0.15, wall + 0.12);
      const c = BULBS[n % BULBS.length];
      colors.push(c.r, c.g, c.b);
      phases.push(Math.random() * Math.PI * 2);
      n++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("phase", new THREE.Float32BufferAttribute(phases, 1));
  const uniforms = { uTime: { value: 0 }, uGlow: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 color; attribute float phase; uniform float uTime; uniform float uGlow;
      varying vec3 vColor; varying float vOn;
      void main() {
        vColor = color;
        vOn = uGlow * (0.55 + 0.45 * sin(uTime * (1.3 + fract(phase) * 1.4) + phase));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 34.0 * (60.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    // a bright square bulb in the middle of a soft halo
    fragmentShader: `varying vec3 vColor; varying float vOn;
      void main() {
        vec2 p = abs(gl_PointCoord - 0.5);
        float bulb = step(max(p.x, p.y), 0.09);
        float halo = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * 0.45;
        float a = (bulb + halo) * vOn;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vColor, vec3(1.0), bulb * 0.35) * a, a);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.visible = false;
  scene.add(points);
  return {
    count: n,
    setOn(on) {
      points.visible = on && n > 0;
    },
    // t: seconds; day: 0 night .. 1 day (dimmer by day)
    update(t, day) {
      uniforms.uTime.value = t;
      uniforms.uGlow.value = 1 - 0.55 * day;
    },
  };
}
