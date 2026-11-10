// Room server: one Durable Object per room, everyone connected over WebSocket.
// Protocol (JSON):
//   client -> server: { t: "hello", name, gender } | { t: "pos", x, z, dir, step }
//                     { t: "chat", text } | { t: "name", name } | { t: "gender", gender }
//                     { t: "radio", idx, password }   (admin)
//   server -> client: { t: "you", id } | { t: "state", players: [...] }
//                     { t: "joined", player } | { t: "left", id } | { t: "pos", ... }
//                     { t: "chat", id, name, text, at } | { t: "name", id, name }
//                     { t: "gender", id, gender } | { t: "radio", command } | { t: "error", msg }
//
// Security (the client is public, so nothing coming from it is trusted):
//  - max message size, per-connection rate limit, max players per room
//  - admin password only on the server (ADMIN_PASSWORD secret), constant-time compare,
//    few attempts per connection
//  - allowed origins (ALLOWED_ORIGINS) so other sites can't use this server
//  - all text is stripped of control characters and truncated; numbers finite and clamped

const MAX_PLAYERS = 40;
const MAX_BYTES = 1024;
const COORD_LIMIT = 500;
const ADMIN_ATTEMPTS = 5;
// rate buckets: capacity, refill per second
const RATES = { pos: [30, 20], chat: [5, 0.5], other: [10, 1] };

const DIRS = ["down", "up", "left", "right"];
const cleanText = (s, max) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.buckets = new WeakMap(); // ws -> { type: { tokens, at } } (in memory; resets on hibernation)
  }

  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    if (this.state.getWebSockets().length >= MAX_PLAYERS) return new Response("room is full", { status: 503 });

    const [client, server] = Object.values(new WebSocketPair());
    const id = crypto.randomUUID().slice(0, 8);
    // hibernation: the DO can sleep with connections open; each player's
    // state lives on its own socket (serializeAttachment)
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id, name: "trainer", gender: "male", x: 0, z: 0, dir: "down", step: 0, adminFailures: 0 });
    server.send(JSON.stringify({ t: "you", id }));
    const radio = await this.state.storage.get("radio");
    if (radio) server.send(JSON.stringify({ t: "radio", command: radio }));
    server.send(JSON.stringify({ t: "state", players: this.players().filter((p) => p.id !== id) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // only each player's public fields (never adminFailures etc.)
  public(p) {
    return { id: p.id, name: p.name, gender: p.gender, x: p.x, z: p.z, dir: p.dir, step: p.step };
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

  // rate limit (token bucket) per connection and per message type
  allowed(ws, type) {
    const [cap, refill] = RATES[type] || RATES.other;
    let b = this.buckets.get(ws);
    if (!b) this.buckets.set(ws, (b = {}));
    const now = Date.now() / 1000;
    const k = (b[type] ??= { tokens: cap, at: now });
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
    const type = m.t === "pos" ? "pos" : m.t === "chat" ? "chat" : "other";
    if (!this.allowed(ws, type)) return;

    if (m.t === "hello") {
      p.name = cleanText(m.name, 16) || "trainer";
      p.gender = gender(m.gender);
      ws.serializeAttachment(p);
      this.broadcast({ t: "joined", player: this.public(p) }, ws);
    } else if (m.t === "gender") {
      p.gender = gender(m.gender);
      ws.serializeAttachment(p);
      this.broadcast({ t: "gender", id: p.id, gender: p.gender }, ws);
    } else if (m.t === "name") {
      p.name = cleanText(m.name, 16) || "trainer";
      ws.serializeAttachment(p);
      this.broadcast({ t: "name", id: p.id, name: p.name }, ws);
    } else if (m.t === "pos") {
      p.x = number(m.x);
      p.z = number(m.z);
      p.dir = DIRS.includes(m.dir) ? m.dir : "down";
      p.step = Math.abs(m.step | 0) % 4;
      ws.serializeAttachment(p);
      this.broadcast({ t: "pos", id: p.id, x: p.x, z: p.z, dir: p.dir, step: p.step }, ws);
    } else if (m.t === "radio") {
      if (p.adminFailures >= ADMIN_ATTEMPTS) return; // locked out on this connection
      if (!this.env.ADMIN_PASSWORD || typeof m.password !== "string" || !equal(m.password, this.env.ADMIN_PASSWORD)) {
        p.adminFailures++;
        ws.serializeAttachment(p);
        ws.send(JSON.stringify({ t: "error", msg: "invalid admin password" }));
        return;
      }
      const command = { idx: Math.max(0, Math.min(999, m.idx | 0)), at: Date.now() };
      await this.state.storage.put("radio", command);
      this.broadcast({ t: "radio", command });
    } else if (m.t === "chat") {
      const text = cleanText(m.text, 140);
      if (text) this.broadcast({ t: "chat", id: p.id, name: p.name, text, at: Date.now() });
    }
  }

  async webSocketClose(ws) { this.leave(ws); }
  async webSocketError(ws) { this.leave(ws); }
  leave(ws) {
    const p = ws.deserializeAttachment();
    if (p) this.broadcast({ t: "left", id: p.id }, ws);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // /ws/<room>  ->  that room's Durable Object. Everything else is the static site (assets).
    const m = url.pathname.match(/^\/ws\/([a-z0-9-]{1,32})$/i);
    if (!m) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("lofi-lobby", { status: 404 });

    // only accept connections from the site itself (or origins listed in ALLOWED_ORIGINS)
    const origin = req.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    allowed.push(url.origin);
    if (!origin || !allowed.includes(origin)) return new Response("origin not allowed", { status: 403 });

    const stub = env.ROOM.get(env.ROOM.idFromName(m[1].toLowerCase()));
    return stub.fetch(req);
  },
};
