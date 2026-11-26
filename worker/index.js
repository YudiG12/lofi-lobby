// Room server: one Durable Object per room, everyone connected over WebSocket.
// Protocol (JSON):
//   client -> server: { t: "hello", name, gender, x, z, dir } | { t: "pos", x, z, dir, step }
//                     { t: "chat", text } | { t: "name", name } | { t: "gender", gender }
//                     { t: "sit", seat, n }   (bench seat 0..15 or -1 to stand; n numbers the request)
//                     { t: "radio", idx, password }   (admin)
//                     { t: "auth", password, quiet }   (admin login: admin-ok or an error; quiet = on reconnect, no admin-ok)
//                     { t: "who", id, password }   (admin: who is this player)
//                     { t: "mod", action: "kick"|"ban"|"unban", id, password }   (admin)
//   server -> client: { t: "you", id, v } | { t: "state", players: [...] }
//                     { t: "joined", player } | { t: "left", id } | { t: "pos", ... }
//                     { t: "chat", id, name, text, at } | { t: "name", id, name }
//                     { t: "gender", id, gender } | { t: "radio", command } | { t: "error", msg }
//                     { t: "hold", item }   (what you hold while sitting: 0 nothing, 1 laptop, 2 coffee, 3 book)
//                     { t: "seat", id, seat, n }   (who sits where; n only on a correction to the sender)
//                     { t: "history", messages: [{ id, name, text, at }] } (on join)
//                     { t: "notice", msg } | { t: "rename", name } (your name was refused)
//                     { t: "who", id, tag, names, sameTag } (admin only)
//                     { t: "kicked", msg } (the server closes you; don't reconnect)
//                     { t: "admin", id } (that player logged in as admin; players and chat also carry admin: true)
//
// Security (the client is public, so nothing coming from it is trusted):
//  - max message size, per-connection rate limit, max players per room
//  - admin password only on the server (ADMIN_PASSWORD secret), constant-time compare,
//    few attempts per connection
//  - allowed origins (ALLOWED_ORIGINS) so other sites can't use this server
//  - per IP: few connections, shared chat budget, admin lockout, progressive mute for spam
//  - all text is stripped of control characters and truncated; numbers finite and clamped
//  - word filter: bad names refused, bad chat words become *** (worker/moderation.js)
//  - admin kick (short IP ban) and ban (long IP ban), kept in storage
//
// Message wall (HTTP, a note is too long for a WebSocket frame): notes kept forever in this room's storage,
// one key per note ("note:<time>-<id>"), so there is no limit on how many.
//   GET /api/notes?before=<id>  newest first, NOTES_PAGE at a time
//   POST /api/notes { name, gender, text, color, key }  one per NOTE_EVERY_MS per IP, banned IPs refused,
//                                                  same cleaning and word filter as names and chat, no links
//   PATCH /api/notes/<id> { text, color, key }  the writer edits their note
//   POST /api/notes/<id>/claim  the admin takes a note nobody owns (written before wall keys existed)
//   DELETE /api/notes/<id>  the writer (X-Wall-Key header) or the admin (password in the Authorization header)
// A note belongs to whoever holds its "wall key" (random, kept in the writer's browser; the note stores its hash).
// New, edited and deleted notes also go out on the WebSocket:
//   { t: "note", note } | { t: "note-edit", note } | { t: "note-del", id }
//
// Stats (Workers Analytics Engine, dataset "lofi_lobby"): one data point per join, leave and chat.
// No IP, name or chat text is stored: a visitor is a hash of IP + day, only good for counting uniques.
//   blob1 event ("join"|"leave"|"chat"), blob2 gender, blob3 country, blob4 visitor
//   double1 players online, double2 seconds in the room (leave)
// /api/stats (admin password in the Authorization header) reads them back through the SQL API
// (CF_ACCOUNT_ID and CF_API_TOKEN secrets) for public/stats.html.

const MAX_PLAYERS = 100;
// v1 has a single room; any other name is refused so nobody can spin up extra rooms (and extra cost)
const ROOMS = ["lobby"];
const MAX_BYTES = 1024;
const COORD_LIMIT = 500;
const ADMIN_ATTEMPTS = 20; // per IP, then locked for ADMIN_LOCK_MS (the "other" rate limit already caps tries at ~1/s)
const ADMIN_LOCK_MS = 60_000;
const MAX_SEATS = 16; // bench seats numbered 0..15 (bench * 2 + side); the client knows where each is
const MAX_PER_IP = 3; // tabs/devices behind one IP
const KICK_MS = 10 * 60_000; // kick = a short ban, so the client's auto-reconnect doesn't undo it
const BAN_MS = 7 * 24 * 60 * 60_000;
// chat history for people who just arrived: last few messages, only recent ones, never the IP
const HISTORY_SIZE = 30;
const HISTORY_MS = 2 * 60 * 60_000;
// admin sees a short tag per IP (never the IP) and the names used from it in the last hours
const NAMES_KEEP = 10;
const NAMES_MS = 6 * 60 * 60_000;
// progressive mute: each spam strike mutes for longer; strikes are forgotten after STRIKE_RESET_MS quiet
const MUTE_STEPS_MS = [0, 15_000, 60_000, 5 * 60_000, 30 * 60_000]; // first strike is only a warning
const STRIKE_RESET_MS = 30 * 60_000;
const REPEAT_LIMIT = 3; // the same text more than this many times in a row...
const REPEAT_WINDOW_MS = 30_000; // ...inside this window counts as spam
// message wall
const NOTE_MAX = 2000; // characters: room to say something, not a book
const NOTE_LINES = 40;
const NOTE_BYTES = 12_000; // request body: NOTE_MAX characters of any alphabet, plus the JSON around them
const NOTE_EVERY_MS = 60_000; // one note per minute per IP
const NOTES_PAGE = 30;
const NOTE_EDIT_EVERY_MS = 5_000;
const NOTE_COLORS = ["cream", "yellow", "pink", "blue", "green", "lilac"];
// rate buckets: capacity, refill per second
const RATES = { pos: [30, 20], chat: [8, 1], sit: [20, 6], other: [10, 1] };

import { badName, cleanChat, hasLink, normalize } from "./moderation.js";

const DIRS = ["down", "up", "left", "right"];
const cleanText = (s, max) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
// like cleanText, but keeps line breaks (at most 2 in a row, NOTE_LINES in all)
const cleanNote = (s) => {
  let lines = 0;
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n/g, () => (++lines < NOTE_LINES ? "\n" : " "))
    .trim()
    .slice(0, NOTE_MAX);
};
// Whose note is it: the browser keeps a random "wall key" and sends it with a note; the note stores only
// its SHA-256, which never leaves the server. Showing the key again proves you wrote it (edit, delete).
async function ownerOf(key) {
  if (typeof key !== "string" || !/^[a-f0-9]{32}$/.test(key)) return null;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("wall|" + key));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// a note as the browser sees it: never the owner hash, only "mine" for the one asking
// (and "open" for a note nobody owns, from before wall keys: the admin can claim those)
const shown = (id, { owner, ...note }, asking) =>
  ({ id, ...note, ...(asking && owner === asking && { mine: true }), ...(!owner && { open: true }) });
const number = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, n)) : 0;
};
const gender = (g) => (g === "female" ? "female" : "male");

// constant-time compare (timing doesn't leak how many characters match)
function equal(a, b) {
  const ea = new TextEncoder().encode(String(a));
  const eb = new TextEncoder().encode(String(b));
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

async function visitorOf(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + day));
  return [...new Uint8Array(hash).slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// last 30 days, answered by the Analytics Engine SQL API
const STATS_QUERIES = {
  daily: `SELECT toStartOfDay(timestamp) AS day, SUM(_sample_interval) AS joins, COUNT(DISTINCT blob4) AS visitors, MAX(double1) AS peak
          FROM lofi_lobby WHERE blob1 = 'join' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY day ORDER BY day`,
  sessions: `SELECT toStartOfDay(timestamp) AS day, SUM(_sample_interval * double2) / SUM(_sample_interval) AS avgSeconds
          FROM lofi_lobby WHERE blob1 = 'leave' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY day ORDER BY day`,
  chat: `SELECT toStartOfDay(timestamp) AS day, SUM(_sample_interval) AS messages
          FROM lofi_lobby WHERE blob1 = 'chat' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY day ORDER BY day`,
  hours: `SELECT toHour(timestamp) AS hour, SUM(_sample_interval) AS joins
          FROM lofi_lobby WHERE blob1 = 'join' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY hour ORDER BY hour`,
  countries: `SELECT blob3 AS country, COUNT(DISTINCT blob4) AS visitors
          FROM lofi_lobby WHERE blob1 = 'join' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY country ORDER BY visitors DESC LIMIT 12`,
  genders: `SELECT blob2 AS gender, SUM(_sample_interval) AS joins
          FROM lofi_lobby WHERE blob1 = 'join' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY gender`,
};

// one finished day, for the archive (Analytics Engine keeps only 3 months)
const dayQuery = (day) => `SELECT blob1 AS event, SUM(_sample_interval) AS n, COUNT(DISTINCT blob4) AS visitors,
  MAX(double1) AS peak, SUM(_sample_interval * double2) AS seconds
  FROM lofi_lobby WHERE timestamp >= toDateTime('${day} 00:00:00') AND timestamp < toDateTime('${day} 00:00:00') + INTERVAL '1' DAY
  GROUP BY event`;

// Measured by Cloudflare since launch (the API allows about 31 days back): Worker requests per day (with assets
// served before the Worker, almost all are WebSocket connections: page loads and reconnects) and the most
// WebSockets open at once on the Durable Object (peak online, from before the game logged its own stats).
const CONNECTIONS_QUERY = `query ($account: String!, $since: Date!) { viewer { accounts(filter: { accountTag: $account }) {
  workersInvocationsAdaptive(limit: 100, filter: { scriptName: "lofi-lobby", date_geq: $since }, orderBy: [date_ASC]) {
    sum { requests } dimensions { date } }
  durableObjectsPeriodicGroups(limit: 100, filter: { date_geq: $since }, orderBy: [date_ASC]) {
    max { activeWebsocketConnections } dimensions { date } } } } }`;

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.buckets = new Map(); // "ip|type" or "ws-id|pos" -> { tokens, at } (in memory)
    this.noteEdits = new Map(); // ip -> time of the last note edit (in memory)
    this.spam = new Map(); // ip -> { strikes, mutedUntil, lastStrike, lastText, lastAt }
  }

  stat(event, p, extra = []) {
    try {
      this.env.STATS?.writeDataPoint({
        indexes: [event],
        blobs: [event, p.gender || "", p.country || "", p.visitor || ""],
        doubles: [this.state.getWebSockets().length, ...extra],
      });
    } catch {}
  }

  async stats(req) {
    const ip = req.headers.get("CF-Connecting-IP") || "local";
    const password = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const check = await this.checkAdmin(ip, password);
    if (!check.ok) return Response.json({ error: check.msg }, { status: 401 });
    if (!this.env.CF_ACCOUNT_ID || !this.env.CF_API_TOKEN) return Response.json({ error: "stats not set up" }, { status: 501 });
    const out = { online: this.state.getWebSockets().length };
    await Promise.all(Object.entries(STATS_QUERIES).map(async ([key, sql]) => {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
        method: "POST", headers: { Authorization: `Bearer ${this.env.CF_API_TOKEN}` }, body: sql,
      });
      out[key] = r.ok ? (await r.json()).data : [];
      if (!r.ok) out.errors = [...(out.errors || []), key + ": " + (await r.text()).slice(0, 200)];
    }));
    try { out.connections = await this.connections(); } catch (e) { out.connections = []; (out.errors ||= []).push("connections: " + e.message); }
    // connections: archived days under the live ~31 days
    const live = new Set(out.connections.map((c) => c.day));
    out.archive = [...(await this.state.storage.list({ prefix: "day:" }))].map(([k, v]) => ({ day: k.slice(4), ...v }));
    for (const a of out.archive) if (a.connections != null && !live.has(a.day)) out.connections.push({ day: a.day, requests: a.connections, peak: a.cfPeak || 0 });
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  }

  // ---- message wall ----
  async notes(req) {
    const url = new URL(req.url);
    const ip = req.headers.get("CF-Connecting-IP") || "local";
    const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const del = url.pathname.replace("%3A", ":").match(/^\/api\/notes\/(note:\d{15}-[a-z0-9]{6})$/);
    if (req.method === "GET" && url.pathname === "/api/notes") {
      const before = /^note:\d{15}-[a-z0-9]{6}$/.test(url.searchParams.get("before") || "") ? url.searchParams.get("before") : null;
      const page = await this.state.storage.list({ prefix: "note:", reverse: true, limit: NOTES_PAGE + 1, ...(before && { end: before }) });
      const owner = await ownerOf(req.headers.get("X-Wall-Key"));
      const notes = [...page].slice(0, NOTES_PAGE).map(([id, n]) => shown(id, n, owner));
      return json({ notes, more: page.size > NOTES_PAGE, total: await this.noteCount() });
    }
    if (req.method === "POST" && url.pathname === "/api/notes") {
      // the body is read before any check, so nothing awaits between the rate check and its write
      // (two requests at once from one IP can't both pass)
      const bytes = req.headers.get("Content-Length");
      if (!bytes || !(Number(bytes) <= NOTE_BYTES)) return json({ error: "note too long" }, 413);
      let m;
      try { m = JSON.parse(await req.text()); } catch { return json({ error: "bad request" }, 400); }
      const raw = cleanNote(m?.text);
      if (!raw) return json({ error: "write something first" }, 400);
      if (hasLink(raw)) return json({ error: "links are not allowed on the wall" }, 400);
      const text = cleanChat(raw);
      if (text === null) return json({ error: "note blocked" }, 400);
      let name = cleanText(m.name, 16) || "trainer";
      if (badName(name) || /admin|moderador|moderator|staff/.test(normalize(name))) name = "trainer";
      const at = Date.now();
      const lastKey = "note-at:" + ip;
      const [ban, last, count] = await Promise.all([this.state.storage.get("ban:" + ip), this.state.storage.get(lastKey), this.noteCount()]);
      if (ban > at) return json({ error: "you are banned" }, 403);
      const wait = (last || 0) + NOTE_EVERY_MS - at;
      if (wait > 0) return json({ error: `wait ${Math.ceil(wait / 1000)} s for the next note` }, 429);
      const owner = await ownerOf(m.key);
      const note = { name, gender: gender(m.gender), text, at, color: NOTE_COLORS.includes(m.color) ? m.color : "cream", ...(owner && { owner }) };
      const id = `note:${String(at).padStart(15, "0")}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
      await this.state.storage.put({ [id]: note, [lastKey]: at, "note-count": count + 1 });
      this.broadcast({ t: "note", note: shown(id, note), total: count + 1 });
      return json({ note: shown(id, note, owner), total: count + 1 });
    }
    // the writer edits their own note: same cleaning as a new one, and a short wait between edits
    if (req.method === "PATCH" && del) {
      const bytes = req.headers.get("Content-Length");
      if (!bytes || !(Number(bytes) <= NOTE_BYTES)) return json({ error: "note too long" }, 413);
      let m;
      try { m = JSON.parse(await req.text()); } catch { return json({ error: "bad request" }, 400); }
      const owner = await ownerOf(m?.key);
      const raw = cleanNote(m?.text);
      if (!raw) return json({ error: "write something first" }, 400);
      if (hasLink(raw)) return json({ error: "links are not allowed on the wall" }, 400);
      const text = cleanChat(raw);
      if (text === null) return json({ error: "note blocked" }, 400);
      const now = Date.now();
      const [ban, note] = await Promise.all([this.state.storage.get("ban:" + ip), this.state.storage.get(del[1])]);
      if (ban > now) return json({ error: "you are banned" }, 403);
      if (!note) return json({ error: "this note is gone" }, 404);
      if (!owner || !note.owner || !equal(owner, note.owner)) return json({ error: "this note is not yours" }, 403);
      const wait = (this.noteEdits.get(ip) || 0) + NOTE_EDIT_EVERY_MS - now;
      if (wait > 0) return json({ error: `wait ${Math.ceil(wait / 1000)} s to edit again` }, 429);
      this.noteEdits.set(ip, now);
      const edited = { ...note, text, color: NOTE_COLORS.includes(m.color) ? m.color : note.color, edited: now };
      await this.state.storage.put(del[1], edited);
      this.broadcast({ t: "note-edit", note: shown(del[1], edited) });
      return json({ note: shown(del[1], edited, owner) });
    }
    // Notes from before wall keys existed belong to nobody. The admin can take one (it becomes theirs to edit):
    // the only way left to tell whose it was is to ask, and the admin is who gets asked.
    const claim = url.pathname.replace("%3A", ":").match(/^\/api\/notes\/(note:\d{15}-[a-z0-9]{6})\/claim$/);
    if (req.method === "POST" && claim) {
      const check = await this.checkAdmin(ip, (req.headers.get("Authorization") || "").replace(/^Bearer /, ""));
      if (!check.ok) return json({ error: check.msg }, 401);
      const owner = await ownerOf(req.headers.get("X-Wall-Key"));
      const note = await this.state.storage.get(claim[1]);
      if (!note) return json({ error: "this note is gone" }, 404);
      if (!owner) return json({ error: "bad request" }, 400);
      if (note.owner) return json({ error: "this note already has an owner" }, 409);
      await this.state.storage.put(claim[1], { ...note, owner });
      return json({ note: shown(claim[1], { ...note, owner }, owner) });
    }
    if (req.method === "DELETE" && del) {
      // the writer (their wall key) or the admin (password, same lockout as everywhere)
      const owner = await ownerOf(req.headers.get("X-Wall-Key"));
      const note = owner && (await this.state.storage.get(del[1]));
      if (!(note?.owner && equal(owner, note.owner))) {
        if (owner && !req.headers.get("Authorization")) return json({ error: "this note is not yours" }, 403);
        const check = await this.checkAdmin(ip, (req.headers.get("Authorization") || "").replace(/^Bearer /, ""));
        if (!check.ok) return json({ error: check.msg }, 401);
      }
      let total = await this.noteCount();
      if (await this.state.storage.delete(del[1])) await this.state.storage.put("note-count", (total = Math.max(0, total - 1)));
      this.broadcast({ t: "note-del", id: del[1], total });
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }
  // how many notes the wall holds (kept beside them, so nobody has to list them all)
  async noteCount() {
    let n = await this.state.storage.get("note-count");
    if (n == null) await this.state.storage.put("note-count", (n = (await this.state.storage.list({ prefix: "note:" })).size));
    return n;
  }

  async sql(query) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
      method: "POST", headers: { Authorization: `Bearer ${this.env.CF_API_TOKEN}` }, body: query,
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
    return (await r.json()).data;
  }

  async connections() {
    const since = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: CONNECTIONS_QUERY, variables: { account: this.env.CF_ACCOUNT_ID, since } }),
    });
    const body = await r.json();
    if (body.errors?.length) throw new Error(body.errors[0].message.slice(0, 200));
    const acc = body.data.viewer.accounts[0];
    const days = new Map();
    for (const x of acc.workersInvocationsAdaptive) days.set(x.dimensions.date, { day: x.dimensions.date, requests: x.sum.requests, peak: 0 });
    for (const x of acc.durableObjectsPeriodicGroups) {
      const d = days.get(x.dimensions.date) || { day: x.dimensions.date, requests: 0, peak: 0 };
      d.peak = Math.max(d.peak, x.max.activeWebsocketConnections);
      days.set(d.day, d);
    }
    return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  // daily cron: keep every finished day (of the last 80) in storage, forever
  async archive() {
    // the wall's "last note" marks are only needed for a minute: don't keep IPs around
    const marks = await this.state.storage.list({ prefix: "note-at:" });
    const stale = [...marks].filter(([, at]) => at < Date.now() - NOTE_EVERY_MS).map(([k]) => k);
    for (let i = 0; i < stale.length; i += 128) await this.state.storage.delete(stale.slice(i, i + 128));
    if (!this.env.CF_ACCOUNT_ID || !this.env.CF_API_TOKEN) return;
    // Cloudflare's own count only goes ~31 days back, so it is archived too
    const today = new Date().toISOString().slice(0, 10);
    for (const c of await this.connections().catch(() => [])) {
      if (c.day >= today) continue;
      const key = "day:" + c.day;
      const saved = (await this.state.storage.get(key)) || {};
      if (saved.connections == null) await this.state.storage.put(key, { ...saved, connections: c.requests, cfPeak: c.peak });
    }
    for (let i = 80; i >= 1; i--) {
      const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const saved = (await this.state.storage.get("day:" + day)) || {};
      if (saved.joins != null) continue;
      const rows = await this.sql(dayQuery(day));
      if (!rows.length) continue;
      const by = Object.fromEntries(rows.map((r) => [r.event, r]));
      const joins = Number(by.join?.n || 0), leaves = Number(by.leave?.n || 0);
      await this.state.storage.put("day:" + day, {
        ...saved, joins, visitors: Number(by.join?.visitors || 0), peak: Number(by.join?.peak || 0),
        avgSeconds: leaves ? Number(by.leave.seconds) / leaves : 0, messages: Number(by.chat?.n || 0),
      });
    }
  }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/api/stats") return this.stats(req);
    if (path.startsWith("/api/notes")) return this.notes(req);
    if (path === "/internal/archive") { await this.archive(); return new Response("ok"); }
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    if (this.state.getWebSockets().length >= MAX_PLAYERS) return new Response("room is full", { status: 503 });
    const ip = req.headers.get("CF-Connecting-IP") || "local";
    const ban = await this.state.storage.get("ban:" + ip);
    if (ban > Date.now()) return new Response("banned", { status: 403 });
    const sameIp = this.state.getWebSockets().filter((w) => w.deserializeAttachment()?.ip === ip).length;
    if (sameIp >= MAX_PER_IP) return new Response("too many connections", { status: 429 });

    const [client, server] = Object.values(new WebSocketPair());
    const id = crypto.randomUUID().slice(0, 8);
    // hibernation: the DO can sleep with connections open; each player's
    // state lives on its own socket (serializeAttachment)
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id, name: "trainer", gender: "male", x: 0, z: 0, dir: "down", step: 0, seat: -1, ip,
      country: String(req.cf?.country || "").slice(0, 2), visitor: await visitorOf(ip) });
    // v: the deploy that is running. A tab that reconnects and sees another one reloads itself.
    server.send(JSON.stringify({ t: "you", id, v: this.env.VERSION?.id || "" }));
    const radio = await this.state.storage.get("radio");
    if (radio) server.send(JSON.stringify({ t: "radio", command: radio }));
    const messages = await this.history();
    if (messages.length) server.send(JSON.stringify({ t: "history", messages }));
    server.send(JSON.stringify({ t: "state", players: this.players().filter((p) => p.id !== id) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // only each player's public fields (never the IP)
  public(p) {
    return { id: p.id, name: p.name, gender: p.gender, x: p.x, z: p.z, dir: p.dir, step: p.step, seat: p.seat ?? -1, hold: p.hold | 0, admin: !!p.admin };
  }
  players() {
    return this.state.getWebSockets().map((ws) => ws.deserializeAttachment()).filter(Boolean).map((p) => this.public(p));
  }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(s); } catch {}
    }
  }

  // rate limit (token bucket): movement and seats per connection, chat and the rest shared by everyone on one IP
  allowed(p, type) {
    const [cap, refill] = RATES[type] || RATES.other;
    const key = (type === "pos" || type === "sit" ? p.id : p.ip) + "|" + type;
    const now = Date.now() / 1000;
    let k = this.buckets.get(key);
    if (!k) this.buckets.set(key, (k = { tokens: cap, at: now }));
    k.tokens = Math.min(cap, k.tokens + (now - k.at) * refill);
    k.at = now;
    if (k.tokens < 1) return false;
    k.tokens -= 1;
    return true;
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_BYTES) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    const p = ws.deserializeAttachment();
    if (!p) return;
    const type = m.t === "pos" ? "pos" : m.t === "chat" ? "chat" : m.t === "sit" ? "sit" : "other";
    // the seat the room really has for this player, tagged with the request it answers
    const seatReply = () => ws.send(JSON.stringify({ t: "seat", id: p.id, seat: p.seat ?? -1, n: Number.isSafeInteger(m.n) ? m.n : 0 }));
    if (!this.allowed(p, type)) {
      if (type === "chat") this.strike(ws, p.ip);
      // a dropped sit would leave the client and the room disagreeing: tell it where it really is
      if (type === "sit") seatReply();
      return;
    }

    if (m.t === "hello") {
      // A tab opened before the self-reload existed doesn't know `v`. The only thing that makes it
      // reload is the answer to an admin login, so it gets that once and comes back as a new tab.
      // (It only clears a password saved in that tab; no admin right is given.)
      if (m.v !== 1) return void ws.send(JSON.stringify({ t: "admin-ok" }));
      p.name = this.nameFor(ws, m.name);
      p.gender = gender(m.gender);
      // where the player already is (a reconnect, or a saved spot), so others see them there at once
      p.x = number(m.x);
      p.z = number(m.z);
      p.dir = DIRS.includes(m.dir) ? m.dir : "down";
      const first = !p.joinedAt;
      if (first) p.joinedAt = Date.now();
      ws.serializeAttachment(p);
      if (first) this.stat("join", p);
      this.broadcast({ t: "joined", player: this.public(p) }, ws);
      await this.rememberName(p);
    } else if (m.t === "gender") {
      p.gender = gender(m.gender);
      ws.serializeAttachment(p);
      this.broadcast({ t: "gender", id: p.id, gender: p.gender }, ws);
    } else if (m.t === "name") {
      p.name = this.nameFor(ws, m.name);
      ws.serializeAttachment(p);
      this.broadcast({ t: "name", id: p.id, name: p.name }, ws);
      await this.rememberName(p);
    } else if (m.t === "pos") {
      p.x = number(m.x);
      p.z = number(m.z);
      p.dir = DIRS.includes(m.dir) ? m.dir : "down";
      p.step = Math.abs(m.step | 0) % 4;
      ws.serializeAttachment(p);
      this.broadcast({ t: "pos", id: p.id, x: p.x, z: p.z, dir: p.dir, step: p.step }, ws);
    } else if (m.t === "sit") {
      // one player per seat; -1 stands up. A taken seat is refused back to the sender only,
      // with the seat the room really has for them
      const seat = Number.isInteger(m.seat) && m.seat >= 0 && m.seat < MAX_SEATS ? m.seat : -1;
      if (seat >= 0 && this.players().some((q) => q.id !== p.id && q.seat === seat)) {
        seatReply();
        return;
      }
      p.seat = seat;
      ws.serializeAttachment(p);
      // not back to the sender: it already moved, and a late echo would undo a quick sit/stand
      this.broadcast({ t: "seat", id: p.id, seat }, ws);
    } else if (m.t === "hold") {
      // what the player holds on a bench; the client only draws it on someone seated
      p.hold = [1, 2, 3].includes(m.item) ? m.item : 0;
      ws.serializeAttachment(p);
      this.broadcast({ t: "hold", id: p.id, item: p.hold }, ws);
    } else if (m.t === "auth") {
      if (!(await this.isAdmin(ws, p, m.password))) return;
      // everyone sees who the admin is (badge over the name, colour in the chat)
      p.admin = true;
      ws.serializeAttachment(p);
      this.broadcast({ t: "admin", id: p.id });
      if (!m.quiet) ws.send(JSON.stringify({ t: "admin-ok" }));
    } else if (m.t === "who") {
      if (!(await this.isAdmin(ws, p, m.password))) return;
      const all = this.state.getWebSockets().map((w) => w.deserializeAttachment()).filter(Boolean);
      const target = all.find((q) => q.id === cleanText(m.id, 16));
      if (!target) return;
      const tag = await this.tagOf(target.ip);
      const names = (await this.namesOf(tag)).map((n) => n.name).filter((n) => n !== target.name);
      const sameTag = all.filter((q) => q.ip === target.ip && q.id !== target.id).map((q) => q.name);
      ws.send(JSON.stringify({ t: "who", id: target.id, tag, names, sameTag }));
    } else if (m.t === "mod") {
      if (!(await this.isAdmin(ws, p, m.password))) return;
      await this.moderate(ws, m.action, cleanText(m.id, 16));
    } else if (m.t === "radio") {
      if (!(await this.isAdmin(ws, p, m.password))) return;
      const command = { idx: Math.max(0, Math.min(999, m.idx | 0)), at: Date.now() };
      await this.state.storage.put("radio", command);
      this.broadcast({ t: "radio", command });
    } else if (m.t === "chat") {
      const text = cleanChat(cleanText(m.text, 140));
      if (text === null) return void ws.send(JSON.stringify({ t: "error", msg: "message blocked" }));
      if (!text) return;
      const now = Date.now();
      const s = this.spamOf(p.ip, now);
      if (s.mutedUntil > now) return this.tellMuted(ws, s.mutedUntil);
      s.repeats = text === s.lastText && now - s.lastAt < REPEAT_WINDOW_MS ? s.repeats + 1 : 1;
      if (s.repeats > REPEAT_LIMIT) return this.strike(ws, p.ip);
      s.lastText = text;
      s.lastAt = now;
      const msg = { id: p.id, name: p.name, text, at: now, ...(p.admin && { admin: true }) };
      this.broadcast({ t: "chat", ...msg });
      this.stat("chat", p);
      await this.saveHistory([...(await this.history()), msg]);
    }
  }

  // a refused name becomes a random trainer name, and the player is told so it shows the same
  nameFor(ws, raw) {
    const name = cleanText(raw, 16) || "trainer";
    // nobody can pose as staff by name: the real admin is shown by the badge
    const staff = /admin|moderador|moderator|staff/.test(normalize(name));
    if (!badName(name) && !staff) return name;
    const fallback = "trainer" + Math.floor(Math.random() * 900 + 100);
    try { ws.send(JSON.stringify({ t: "rename", name: fallback, msg: "that name is not allowed" })); } catch {}
    return fallback;
  }

  // failures counted per IP in storage, so reconnecting doesn't reset them
  async isAdmin(ws, p, password) {
    const check = await this.checkAdmin(p.ip, password);
    if (!check.ok) ws.send(JSON.stringify({ t: "error", msg: check.msg }));
    return check.ok;
  }
  async checkAdmin(ip, password) {
    // bump the "v3" prefix to drop every stored lock
    const lockKey = "admin-fail-v3:" + ip;
    const lock = (await this.state.storage.get(lockKey)) || { fails: 0, until: 0 };
    if (lock.until > Date.now()) return { ok: false, msg: "admin locked, try later" };
    if (!this.env.ADMIN_PASSWORD || typeof password !== "string" || !equal(password, this.env.ADMIN_PASSWORD)) {
      lock.fails = lock.until ? 1 : lock.fails + 1; // a finished lock starts over
      lock.until = lock.fails >= ADMIN_ATTEMPTS ? Date.now() + ADMIN_LOCK_MS : 0;
      if (lock.until) lock.fails = 0;
      await this.state.storage.put(lockKey, lock);
      return { ok: false, msg: "invalid admin password" };
    }
    await this.state.storage.delete(lockKey);
    return { ok: true };
  }

  // kick / ban a player by id: everyone on that player's IP loses the room
  async moderate(adminWs, action, id) {
    const tell = (msg) => adminWs.send(JSON.stringify({ t: "notice", msg }));
    if (action === "unban") {
      const bans = await this.state.storage.list({ prefix: "ban:" });
      await this.state.storage.delete([...bans.keys()]);
      return tell(`unbanned ${bans.size}`);
    }
    if (action !== "kick" && action !== "ban") return;
    const sockets = this.state.getWebSockets();
    const target = sockets.map((w) => w.deserializeAttachment()).find((p) => p?.id === id);
    if (!target || adminWs.deserializeAttachment()?.id === id) return tell("that player already left");
    const name = target.name;
    const ips = new Set([target.ip]);
    // a banned player's messages leave the history too
    const gone = new Set(sockets.map((w) => w.deserializeAttachment()).filter((q) => q && ips.has(q.ip)).map((q) => q.id));
    await this.saveHistory((await this.history()).filter((m) => !gone.has(m.id)));
    const until = Date.now() + (action === "ban" ? BAN_MS : KICK_MS);
    for (const ip of ips) await this.state.storage.put("ban:" + ip, until);
    const msg = action === "ban" ? "you were banned from the room" : "you were kicked, come back later";
    for (const w of sockets) {
      if (w === adminWs || !ips.has(w.deserializeAttachment()?.ip)) continue;
      try { w.send(JSON.stringify({ t: "kicked", msg })); w.close(4003, action); } catch {}
      this.leave(w);
    }
    tell(`${action === "ban" ? "banned" : "kicked"} ${name}`);
  }

  // short, stable tag for an IP: HMAC with a random key kept in this room's storage, so it can't
  // be turned back into the IP or recomputed by anyone else
  async tagOf(ip) {
    if (!this.tagKey) {
      let raw = await this.state.storage.get("tag-key");
      if (!raw) await this.state.storage.put("tag-key", (raw = [...crypto.getRandomValues(new Uint8Array(32))]));
      this.tagKey = await crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    }
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", this.tagKey, new TextEncoder().encode(ip)));
    return [...sig.slice(0, 2)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async namesOf(tag) {
    const all = (await this.state.storage.get("names:" + tag)) || [];
    return all.filter((n) => n.at > Date.now() - NAMES_MS);
  }
  async rememberName(p) {
    const tag = await this.tagOf(p.ip);
    const names = (await this.namesOf(tag)).filter((n) => n.name !== p.name);
    await this.state.storage.put("names:" + tag, [...names, { name: p.name, at: Date.now() }].slice(-NAMES_KEEP));
  }

  // kept in storage so it survives the object sleeping (hibernation)
  async history() {
    const all = (await this.state.storage.get("chat")) || [];
    return all.filter((m) => m.at > Date.now() - HISTORY_MS);
  }
  async saveHistory(messages) {
    await this.state.storage.put("chat", messages.slice(-HISTORY_SIZE));
  }

  spamOf(ip, now) {
    let s = this.spam.get(ip);
    if (!s) this.spam.set(ip, (s = { strikes: 0, mutedUntil: 0, lastStrike: 0, lastText: "", lastAt: 0, repeats: 0 }));
    if (s.strikes && now - s.lastStrike > STRIKE_RESET_MS) s.strikes = 0;
    return s;
  }
  // a spam strike: mute this IP, longer each time
  strike(ws, ip) {
    const now = Date.now();
    const s = this.spamOf(ip, now);
    if (s.mutedUntil > now) return; // already muted; don't stack while muted
    const ms = MUTE_STEPS_MS[Math.min(s.strikes, MUTE_STEPS_MS.length - 1)];
    s.strikes++;
    s.lastStrike = now;
    s.mutedUntil = now + ms;
    if (!ms) {
      try { ws.send(JSON.stringify({ t: "error", msg: "slow down, next time you get muted" })); } catch {}
      return;
    }
    this.tellMuted(ws, s.mutedUntil);
  }
  tellMuted(ws, until) {
    const secs = Math.ceil((until - Date.now()) / 1000);
    const wait = secs >= 60 ? Math.ceil(secs / 60) + " min" : secs + " s";
    try { ws.send(JSON.stringify({ t: "error", msg: `muted for spam, ${wait} left` })); } catch {}
  }

  async webSocketClose(ws) { this.leave(ws); }
  async webSocketError(ws) { this.leave(ws); }
  leave(ws) {
    const p = ws.deserializeAttachment();
    if (!p) return;
    if (p.joinedAt) this.stat("leave", p, [Math.round((Date.now() - p.joinedAt) / 1000)]);
    for (const k of this.buckets.keys()) if (k.startsWith(p.id + "|")) this.buckets.delete(k);
    this.broadcast({ t: "left", id: p.id }, ws);
  }
}

export default {
  // once a day: archive yesterday's numbers in the room's storage (see Room.archive)
  async scheduled(event, env) {
    await env.ROOM.get(env.ROOM.idFromName(ROOMS[0])).fetch("https://room/internal/archive");
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    // stats: the room's Durable Object checks the admin password (same lockout as the game)
    if (url.pathname === "/api/stats") {
      if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
      return env.ROOM.get(env.ROOM.idFromName(ROOMS[0])).fetch(req);
    }
    // message wall: writes only from the site itself (same origin check as the WebSocket)
    if (url.pathname === "/api/notes" || url.pathname.startsWith("/api/notes/")) {
      if (req.method !== "GET") {
        const origin = req.headers.get("Origin");
        const ok = [url.origin, ...(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)];
        if (!origin || !ok.includes(origin)) return new Response("origin not allowed", { status: 403 });
      }
      return env.ROOM.get(env.ROOM.idFromName(ROOMS[0])).fetch(req);
    }
    // /ws/<room>  ->  that room's Durable Object. Everything else is the static site (assets).
    const m = url.pathname.match(/^\/ws\/([a-z0-9-]{1,32})$/i);
    if (!m) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("lofi-lobby", { status: 404 });
    if (!ROOMS.includes(m[1].toLowerCase())) return new Response("unknown room", { status: 404 });

    // only accept connections from the site itself (or origins listed in ALLOWED_ORIGINS)
    const origin = req.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    allowed.push(url.origin);
    if (!origin || !allowed.includes(origin)) return new Response("origin not allowed", { status: 403 });

    const stub = env.ROOM.get(env.ROOM.idFromName(m[1].toLowerCase()));
    return stub.fetch(req);
  },
};
