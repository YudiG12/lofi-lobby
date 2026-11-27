# ADR 014: Accounts by GitHub login, numbered in order, with friends and private chat in the room

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-27 |
| **Deciders** | Yudi Ganeko |

## Context

Until now a player was only a connection: a name typed on the way in, gone when the tab closes. The
only lasting identity was the GitHub login behind the contributor badge (`/github`, the OAuth device
flow), kept as a session of the room's own. The game now needs something that lasts: a profile others
can open, medals, a friends list and a private chat.

## Decision

- **An account is a GitHub login, and only that.** The device flow that gave the contributor badge now
  also makes the account, on the first login. No passwords, no e-mail, nothing new to protect. A
  browser that had a session before the feature gets its account the next time it connects.
- **Accounts are numbered in the order they were made**, from the room's storage (`acct-next`). Number
  0 is kept for the repository's owner (the owner of `GITHUB_REPO`), whenever they log in; everyone
  else counts from 1.
- **The number is the public name of an account.** Profiles, friends and private messages all travel
  by account number. The GitHub login stays in the room and is shown to its owner only: the promise
  of the contributor badge (the room learns your login, nobody else does) still holds.
- **Medals are rules, not rows.** The room decides who has a medal from the account itself (`MEDALS`
  in `worker/social.js`); the client knows each medal's name, text and picture. The first one,
  Founding member, is every account made before the end of 30 November 2026 (Brasília time). A new
  medal is a new rule and a new picture in `public/assets/badges/`, always pixel art.
- **Friends need a yes from both sides.** A request waits until the other accepts, so nobody gets
  private messages from someone they did not choose. Removing a friend also deletes the private chat.
- **Private chat goes through the same WebSocket**, with the room's chat rules (140 characters, the
  word filter, the spam mute, the chat rate limit). Friends can always message each other. Anyone
  else with an account can be invited from their profile: the invitation reaches them only while
  they are online, waits two minutes and opens the chat for both when accepted. The room keeps the
  last 50 messages of each pair, so a message sent to someone offline is there when they come back,
  with an unread count.
- **A private chat is a tab or a window.** It opens as a tab in the chat panel; dragged out (or with
  its pop-out button) it becomes a window that can be moved anywhere and resized, and dropped back
  on the panel it is a tab again. Where each window was left is kept in the browser. Phones keep tabs.
- **Icons, not sentences.** The profile, the friends list and the chat windows are icon buttons with
  a label on hover, a green dot for who is online, the trainer as the town shows it, and medals as
  small pictures whose name and reason show on hover. The top card and the start screen both have
  the log in button.
- **Everything lives in the room's storage**, like the wall's notes: `acct:<n>`, `acct-of:<login>`,
  `friends:<n>`, `dm:<lo>-<hi>`. No new binding, and the single room stays the only server.
- **The YouTube player leaves the screen.** Its card in the bottom left is gone; the player still
  plays the radio, off screen, and the mute button and volume moved to the top card.

## Consequences

- An account's trainer (name, colours) is saved on the account when it changes, so a profile and a
  friends list can show someone who is offline. That is a few more storage writes per session.
- Friends and private chat only exist inside this one room object. If the game ever has more rooms,
  accounts will have to move to an object of their own.
- Private messages are stored in clear in the room's storage and the admin of a deploy can read that
  storage. The page says how many messages are kept; it does not promise secrecy from the operator.
- A player with no GitHub account cannot have an account here. They keep everything they had before:
  walking, the room's chat, the wall.
- YouTube's terms for embedded players expect the player to be visible. With the card gone the game
  no longer shows it, which is a risk the owner accepted when asking for it to be removed.
