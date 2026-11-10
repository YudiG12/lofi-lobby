// Servidor da sala: um Durable Object por sala, todo mundo conectado por WebSocket.
// Protocolo (JSON):
//   cliente -> servidor: { t: "ola", nome, genero } | { t: "pos", x, z, dir, passo }
//                        { t: "chat", texto } | { t: "nome", nome } | { t: "genero", genero }
//                        { t: "radio", idx, senha }   (admin)
//   servidor -> cliente: { t: "voce", id } | { t: "estado", jogadores: [...] }
//                        { t: "entrou", jogador } | { t: "saiu", id } | { t: "pos", ... }
//                        { t: "chat", id, nome, texto, em } | { t: "nome", id, nome }
//                        { t: "genero", id, genero } | { t: "radio", comando } | { t: "erro", msg }
//
// Segurança (o cliente é público, então nada que vem dele é confiável):
//  - tamanho máximo de mensagem, limite de taxa por conexão, limite de jogadores por sala
//  - senha de admin só no servidor (segredo ADMIN_PASSWORD), comparação em tempo constante,
//    poucas tentativas por conexão
//  - origens permitidas (ALLOWED_ORIGINS) pra outro site não usar este servidor
//  - todo texto é limpo de caracteres de controle e cortado; números só finitos e limitados

const MAX_JOGADORES = 40;
const MAX_BYTES = 1024;
const LIMITE_COORD = 500;
const TENTATIVAS_ADMIN = 5;
// baldes de taxa: capacidade, recarga por segundo
const TAXAS = { pos: [30, 20], chat: [5, 0.5], outro: [10, 1] };

const DIRS = ["baixo", "cima", "esquerda", "direita"];
const limparTexto = (s, max) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-LIMITE_COORD, Math.min(LIMITE_COORD, n)) : 0;
};
const genero = (g) => (g === "feminino" ? "feminino" : "masculino");

// comparação em tempo constante (não vaza, pelo tempo, quantos caracteres batem)
function iguais(a, b) {
  const ea = new TextEncoder().encode(String(a));
  const eb = new TextEncoder().encode(String(b));
  let dif = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) dif |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return dif === 0;
}

export class Sala {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.baldes = new WeakMap(); // ws -> { tipo: { fichas, em } } (em memória; zera se hibernar)
  }

  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    if (this.state.getWebSockets().length >= MAX_JOGADORES) return new Response("room is full", { status: 503 });

    const [cliente, servidor] = Object.values(new WebSocketPair());
    const id = crypto.randomUUID().slice(0, 8);
    // hibernação: o DO pode dormir com as conexões abertas; o estado de cada
    // jogador fica preso no próprio socket (serializeAttachment)
    this.state.acceptWebSocket(servidor);
    servidor.serializeAttachment({ id, nome: "trainer", genero: "masculino", x: 0, z: 0, dir: "baixo", passo: 0, falhasAdmin: 0 });
    servidor.send(JSON.stringify({ t: "voce", id }));
    const radio = await this.state.storage.get("radio");
    if (radio) servidor.send(JSON.stringify({ t: "radio", comando: radio }));
    servidor.send(JSON.stringify({ t: "estado", jogadores: this.jogadores().filter((j) => j.id !== id) }));
    return new Response(null, { status: 101, webSocket: cliente });
  }

  // só os campos públicos de cada jogador (nunca falhasAdmin etc.)
  publico(j) {
    return { id: j.id, nome: j.nome, genero: j.genero, x: j.x, z: j.z, dir: j.dir, passo: j.passo };
  }
  jogadores() {
    return this.state.getWebSockets().map((ws) => ws.deserializeAttachment()).filter(Boolean).map((j) => this.publico(j));
  }

  enviarTodos(msg, exceto) {
    const s = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === exceto) continue;
      try { ws.send(s); } catch {}
    }
  }

  // limite de taxa (token bucket) por conexão e por tipo de mensagem
  permitido(ws, tipo) {
    const [cap, recarga] = TAXAS[tipo] || TAXAS.outro;
    let b = this.baldes.get(ws);
    if (!b) this.baldes.set(ws, (b = {}));
    const agora = Date.now() / 1000;
    const k = (b[tipo] ??= { fichas: cap, em: agora });
    k.fichas = Math.min(cap, k.fichas + (agora - k.em) * recarga);
    k.em = agora;
    if (k.fichas < 1) return false;
    k.fichas -= 1;
    return true;
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_BYTES) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    const j = ws.deserializeAttachment();
    if (!j) return;
    const tipo = m.t === "pos" ? "pos" : m.t === "chat" ? "chat" : "outro";
    if (!this.permitido(ws, tipo)) return;

    if (m.t === "ola") {
      j.nome = limparTexto(m.nome, 16) || "trainer";
      j.genero = genero(m.genero);
      ws.serializeAttachment(j);
      this.enviarTodos({ t: "entrou", jogador: this.publico(j) }, ws);
    } else if (m.t === "genero") {
      j.genero = genero(m.genero);
      ws.serializeAttachment(j);
      this.enviarTodos({ t: "genero", id: j.id, genero: j.genero }, ws);
    } else if (m.t === "nome") {
      j.nome = limparTexto(m.nome, 16) || "trainer";
      ws.serializeAttachment(j);
      this.enviarTodos({ t: "nome", id: j.id, nome: j.nome }, ws);
    } else if (m.t === "pos") {
      j.x = numero(m.x);
      j.z = numero(m.z);
      j.dir = DIRS.includes(m.dir) ? m.dir : "baixo";
      j.passo = Math.abs(m.passo | 0) % 4;
      ws.serializeAttachment(j);
      this.enviarTodos({ t: "pos", id: j.id, x: j.x, z: j.z, dir: j.dir, passo: j.passo }, ws);
    } else if (m.t === "radio") {
      if (j.falhasAdmin >= TENTATIVAS_ADMIN) return; // bloqueado nesta conexão
      if (!this.env.ADMIN_PASSWORD || typeof m.senha !== "string" || !iguais(m.senha, this.env.ADMIN_PASSWORD)) {
        j.falhasAdmin++;
        ws.serializeAttachment(j);
        ws.send(JSON.stringify({ t: "erro", msg: "invalid admin password" }));
        return;
      }
      const comando = { idx: Math.max(0, Math.min(999, m.idx | 0)), em: Date.now() };
      await this.state.storage.put("radio", comando);
      this.enviarTodos({ t: "radio", comando });
    } else if (m.t === "chat") {
      const texto = limparTexto(m.texto, 140);
      if (texto) this.enviarTodos({ t: "chat", id: j.id, nome: j.nome, texto, em: Date.now() });
    }
  }

  async webSocketClose(ws) { this.sair(ws); }
  async webSocketError(ws) { this.sair(ws); }
  sair(ws) {
    const j = ws.deserializeAttachment();
    if (j) this.enviarTodos({ t: "saiu", id: j.id }, ws);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // /ws/<sala>  ->  Durable Object daquela sala. O resto é o site estático (assets).
    const m = url.pathname.match(/^\/ws\/([a-z0-9-]{1,32})$/i);
    if (!m) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("sala-lofi", { status: 404 });

    // só aceita conexão vinda do próprio site (ou das origens listadas em ALLOWED_ORIGINS)
    const origem = req.headers.get("Origin");
    const permitidas = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    permitidas.push(url.origin);
    if (!origem || !permitidas.includes(origem)) return new Response("origin not allowed", { status: 403 });

    const stub = env.SALA.get(env.SALA.idFromName(m[1].toLowerCase()));
    return stub.fetch(req);
  },
};
