// Room radio: the SYSTEM controls the track and position; pausing is local only.
// Everyone hears the same part: the position is computed from the clock, starting
// at a fixed date, looping through the playlist. With multiplayer, the room's
// Durable Object becomes the source of that "start".

export const PLAYLIST = [
  "x6ujm9B-vAc",
  // add more YouTube IDs here
];

const START = Date.UTC(2026, 0, 1); // radio's time zero
const durations = {}; // id -> seconds (learned as each video loads)

let player = null;
let playingIdx = -1;
let paused = false;
// mute is per person and remembered; the radio keeps playing (and in sync) underneath
let muted = false;
try { muted = localStorage.getItem("muted") === "1"; } catch {}

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

const TOUCH = matchMedia("(pointer: coarse)").matches;

export async function startRadio({ elPlayer, elTitle }) {
  await loadApi();
  const { idx, sec } = nowOnRadio();
  playingIdx = idx;
  // cover with the video's thumbnail whenever it isn't playing, so YouTube's big
  // pause/play overlay and logo never show in the little TV
  const cover = Object.assign(document.createElement("img"), { className: "tv-cover", alt: "" });
  document.getElementById(elPlayer).parentElement.append(cover);
  // YouTube shows its pause button and channel badge for a few seconds after playback
  // starts, so the cover only lifts once that has faded
  let coverTimer = 0;
  const setCover = (playing) => {
    clearTimeout(coverTimer);
    if (playing) coverTimer = setTimeout(() => (cover.hidden = true), 4500);
    else {
      cover.src = `https://i.ytimg.com/vi/${PLAYLIST[Math.max(0, playingIdx)]}/hqdefault.jpg`;
      cover.hidden = false;
    }
  };
  setCover(false);
  player = new YT.Player(elPlayer, {
    width: 176,
    height: 99,
    videoId: PLAYLIST[idx],
    playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, start: Math.floor(sec) },
    events: {
      onReady: (e) => {
        e.target.setVolume(70);
        // phones only autoplay muted (the tap on "enter" is used up while the API loads):
        // start muted and turn the sound on at the next touch
        if (TOUCH) {
          e.target.mute();
          const unmute = () => {
            if (muted) return;
            e.target.unMute();
            e.target.setVolume(70);
            if (!paused) e.target.playVideo();
          };
          addEventListener("pointerdown", unmute, { once: true, capture: true });
        }
        if (muted) e.target.mute();
        if (paused) e.target.pauseVideo();
        else e.target.playVideo();
      },
      onStateChange: (e) => {
        const p = e.target;
        setCover(e.data === YT.PlayerState.PLAYING);
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

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("muted", m ? "1" : "0"); } catch {}
  if (!player?.mute) return;
  if (m) player.mute();
  else {
    player.unMute();
    player.setVolume(70);
  }
}

export function pauseRadio() {
  paused = true;
  player?.pauseVideo?.();
}

export function resumeRadio() {
  paused = false;
  sync();
}
