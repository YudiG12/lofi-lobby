// Skipping stones on the pond. A stone leaves the thrower's hand in an arc, skips on the water a few
// times (a ring and a few drops at each touch, each hop shorter and lower) and sinks with a bigger
// splash. Who throws plans the path (where it touches the water) and the room sends it to everyone,
// so all players see the same stone; this file only animates it.
import * as THREE from "three";

const FLIGHT_MS = 800; // from the hand to the first touch
const SINK_MS = 500;
const GRAVITY = 18; // for the drops

// a pixel-art pebble at the trainers' own pixel size, on a plane that faces the camera like they do:
// a flat stone shaded from light to dark, no outline; four frames flip it over (top, tilted, edge-on,
// underside) so it tumbles as it flies
const PX = 5 / 32; // one pixel of a trainer, in world units
const STONE_COLORS = { h: "#eceef5", l: "#b9bdc9", m: "#8d909c", d: "#656876" };
const STONE_FRAMES = [
  [".hhll.", "hllllm", "lllmmd", "mmmddd", ".dddd."],
  [".hhll.", "hllmmd", "mmdddd", ".dddd.", "......"],
  ["......", "hhllmd", "mmdddd", "......", "......"],
  [".lllm.", "lmmmdd", "hhlldd", ".dddd.", "......"],
];
const stoneGeometry = new THREE.PlaneGeometry(STONE_FRAMES[0][0].length * PX, STONE_FRAMES[0].length * PX);
const stoneMaterials = STONE_FRAMES.map((rows) => {
  const cv = Object.assign(document.createElement("canvas"), { width: rows[0].length, height: rows.length });
  const c = cv.getContext("2d");
  rows.forEach((row, y) => [...row].forEach((k, x) => STONE_COLORS[k] && ((c.fillStyle = STONE_COLORS[k]), c.fillRect(x, y, 1, 1))));
  const map = new THREE.CanvasTexture(cv);
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.colorSpace = THREE.SRGBColorSpace;
  // glows a little, like what the trainers hold, to stay readable at night
  return new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.4, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide });
});

// rings on the water: a thin bright circle that grows and fades
const ringMaterial = new THREE.ShaderMaterial({
  uniforms: { uAge: { value: 0 }, uStrength: { value: 1 } },
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uAge; uniform float uStrength; varying vec2 vUv;
    void main() {
      float d = length(vUv * 2.0 - 1.0);
      float ring = smoothstep(0.16, 0.0, abs(d - 0.8)) + 0.45 * smoothstep(0.12, 0.0, abs(d - 0.5));
      float a = ring * (1.0 - uAge) * uStrength;
      if (a < 0.01) discard;
      gl_FragColor = vec4(0.88, 0.95, 1.0, a);
    }`,
});
const ringGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// drops: tiny squares flying up and falling back
const dropMaterial = new THREE.PointsMaterial({ color: "#dff1ff", size: 0.4, transparent: true, depthWrite: false });

export function createStones(scene, { surfaceY, camera }) {
  const throws = new Set(); // flying stones
  const rings = new Set(); // { mesh, age, life, size }
  const bursts = new Set(); // { points, vel, age, life }

  // a ring where the stone touched the water: `big` for the last one (it sinks)
  function ripple(x, y, z, big) {
    for (let k = 0; k < (big ? 3 : 2); k++) {
      const mat = ringMaterial.clone();
      mat.uniforms.uStrength.value = big ? 1 : 0.8;
      const mesh = new THREE.Mesh(ringGeometry, mat);
      mesh.position.set(x, y + 0.04, z);
      mesh.renderOrder = 10;
      scene.add(mesh);
      // the second (and third) ring starts a moment later, so they read as waves going out
      rings.add({ mesh, age: -k * 0.18, life: big ? 1.6 : 1.0, size: (big ? 6 : 3.8) + k * 1.4 });
    }
  }
  function drops(x, y, z, count, power) {
    const pos = new Float32Array(count * 3),
      vel = [];
    for (let i = 0; i < count; i++) {
      pos.set([x, y + 0.1, z], i * 3);
      const a = Math.random() * Math.PI * 2,
        r = (0.6 + Math.random()) * power;
      vel.push([Math.cos(a) * r, (3 + Math.random() * 3) * power, Math.sin(a) * r]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, dropMaterial.clone());
    points.renderOrder = 11;
    points.frustumCulled = false;
    scene.add(points);
    bursts.add({ points, vel, age: 0, life: 0.9, floor: y });
  }

  // from: { x, y, z } (the hand); touches: [[x, z], ...] on the water, the last one is where it sinks
  function launch(from, touches) {
    if (!touches.length) return;
    const mesh = new THREE.Mesh(stoneGeometry, stoneMaterials[0]);
    mesh.position.set(from.x, from.y, from.z);
    scene.add(mesh);
    // the legs of the path: the throw, then one hop per skip, each shorter in time and lower
    const legs = [];
    let a = { x: from.x, y: from.y, z: from.z },
      t = 0;
    touches.forEach(([x, z], i) => {
      const y = surfaceY(x, z);
      const first = i === 0;
      const dist = Math.hypot(x - a.x, z - a.z);
      const ms = first ? FLIGHT_MS : Math.max(160, 120 + dist * 90);
      const height = first ? 3 : Math.min(1.4, 0.35 + dist * 0.25);
      legs.push({ t, ms, a, b: { x, y, z }, height, last: i === touches.length - 1 });
      t += ms;
      a = { x, y, z };
    });
    throws.add({ mesh, legs, t: 0, end: t, sinking: 0, spin: 9 + Math.random() * 6, turn: 0, hit: 0 });
  }

  function update(dt) {
    const ms = dt * 1000;
    for (const s of throws) {
      s.t += ms;
      s.turn += s.spin * dt;
      s.mesh.material = stoneMaterials[Math.floor(s.turn / (Math.PI / 2)) % STONE_FRAMES.length];
      s.mesh.rotation.set(camera.rotation.x * 0.5, 0, 0); // tilted halfway to the camera, like the trainers
      // every touch the stone has reached: a ring and drops (more on the last one)
      while (s.hit < s.legs.length && s.t >= s.legs[s.hit].t + s.legs[s.hit].ms) {
        const { b, last } = s.legs[s.hit];
        ripple(b.x, b.y, b.z, last);
        drops(b.x, b.y, b.z, last ? 14 : 6, last ? 1 : 0.6);
        s.hit++;
      }
      if (s.t < s.end) {
        const leg = s.legs.find((l) => s.t < l.t + l.ms);
        const f = (s.t - leg.t) / leg.ms;
        s.mesh.position.set(
          leg.a.x + (leg.b.x - leg.a.x) * f,
          leg.a.y + (leg.b.y - leg.a.y) * f + 4 * leg.height * f * (1 - f), // an arc over the straight line
          leg.a.z + (leg.b.z - leg.a.z) * f,
        );
      } else {
        // sinking: down through the surface (the water covers it), then gone
        s.sinking += ms / SINK_MS;
        s.mesh.position.y -= dt * 1.6;
        if (s.sinking >= 1) {
          scene.remove(s.mesh);
          throws.delete(s);
        }
      }
    }
    for (const r of rings) {
      r.age += dt / r.life;
      const age = Math.max(0, r.age);
      r.mesh.visible = r.age >= 0;
      r.mesh.scale.setScalar(r.size * (0.25 + age * 0.75));
      r.mesh.material.uniforms.uAge.value = age;
      if (r.age >= 1) {
        scene.remove(r.mesh);
        r.mesh.material.dispose();
        rings.delete(r);
      }
    }
    for (const b of bursts) {
      b.age += dt;
      const p = b.points.geometry.attributes.position;
      b.vel.forEach((v, i) => {
        v[1] -= GRAVITY * dt;
        const y = Math.max(b.floor, p.getY(i) + v[1] * dt);
        p.setXYZ(i, p.getX(i) + v[0] * dt, y, p.getZ(i) + v[2] * dt);
      });
      p.needsUpdate = true;
      b.points.material.opacity = 1 - b.age / b.life;
      if (b.age >= b.life) {
        scene.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        bursts.delete(b);
      }
    }
  }
  return { launch, update };
}
