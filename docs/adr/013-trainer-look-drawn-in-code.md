# ADR 013: Trainer look drawn in code on the trainer's own sheet

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-27 |
| **Deciders** | Emerson Vieira |

## Context

Players asked to customize their avatar. The game already let them pick a trainer (male or female sheet) and one of five cap colours, recoloured in code on the sheet (`recolorCap` in `src/main.js`). A look has to be seen by everyone, survive reloads, cost the room nothing it can't check, and work on every frame the game uses: walking, running and the sitting row drawn from them (`src/ground-sit.js`).

The sheets share tones between parts: the male's hair, jacket and eyes are the same two greys, the female's hair, top and eyes the same two blues. A recolour by tone alone would paint the eyes and turn the whole outfit the hair's colour.

## Decision

Add a **look** on top of the cap colour: a skin, hair, top and bottom colour (6, 7, 7 and 6 choices, or the sheet's own) and two accessories, headphones and glasses. All of it is done in `src/look.js` on the trainer's own sheet, after its background is cleared and its cap recoloured:

- **Parts are found by where they are, frame by frame.** Eyes are a hair tone inside the face (within a pixel of the row's skin, on the face's rows) beside an eye white, or with skin on both sides; they are never painted. The rest of the shared tones is split into touching pieces: a piece that starts near the top of the head is hair, one that starts lower is the top. The jeans, the skirt and the skin have tones of their own, so they are swapped by colour alone; the skin goes last, since finding the eyes and placing the lenses go by the sheet's own skin. Thresholds are relative to the top of the head, because the running frames sit a few rows higher.
- **Accessories are drawn, not loaded.** Glasses are a frame around each detected eye (its white included), a bridge, and from the side an arm to the ear. Headphones are teal cups over the ears and a band following the head's outline. The head's sides are measured outward from the eyes over a few rows, so a hand raised beside the head (running) isn't taken for it. Since they are part of the sheet, lamp shadows, feet depth and the sitting frames get them for free.
- **Protocol.** The client sends `look` with `hello` and with the existing `gender` message (`{ t: "gender", gender, cap, look }`), a moment after the last change so clicking through colours sends one message. The server keeps only five small integers: `skin`, `hair`, `top`, `bottom` checked against their counts (anything else is `-1`), and `acc` masked to the two known bits. It broadcasts them like the cap.
- **One sheet per look, shared.** Other players' sheets are cleaned and dressed once per `gender|cap|look` and shared through a single `THREE.Source`, so everyone wearing the same look shares one canvas and one GPU upload. The entry is dropped when nobody wears it.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **New sheets or overlay images per outfit** | Needs new art (and more ripped sprites would be a step backwards; [ADR 004](004-original-art-in-the-repo-local-assets-ignored.md)), and every frame of every sheet would have to be drawn to match. |
| **Hand-made part masks shipped as images** | Exact, but 56 frames to paint by hand per sheet and to keep in step with any sheet change. The region rules cover both sheets and were checked frame by frame. |
| **Free colour picker (any hex)** | The server would have to accept and relay arbitrary values; fixed palettes keep the pixel-art look, the server check trivial, and the number of distinct sheets small. |
| **A new `look` message** | The `gender` message already makes every client rebuild that trainer; carrying the look in it keeps one rebuild per change. |

## Consequences

- Players pick skin, hair, top and bottom colours and the accessories on the start screen; the choice is kept in `localStorage` (`look`) and everyone sees it, also whoever joins later.
- Adding a colour is one line in `src/look.js` plus the count in `LOOK_COUNTS` (`worker/index.js`); an accessory is a new bit and its drawing.
- The region rules are tuned to the two current sheets (`SHEETS` in `src/look.js`). A new sheet needs its tones and thresholds, and a frame-by-frame look.
- The code-generated fallback trainer (used only when a sheet fails to load) keeps its own colours; the look doesn't apply to it.
- A trainer changing look still makes every client rebuild that one sheet (as with the cap), now at most once per change thanks to the shared cache; the server's `other` rate limit bounds how often.
