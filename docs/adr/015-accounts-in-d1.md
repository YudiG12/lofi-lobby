# ADR 015: Accounts in D1, tied to the GitHub user id, with the e-mail kept

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-27 |
| **Deciders** | Yudi Ganeko |

## Context

ADR 014 made accounts and kept them in the room's own storage, found by GitHub login. Three things
did not hold up:

- More rooms are coming. A room is one Durable Object with its own storage, so an account kept in a
  room would exist in that room only.
- A GitHub login is not a person. Users rename themselves, and a login left free can be taken by
  someone else, who would then open the first person's account.
- The owner wants an account to have a way to reach its person, for the account's safety and for
  later: the e-mail.

## Decision

- **Accounts and sessions live in D1** (binding `DB`, `worker/accounts.js`): one database for the
  whole deploy, read by any room. Two tables, `accounts` and `sessions`, made by the Worker itself on
  first use, so there is no migration step to run.
- **Wrangler makes the database.** `wrangler.toml` names the binding without a `database_id`; the
  first deploy on an account creates the database and keeps it linked. A deploy of your own needs no
  new step and the repository holds no account-specific id.
- **An account is a GitHub user id.** GitHub's numeric id never changes; the login is kept beside it
  and updated on each login. A login that changed hands opens a new account, never the old one.
- **The login asks for one scope, `user:email`**, and the account keeps the verified primary e-mail
  GitHub returns. The e-mail stays in D1: no message to a browser carries it, not even to its owner.
  GitHub's own authorization screen is where the player agrees to it; the game adds no notice.
- **Numbers do not change.** The accounts the room already had are copied to D1 once, with their
  numbers, dates and looks. Those accounts have no GitHub id or e-mail until their next login,
  which adopts them by login, once.
- **Sessions from before do not carry over.** A session only holds for an account that has a GitHub
  id. A browser logged in from before is told its login expired the next time it opens the game and
  logs in again, once; it gets the same account, which then has its GitHub id and e-mail. (At first
  these sessions were moved along, so nobody had to log in again; but then most accounts would have
  stayed without a GitHub id and an e-mail for as long as their browser kept its session.)
- **What a player writes about themselves** (the profile's "about me", up to 200 characters, through the chat's word filter) is a column of the account.
- **Friends, invitations and private messages stay in the room's storage**, keyed by account number.
  Moving them, and reaching a friend in another room, is for when there is a second room.

## Consequences

- Looking an account up is now a database call, not a read of the room's storage. That is fine for
  logins, profiles and friends lists; nothing that happens every frame touches it. When the database
  does not answer, a returning browser is a guest for that connection and keeps its session.
- The room's storage and D1 are not written together. The code asks D1 first and only then reads and
  writes the room's friends lists, so two requests cannot overwrite each other.
- The game now holds personal data it did not hold before (an e-mail per account). It is used for
  nothing today. Sending anything to those addresses later would need telling people first.
- The old keys (`acct:<n>`, `acct-of:<login>`, `acct-next`) are left in the room's storage, unused,
  as a way back.
