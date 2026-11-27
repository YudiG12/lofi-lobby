// World-space door approaches in the FBX town and its generated fallback.
export const HOUSE_DOORS = [
  { id: 1, town: [11, 13.3], fallback: [5.3, 9.1] },
  { id: 2, town: [8.8, -11.9], fallback: [6.2, -20] },
  { id: 3, town: [-14.2, 12.1], fallback: [-7.1, 9.1] },
  { id: 4, town: [-17, -9.8], fallback: [-6.2, -20] },
];
export const DOOR_RANGE = 3;
export const HOUSE_SEAT = 40;
export const CIGARETTE = 4;

export const HOUSE_ROOMS = {
  center: {
    file: "center_scene.glb",
    scale: 2.5 / 0.748461127281189,
    offset: [0, 0, 0],
    entry: [0, 18.75],
    seats: [
      ...[0.25, 1.65, 2.95].map((z) => [-22.125, 1.25, z * 2.5, "right"]),
      ...[-7.2, -5.85, -4.5].map((x) => [x * 2.5, 1.25, 12.375, "up"]),
      [12.6, 1.25, 1.25, "down"],
      [17.65, 1.25, 1.25, "down"],
      [27.5, 1.25, 2.45, "left"],
      [27.5, 1.25, 7.35, "left"],
    ],
  },
  room: {
    file: "players_room.glb",
    scale: 0.25,
    offset: [42, 0.5, 42],
    entry: [0, 15],
    seats: [
      [-12, 2.38, -0.7, "up"],
      [-12, 2.38, -7.3, "down"],
      ...[9, 12, 15].map((x) => [x, 1.75, -0.7, "up"]),
    ],
  },
};

export const houseRoom = (id) => id === 1 ? HOUSE_ROOMS.center : HOUSE_ROOMS.room;
