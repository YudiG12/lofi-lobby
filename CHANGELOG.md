# Changelog

## Unreleased

### Added
- **Accounts**: press the GitHub button in the top card, or **log in** on the start screen, and connect GitHub (the only way to make one). Your account gets a number in the order accounts were made: the game's owner is #0, the next one #1, and so on. Nobody else sees your GitHub login, only the number. `/github` still works, and whoever had logged in for the contributor badge gets an account the next time they open the game.
- **Profile**: click a name, over a trainer or in the chat (yours too), to open that player's profile: their trainer, a green dot when they are online, their account number, their merged pull requests and their medals.
- **Medals**, in pixel art: hover one to read what it is for. The first one is **Founding member**: for every account made in the game's first week, until the end of November 2026.
- **Friends**: add someone from their profile; they accept or decline. The friends button in the top card lists them, with who is online and who is waiting for an answer.
- **Private chat**: message a friend, or invite anyone with an account from their profile (they accept or decline). Only the two of you see it, and a message sent while they are away waits for them (the last 50 are kept). It opens as a tab in the chat panel; drag the tab out (or press its pop-out button) and it becomes a window you can move anywhere and resize, and drop it back on the chat to make it a tab again.
- **Roller coaster**: from a little station below the pond, between the carousel and the Ferris wheel, a little Christmas train of 5 cars climbs the east side, drops over the water, runs along the north of the pond, spirals down on the west side and brakes back into the station. It leaves every 42 seconds: while it waits at the station (12 s), walk up and press **E** to take one of its 5 seats (a sign over the station counts down the seconds left); you are strapped in for the ride and get off by the station when it is back. Everyone sees the same train in the same place. Bulbs along the track glow at night.
- **Contributor badge**: whoever had a pull request merged in the game gets a pixel-art ball and their PR count over their name and in the chat, next to where the admin has the gold badge. The ball is red at 1–10 PRs, blue at 11–20, black at 21–50 and a purple Master Ball at 51 or more. Type **/github** in the chat, open GitHub and type the code shown: the room learns your GitHub login (nothing else, and no password or token is kept) and counts your merged pull requests. The browser remembers it; **/github out** forgets it. A deploy of your own needs the Client ID of a GitHub OAuth App with Device Flow on, in `GITHUB_CLIENT_ID` (`wrangler.toml`). The counts are read again from GitHub every 6 hours and right after each deploy.
- **Frames per second**: press **P** (or tap the player count, on phones) to show the game's frames per second beside it, in yellow below 45 and red below 25; hovering it shows the time a frame takes, the slowest frame of the last half second and the draw calls. Only for you, and remembered.
- **Ferris wheel**: right of the pond, across the water from the carousel, a Ferris wheel turns slowly with 8 colourful gondolas and bulbs along its rims. Walk up and press **E** when a gondola is at the bottom to ride it all the way up (the camera goes with you); any move key gets you off, onto the grass in front of it. Everyone sees the same wheel and you in the same gondola. Four new lamp posts light the rides at night.
- **Christmas carousel**: below the sand path, left of the pond, where some pines stood, a merry-go-round turns slowly all the time: a striped canopy with a garland and a star, coloured bulbs that glow at night, presents on its base and 8 horses going up and down. Walk up and press **E** (or tap the note) to ride a horse; any move key gets you off. Everyone sees the same carousel at the same angle and you on the same horse, also whoever joins later: it turns by the room's clock, so riding sends nothing. No new assets: it is made in code.
- **Owl**: an owl sits on the message wall's roof and every so often flies, flapping, to the cap of one of the two nearest lamp posts and on to another perch. Walk up to its perch and it flies off. Only for you.
- **Skipping stones**: by the pond, press **T** (or tap the note over you) to throw a stone into the water. It flies from your hand in an arc, skips one to four times (a ring and a few drops at each touch, each hop shorter and lower) and sinks with a bigger splash. Everyone sees the same throw: the thrower plans where it touches the water and the room passes it on. No new assets: the pebble, the rings and the drops are made in code.
- **Cigarette**: **Q** now goes coffee, cigarette, empty hands while you stand (and through it on a bench too). The ember glows at night and a thin trail of smoke rises from the tip; everyone sees it, and like the coffee it goes away while you walk.
- **Sit on the ground**: press **C** (or the sitting button in the top card) to sit down wherever you are, facing the way you stand: front, back, left or right. Everyone sees it, also whoever joins later; walking, sitting on a bench or C again gets you up. The sitting frames are drawn in code from each trainer's own standing frames (with its cap colour), so there are no new assets.
- **Mentions in the chat**: type **@** and pick a name from the list of players in the room (arrows, Tab or Enter). Everyone sees the message as usual, but for the player it names it is highlighted: a gold bar and tint in the chat and a gold-edged bubble over the sender. The @name is shown in that player's name colour for everyone. Names are matched without telling upper from lower case and only as a whole name ("@Ana" doesn't mention "Anabel").
- A small GitHub link beside the chat: the game is open source, come and contribute.
- **Cap colour**: pick one of five cap colours on the enter/pause screen, next to a preview of your trainer; everyone sees it.
- **Trainer and cap in the top card**: a male/female switch and, beside it, the cap you wear (drawn as a little cap, so it is not taken for the name colour's dot). Click the cap to see the other colours; picking one folds them away.
- **The capybara takes a walk**: it strolls left and right on the sand path in front of the house on the right, by day and by night. Feed it (E) and it sits down to chew and thank you, then walks on. Everyone sees the same capybara: same place, same step, same thank-you (the room keeps its clock and tells everyone when it is fed).
- **Coffee on your feet**: **Q** (or the cup button, now always in the top card) puts a coffee in your hand while you stand still, and everyone sees it; it goes away while you walk and comes back when you stop. The laptop and the book still need a bench.
- **Likes on the wall**: every note has a heart; tap it to like (or take the like back) and everyone sees the count change live. The wall opens with the most liked notes on top, and a **top / new** switch in its header goes back to newest first (remembered). One like per browser, at most 3 per network on a note.
- **Name colour**: pick one of ten colours for your name on the enter/pause screen, or in-game from the dot next to "you: <name>" in the top card; a first visit gets a random one. Everyone sees it over your trainer and in the chat, and it is remembered. The admin keeps the gold badge.
- **Fishing pomodoro**: walk up to the edge of the pond, face the water and press **E** (or tap the note) to cast, then choose how many minutes to focus (15, 25, 50 or any number; the last choice is remembered). A bobber floats on the water and the time left shows on a fish button in the top card and in the tab's title. When the time is up a fish bites: a plop plays (also with the tab in the background) and you have a minute to press E and pull it in, or it gets away. Moving away from the spot (or standing up) reels the line in; reeling in on purpose asks for a second press. On a pond bench the fish button casts, since E stands you up there. Everyone sees your rod, your line and the bobber on the water while your line is out (the throw too, and also whoever joins later); the timer, the bite and the catch stay yours, in your browser. A line that is out survives a reload.
- **Fireflies**: at night, little lights blink and drift around the pond. They fade out by day and in the rain. Only for you.
- **Open tabs follow the deploy**: after a new deploy, a tab that reconnects to the room reloads itself to get the new version (it waits while you are writing a note or a chat message).
- **Benches**: park benches around the town (wooden slats on iron ends, like the lamp posts), two seats each, some facing the camera and some sideways along the paths. Walk up and a "press E to sit" note shows over the seat; press **E** (or tap the note) to sit, and any move key stands you up. Everyone sees you sitting, a seat holds one player, and a bench hides whoever stands behind it. Two of them face the pond, between the lamp posts at its ends, with a few candles on the grass. While sitting, **Q** (or the cup button) puts a laptop on your lap, a coffee in your hand or an open book (its pages turn now and then), and everyone sees it. You get up toward the side you walked off, and the camera glides instead of jumping.
- **Message wall**: a cork board by the lamp posts, in front of the lower-left house. Walk up and press E (or tap the note, or B) to read the notes people left and pin your own: up to 2,000 characters, six paper colours (a new note starts on a random one), one note a minute, no links. Notes are kept forever, appear live for everyone in the room, and the board in town shows the latest ones. You can edit or delete your own notes (deleting asks first; an edited note says so), and the admin can delete any note.
- **Stats** for the admin at `/stats.html`: online now, visitors per day, peak online, time in the room, busiest hours, countries and chat volume (Workers Analytics Engine; no IP, name or chat text is stored). `scripts/stats-token.sh` gives it read access. Each finished day is archived in the room's storage by a daily cron, so history outlives the 3 months of Analytics Engine, and a Cloudflare-measured connections-per-day chart goes back to launch.
- Cleaner HUD: the top card buttons are icons with an instant label on hover and their key in the corner, the shortcut bar became a "?" list (shown once on the first visit), the player count reads "N online", the radio TV is smaller, and respawn asks for a second click.
- **Full screen**: a button in the top card (and the F key) enters or leaves full screen, handy for leaving the lobby open next to your work. Only for you; hidden where the browser doesn't support it.
- **Respawn** button in the top card: sends your trainer back to the spawn if you got stuck.
- Everyone sees who the admin is: an **ADMIN** badge over the name and a highlighted line in the chat. Names with "admin", "moderador", "moderator" or "staff" are refused so nobody can pose as one.
- **Rain**: a button in the top card (and the R key) turns on rain with a short fade: thin drops that stop on roofs, splash rings on the ground and the pond, shiny wet ground and a little fog; by day the sky also turns grey. Only for you, and remembered.
- The HUD panels are more opaque with lighter grey text, and the shortcut bar sits between the radio and the chat instead of over the radio.
- Admin menu shows who a player is: a short tag of their IP (never the IP), who else is online with it, and the names it used in the last 6 hours.
- **Chat history**: whoever joins sees the last 30 messages from the last 2 hours.
- **Moderation**: bad names are refused, bad chat words become `***`, and the admin can kick or ban by clicking a player's name (`/unban` in the chat lifts bans).
- **Day and night**: a button in the top card (and the N key) switches the town to daytime and back, with a short fade. Only for you, and remembered.
- **Mute** button next to "now playing" (and the M key): only for you, remembered, and the radio keeps playing in sync underneath.
- **Volume** slider next to the mute button: only for you and remembered; moving it while muted unmutes.
- Chat **send** button (on phones it keeps the keyboard open).
- Play on phones: drag anywhere to walk (floating joystick, push to the edge to run), compact HUD, chat as a sheet behind a button with an unread dot, pause button, lighter shadows on touch devices.
- Name and trainer live together: a name field on the enter/pause screen, and "you: <name> ✎" moved from the chat header to the top card.
- Anti-flood per IP: at most 3 connections, chat budget shared across tabs, admin locked for 15 min after 5 wrong passwords (counted per IP, survives reconnects).
- Browser icon: the town's lamp post (`public/favicon.svg`).
- Progressive mute for chat spam (rate exceeded, or the same text 4+ times in a row): warning, then 15 s, 1 min, 5 min, 30 min.

### Changed
- **The YouTube player is off the screen**: the card in the bottom left corner is gone. The radio plays as before, and its mute button and volume are in the top card (the admin's song buttons too).
- A bad word in the chat or on the wall now reads `lobba` instead of `***` (and the result still stays within the 140 / 2,000-character limit).
- Lighter shadows: the lamp posts' shadow maps are 512 instead of 1024 and the moon's (sun's by day) 1024 instead of 2048, the same on every device. The town looks the same by night and by day, and the game takes about 245 MB less of GPU memory (about 355 MB down to 110 MB).
- Lamp shadows are redrawn only when they can change: once the town is in place, when the lamps come on at dusk, and when a trainer or the capybara moves within a lamp's reach (for the slow capybara, about 10 times a second). By day (lamps off) the 24 extra shadow passes per frame are skipped altogether, and at night they run only now and then: about 4,300 draw calls per frame down to 1,850 by day and 2,200 at night on average. They look the same, and a trainer or the capybara walking under a lamp still casts a moving shadow for everyone.
- The town is drawn in 18 pieces instead of 1,287: its meshes share one texture atlas, so they are baked together by material and by stretch of town once it loads. About 1,900 draw calls per frame down to 170, and 4,400 down to 520 when the lamps redraw their shadows (at night by the pond with a trainer walking, about 3,300 down to 370). The town looks the same, and collision, ground height, the water and the pond edge still use the original meshes, kept hidden.
- Two trainers standing close: the one in front now covers the other from head to toe (the feet of the one behind used to show through). Every trainer is drawn at the depth of its feet, not only yours.
- Admin login: type `/admin` in the chat and then the password in its own login box instead of `?admin=` in the URL; `/logout` leaves. Admin lock is looser: 20 tries, then 1 minute.
- You come back where you were: the position is remembered in the browser and sent when you (re)connect, so others see you in the right spot even if you stand still.
- The chat box stays open after sending, so you can keep talking; Esc or Enter on an empty box goes back to walking.
- Room limit raised from 40 to 100 players.
- A single room, `lobby`: `?room=` is gone and the server refuses other room names, so nobody can open extra rooms to run up the bill.

### Fixed
- **Room to walk between the pond and the Ferris wheel**: the wheel stood so close to the pond's corner that nobody could pass. It moved a little to the right and blocks less of the grass, so you can walk by on both sides of it.
- The game no longer fails to start when you come back to a fishing line whose fish got away while the tab was closed.
- **Stones thrown while your tab was hidden** no longer all fly at once when you come back: a stone someone throws while you are on another tab is skipped.
- A player whose cap colour is not known shows the cap their trainer is drawn with (red for the male, white for the female) instead of always red.
- The chat button is back on phones (a desktop-only rule was hiding it there too).
- Name tags, chat bubbles and the sit and wall prompts no longer show over the chat and the other panels.
- The chat bubble over a trainer keeps one size on every screen (it used to get narrower on small screens and near the right edge).
- Running now shows for everyone: other players used to see a runner with the walking frames.
- Chat history scrolls to older messages; new messages only pull you down if you were already at the bottom.
- Long words without spaces now wrap in the chat bubble and history.

### Restored
- The original Twinleaf FBX town, its textures and the male/female trainer sheets are versioned and included in production again ([ADR 005](docs/adr/005-version-and-deploy-game-assets.md)).
- README artwork now uses a real gameplay screenshot and the architecture docs describe the bundled assets.

## v1 (2026-11-09)

Built in one evening, from a Paper mockup to a live multiplayer lobby. Decisions in [ADR 001](docs/adr/001-one-durable-object-per-room.md) to [ADR 004](docs/adr/004-original-art-in-the-repo-local-assets-ignored.md); design in [spec v1](docs/spec/v1.md).

### Added
- **2.5D town at night** in three.js: lamp posts that light the scene and cast dynamic shadows, animated water, collision with houses, fences, mailboxes and the pond.
- **Sprites that take the depth of their feet**, so objects in front cover the whole trainer and nothing behind cuts the head ([ADR 003](docs/adr/003-sprites-take-the-depth-of-the-feet.md)).
- **Original town and trainers** (male and female) generated in code; switch trainer any time with G.
- **Multiplayer**: one Durable Object per room with hibernating WebSockets ([ADR 001](docs/adr/001-one-durable-object-per-room.md)); name tags over every trainer.
- **Chat** with a bubble over the speaker; change your name in the game.
- **Synced radio**: everyone hears the same second of the same YouTube video; admin can restart or skip for the whole room ([ADR 002](docs/adr/002-radio-synced-by-the-clock.md)).
- **Security**: rate and size limits, origin check, player cap, constant-time admin password with few tries, cleaned input ([SECURITY.md](SECURITY.md)).
