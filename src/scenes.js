// Scenes: one place is drawn at a time, and each one is its own room on the server. Walking into a
// portal (an edge of the map, like the classic top-down games) takes you to the other scene, where
// you arrive just inside its matching portal. No three.js here: the worker and the tests import it.

// Each portal: the box that triggers it (world units, the scene's own coordinates), the scene it
// leads to and where you appear there, facing away from the way back.
export const SCENES = {
  lobby: {
    name: "Lofi Lobby",
    spawn: { x: 0, z: 0 }, // the respawn button, or a saved spot that no longer fits
    portals: [
      // the dirt path that leaves the top of the town, between the pines
      { box: { minX: -3, maxX: 3, minZ: -60, maxZ: -46.5 }, to: "lago", arrive: { x: 16, z: 34, dir: "up" } },
    ],
  },
  lago: {
    name: "Lago",
    spawn: { x: 16, z: 34 },
    portals: [
      // the path's lower end (src/lake-layout.js, PORTAL_COLS), back to the top of the town
      { box: { minX: 12.8, maxX: 19.2, minZ: 37, maxZ: 60 }, to: "lobby", arrive: { x: 0, z: -42, dir: "down" } },
    ],
  },
};

export const HOME = "lobby";
// the rooms the server accepts, one per scene
export const ROOM_IDS = Object.keys(SCENES);

export const isScene = (id) => Object.hasOwn(SCENES, id);

// the portal at (x, z) in that scene, or null
export function portalAt(scene, x, z) {
  if (!isScene(scene)) return null;
  return SCENES[scene].portals.find(({ box: b }) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) || null;
}
