// Half see-through circle around your trainer on what stands in front (ADR 016).
import * as THREE from "three";

const RADIUS = 2.6; // world units
const MIDDLE = 1.4; // circle center over the feet
const KEEP = 0.5; // opacity in the middle
const FRONT = 0.4;
const OVER_FEET = 0.3;

const uniforms = {
  uSeeCenter: { value: new THREE.Vector2() }, // drawing-buffer pixels
  uSeeRadius: { value: 1 },
  uSeeZ: { value: 0 },
  uSeeFloor: { value: 0 },
  uSeeKeep: { value: KEEP },
  uSeeOn: { value: 0 },
};

const VERTEX_HEAD = "varying vec3 vSeeWorld;";
const VERTEX_BODY = `
{
  vec4 seeWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    seeWorld = instanceMatrix * seeWorld;
  #endif
  vSeeWorld = (modelMatrix * seeWorld).xyz;
}`;
const FRAGMENT_HEAD = `
varying vec3 vSeeWorld;
uniform vec2 uSeeCenter;
uniform float uSeeRadius, uSeeZ, uSeeFloor, uSeeKeep, uSeeOn;
const float SEE_BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);`;
const FRAGMENT_BODY = `
if (uSeeOn > 0.5 && vSeeWorld.z > uSeeZ && vSeeWorld.y > uSeeFloor) {
  float seeD = distance(gl_FragCoord.xy, uSeeCenter) / uSeeRadius;
  if (seeD < 1.0) {
    float seeKeep = mix(uSeeKeep, 1.0, smoothstep(0.3, 1.0, seeD));
    ivec2 seeP = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
    if ((SEE_BAYER[seeP.x + seeP.y * 4] + 0.5) / 16.0 >= seeKeep) discard;
  }
}`;

const patched = new WeakSet();
function patch(m) {
  if (patched.has(m) || m.userData.noSeeThrough || m.transparent) return;
  if (!(m.isMeshLambertMaterial || m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial || m.isMeshToonMaterial)) return;
  patched.add(m);
  const before = Object.hasOwn(m, "onBeforeCompile") ? m.onBeforeCompile : null;
  const beforeKey = before ? before.toString() : "";
  m.onBeforeCompile = (shader, renderer) => {
    before?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${FRAGMENT_BODY}`);
  };
  m.customProgramCacheKey = () => `see-through|${beforeKey}`;
  m.needsUpdate = true;
}

export function seeThrough(root) {
  root.traverse((o) => {
    if (!o.isMesh || o.isSprite) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) patch(m);
  });
}

const _mid = new THREE.Vector3();
const _edge = new THREE.Vector3();
const _right = new THREE.Vector3();
const _size = new THREE.Vector2();
export function updateSeeThrough(camera, renderer, feet, on = true) {
  uniforms.uSeeOn.value = on ? 1 : 0;
  if (!on) return;
  renderer.getDrawingBufferSize(_size);
  _mid.set(feet.x, feet.y + MIDDLE, feet.z);
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _edge.copy(_mid).addScaledVector(_right, RADIUS).project(camera);
  _mid.project(camera);
  const cx = (_mid.x * 0.5 + 0.5) * _size.x,
    cy = (_mid.y * 0.5 + 0.5) * _size.y;
  uniforms.uSeeCenter.value.set(cx, cy);
  uniforms.uSeeRadius.value = Math.max(1, Math.hypot((_edge.x * 0.5 + 0.5) * _size.x - cx, (_edge.y * 0.5 + 0.5) * _size.y - cy));
  uniforms.uSeeZ.value = feet.z + FRONT;
  uniforms.uSeeFloor.value = feet.y + OVER_FEET;
}
