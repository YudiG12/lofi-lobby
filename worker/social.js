// Accounts, profiles, medals, friends and private chat: methods of the Room (installed by installSocial).
//
// An account is made by logging in with GitHub (the device flow in index.js), and only that way. It gets
// a number in the order accounts were made: the repository's owner is 0, the next account 1, and so on.
// Everything here names an account by that number: the GitHub login is shown to its owner only.
//
// Storage (this room's):
//   "acct-of:<login>"  the account number of that GitHub login
//   "acct:<n>"         { n, login, at, name, color, gender, cap }: when it was made and the trainer last seen with it
//   "acct-next"        the number the next account gets (0 is kept for the owner)
//   "friends:<n>"      { f: [n], in: [n], out: [n], c: [n], ci: { n: until }, unread: { n: count } }: friends,
//                      requests received and sent, who else it has a private chat with (invited, not a
//                      friend), chat invitations waiting for an answer, and private messages not read yet
//   "dm:<lo>-<hi>"     the last DM_KEEP private messages between two accounts: [{ f, t, at }]
//
// Protocol (JSON over the room's WebSocket; a guest's requests are refused):
//   client -> server: { t: "profile", n }   (whose profile to show)
//                     { t: "friend", n, action: "add" | "remove" }   (add asks, or accepts a request from n;
//                                                                     remove unfriends, declines or takes a request back)
//                     { t: "friends" }   (send my list again)
//                     { t: "chat-invite", n }   (ask someone who is not a friend, and is online, for a private chat)
//                     { t: "chat-accept", n }   (say yes to n's invitation)
//                     { t: "dm", n, text } | { t: "dm-open", n } | { t: "dm-read", n }
//   server -> client: { t: "account", n, login, at, medals, created }   (this connection's account; n -1: none)
//                     { t: "acct", id, n }   (that player's account; players and chat also carry n)
//                     { t: "profile", n, name, color, gender, cap, at, medals, prs, online, relation, chat, login? }
//                       chat: you two have a private chat (friends, or an accepted invitation)
//                       relation: "self" | "friends" | "sent" | "received" | "none" | "guest" (you have no account)
//                     { t: "friends", friends: [{ n, name, color, online, unread }], in: [...], out: [...],
//                       chats: [{ n, name, color, online, unread }], event? }   (chats: private chats with non-friends)
//                       event: { kind: "request" | "accepted", n, name } when that is what changed
//                     { t: "friend-online", n, online }
//                     { t: "chat-invite", from, name, color }   (from wants a private chat with you)
//                     { t: "chat-open", with, name, color }   (the invitation was accepted: the chat is open)
//                     { t: "dm", with, from, text, at } | { t: "dm-history", with, messages: [{ from, text, at }] }
import { cleanChat } from "./moderation.js";

// Founding member: an account made in the game's first week, until the end of 30 November 2026 (Brasília time)
export const FOUNDER_UNTIL = Date.UTC(2026, 11, 1, 3);
// medal id -> who has it. The client knows each medal's name, text and picture (src/social.js).
const MEDALS = { founder: (a) => a.at < FOUNDER_UNTIL };
const medalsOf = (a) => Object.keys(MEDALS).filter((id) => MEDALS[id](a));

const MAX_FRIENDS = 200;
const MAX_PENDING = 50; // requests waiting, each way
const DM_KEEP = 50; // messages kept per pair of friends
const DM_MAX = 140; // characters, like the room's chat
const UNREAD_MAX = 99;
const MAX_CHATS = 50; // private chats with non-friends
const INVITE_MS = 2 * 60_000; // a chat invitation waits this long for a yes
const MAX_INVITES = 20; // waiting at once, per account
const ACCOUNT_MAX = 1_000_000_000;

const accountNumber = (v) => (Number.isInteger(v) && v >= 0 && v < ACCOUNT_MAX ? v : -1);
const dmKey = (a, b) => `dm:${Math.min(a, b)}-${Math.max(a, b)}`;
const without = (list, n) => list.filter((x) => x !== n);

export function installSocial(Room, { cleanText }) {
  Object.assign(Room.prototype, {
    // The account of a GitHub login. `create` makes it on the first login.
    async accountOf(login, create = false) {
      const s = this.state.storage;
      let n = await s.get("acct-of:" + login);
      if (n === undefined) {
        if (!create) return null;
        // the repository's owner is account 0, whenever they log in; everyone else counts from 1
        const owner = String(this.env.GITHUB_REPO || "").split("/")[0].toLowerCase();
        if (login === owner) n = 0;
        else {
          n = (await s.get("acct-next")) || 1;
          await s.put("acct-next", n + 1);
        }
        const account = { n, login, at: Date.now() };
        await s.put({ ["acct-of:" + login]: n, ["acct:" + n]: account });
        return { ...account, created: true };
      }
      return (await s.get("acct:" + n)) || null;
    },
    socketsOf(n) {
      return this.openSockets().filter((ws) => ws.deserializeAttachment()?.acct === n);
    },
    sendTo(n, msg) {
      const s = JSON.stringify(msg);
      for (const ws of this.socketsOf(n)) try { ws.send(s); } catch {}
    },
    async friendsOf(n) {
      const f = await this.state.storage.get("friends:" + n);
      return { f: f?.f || [], in: f?.in || [], out: f?.out || [], c: f?.c || [], ci: f?.ci || {}, unread: f?.unread || {} };
    },

    // This connection now has an account (a login, or a browser coming back with its session).
    async accountAttached(ws, account, first) {
      const p = ws.deserializeAttachment();
      if (!p || p.left) return;
      await this.saveLook(p, account);
      ws.send(JSON.stringify({ t: "account", n: account.n, login: account.login, at: account.at, medals: medalsOf(account), ...(account.created && { created: true }) }));
      await this.sendFriends(account.n, null, [ws]);
      if (first) await this.presence(account.n, true);
    },
    // The trainer an account was last seen as: what its friends and its profile show while it is away.
    async saveLook(p, account) {
      if (p.acct == null) return;
      const a = account || (await this.state.storage.get("acct:" + p.acct));
      if (!a) return;
      const look = { name: p.name, color: p.color || "", gender: p.gender, cap: p.cap ?? -1 };
      if (Object.keys(look).every((k) => a[k] === look[k])) return;
      const { created, ...kept } = a;
      await this.state.storage.put("acct:" + a.n, { ...kept, ...look });
    },
    // Tell an account's online friends that it came or went (only for its first or last connection).
    async presence(n, online) {
      if (this.socketsOf(n).length !== (online ? 1 : 0)) return;
      const { f, c } = await this.friendsOf(n);
      for (const friend of [...f, ...c]) this.sendTo(friend, { t: "friend-online", n, online });
    },

    // An account's friends and requests, to all its connections (or only to `only`).
    async sendFriends(n, event = null, only = null) {
      const sockets = only || this.socketsOf(n);
      if (!sockets.length) return;
      const list = await this.friendsOf(n);
      const all = [...new Set([...list.f, ...list.in, ...list.out, ...list.c])];
      const accounts = new Map();
      for (let i = 0; i < all.length; i += 100) {
        const got = await this.state.storage.get(all.slice(i, i + 100).map((x) => "acct:" + x));
        for (const a of got.values()) accounts.set(a.n, a);
      }
      const online = new Set(this.openSockets().map((ws) => ws.deserializeAttachment()?.acct).filter((x) => x != null));
      const card = (x) => ({ n: x, name: accounts.get(x)?.name || "trainer", color: accounts.get(x)?.color || "" });
      const live = (x) => ({ ...card(x), online: online.has(x), unread: list.unread[x] | 0 });
      const msg = JSON.stringify({
        t: "friends",
        friends: list.f.filter((x) => accounts.has(x)).map(live),
        chats: list.c.filter((x) => accounts.has(x)).map(live),
        in: list.in.filter((x) => accounts.has(x)).map(card),
        out: list.out.filter((x) => accounts.has(x)).map(card),
        ...(event && { event }),
      });
      for (const ws of sockets) try { ws.send(msg); } catch {}
    },

    async socialMessage(ws, p, m) {
      const fail = (msg) => ws.send(JSON.stringify({ t: "error", msg }));
      if (m.t === "profile") return this.sendProfile(ws, p, accountNumber(m.n));
      if (p.acct == null) return fail("connect github to create an account first");
      if (m.t === "friends") return this.sendFriends(p.acct, null, [ws]);
      const other = accountNumber(m.n);
      if (other < 0 || other === p.acct) return;
      if (m.t === "friend") return this.friend(p, other, m.action, fail);
      if (m.t === "chat-invite") return this.chatInvite(ws, p, other, fail);
      if (m.t === "chat-accept") return this.chatAccept(p, other);
      if (m.t === "dm") return this.dm(ws, p, other, m.text, fail);
      if (m.t === "dm-open") return this.dmOpen(ws, p, other);
      if (m.t === "dm-read") return this.dmRead(p.acct, other);
    },

    async sendProfile(ws, p, n) {
      const a = n < 0 ? null : await this.state.storage.get("acct:" + n);
      if (!a) return ws.send(JSON.stringify({ t: "profile", n, missing: true }));
      const counts = await this.contributors();
      let relation = "guest";
      let chat = false;
      if (p.acct === n) relation = "self";
      else if (p.acct != null) {
        const mine = await this.friendsOf(p.acct);
        relation = mine.f.includes(n) ? "friends" : mine.out.includes(n) ? "sent" : mine.in.includes(n) ? "received" : "none";
        chat = mine.f.includes(n) || mine.c.includes(n);
      }
      ws.send(JSON.stringify({
        t: "profile", n, name: a.name || "trainer", color: a.color || "", gender: a.gender || "male", cap: a.cap ?? -1, at: a.at,
        medals: medalsOf(a), prs: counts[a.login] | 0, online: this.socketsOf(n).length > 0, relation, chat,
        ...(relation === "self" && { login: a.login }),
      }));
    },

    async friend(p, other, action, fail) {
      const me = p.acct;
      const them = await this.state.storage.get("acct:" + other);
      if (!them) return;
      const mine = await this.friendsOf(me);
      const theirs = await this.friendsOf(other);
      let event = null;
      if (action === "add") {
        if (mine.f.includes(other) || mine.out.includes(other)) return;
        if (mine.in.includes(other)) {
          // they asked first: this accepts
          if (mine.f.length >= MAX_FRIENDS || theirs.f.length >= MAX_FRIENDS) return fail("friends list full");
          mine.in = without(mine.in, other);
          theirs.out = without(theirs.out, me);
          mine.f.push(other);
          theirs.f.push(me);
          // friends chat anyway: no need for the invited chat any more (its messages stay)
          mine.c = without(mine.c, other);
          theirs.c = without(theirs.c, me);
          event = { kind: "accepted", n: me, name: p.name };
        } else {
          if (mine.f.length >= MAX_FRIENDS) return fail("friends list full");
          if (mine.out.length >= MAX_PENDING) return fail("too many friend requests waiting");
          if (theirs.in.length >= MAX_PENDING) return fail("that player has too many requests waiting");
          mine.out.push(other);
          theirs.in.push(me);
          event = { kind: "request", n: me, name: p.name };
        }
      } else if (action === "remove") {
        const were = mine.f.includes(other) || mine.c.includes(other);
        for (const k of ["f", "in", "out", "c"]) {
          mine[k] = without(mine[k], other);
          theirs[k] = without(theirs[k], me);
        }
        delete mine.unread[other];
        delete theirs.unread[me];
        delete mine.ci[other];
        delete theirs.ci[me];
        // nothing between them any more: their private chat goes too
        if (were) await this.state.storage.delete(dmKey(me, other));
      } else return;
      await this.state.storage.put({ ["friends:" + me]: mine, ["friends:" + other]: theirs });
      await this.sendFriends(me);
      await this.sendFriends(other, event);
    },

    // A private chat with someone who is not a friend starts with an invitation they accept.
    async chatInvite(ws, p, other, fail) {
      const me = p.acct;
      const them = await this.state.storage.get("acct:" + other);
      if (!them) return;
      const mine = await this.friendsOf(me);
      const open = () => ws.send(JSON.stringify({ t: "chat-open", with: other, name: them.name || "trainer", color: them.color || "" }));
      if (mine.f.includes(other) || mine.c.includes(other)) return open();
      if (mine.c.length >= MAX_CHATS) return fail("too many private chats open");
      if (!this.socketsOf(other).length) return fail(`${them.name || "that player"} is offline`);
      const theirs = await this.friendsOf(other);
      const now = Date.now();
      for (const k of Object.keys(theirs.ci)) if (theirs.ci[k] < now) delete theirs.ci[k];
      if (!(me in theirs.ci) && Object.keys(theirs.ci).length >= MAX_INVITES) return fail("that player has too many invitations waiting");
      theirs.ci[me] = now + INVITE_MS;
      await this.state.storage.put("friends:" + other, theirs);
      this.sendTo(other, { t: "chat-invite", from: me, name: p.name, color: p.color || "" });
    },
    async chatAccept(p, other) {
      const me = p.acct;
      const mine = await this.friendsOf(me);
      if (!(mine.ci[other] > Date.now())) return;
      delete mine.ci[other];
      const theirs = await this.friendsOf(other);
      if (!mine.f.includes(other)) {
        if (mine.c.length >= MAX_CHATS || theirs.c.length >= MAX_CHATS) return;
        if (!mine.c.includes(other)) mine.c.push(other);
        if (!theirs.c.includes(me)) theirs.c.push(me);
      }
      await this.state.storage.put({ ["friends:" + me]: mine, ["friends:" + other]: theirs });
      await this.sendFriends(me);
      await this.sendFriends(other);
      const them = await this.state.storage.get("acct:" + other);
      this.sendTo(me, { t: "chat-open", with: other, name: them?.name || "trainer", color: them?.color || "" });
      this.sendTo(other, { t: "chat-open", with: me, name: p.name, color: p.color || "" });
    },

    async dm(ws, p, other, raw, fail) {
      const me = p.acct;
      const mine = await this.friendsOf(me);
      if (!mine.f.includes(other) && !mine.c.includes(other)) return fail("invite them to a private chat first");
      // the same cleaning, word filter and spam mute as the room's chat
      const text = cleanChat(cleanText(raw, DM_MAX), DM_MAX);
      if (text === null) return fail("message blocked");
      if (!text) return;
      const now = Date.now();
      const spam = this.spamOf(p.ip, now);
      if (spam.mutedUntil > now) return this.tellMuted(ws, spam.mutedUntil);
      const key = dmKey(me, other);
      const kept = [...((await this.state.storage.get(key)) || []), { f: me, t: text, at: now }].slice(-DM_KEEP);
      const theirs = await this.friendsOf(other);
      theirs.unread[me] = Math.min(UNREAD_MAX, (theirs.unread[me] | 0) + 1);
      await this.state.storage.put({ [key]: kept, ["friends:" + other]: theirs });
      this.sendTo(me, { t: "dm", with: other, from: me, text, at: now });
      this.sendTo(other, { t: "dm", with: me, from: me, text, at: now });
    },
    async dmOpen(ws, p, other) {
      const mine = await this.friendsOf(p.acct);
      if (!mine.f.includes(other) && !mine.c.includes(other)) return;
      const kept = (await this.state.storage.get(dmKey(p.acct, other))) || [];
      ws.send(JSON.stringify({ t: "dm-history", with: other, messages: kept.map((x) => ({ from: x.f, text: x.t, at: x.at })) }));
      await this.dmRead(p.acct, other, mine);
    },
    async dmRead(me, other, list = null) {
      const mine = list || (await this.friendsOf(me));
      if (!mine.unread[other]) return;
      delete mine.unread[other];
      await this.state.storage.put("friends:" + me, mine);
    },
  });
}
