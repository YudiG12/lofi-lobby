# Security

The client is public, so the server trusts nothing it sends.

## Access model

- **No accounts.** Anyone with the URL joins a room with a name they pick; names are not unique and prove nothing.
- **Admin** is one secret, `ADMIN_PASSWORD`, stored only as a Worker secret (and in a git-ignored `.dev.vars` locally). It is compared in **constant time**, and a connection is blocked after **5 wrong tries**. Admin can only restart or skip the song.
- **Origin check:** the WebSocket only accepts the site's own origin, plus any listed in `ALLOWED_ORIGINS`. Anything else gets `403`.
- **Limits per connection:** 1 KB per message; rate limits (token bucket) for positions, chat and everything else; **40 players** per room.
- **Input is cleaned:** names (16 chars) and chat (140 chars) lose control and bidi characters; coordinates must be finite and within bounds; enums are checked against a list.
- **Output is safe:** the browser inserts every text that comes from the network with `textContent`, never as HTML.
- **No third-party assets** in the repo or on the live site ([ADR 004](docs/adr/004-original-art-in-the-repo-local-assets-ignored.md)).

What it does not do yet: moderation (mute, ban, word filter) and persistence of chat. Chat is relayed and forgotten.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/YudiG12/lofi-lobby/security/advisories/new) instead of a public issue.
