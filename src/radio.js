// Rádio da sala: o SISTEMA controla a faixa e a posição; a pausa é só local.
// Todo mundo ouve o mesmo trecho: a posição é calculada pelo relógio a partir
// de uma data fixa, percorrendo a lista em loop. Quando o multiplayer entrar,
// o Durable Object da sala passa a ser a fonte desse "início".

export const LISTA = [
  "ZWIJiNeMigM",
  // adicione outros IDs do YouTube aqui
];

const INICIO = Date.UTC(2026, 0, 1); // marco zero da rádio
const duracoes = {}; // id -> segundos (descobre ao carregar cada vídeo)

let player = null;
let tocandoIdx = -1;
let pausado = false;

function carregarApi() {
  return new Promise((ok) => {
    if (window.YT?.Player) return ok();
    window.onYouTubeIframeAPIReady = ok;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
}

// Comando do admin: "o vídeo idx começou no instante t". Enquanto existir,
// manda no relógio; depois que esse vídeo acaba, segue a lista a partir dele.
let comando = null;
try { comando = JSON.parse(localStorage.getItem("radio-comando") || "null"); } catch {}

function agoraPorComando() {
  let idx = comando.idx;
  let t = (Date.now() - comando.em) / 1000;
  // avança pela lista enquanto já passou da duração do vídeo
  for (let n = 0; n < 500; n++) {
    const d = duracoes[LISTA[idx]] || 3600;
    if (t < d) return { idx, seg: Math.max(0, t) };
    t -= d;
    idx = (idx + 1) % LISTA.length;
  }
  return { idx: 0, seg: 0 };
}

// Com servidor: o comando vai pro Durable Object da sala, que valida a senha
// de admin e manda pra todo mundo (inclusive de volta pra cá).
let enviarAoServidor = null;
export function ligarRadioAoServidor(fn) {
  enviarAoServidor = fn;
}
// chamado quando o servidor manda o comando atual da sala
export function receberComando(c) {
  comando = c && Number.isFinite(c.idx) ? { idx: c.idx % LISTA.length, em: c.em } : null;
  tocandoIdx = -1;
  sincronizar();
}

function aplicarComando(idx) {
  idx = (idx + LISTA.length) % LISTA.length;
  if (enviarAoServidor) return enviarAoServidor(idx); // espera o servidor confirmar
  comando = { idx, em: Date.now() };
  try { localStorage.setItem("radio-comando", JSON.stringify(comando)); } catch {}
  tocandoIdx = -1; // força recarregar o vídeo no ponto novo
  sincronizar();
}

// Controles de admin (por enquanto locais; no multiplayer vão pro servidor da sala)
export const admin = {
  replay: () => aplicarComando(Math.max(0, tocandoIdx)),
  proximo: () => aplicarComando(tocandoIdx + 1),
  anterior: () => aplicarComando(tocandoIdx - 1),
};

// Qual vídeo e em que segundo, agora. Vídeo sem duração conhecida conta como 1h
// até carregar (aí recalcula).
function agoraNaRadio() {
  if (comando) return agoraPorComando();
  const total = LISTA.reduce((s, id) => s + (duracoes[id] || 3600), 0);
  let t = ((Date.now() - INICIO) / 1000) % total;
  for (let i = 0; i < LISTA.length; i++) {
    const d = duracoes[LISTA[i]] || 3600;
    if (t < d) return { idx: i, seg: t };
    t -= d;
  }
  return { idx: 0, seg: 0 };
}

function sincronizar() {
  if (pausado || !player?.getPlayerState) return;
  const { idx, seg } = agoraNaRadio();
  if (idx !== tocandoIdx) {
    const mesmoVideo = LISTA[idx] === player.getVideoData?.()?.video_id;
    tocandoIdx = idx;
    // replay com lista de 1 vídeo: mesmo id, só volta o ponteiro
    if (mesmoVideo) player.seekTo(seg, true);
    else player.loadVideoById({ videoId: LISTA[idx], startSeconds: seg });
    return;
  }
  // corrige se saiu do ritmo (anúncio, internet lenta) mais de 3s
  const atual = player.getCurrentTime?.() || 0;
  if (Math.abs(atual - seg) > 3 && player.getPlayerState() === YT.PlayerState.PLAYING) player.seekTo(seg, true);
  if (player.getPlayerState() !== YT.PlayerState.PLAYING && player.getPlayerState() !== YT.PlayerState.BUFFERING) player.playVideo();
}

export async function iniciarRadio({ elPlayer, elTitulo }) {
  await carregarApi();
  const { idx, seg } = agoraNaRadio();
  tocandoIdx = idx;
  player = new YT.Player(elPlayer, {
    width: 176,
    height: 99,
    videoId: LISTA[idx],
    playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, start: Math.floor(seg) },
    events: {
      onReady: (e) => {
        e.target.setVolume(70);
        if (pausado) e.target.pauseVideo();
        else e.target.playVideo();
      },
      onStateChange: (e) => {
        const p = e.target;
        if (pausado && e.data === YT.PlayerState.PLAYING) {
          p.pauseVideo();
          return;
        }
        if (e.data === YT.PlayerState.PLAYING) {
          const id = LISTA[tocandoIdx];
          const d = p.getDuration();
          if (d && duracoes[id] !== d) {
            duracoes[id] = d;
            sincronizar(); // agora com a duração real, recalcula o ponto
          }
          elTitulo.textContent = p.getVideoData()?.title || "—";
        }
        if (e.data === YT.PlayerState.ENDED) sincronizar();
      },
      onError: () => {
        // vídeo indisponível/sem embed: pula pro próximo
        duracoes[LISTA[tocandoIdx]] = 1;
        sincronizar();
      },
    },
  });
  setInterval(sincronizar, 5000);
}

export function pausarRadio() {
  pausado = true;
  player?.pauseVideo?.();
}

export function retomarRadio() {
  pausado = false;
  sincronizar();
}
