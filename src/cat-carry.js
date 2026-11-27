// Picking up and throwing the town cats, like the hens of the classic top-down games. Shared by the
// room (worker/index.js) and the game, with no three.js in it so the tests can import it.
//   H next to a cat lifts it over your head; H again throws it the way you face. The room decides
//   who holds which cat and where a thrown one lands, and everyone draws the same arc.

export const CAT_HOLD_MS = 20_000; // held longer than this, the cat wriggles free and hops down
export const CAT_LIFT_REST_MS = 4_000; // a thrown cat can't be picked up again before this
export const CAT_THROW_MS = 650; // the flight
export const CAT_THROW_DIST = 6; // how far ahead of you it lands
export const CAT_THROW_MAX = CAT_THROW_DIST + 3; // the room clamps a landing spot to this far from the thrower

const STEP = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

// Why this player can't lift this cat now (a short reason), or null when they can.
//   ride: the cat's entry in the room's "cat-rides" ({ playerId, at, until, held, thrownAt })
//   fed: the cat's feeding state ({ at, until }); holding: the player already holds a cat
export function liftRefusal({ now, ride, fed, holding, seated }) {
  if (holding) return "hands full";
  if (seated) return "seated";
  if (ride?.playerId && ride.until > now) return "taken";
  if (fed && fed.until > now) return "eating";
  if (ride?.thrownAt && now < ride.thrownAt + CAT_LIFT_REST_MS) return "dizzy";
  return null;
}

// the cat this player holds in the room's "cat-rides" (its id), or null
export function heldBy(rides, playerId, now) {
  for (const [id, r] of Object.entries(rides || {})) if (r?.held && r.playerId === playerId && r.until > now) return id;
  return null;
}

// where a cat thrown from (x, z) facing `dir` lands
export function throwTarget(x, z, dir) {
  const [dx, dz] = STEP[dir] || STEP.down;
  return { x: x + dx * CAT_THROW_DIST, z: z + dz * CAT_THROW_DIST };
}

// the room's check on a landing spot the thrower sent: kept within CAT_THROW_MAX of where they stand
export function clampThrow(from, to) {
  const tx = Number.isFinite(to?.x) ? to.x : from.x;
  const tz = Number.isFinite(to?.z) ? to.z : from.z;
  const dx = tx - from.x, dz = tz - from.z;
  const d = Math.hypot(dx, dz);
  if (d <= CAT_THROW_MAX) return { x: tx, z: tz };
  const k = CAT_THROW_MAX / d;
  return { x: from.x + dx * k, z: from.z + dz * k };
}

// the flight at u (0..1): a parabola from `from` to `to`, peaking `h` above the straight line,
// and which way the cat faces as it spins (two turns in the air, landing facing down)
const SPIN = ["down", "left", "up", "right"];
export function throwArc(u, from, to, h = 4) {
  const k = Math.min(1, Math.max(0, u));
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k + h * 4 * k * (1 - k),
    z: from.z + (to.z - from.z) * k,
    dir: k >= 1 ? "down" : SPIN[Math.floor(k * 8) % 4],
  };
}

export const LIFT_PHRASES = [
  "Ei! Me põe no chão… ou não, a vista daqui é boa.",
  "Isso é um sequestro ou um passeio VIP?",
  "Miau?! Eu não autorizei esse deploy.",
  "Tá, pode segurar. Mas sem selfie.",
];
export const THROW_PHRASES = [
  "Caí de pé. Como sempre. Nota 10.",
  "Mrrrp! De novo! …mentira, nunca mais.",
  "Voei mais que o seu sprint planejado.",
  "Aterrissagem perfeita. Ninguém viu nada.",
];
