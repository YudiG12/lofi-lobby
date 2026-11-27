// The deploy fireworks' timeline (ADR 016): which round is on and how far into it, from the show's
// start `at` and the room's clock, so every tab is on the same round at the same second.

export const ROUND_MS = 6000; // one round per pull request: a few bursts and its "PR #n"
export const MAX_ROUNDS = 5; // PRs with a round of their own (the room sends at most this many)
const DIM_MS = 1000; // the light dims this long before the first round and comes back this long after the last

/**
 * @param {number[]} prs PR numbers; no login, the room never shows one to others (ADR 014)
 * @param {number} more how many other PRs the deploy brought ("+ N more" round)
 * @returns {{ label: string, seed: number }[]}
 */
export function planRounds(prs, more) {
  const rounds = (Array.isArray(prs) ? prs : []).slice(0, MAX_ROUNDS).map((n) => ({ label: `PR #${n}`, seed: n }));
  if (more > 0) rounds.push({ label: `+ ${more} more`, seed: -more });
  return rounds;
}

/** @returns {{ running: boolean, round: number, t: number, dim: number }} t: 0..1 inside the round; dim: 0..1 */
export function showState(rounds, at, now) {
  const end = at + rounds.length * ROUND_MS;
  if (!rounds.length) return { running: false, round: -1, t: 0, dim: 0 };
  const dim = now < at ? clamp01(1 - (at - now) / DIM_MS) : now >= end ? clamp01(1 - (now - end) / DIM_MS) : 1;
  if (now < at || now >= end) return { running: false, round: -1, t: 0, dim };
  const into = now - at;
  const round = Math.floor(into / ROUND_MS);
  return { running: true, round, t: (into - round * ROUND_MS) / ROUND_MS, dim };
}

/** mulberry32: a small deterministic random, so a burst looks the same in every tab */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
