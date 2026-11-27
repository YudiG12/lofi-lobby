// Which merged pull requests a deploy celebrates with fireworks (ADR 016).
// A deploy carries no "which PR" field, so the room keeps the numbers it has already celebrated and,
// on the first good read of GitHub for a new version, celebrates the merged ones it hasn't seen. Only a
// new version moves the list on: the reads for stale badge counts don't, so a PR merged before its
// deploy is still celebrated at that deploy. Only PR numbers come in and out: the room never shows
// anyone's GitHub login to others (ADR 014).
//
// A new VERSION.id is not always a deploy of new code: `wrangler secret put` (or a rollback) also makes
// one, and a deploy from a branch can lack some merged PRs. Then the show comes early and the real
// deploy shows nothing (ADR 016, Consequences).

const CELEBRATE_WINDOW_MS = 15 * 60_000; // a read this long after the deploy was first seen celebrates nothing
const SHOW_LEAD_MS = 4000; // the show starts this far ahead, so the tabs reloading after the deploy see it from the start
const SHOW_PRS = 5; // PRs with a round of their own (MAX_ROUNDS in src/fireworks-plan.js); the others are counted in `more`
export const SHOW_MAX_MS = 40_000; // longer than any show (6 rounds of 6 s and the dimming): a player who joins later gets none

/**
 * @param {{ v: string, seen: number[] } | undefined} stored the "deploy-prs" key; missing (or broken) = first run
 * @param {number[]} merged the numbers of the read's merged PRs (with a real author), as GitHub lists them
 * @param {string} v the deploy now running (VERSION.id)
 * @param {number} firstSeenAt when the room first saw `v` on a connection ("deploy-seen")
 * @param {number} now
 * @returns {{ celebrate: number[], stored: { v: string, seen: number[] } }} celebrate: PR numbers
 */
export function deployPrs(stored, merged, v, firstSeenAt, now) {
  const valid = [];
  const numbers = new Set();
  for (const n of Array.isArray(merged) ? merged : []) {
    if (!Number.isInteger(n) || n <= 0 || numbers.has(n)) continue;
    numbers.add(n);
    valid.push(n);
  }
  const firstRun = !stored || typeof stored.v !== "string" || !Array.isArray(stored.seen);
  if (firstRun) return { celebrate: [], stored: { v, seen: valid } };
  if (stored.v === v) return { celebrate: [], stored };
  const seen = new Set(stored.seen);
  const fresh = valid.filter((n) => !seen.has(n));
  const inTime = now - firstSeenAt <= CELEBRATE_WINDOW_MS;
  return { celebrate: inTime ? fresh : [], stored: { v, seen: [...stored.seen, ...fresh] } };
}

/** The show the room sends: the first SHOW_PRS PR numbers, and how many more there are. */
export function showOf(celebrate, now) {
  return { at: now + SHOW_LEAD_MS, prs: celebrate.slice(0, SHOW_PRS), more: Math.max(0, celebrate.length - SHOW_PRS) };
}
