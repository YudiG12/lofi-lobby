# ADR 007: Chat player mentions with server validation and selective highlighting

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-26 |
| **Deciders** | Daniel Carlos |

## Context

Players in the shared lobby chat needed a way to mention another player directly using `@` autocomplete, subject to Lofi Lobby's existing design and security constraints:

- **Ambiguous player names.** Player names allow spaces (up to 16 characters) and duplicates, while WebSocket connection `id`s are ephemeral per session and never displayed to users.
- **Zero client trust (`SECURITY.md`).** The server trusts nothing from the client, so mentions cannot rely on client-supplied target names, colors, or arbitrary HTML/styling.
- **Calm, focused environment.** Lofi Lobby is meant to stay open in the background while studying or working; mentions must draw attention only for the mentioned player without adding audio interruptions or visual clutter for everyone else.

## Decision

Implement `@mention` autocomplete, zero-trust server validation, and selective client rendering across three parts:

- **Input autocomplete (`@` + at least 1 character).** Typing `@` followed by at least one non-whitespace character (at the start of `#msg` or after whitespace) opens `#mention-list` showing other currently joined players (excluding self), filtered case- and accent-insensitively with prefix matches sorted first and each player's chosen name color. Selecting an option inserts `@<name> ` into the input and tracks that player's internal `id` for the message. Only **1 mention per message** is allowed; deleting `@<name>` from the input unlocks picking another player.
- **Server-side validation (`worker/index.js`).** The client sends `{ t: "chat", text, mention? }` containing only the optional target `id`. After running `cleanText` and `cleanChat`, the Room Durable Object checks that `mention` is a different, currently joined socket and that `@<target.name>` appears on valid word boundaries (`findMentionRange`) in the cleaned `text`. The server then attaches `{ id, name, color?, admin? }` read strictly from the target's socket attachment (never trusting client-supplied metadata) to the broadcast and persisted chat history.
- **Selective rendering without `@` (`src/main.js`, `index.html`).** When rendering a validated mention in the chat panel and 3D speech bubble, the leading `@` is omitted (`@` remains only an input trigger and wire boundary marker):
  - **Mentioned player (`mention.id === myId`):** sees the message row highlighted (`.m.mentioned` left border and subtle tinted background) plus `<mark class="mention">` styled in their chosen name color (`--mention`, or `#ffc95a` for admin/default).
  - **Sender and other players:** see a normal unhighlighted row (`.m`) with the mentioned player's name colored in that player's chosen name color (`<span class="mention-other">`).
  - **3D speech bubble:** displays plain text without `@` and without highlight styling.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Client-only `@name` text parsing** | Cannot distinguish players sharing the same name, breaks easily with spaces or renames, and bypasses server validation. |
| **Opening the list on bare `@`** | Pops up accidentally when typing standalone `@` or email-like text; requiring `@` + 1 character keeps typing clean while filtering immediately. |
| **Multiple mentions per message** | Enables mention-spam in a 100-player room; capping at 1 mention per message keeps chat calm and simplifies validation. |
| **Stripping `@` on the server before broadcast** | Loses unambiguous boundary matching on the client and breaks plain-text fallback for older clients; stripping `@` only at render time keeps the wire text self-describing. |
| **Audio chimes or unread badge alerts** | Distracts from the lofi study/work radio; kept purely visual inside the chat panel for now. |

## Consequences

- Mentions resolve accurately even when players share a name or use spaces, with all moderation and metadata controlled by the server.
- Mentioned players immediately spot messages addressed to them in their chosen color, while bystanders see only the colored name without row-level noise.
- Because `id` is per WebSocket connection, history replayed after a reload or reconnect renders previous mentions in the bystander style (colored name without row highlight) rather than re-highlighting old messages.
