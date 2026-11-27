// Room radio: the SYSTEM controls the track and position; pausing is local only.
// Everyone hears the same part: the position is computed from the clock, starting
// at a fixed date, looping through the playlist. With multiplayer, the room's
// Durable Object becomes the source of that "start".

// Each video with its length in whole seconds. The second everyone hears comes from the clock,
// looping through the playlist since START, so every listener must use the same lengths: YouTube
// reports a video's length a little differently from one load to the next (10556 or 10555.341 s
// for the first one), and over the thousands of loops since START that put listeners up to half
// an hour apart. Add a video with its length.
export const PLAYLIST = [
  { id: "x6ujm9B-vAc", seconds: 10555 }, // 2:55:55
];

const START = Date.UTC(2026, 0, 1); // radio's time zero
// a video added without its length: learned when it loads (whole seconds), 1h until then
const learned = {};
const broken = new Set(); // unavailable or not embeddable: counts as 1 second, so it's skipped
function lengthOf(idx) {
  const { id, seconds } = PLAYLIST[idx];
  return broken.has(id) ? 1 : seconds || learned[id] || 3600;
}
function learnLength(idx, d) {
  const { id, seconds } = PLAYLIST[idx] || {};
  d = Math.floor(d);
  if (!id || seconds || !(d > 1) || learned[id] === d) return false;
  learned[id] = d;
  return true;
}

let player = null;
let playingIdx = -1;
let paused = false;
// mute is per person and remembered; the radio keeps playing (and in sync) underneath
let muted = false;
try { muted = localStorage.getItem("muted") === "1"; } catch {}
// volume (0-100) is per person and remembered too
let volume = 70;
try {
  const v = parseInt(localStorage.getItem("volume"), 10);
  if (v >= 0 && v <= 100) volume = v;
} catch {}

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
    const d = lengthOf(idx);
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

// Which video and which second, right now.
function nowOnRadio() {
  if (command) return nowByCommand();
  const total = PLAYLIST.reduce((s, _, i) => s + lengthOf(i), 0);
  let t = ((Date.now() - START) / 1000) % total;
  for (let i = 0; i < PLAYLIST.length; i++) {
    const d = lengthOf(i);
    if (t < d) return { idx: i, sec: t };
    t -= d;
  }
  return { idx: 0, sec: 0 };
}

function sync() {
  if (paused || !player?.getPlayerState) return;
  const { idx, sec } = nowOnRadio();
  if (idx !== playingIdx) {
    const sameVideo = PLAYLIST[idx].id === player.getVideoData?.()?.video_id;
    playingIdx = idx;
    // restart with a 1-video playlist: same id, just seek back
    if (sameVideo) player.seekTo(sec, true);
    else player.loadVideoById({ videoId: PLAYLIST[idx].id, startSeconds: sec });
    return;
  }
  // correct drift (ads, slow connection, a pause) of more than 3s. Also while stopped, so coming
  // back from a pause starts at the room's second instead of playing the old one first
  const state = player.getPlayerState();
  if (state === YT.PlayerState.BUFFERING) return;
  const current = player.getCurrentTime?.() || 0;
  if (Math.abs(current - sec) > 3) player.seekTo(sec, true);
  if (state !== YT.PlayerState.PLAYING) player.playVideo();
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
      cover.src = `https://i.ytimg.com/vi/${PLAYLIST[Math.max(0, playingIdx)].id}/hqdefault.jpg`;
      cover.hidden = false;
    }
  };
  setCover(false);
  player = new YT.Player(elPlayer, {
    width: 176,
    height: 99,
    videoId: PLAYLIST[idx].id,
    playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, start: Math.floor(sec) },
    events: {
      onReady: (e) => {
        e.target.setVolume(volume);
        // phones only autoplay muted (the tap on "enter" is used up while the API loads):
        // start muted and turn the sound on at the next touch
        if (TOUCH) {
          e.target.mute();
          const unmute = () => {
            if (muted) return;
            e.target.unMute();
            e.target.setVolume(volume);
            if (!paused) e.target.playVideo();
          };
          addEventListener("pointerdown", unmute, { once: true, capture: true });
        }
        if (muted) e.target.mute();
        // a video added without its length started at a guess: once it tells its length, go to the right second
        if (learnLength(playingIdx, e.target.getDuration())) {
          playingIdx = -1;
          sync();
        }
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
          if (learnLength(playingIdx, p.getDuration())) sync(); // a video added without its length: recompute the point
          elTitle.textContent = p.getVideoData()?.title || "—";
        }
        if (e.data === YT.PlayerState.ENDED) sync();
      },
      onError: () => {
        // video unavailable / not embeddable: skip to the next
        const v = PLAYLIST[playingIdx];
        if (v) broken.add(v.id);
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
    player.setVolume(volume);
  }
}

export const getVolume = () => volume;
export function setVolume(v) {
  volume = Math.max(0, Math.min(100, Math.round(v)));
  try { localStorage.setItem("volume", String(volume)); } catch {}
  player?.setVolume?.(volume);
}

export function pauseRadio() {
  paused = true;
  player?.pauseVideo?.();
}

export function resumeRadio() {
  paused = false;
  sync();
}
