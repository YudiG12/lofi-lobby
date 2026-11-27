# Security

The client is public, so the server trusts nothing it sends.

## Access model

- **No accounts.** Anyone with the URL joins a room with a name they pick; names are not unique and prove nothing.
- **Admin** is one secret, `ADMIN_PASSWORD`, stored only as a Worker secret (and in a git-ignored `.dev.vars` locally). It is typed in a login box opened by `/admin` (never in the chat box or the URL), compared in **constant time**, and an IP is blocked for 1 minute after **20 wrong tries** (tries are also rate-limited to about one per second). Admin can restart or skip the song, and kick or ban players.
- **Origin check:** the WebSocket only accepts the site's own origin, plus any listed in `ALLOWED_ORIGINS`. Anything else gets `403`.
- **Contributor badge** (`/github`): the GitHub OAuth device flow with no scope, so the room can only read the player's public login. GitHub's token is used once (who is this, and the repository's merged pull requests) and never stored or sent to the browser; the browser keeps a random session of the room's own, stored in the room only as a SHA-256 hash. Login attempts are rate-limited per IP, and the count comes from GitHub, never from the client.
- **Accounts, friends and private chat** ([`worker/social.js`](worker/social.js)): an account can only be made by the GitHub login above, and its number comes from the room, never from the client. Everyone else sees an account by its number; the GitHub login is sent to its owner only. Every request names accounts by number and is checked in the room: a guest's requests are refused, a friend request needs the other side's yes, and a private message is refused unless the two are friends or one accepted the other's chat invitation (an invitation only reaches someone online, lasts two minutes, and at most 20 wait per account). Private messages get the room chat's cleaning, word filter, spam mute and rate limit, and are drawn with `textContent`. The room keeps the last 50 messages per pair of friends, in clear; removing a friend deletes them. Lists are capped (200 friends, 50 requests waiting each way, 50 chats with non-friends).
- **Limits per connection:** 1 KB per message; rate limits (token bucket) for positions, chat, bench seats and everything else (what a sitter holds is one of three fixed values); **100 players** per room.
- **Input is cleaned:** names (16 chars) and chat (140 chars) lose control and bidi characters; coordinates must be finite and within bounds; enums are checked against a list.
- **Output is safe:** the browser inserts every text that comes from the network with `textContent`, never as HTML.
- **Static game assets only:** the repo and live site serve the reviewed files in `public/assets/`; visitors cannot upload assets ([ADR 005](docs/adr/005-version-and-deploy-game-assets.md)).

- **Moderation:** names with bad words or porn names are refused and replaced by a random `trainer` name; bad chat words become `lobba`, and messages with blocked names are dropped ([`worker/moderation.js`](worker/moderation.js)). Text is normalized first (accents, leetspeak, repeated letters). The admin clicks a player's name to kick (10-minute IP ban) or ban (7-day IP ban) them, and `/unban` in the chat clears every ban. Bans are per IP, so people sharing an IP are affected together.
- **Who is this (admin only):** the kick/ban menu shows a 4-character tag of the player's IP (HMAC with a random key kept in the room, so it can't be turned back into the IP), the other players online with the same tag, and the names used from it in the last 6 hours (last 10). The IP itself is never shown. Same tag means same connection, not certainly the same person (shared networks).
- **Progressive mute** for chat spam, per IP.

- **Chat history:** the room keeps the last 30 messages from the last 2 hours (name, text, time; never the IP) so people who just joined can read them. Messages are filtered before they are stored, and a banned player's messages are removed.

- **Message wall:** notes are kept forever (name, trainer, text, colour, time; never the IP). Writing is only accepted from the site's own origin, with a body of at most 12 KB; the text is cut to 2,000 characters and 40 lines and goes through the same cleaning and word filter as the chat, the name through the same filter as names. Notes with a link are refused (a scheme, `www.`, a domain, or `name.xx/path`). Notes with a link are refused (a scheme, `www.`, a domain, or `name.xx/path`). One note per minute per IP (the time of an IP's last note is kept for that and removed by the daily cron); banned IPs can't write. The admin deletes a note with the admin password, under the same lockout.
- **Likes:** a like is tied to the browser's wall key (only a piece of its hash is stored), so liking twice from one browser counts once. Beside each like the room keeps the short IP tag (never the IP), and a note takes at most 3 likes from one IP, so fresh wall keys can't farm likes. Likes are rate-limited per IP, banned IPs can't like, and a deleted note takes its likes with it.
- **Whose note it is:** there are no accounts, so the browser keeps a random "wall key" and sends it with each note. The note stores only the key's SHA-256, which is never sent to anyone; showing the key again is what allows editing (same cleaning, filter and link rule; 5 s between edits) or deleting that note. Clearing the browser's data loses the key, and the note can then only be removed by the admin. Notes written before wall keys existed have no owner: the admin can claim one (it becomes theirs to edit); a note that has an owner can never be claimed.

A word list never catches everything; kick and ban cover the rest.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/YudiG12/lofi-lobby/security/advisories/new) instead of a public issue.
