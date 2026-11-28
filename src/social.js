// Accounts, profiles, medals, friends and private chat: the screens (DOM). The room does the rest
// (worker/social.js): it makes the account on a GitHub login, keeps friends and private messages,
// and says who has which medal. An account is named by its number everywhere; nobody else sees the
// GitHub login behind it.
// The screens say little: icons with a label on hover, a green dot for who is online.
import "./social.css";

// What each medal is. The room only says which ones an account has (by id).
export const MEDALS = {
  founder: {
    name: "Founding member",
    text: "Created an account in the game's first week, before December 2026.",
    img: "/assets/badges/founder.svg",
  },
};

// Until when a new account gets the Founding member medal: the room decides (FOUNDER_UNTIL in
// worker/social.js); this copy only says when to stop telling guests about it.
const FOUNDER_UNTIL = Date.UTC(2026, 11, 1, 3);

const BIO_MAX = 200; // characters of "about me" (the room cuts it there too)

const svg = (d, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const POP_OUT = '<path d="M14 4h6v6M20 4l-8 8M10 6H5v13h13v-5"/>';
const ICON = {
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  friends: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  invite: svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v5M9.5 10.5h5"/>'),
  add: svg('<circle cx="10" cy="8" r="4"/><path d="M2.5 21a7.5 7.5 0 0 1 12-6M19 14v6M16 17h6"/>'),
  remove: svg('<circle cx="10" cy="8" r="4"/><path d="M2.5 21a7.5 7.5 0 0 1 12-6M16.5 15l5 5M21.5 15l-5 5"/>'),
  sent: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  yes: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  no: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  logout: svg('<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>'),
  dock: svg('<path d="M4 5h16v14H4zM14 5v14"/>'),
  send: svg('<path d="m5 12 14-7-5 14-3-6z"/>'),
  // GitHub's mark: the one the page already draws for the repository link
  github: document.querySelector("#github svg")?.outerHTML || "",
};

const $ = (tag, props = {}, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
};
const day = (at) => new Date(at).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
const TOUCH = matchMedia("(pointer: coarse)").matches;
// an icon button; its label shows on hover (and names it for a screen reader)
const icon = (name, label, fn, kind = "") => {
  const b = $("button", { className: "ico " + kind, type: "button", innerHTML: ICON[name], title: label });
  b.setAttribute("aria-label", label);
  b.addEventListener("click", (e) => (e.stopPropagation(), b.blur(), fn(e)));
  return b;
};

// An icon button that asks before it acts, in place: the first click turns it into "question ✓ ✕"
// (no window of its own); it goes back by itself if nothing is answered.
const confirmIcon = (name, label, question, fn, kind = "danger") => {
  const wrap = $("span", { className: "confirm" });
  const idle = () => wrap.replaceChildren(icon(name, label, ask, kind));
  let timer = 0;
  function ask() {
    clearTimeout(timer);
    wrap.replaceChildren($("small", { textContent: question }), icon("yes", label, () => (clearTimeout(timer), fn()), "danger"), icon("no", "cancel", idle));
    timer = setTimeout(idle, 6000);
  }
  idle();
  return wrap;
};

/**
 * @param {object} game what the screens need from the game:
 *   send(msg) -> boolean (false when offline), paintName(el, color), showPrs(el, prs),
 *   login() and logout() (the GitHub login), say(text) (a system line in the room's chat),
 *   me() -> { name, color, prs, gender, cap }, look(gender, cap) -> Promise<canvas> (a trainer's
 *   front frame), elMsgs, elMsgsLocal and elInput (the global and local chat's lists, and the box),
 *   sceneName() (the scene you are in)
 */
export function setupSocial(game) {
  let account = null; // { n, login, at, medals } once this browser is logged in
  let friends = { friends: [], in: [], out: [], chats: [] };
  const chats = new Map(); // account number -> an open private chat (see chatWith)
  let active = "global"; // the tab open in the chat panel: "global", "local" or an account number
  let lastRoom = "global"; // the room chat (global or local) open last: where a private chat closes back to
  const isRoom = (tab) => tab === "global" || tab === "local";
  let shown = null; // the profile on screen: an account number, or "guest"
  const known = (n) => friends.friends.find((f) => f.n === n) || friends.chats.find((f) => f.n === n);

  // ---- the top card and the start screen: my account and my friends ----
  const accountBtn = document.querySelector("#account-btn");
  const friendsBtn = document.querySelector("#friends-btn");
  const enterLogin = document.querySelector("#enter-login");
  friendsBtn.innerHTML = ICON.friends;
  const friendsBadge = friendsBtn.appendChild($("i"));
  function drawAccount() {
    accountBtn.innerHTML = account ? ICON.profile : ICON.github;
    accountBtn.classList.toggle("new", !account);
    accountBtn.setAttribute("aria-label", account ? `profile #${account.n}` : "log in");
    friendsBtn.hidden = !account;
    const waiting = friends.in.length + [...friends.friends, ...friends.chats].reduce((sum, f) => sum + (chats.get(f.n)?.unread ?? f.unread), 0);
    friendsBadge.textContent = waiting > 99 ? "99+" : waiting;
    friendsBadge.classList.toggle("on", waiting > 0);
    enterLogin.innerHTML = account ? `${ICON.yes}<span>#${account.n}</span>` : `${ICON.github}<span>log in</span>`;
    enterLogin.classList.toggle("in", !!account);
    enterLogin.title = account ? `logged in: account #${account.n}` : "log in with github";
    // a guest is told about the medal while it can still be had: on the start screen, and once in the room
    const offer = !account && Date.now() < FOUNDER_UNTIL;
    document.querySelector("#enter-founder").hidden = !offer;
    if (!offer) founderCard?.remove();
  }
  accountBtn.addEventListener("click", () => (accountBtn.blur(), account ? openProfile(account.n, { ...game.me(), online: true }) : game.login()));
  friendsBtn.addEventListener("click", () => (friendsBtn.blur(), openFriends()));
  enterLogin.addEventListener("click", () => (enterLogin.blur(), !account && game.login()));

  // ---- profile ----
  const profile = $("div", { id: "profile", className: "glass social-card", hidden: true });
  profile.setAttribute("role", "dialog");
  const friendsCard = $("div", { id: "friends", className: "glass social-card", hidden: true });
  friendsCard.setAttribute("role", "dialog");
  const invites = $("div", { id: "invites" });
  document.body.append(profile, friendsCard, invites);
  const closeAll = () => {
    profile.hidden = friendsCard.hidden = true;
    shown = null;
  };
  const closeBtn = () => icon("no", "close", closeAll, "close");
  // The profile and the friends list can be dragged by their top bar and stay where they are put
  // (until the page is reloaded); they close with their ✕ or Esc.
  for (const card of [profile, friendsCard]) {
    card.addEventListener("pointerdown", (e) => {
      if (!e.target.closest("header") || e.target.closest("button")) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => {
        card.style.transform = "none";
        card.style.left = Math.max(0, Math.min(ev.clientX - dx, innerWidth - 60)) + "px";
        card.style.top = Math.max(0, Math.min(ev.clientY - dy, innerHeight - 30)) + "px";
      };
      const stop = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", stop));
      addEventListener("pointermove", move);
      addEventListener("pointerup", stop);
    });
  }
  const friendAction = (n, action) => game.send({ t: "friend", n, action });
  // the trainer as everyone sees it in town: front frame, with its cap colour
  function lookOf(gender, cap) {
    const cv = $("canvas", { className: "look", width: 32, height: 32 });
    game.look(gender, cap).then((frame) => {
      cv.width = frame.width;
      cv.height = frame.height;
      cv.getContext("2d").drawImage(frame, 0, 0);
    }, () => {});
    return cv;
  }
  // name, with a green dot when online, and the account number (hover: since when)
  function head(who, num, since = "") {
    const title = $("b", { textContent: who.name || "trainer" });
    game.paintName(title, who.color);
    const dot = who.online == null ? [] : [$("i", { className: "dot" + (who.online ? " on" : ""), title: who.online ? "online" : "offline" })];
    const number = num ? [$("span", { className: "num", textContent: num, title: since })] : [];
    return $("header", {}, ...dot, title, ...number, closeBtn());
  }

  /**
   * Shows a profile. With an account number the room is asked for it; a player without an
   * account (n < 0) only has what the room already shows of them.
   * @param {number} n account number, or -1
   * @param {{name: string, color: string, gender?: string, cap?: number, online?: boolean}} seen what is known already
   */
  function openProfile(n, seen = {}) {
    friendsCard.hidden = true;
    const asked = n >= 0 && game.send({ t: "profile", n });
    shown = asked ? n : "guest";
    const body = seen.gender ? [$("div", { className: "body" }, lookOf(seen.gender, seen.cap))] : [];
    profile.replaceChildren(head(seen, asked ? `#${n}` : ""), ...body);
    profile.hidden = false;
  }
  function drawProfile(m) {
    if (shown !== m.n) return;
    if (m.missing) return profile.replaceChildren(head({ name: "?" }, `#${m.n}`));
    const self = m.relation === "self";
    const side = $("div", { className: "side" });
    if (m.prs > 0) {
      const prs = $("span", { className: "prs" });
      game.showPrs(prs, m.prs);
      side.append(prs);
    }
    const medals = m.medals.map((id) => MEDALS[id]).filter(Boolean);
    if (medals.length) {
      // only the picture: what the medal is shows on hover (or on a tap)
      side.append($("div", { className: "medals" }, ...medals.map((x) =>
        $("button", { className: "medal", type: "button" }, $("img", { src: x.img, alt: x.name, width: 24, height: 24 }), $("span", { className: "tip" }, $("b", { textContent: x.name }), x.text)))));
    }
    const again = () => game.send({ t: "profile", n: m.n });
    const acts = [];
    if (self) acts.push(confirmIcon("logout", "log out", "log out?", () => (closeAll(), game.logout())));
    else if (m.relation === "guest") acts.push(icon("github", "log in", () => (closeAll(), game.login()), "github"));
    else {
      acts.push(m.chat ? icon("chat", "message", () => (closeAll(), openChat(m.n, m)), "main")
        : icon("invite", "invite to a private chat", (e) => (game.send({ t: "chat-invite", n: m.n }), e.currentTarget.classList.add("done")), "main"));
      if (m.relation === "none") acts.push(icon("add", "add friend", () => (friendAction(m.n, "add"), again()), "main"));
      if (m.relation === "sent") acts.push(icon("sent", "friend request sent: cancel", () => (friendAction(m.n, "remove"), again())));
      if (m.relation === "received") acts.push(icon("yes", "accept friend", () => (friendAction(m.n, "add"), again()), "main"), icon("no", "decline friend", () => (friendAction(m.n, "remove"), again()), "danger"));
      if (m.relation === "friends") acts.push(confirmIcon("remove", "remove friend", "remove friend?", () => (friendAction(m.n, "remove"), again())));
    }
    // about me: everyone reads it as plain text. Its owner clicks the text to write (or sees the box
    // with the hint while there is nothing yet); it is saved on leaving the box, or Enter, and the
    // box is gone again.
    let about = [];
    const edit = (holder) => {
      const box = $("textarea", { className: "bio", maxLength: BIO_MAX, rows: 3, value: m.bio || "", placeholder: "write about yourself, so people can strike up a conversation with you!" });
      box.setAttribute("aria-label", "about you");
      const save = () => {
        const text = box.value.replace(/\s+/g, " ").trim();
        if (text !== (m.bio || "")) return game.send({ t: "bio", text }); // the room's answer draws the profile again
        if (m.bio) box.replaceWith(written()); // nothing changed: back to the text
      };
      box.addEventListener("blur", save);
      box.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), box.blur());
        if (e.key === "Escape") ((box.value = m.bio || ""), box.blur(), e.stopPropagation());
      });
      if (holder) (holder.replaceWith(box), box.focus());
      return box;
    };
    const written = () => {
      const text = $("p", { className: "bio" + (self ? " mine" : ""), textContent: m.bio }); // textContent: no HTML from a player
      if (self) {
        text.title = "edit";
        text.addEventListener("click", () => edit(text));
      }
      return text;
    };
    if (m.bio) about = [written()];
    else if (self) about = [edit()];
    profile.replaceChildren(
      head(m, `#${m.n}`, `since ${day(m.at)}${self ? ` · github @${m.login} (only you see this)` : ""}`),
      $("div", { className: "body" }, lookOf(m.gender, m.cap), side),
      ...about,
      $("div", { className: "actions" }, ...acts),
    );
  }

  // ---- friends ----
  function openFriends() {
    if (!account) return game.login();
    profile.hidden = true;
    shown = null;
    drawFriends();
    friendsCard.hidden = false;
    game.send({ t: "friends" });
  }
  function drawFriends() {
    const who = (f) => {
      const b = $("button", { className: "who", type: "button", title: "profile" }, f.name, $("small", { textContent: `#${f.n}` }));
      game.paintName(b, f.color);
      b.addEventListener("click", () => openProfile(f.n, f));
      return b;
    };
    const dot = (f) => $("i", { className: "dot" + (f.online ? " on" : ""), title: f.online ? "online" : "offline" });
    const talk = (f) => {
      const unread = chats.get(f.n)?.unread ?? f.unread;
      return [...(unread ? [$("span", { className: "count", textContent: unread })] : []), icon("chat", "message", () => (closeAll(), openChat(f.n, f)))];
    };
    // online first, then by name
    const sorted = (list) => [...list].sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
    const rows = [
      ...friends.in.map((f) => $("div", { className: "row ask" }, who(f), icon("yes", "accept friend", () => friendAction(f.n, "add"), "main"), icon("no", "decline", () => friendAction(f.n, "remove"), "danger"))),
      ...sorted(friends.friends).map((f) => $("div", { className: "row" }, dot(f), who(f), ...talk(f))),
      ...sorted(friends.chats).map((f) => $("div", { className: "row" }, dot(f), who(f), ...talk(f), icon("add", "add friend", () => friendAction(f.n, "add")))),
      ...friends.out.map((f) => $("div", { className: "row wait" }, who(f), icon("sent", "friend request sent: cancel", () => friendAction(f.n, "remove")))),
    ];
    const title = $("header", {}, $("span", { className: "glyph", innerHTML: ICON.friends, title: "friends" }), closeBtn());
    friendsCard.replaceChildren(title, rows.length ? $("div", { className: "list" }, ...rows) : $("div", { className: "none", innerHTML: ICON.friends }));
  }

  // ---- private chat ----
  // A chat sits in the chat panel as a tab, or floats as a window of its own that can be dragged
  // anywhere and resized; dropped on the chat panel it becomes a tab again, and a tab dragged out
  // (or its pop-out button) becomes a window. Where each window was left is remembered.
  const chatPanel = document.querySelector("#chat");
  const chatHeader = chatPanel.querySelector("header");
  const tabs = $("div", { className: "tabs" });
  tabs.setAttribute("role", "tablist");
  // the open tab has a speech bubble before its name: it says "chat" without a title taking the room
  const bubble = () => $("i", { className: "ic", innerHTML: ICON.chat });
  // the two room chats come first: global (the main one, every scene) and local (this scene only)
  const roomTabs = {};
  const roomLists = { global: game.elMsgs, local: game.elMsgsLocal };
  const roomUnread = { global: 0, local: 0 };
  for (const scope of ["global", "local"]) {
    const tab = $("button", { type: "button", className: scope === active ? "on" : "" }, bubble(), $("span", { textContent: scope }), $("i", { className: "n" }));
    tab.dataset.tab = scope;
    tab.setAttribute("role", "tab");
    tab.addEventListener("click", () => (tab.blur(), show(scope)));
    roomTabs[scope] = tab;
    tabs.append(tab);
  }
  roomTabs.global.title = "everyone, in every scene";
  function drawRoomTabs() {
    roomTabs.local.title = `only who is in ${game.sceneName()}`;
    if (isRoom(active)) game.elInput.placeholder = active === "local" ? `only ${game.sceneName().toLowerCase()}…` : roomPlaceholder;
    for (const scope of ["global", "local"]) {
      const tab = roomTabs[scope];
      tab.classList.toggle("on", active === scope);
      tab.setAttribute("aria-selected", String(active === scope));
      const badge = tab.querySelector("i.n");
      badge.textContent = roomUnread[scope] > 99 ? "99+" : roomUnread[scope];
      badge.classList.toggle("on", roomUnread[scope] > 0);
    }
  }
  chatHeader.replaceChildren(tabs);
  const dmMsgs = $("div", { id: "dm-msgs", hidden: true });
  game.elMsgs.after(dmMsgs);
  const roomPlaceholder = game.elInput.placeholder;

  let saved = {}; // account number -> { x, y, w, h } of its window, when it floats
  try { saved = JSON.parse(localStorage.getItem("dm-windows") || "{}") || {}; } catch {}
  const remember = () => { try { localStorage.setItem("dm-windows", JSON.stringify(saved)); } catch {} };

  const line = (name, color, text, at) => {
    const who = $("small", { textContent: name });
    game.paintName(who, color);
    const when = $("time", { dateTime: new Date(at).toISOString(), textContent: new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
    return $("div", { className: "m" }, $("div", { className: "head" }, who, when), $("span", { textContent: text })); // textContent: no HTML from a message
  };
  const chatVisible = () => !TOUCH || chatPanel.classList.contains("open");
  // the room chat on screen again (the phone's sheet opened, the browser tab came back): it is read
  const roomSeen = () => {
    if (!isRoom(active) || !chatVisible() || document.visibilityState !== "visible" || !roomUnread[active]) return;
    roomUnread[active] = 0;
    drawRoomTabs();
  };
  new MutationObserver(roomSeen).observe(chatPanel, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", roomSeen);
  // am I looking at this chat right now (so what arrives is read)
  const watching = (c) => document.visibilityState === "visible" && (c.win ? true : active === c.n && chatVisible());
  function drawChat(c) {
    const list = c.win ? c.list : active === c.n ? dmMsgs : null;
    if (!list) return;
    const me = game.me();
    list.replaceChildren(...c.msgs.map((x) => (x.from === c.n ? line(c.name, c.color, x.text, x.at) : line(me.name, me.color, x.text, x.at))));
    list.scrollTop = list.scrollHeight;
  }
  function drawTab(c) {
    for (const el of [c.tab, c.win?.firstChild]) {
      if (!el) continue;
      el.querySelector(".nm").textContent = c.name;
      game.paintName(el, c.color);
      el.querySelector(".dot")?.classList.toggle("on", !!known(c.n)?.online);
    }
    if (!c.tab) return;
    c.tab.classList.toggle("on", active === c.n);
    const badge = c.tab.querySelector("i.n");
    badge.textContent = c.unread;
    badge.classList.toggle("on", c.unread > 0);
  }
  // the chat with account n, made on the first use (a tab, or the window it was left as)
  function chatWith(n, seen = {}, floating = !TOUCH && !!saved[n]) {
    let c = chats.get(n);
    if (c) return c;
    const who = known(n) || seen;
    c = { n, name: who.name || "trainer", color: who.color || "", msgs: [], unread: who.unread | 0, loaded: false, tab: null, win: null, list: null };
    chats.set(n, c);
    if (floating) float(c);
    else dock(c);
    return c;
  }
  function dock(c) {
    if (c.win) {
      c.win.remove();
      c.win = c.list = null;
      delete saved[c.n];
      remember();
    }
    if (!c.tab) {
      const tab = $("button", { type: "button" }, bubble(), $("span", { className: "nm" }), $("i", { className: "n" }),
        ...(TOUCH ? [] : [$("b", { className: "x pop", innerHTML: svg(POP_OUT, 11), title: "pop out" })]),
        $("b", { className: "x shut", textContent: "✕", title: "close" }));
      tab.dataset.tab = c.n;
      tab.addEventListener("click", (e) => {
        if (e.target.closest(".shut")) return closeChat(c.n);
        if (e.target.closest(".pop")) return float(c);
        show(c.n);
      });
      // dragging the tab out of the panel turns it into a window, which keeps following the pointer
      tab.addEventListener("pointerdown", (e) => {
        if (TOUCH || e.target.closest(".x")) return;
        const from = { x: e.clientX, y: e.clientY };
        const move = (ev) => {
          if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 24) return;
          stop();
          float(c, { x: ev.clientX - 120, y: ev.clientY - 14 });
          startDrag(c, ev, 120, 14);
        };
        const stop = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", stop));
        addEventListener("pointermove", move);
        addEventListener("pointerup", stop);
      });
      tabs.append(tab);
      c.tab = tab;
    }
    drawTab(c);
  }
  function float(c, at = null) {
    if (c.tab) {
      c.tab.remove();
      c.tab = null;
      if (active === c.n) show(lastRoom);
    }
    if (!c.win) {
      const box = saved[c.n] || { x: innerWidth - 700, y: innerHeight - 380, w: 300, h: 320 };
      if (at) Object.assign(box, at);
      const list = $("div", { className: "msgs" });
      const input = $("input", { maxLength: 140, autocomplete: "off", placeholder: "message…" });
      const form = $("form", {}, input, $("button", { type: "submit", innerHTML: ICON.send, title: "send" }));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = input.value.trim().slice(0, 140);
        input.value = "";
        if (text && !game.send({ t: "dm", n: c.n, text })) game.say("you are offline: the message was not sent");
      });
      input.addEventListener("keydown", (e) => e.key === "Escape" && input.blur());
      const bar = $("header", {}, $("i", { className: "dot" }), $("b", { className: "nm" }), $("small", { textContent: `#${c.n}` }),
        icon("dock", "back into the chat", () => (dock(c), show(c.n))), icon("no", "close", () => closeChat(c.n), "close"));
      bar.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        const r = c.win.getBoundingClientRect();
        startDrag(c, e, e.clientX - r.left, e.clientY - r.top);
      });
      c.win = $("div", { className: "glass dm-win" }, bar, list, form);
      c.list = list;
      document.body.append(c.win);
      const fit = (v, max) => Math.max(8, Math.min(v, max));
      const w = Math.max(220, Math.min(box.w, innerWidth - 16)), h = Math.max(170, Math.min(box.h, innerHeight - 16));
      Object.assign(c.win.style, { left: fit(box.x, innerWidth - w - 8) + "px", top: fit(box.y, innerHeight - h - 8) + "px", width: w + "px", height: h + "px" });
      // resized (the corner handle): remember the new size
      new ResizeObserver(() => c.win && keep(c)).observe(c.win);
      keep(c);
    }
    drawTab(c);
    if (!c.loaded) game.send({ t: "dm-open", n: c.n });
    else if (c.unread) game.send({ t: "dm-read", n: c.n });
    c.unread = 0;
    if (known(c.n)) known(c.n).unread = 0;
    drawChat(c);
    drawAccount();
  }
  function keep(c) {
    const r = c.win.getBoundingClientRect();
    if (!r.width) return;
    saved[c.n] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    remember();
  }
  // a window follows the pointer; let go over the chat panel and it becomes a tab there
  function startDrag(c, e, dx, dy) {
    e.preventDefault();
    const over = (ev) => {
      const r = chatPanel.getBoundingClientRect();
      return chatVisible() && ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom;
    };
    const move = (ev) => {
      if (!c.win) return;
      c.win.style.left = Math.max(0, Math.min(ev.clientX - dx, innerWidth - 60)) + "px";
      c.win.style.top = Math.max(0, Math.min(ev.clientY - dy, innerHeight - 30)) + "px";
      chatPanel.classList.toggle("drop", over(ev));
    };
    const stop = (ev) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", stop);
      chatPanel.classList.remove("drop");
      if (!c.win) return;
      if (over(ev)) return dock(c), show(c.n);
      keep(c);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", stop);
  }
  function openChat(n, seen) {
    const c = chatWith(n, seen);
    if (c.win) return c.win.querySelector("input").focus();
    show(n);
    chatPanel.classList.add("open"); // phones: the chat is a sheet
    if (!TOUCH) game.elInput.focus();
  }
  function closeChat(n) {
    const c = chats.get(n);
    if (!c) return;
    if (known(n)) known(n).unread = c.unread; // still waiting, chat open or not
    const floated = !!c.win;
    c.tab?.remove();
    c.win?.remove();
    c.win = null;
    chats.delete(n);
    if (floated) delete saved[n], remember();
    if (active === n) show(lastRoom);
    drawAccount();
  }
  function show(tab) {
    active = tab;
    const room = isRoom(tab);
    if (room) lastRoom = tab;
    for (const scope of ["global", "local"]) roomLists[scope].hidden = active !== scope;
    dmMsgs.hidden = room;
    if (room && chatVisible()) roomUnread[tab] = 0;
    drawRoomTabs();
    for (const c of chats.values()) drawTab(c);
    if (room) {
      roomLists[tab].scrollTop = roomLists[tab].scrollHeight;
      return;
    }
    const c = chats.get(tab);
    game.elInput.placeholder = `message ${c.name}…`;
    if (!c.loaded) game.send({ t: "dm-open", n: tab }); // the history, and it counts as read
    else if (c.unread) game.send({ t: "dm-read", n: tab });
    c.unread = 0;
    if (known(tab)) known(tab).unread = 0;
    drawTab(c);
    drawChat(c);
    drawAccount();
  }
  function receive(m) {
    const c = chatWith(m.with, {}, false); // a chat that opens by itself comes as a tab, not as a window in the way
    if (c.loaded) c.msgs.push({ from: m.from, text: m.text, at: m.at });
    while (c.msgs.length > 50) c.msgs.shift();
    const mine = m.from !== m.with;
    if (watching(c)) {
      if (!c.loaded) game.send({ t: "dm-open", n: m.with });
      else if (!mine) game.send({ t: "dm-read", n: m.with });
      drawChat(c);
    } else if (!mine) {
      c.unread++;
      document.querySelector("#chat-toggle")?.classList.add("unread");
    }
    drawTab(c);
    drawAccount();
  }
  // Founding member: a card at the top of the screen for a guest who just walked in, with the medal,
  // a log in button and a ✕. Closed, it stays away for this visit only: it is back the next time the
  // game is opened, for as long as the medal can be had.
  let founderCard = null;
  let founderClosed = false;
  function offerFounder() {
    if (account || founderClosed || endedCard?.isConnected || founderCard?.isConnected || Date.now() >= FOUNDER_UNTIL) return;
    founderCard = $("div", { className: "glass invite founder" }, $("img", { src: MEDALS.founder.img, alt: "", width: 32, height: 32 }),
      $("span", { innerHTML: "create your account until <b>nov 30</b><br>and get the <b>founding member</b> medal" }),
      icon("github", "log in", () => game.login(), "github"),
      icon("no", "close", () => {
        founderCard.remove();
        founderClosed = true;
      }));
    invites.prepend(founderCard);
  }
  // This browser was logged in and the room ended its session: a card to log in again, in place of the
  // one above (this player has an account already, and gets back to it by logging in).
  let endedCard = null;
  function sessionEnded() {
    founderCard?.remove();
    if (account || endedCard?.isConnected) return;
    endedCard = $("div", { className: "glass invite founder ended" }, $("span", { className: "glyph", innerHTML: ICON.profile }),
      $("span", { innerHTML: "your login expired:<br><b>log in again</b> to get back to your account" }),
      icon("github", "log in", () => game.login(), "github"), icon("no", "close", () => endedCard.remove()));
    invites.prepend(endedCard);
  }
  // in the room (the start screen is gone), and after the room had a moment to say who this browser is
  addEventListener("game:pause", (e) => !e.detail && setTimeout(offerFounder, 1500));

  // someone who is not a friend asks for a private chat: a small card to say yes or no
  function invited(m) {
    if ([...invites.children].some((el) => el.dataset.n === String(m.from))) return;
    const who = $("b", { textContent: m.name });
    game.paintName(who, m.color);
    const card = $("div", { className: "glass invite", title: "invites you to a private chat" }, $("span", { className: "glyph", innerHTML: ICON.chat }), who, $("small", { textContent: `#${m.from}` }));
    card.dataset.n = m.from;
    card.append(icon("yes", "accept the chat", () => (game.send({ t: "chat-accept", n: m.from }), card.remove()), "main"), icon("no", "decline", () => card.remove(), "danger"));
    invites.append(card);
    setTimeout(() => card.remove(), 115_000); // the room forgets the invitation after two minutes
  }

  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (!profile.hidden || !friendsCard.hidden)) closeAll();
  });
  drawAccount();

  return {
    /** A message from the room. @returns {boolean} it was one of these screens' */
    onMessage(m) {
      if (m.t === "account") {
        account = m.n >= 0 ? { n: m.n, login: m.login, at: m.at, medals: m.medals || [] } : null;
        if (account) endedCard?.remove();
        if (!account) {
          friends = { friends: [], in: [], out: [], chats: [] };
          for (const c of [...chats.values()]) (c.tab?.remove(), c.win?.remove(), chats.delete(c.n)); // the windows keep their place for the next login
          if (!isRoom(active)) show(lastRoom);
          invites.replaceChildren();
          closeAll();
        }
        // a new connection: what was loaded before may have missed messages
        for (const c of chats.values()) {
          c.loaded = false;
          if (c.win) game.send({ t: "dm-open", n: c.n });
        }
        if (account && !isRoom(active)) show(active);
        if (m.created && document.querySelector("#enter")?.hidden !== false) openProfile(m.n, { ...game.me(), online: true });
        drawAccount();
      } else if (m.t === "profile") drawProfile(m);
      else if (m.t === "friends") {
        friends = { friends: m.friends || [], in: m.in || [], out: m.out || [], chats: m.chats || [] };
        // someone who is gone from both lists takes their private chat along
        for (const n of [...chats.keys()]) if (!known(n)) closeChat(n);
        // the chats left floating open again by themselves
        for (const f of [...friends.friends, ...friends.chats]) if (!TOUCH && saved[f.n] && !chats.has(f.n)) chatWith(f.n, f);
        for (const c of chats.values()) Object.assign(c, { name: known(c.n).name, color: known(c.n).color }), drawTab(c);
        if (m.event?.kind === "request") game.say(`${m.event.name} #${m.event.n} wants to be your friend`);
        if (m.event?.kind === "accepted") game.say(`${m.event.name} #${m.event.n} is now your friend`);
        if (!friendsCard.hidden) drawFriends();
        if (typeof shown === "number" && shown !== account?.n) game.send({ t: "profile", n: shown });
        drawAccount();
      } else if (m.t === "friend-online") {
        const f = known(m.n);
        if (f) f.online = !!m.online;
        if (chats.has(m.n)) drawTab(chats.get(m.n));
        if (!friendsCard.hidden) drawFriends();
        if (shown === m.n) game.send({ t: "profile", n: m.n });
      } else if (m.t === "chat-invite") invited(m);
      else if (m.t === "chat-open") {
        [...invites.children].find((el) => el.dataset.n === String(m.with))?.remove();
        closeAll();
        openChat(m.with, m);
      } else if (m.t === "dm") receive(m);
      else if (m.t === "dm-history") {
        const c = chats.get(m.with);
        if (!c) return true;
        c.msgs = m.messages || [];
        c.loaded = true;
        if (watching(c)) c.unread = 0;
        drawTab(c);
        drawChat(c);
        drawAccount();
      } else return false;
      return true;
    },
    /** What was typed in the chat box. @returns {boolean} it went to a private chat, not to the room */
    sendChat(text) {
      if (isRoom(active)) return false;
      if (!game.send({ t: "dm", n: active, text })) game.say("you are offline: the message was not sent");
      return true;
    },
    sessionEnded,
    /** @returns {"global"|"local"} the room chat the box talks to (the one open last, when a private chat is open) */
    roomScope: () => lastRoom,
    /** Through a portal: the local tab now names the new scene. */
    sceneChanged: drawRoomTabs,
    /** A new line in the global or local chat: counted on its tab while that chat is out of sight. */
    roomLine(scope) {
      if (active === scope && chatVisible() && document.visibilityState === "visible") return;
      roomUnread[scope]++;
      drawRoomTabs();
    },
    sessionEnded,
    /** @returns {number} my account number, or -1 */
    myAccount: () => (account ? account.n : -1),
    openProfile,
    isOpen: () => !profile.hidden || !friendsCard.hidden,
  };
}
