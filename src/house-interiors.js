import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { houseRoom } from "./house-layouts.js";

const loader = new GLTFLoader();
const pending = new Map();
const ray = new THREE.Raycaster();
const origin = new THREE.Vector3();
const down = new THREE.Vector3(0, -1, 0);
const samples = [[0, 0], [0.42, 0], [-0.42, 0], [0, 0.42], [0, -0.42]];

export function loadHouse(id) {
  const layout = houseRoom(id);
  if (!pending.has(layout.file)) {
    const promise = loader.loadAsync(`/assets/indoor_houses/${layout.file}`).then(({ scene }) => {
      scene.scale.setScalar(layout.scale);
      scene.position.fromArray(layout.offset);
      scene.updateMatrixWorld(true);
      const room = new THREE.Scene();
      room.background = new THREE.Color(0x121018);
      room.add(scene, new THREE.AmbientLight(0xffffff, 2.2));
      const meshes = [];
      scene.traverse((object) => {
        if (object.isMesh) meshes.push(object);
      });
      const clear = (x, z) => {
        ray.set(origin.set(x, 60, z), down);
        const hit = ray.intersectObjects(meshes, false)[0];
        return !!hit && hit.point.y >= -0.2 && hit.point.y < 0.9;
      };
      return { room, meshes, free: (x, z) => samples.every(([dx, dz]) => clear(x + dx, z + dz)) };
    });
    pending.set(layout.file, promise);
    promise.catch(() => pending.delete(layout.file));
  }
  return pending.get(layout.file);
}
