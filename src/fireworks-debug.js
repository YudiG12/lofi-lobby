// Dev-only deploy fireworks preview for the Debug Hub (src/debug.js, ADR 010): plays a show with test
// pull requests in this tab only, nothing is sent to the room. Loaded only under import.meta.env.DEV.
import { MAX_ROUNDS } from "./fireworks-plan.js";

const FIREWORKS_DEBUG_CSS = `
  .dbg-fw { display: flex; gap: 4px; flex-wrap: wrap; }
  .dbg-fw button { font: inherit; font-size: 10px; color: #F2F2F5; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.18); border-radius: 4px; padding: 3px 8px; cursor: pointer; }
  .dbg-fw button:hover { border-color: #ffc95a; color: #ffc95a; }
`;

const TEST_PRS = [65, 72, 63, 99999, 58, 57, 56]; // PR numbers; 7 PRs → 5 rounds and "+ 2 more"

/** Creates the dev-only fireworks debug module for the Debug Hub. */
export function createFireworksDebugModule({ playFireworks }) {
  return {
    id: "fireworks",
    title: "fireworks",
    desc: "play a test show of the deploy fireworks",
    mount(container) {
      document.head.appendChild(Object.assign(document.createElement("style"), { textContent: FIREWORKS_DEBUG_CSS }));
      container.innerHTML = `
        <div class="dbg-fw">
          <button type="button" data-prs="1">1 PR</button>
          <button type="button" data-prs="3">3 PRs</button>
          <button type="button" data-prs="7">7 PRs</button>
        </div>`;
      for (const b of container.querySelectorAll("button[data-prs]")) {
        b.addEventListener("click", () => {
          const count = Number(b.dataset.prs);
          playFireworks(TEST_PRS.slice(0, Math.min(MAX_ROUNDS, count)), Math.max(0, count - MAX_ROUNDS));
          b.blur(); // give the keyboard back to the game
        });
      }
    },
  };
}
