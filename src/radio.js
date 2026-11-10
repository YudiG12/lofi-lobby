// Room radio: the SYSTEM controls the track and position; pausing is local only.
// Everyone hears the same part: the position is computed from the clock, starting
// at a fixed date, looping through the playlist. With multiplayer, the room's
// Durable Object becomes the source of that "start".

export const PLAYLIST = [
  "ZWIJiNeMigM",
  // add more YouTube IDs here
];

const START = Date.UTC(2026, 0, 1); // radio's time zero
const durations = {}; // id -> seconds (learned as each video loads)

let player = null;
let playingIdx = -1;
let paused = false;

function loadApi() {
  return new Promise((ok) => {
    if (window.YT?.Player) return ok();
    window.onYouTubeIframeAPIReady = ok;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
}

// Admin command: "video idx started at time t". While it exists it drives
// the clock; after that video ends, the playlist continues from it.
let command = null;
try { command = JSON.parse(localStorage.getItem("radio-command") || "null"); } catch {}

function nowByCommand() {
  let idx = command.idx;
  let t = (Date.now() - command.at) / 1000;
  // walk the playlist while time is past the video's duration
  for (let n = 0; n < 500; n++) {
    const d = durations[PLAYLIST[idx]] || 3600;
    if (t < d) return { idx, sec: Math.max(0, t) };
    t -= d;
    idx = (idx + 1) % PLAYLIST.length;
  }
  return { idx: 0, sec: 0 };
}

// With a server: the command goes to the room's Durable Object, which checks the
// admin password and sends it to everyone (including back here).
let sendToServer = null;
export function connectRadioToServer(fn) {
  sendToServer = fn;
}
// called when the server sends the room's current command
export function receiveCommand(c) {
  command = c && Number.isFinite(c.idx) ? { idx: c.idx % PLAYLIST.length, at: c.at } : null;
  playingIdx = -1;
  sync();
}

function applyCommand(idx) {
  idx = (idx + PLAYLIST.length) % PLAYLIST.length;
  if (sendToServer) return sendToServer(idx); // wait for the server to confirm
  command = { idx, at: Date.now() };
  try { localStorage.setItem("radio-command", JSON.stringify(command)); } catch {}
  playingIdx = -1; // force reloading the video at the new point
  sync();
}

// Admin controls (local when offline; go to the room server in multiplayer)
export const admin = {
  restart: () => applyCommand(Math.max(0, playingIdx)),
  next: () => applyCommand(playingIdx + 1),
  previous: () => applyCommand(playingIdx - 1),
};

// Which video and which second, right now. A video with unknown duration counts
// as 1h until it loads (then it's recomputed).
function nowOnRadio() {
  if (command) return nowByCommand();
  const total = PLAYLIST.reduce((s, id) => s + (durations[id] || 3600), 0);
  let t = ((Date.now() - START) / 1000) % total;
  for (let i = 0; i < PLAYLIST.length; i++) {
    const d = durations[PLAYLIST[i]] || 3600;
    if (t < d) return { idx: i, sec: t };
    t -= d;
  }
  return { idx: 0, sec: 0 };
}

function sync() {
  if (paused || !player?.getPlayerState) return;
  const { idx, sec } = nowOnRadio();
  if (idx !== playingIdx) {
    const sameVideo = PLAYLIST[idx] === player.getVideoData?.()?.video_id;
    playingIdx = idx;
    // restart with a 1-video playlist: same id, just seek back
    if (sameVideo) player.seekTo(sec, true);
    else player.loadVideoById({ videoId: PLAYLIST[idx], startSeconds: sec });
    return;
  }
  // correct drift (ads, slow connection) of more than 3s
  const current = player.getCurrentTime?.() || 0;
  if (Math.abs(current - sec) > 3 && player.getPlayerState() === YT.PlayerState.PLAYING) player.seekTo(sec, true);
  if (player.getPlayerState() !== YT.PlayerState.PLAYING && player.getPlayerState() !== YT.PlayerState.BUFFERING) player.playVideo();
}

export async function startRadio({ elPlayer, elTitle }) {
  await loadApi();
  const { idx, sec } = nowOnRadio();
  playingIdx = idx;
  player = new YT.Player(elPlayer, {
    width: 176,
    height: 99,
    videoId: PLAYLIST[idx],
    playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, start: Math.floor(sec) },
    events: {
      onReady: (e) => {
        e.target.setVolume(70);
        if (paused) e.target.pauseVideo();
        else e.target.playVideo();
      },
      onStateChange: (e) => {
        const p = e.target;
        if (paused && e.data === YT.PlayerState.PLAYING) {
          p.pauseVideo();
          return;
        }
        if (e.data === YT.PlayerState.PLAYING) {
          const id = PLAYLIST[playingIdx];
          const d = p.getDuration();
          if (d && durations[id] !== d) {
            durations[id] = d;
            sync(); // now with the real duration, recompute the point
          }
          elTitle.textContent = p.getVideoData()?.title || "—";
        }
        if (e.data === YT.PlayerState.ENDED) sync();
      },
      onError: () => {
        // video unavailable / not embeddable: skip to the next
        durations[PLAYLIST[playingIdx]] = 1;
        sync();
      },
    },
  });
  setInterval(sync, 5000);
}

export function pauseRadio() {
  paused = true;
  player?.pauseVideo?.();
}

export function resumeRadio() {
  paused = false;
  sync();
}
