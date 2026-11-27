# ADR 016: Fireworks over the town after a deploy, for the pull requests it brought

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-27 |
| **Deciders** | Matheus Borges |

## Context

Lofi Lobby is open source and many people contribute to it. A merged pull request shows up in the game
only as the small badge over its author (ADR 014 counts them per account). When a deploy puts new
contributions live, the room could celebrate them together, at the same second for everyone, and
invite the people in the room to contribute too.

A deploy carries no "which pull request" field. The room already knows two useful things, though: the
deploy it runs (`VERSION.id`, sent to every tab in `you`, which reloads tabs on a new one) and the
repository's merged pull requests, which `readContributors()` reads from GitHub for the badges, again
after every new version.

ADR 014 promises that nobody in the game sees another player's GitHub login, only their account
number. The show must not break that.

## Decision

- **What a deploy celebrates** (`worker/deploy-prs.js`): the merged pull
  requests the room has not celebrated yet, decided on the first good GitHub read for a new
  `VERSION.id`. The celebrated numbers are kept per repository (`"deploy-prs:<repo>"`: `{ v, seen }`).
  - **First run** (no key yet) celebrates nothing and only records what exists, so the whole history
    never goes off at once. Pointing `GITHUB_REPO` elsewhere is a first run too.
  - **Reads for the same version** (the badge counts go stale after 6 h) change nothing, so a pull
    request merged before its deploy is still celebrated at that deploy, and several merged before one
    deploy are celebrated together.
  - **Only soon after the deploy**: the room writes when it first saw a version on a connection
    (`"deploy-seen"`: `{ v, at }`, its own key, so it never looks like a celebrated version). A read more
    than 15 minutes later (GitHub refused the first ones) records the new pull requests without a show.
- **The read starts on any connection and on the heartbeat alarm**, not only for players logged in
  with GitHub (`checkDeploy()` calls `contributors()`). Cloudflare keeps a Durable Object that is in use
  on its old code for up to 5 minutes after a deploy, and hibernated WebSockets survive the switch, so
  the tabs already in the room may never reconnect; the alarm, every minute while someone is online,
  still notices the new version. It is one storage read; the GitHub read keeps its existing limits.
- **Only pull request numbers leave the server.** The message is
  `{ t: "fireworks", at, prs: [n], more }`: at most 5 numbers and how many more. The authors' logins are
  used only to keep pull requests with a real author and never reach a browser (ADR 014). Whoever wants
  to know who wrote #65 looks it up on GitHub, outside the game.
- **The same second for everyone**: `at` is 4 s ahead on the room's clock, so the tabs reloading after
  the deploy are back for the start; a player who joins during the show gets the message on join and
  sees only what is left of it (`SHOW_MAX_MS`, 40 s). The timeline (`src/fireworks-plan.js`):
  one 6 s round per pull request, at most 5, then one "+ N more" round with the real number.
- **Drawn from time, not integrated** (`src/fireworks.js`): every spark's place is a function of the
  room's clock and a seed per round (a small mulberry32), so every tab shows the same picture and a tab
  that was hidden comes back to the current moment, not to a pile of bursts. Each round has three
  rockets and bursts, then "PR #n" written in sparks taken from a 14 px canvas text (chunky, like the
  town's pixel art). One `THREE.Points` of 2,600 sparks, one draw call, additive blending (an unused
  spark is black and adds nothing), no fog, no depth test.
- **In view wherever you are**: the camera looks down at the town (30° field from `+(0, 38, 42)`, about
  26° to 56° below the horizon) and never shows the sky, so the show sits in the upper part of the view,
  in front of the player, facing the camera. The text is scaled to at most 80 % of the visible width.
- **Visible by day**: while the show runs the look blends to the night look and back, applied after
  `updateTimeOfDay` and `updateRain` (both re-apply the player's own look); the player's day/night choice
  is untouched.
- **A preview in development**: a "fireworks" module in the debug hub (ADR 010) plays a local show with
  1, 3 or 7 test pull requests in that tab only.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **A GitHub webhook to the room on each merge** | A merge is not a deploy: the show would come before the change is live. It also needs a public endpoint and a secret to check. |
| **The deploy (CI) calling the room** | The owner deploys by hand (`npm run deploy`); a call would need a new secret and a new endpoint for something the room can see by itself. |
| **The author's login in the sky** | Breaks ADR 014: the badge of the author, if online, goes up at the same moment, so everyone could tell which trainer it is. |
| **The pull request's title** | Free text from outside the game, would need the word filter, and is long. |
| **Fireworks fixed over the pond** | The camera follows the player; from the back of the town they would be off screen. |
| **Sparks moved frame by frame** | Different in each tab, and a hidden tab would catch up all at once. |

## Consequences

- One new server → client message, three new storage keys (`"deploy-prs:<repo>"`, `"deploy-seen"`,
  `"fireworks"`); `seen` grows by one number per merged pull request.
- The first deploy with this change only records what exists; the shows start from the next one.
- A new `VERSION.id` is not always new code. `wrangler secret put` and a rollback also publish a version,
  and a deploy from a branch can lack some merged pull requests. In those cases the room celebrates
  pull requests that are not live yet, and the real deploy then shows nothing for them. Merge and
  deploy from `main`, with no secret change in between, keeps the show on the right deploy.
- A deploy whose GitHub reads all fail for 15 minutes has no show. GitHub's unauthenticated limit is
  low and shared; the room already lives with it for the badges.
- Locally, every `wrangler dev` restart is a new `VERSION.id`, so the whole path can be tested on a
  laptop. On Cloudflare (checked on a deploy of my own), the show came 20 s after the deploy through the
  alarm, to a tab that never reconnected.
