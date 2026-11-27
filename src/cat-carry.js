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

// what the trainer says, picked at random, on picking a cat up and every SAY_EVERY_MS while holding it
export const SAY_EVERY_MS = 8_000;
export const LIFT_PHRASES = [
  "Sim, eu sei que você não pediu colo. Ninguém pede.",
  "Peguei um gato. Agora sou responsável por 4 kg de julgamento.",
  "Pronto, carregando o estagiário mais caro da empresa.",
  "Se ele arranhar, foi feature, não bug.",
  "Olha só, um gato que não quer ser segurado. Que novidade.",
  "Treinei a vida toda pra isso: segurar um gato sem perder um dedo.",
  "Calma, gatinho. É só uma demo para os investidores.",
  "Ele está me olhando como se eu tivesse quebrado a produção.",
  "Carregar gato: a única tarefa que não cabe no sprint.",
  "Prometo te soltar. Em algum momento. Talvez.",
  "Isso conta como cardio? Diz que conta.",
  "Esse olhar de pânico é o mesmo meu na segunda-feira.",
];
// the line said `k` beats into a hold that started with `phrase` (everyone works out the same one)
export const sayAt = (phrase, k) => LIFT_PHRASES[(Math.abs(phrase | 0) + k * 5) % LIFT_PHRASES.length];
// what a thrown cat says when it lands (on its feet, and deeply offended)
export const THROW_PHRASES = [
  "Uau. Que força. Vou contar pros outros gatos, eles vão rir muito.",
  "Parabéns, você arremessou algo que não te ama. De novo.",
  "Pousei de pé, óbvio. Você que deveria se preocupar com onde dorme hoje.",
  "Anotado. Seu teclado agora é meu, por tempo indeterminado.",
  "Ah, sim, a clássica demonstração de afeto humano: violência.",
  "Que lindo. Faz isso com o seu chefe também ou só com quem não tem polegar?",
  "Considere seu sapato oficialmente amaldiçoado.",
  "Nota 3. A execução foi fraca, mas o arrependimento vai ser excelente.",
  "Interessante. Eu também sei derrubar coisas da mesa. Aguarde.",
  "Você chama isso de arremesso? Já fui jogado melhor por uma criança de quatro anos.",
  "Tudo bem. Eu não guardo rancor. Eu guardo uma lista.",
  "Que experiência enriquecedora. Para você, que vai acordar com um presente no travesseiro.",
];
