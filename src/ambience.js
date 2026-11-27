// Procedural ambient soundscape using Web Audio API (no external audio assets).
// Reacts smoothly to rain, day/night cycle, and pond proximity; independent of radio mute.

const STORAGE_KEY = "ambience";
const MASTER_LEVEL = 0.35;

/** Creates a stereo pink-noise buffer of `seconds` length (coprime lengths avoid audible loops). */
function createPinkNoiseBuffer(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
      b6 = white * 0.115926;
    }
  }
  return buffer;
}

/** Short white-noise grain buffer for individual raindrop impacts. */
function createDropBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * 0.06);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const out = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const env = Math.pow(1 - i / length, 3);
    out[i] = (Math.random() * 2 - 1) * env;
  }
  return buffer;
}

export function createAmbience() {
  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== "0"; } catch {}

  let ctx = null;
  let master = null;
  let rainGain = null;
  let rainAirGain = null;
  let dropBus = null;
  let dropBuffer = null;
  let waterGain = null;
  let cricketGain = null;
  let cricketPulse = null;
  let lastCricketAt = 0;
  let nextDropAt = 0;

  function ensureGraph() {
    if (ctx) return true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
      ctx = new AudioCtx();
    } catch {
      return false;
    }

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Two coprime-length buffers so the rain never has a noticeable loop seam
    const noiseA = createPinkNoiseBuffer(ctx, 7.3);
    const noiseB = createPinkNoiseBuffer(ctx, 11.1);
    dropBuffer = createDropBuffer(ctx);

    // Rain body: warm, muffled lo-fi downpour (no harsh hiss or periodic sweeps)
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseA;
    rainSrc.loop = true;
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = "highpass";
    rainHp.frequency.value = 130;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = "lowpass";
    rainLp.frequency.value = 720;
    rainLp.Q.value = 0.35;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSrc.connect(rainHp).connect(rainLp).connect(rainGain).connect(master);
    rainSrc.start();

    // Rain air: very soft, warm upper texture from the second buffer
    const airSrc = ctx.createBufferSource();
    airSrc.buffer = noiseB;
    airSrc.loop = true;
    const airBp = ctx.createBiquadFilter();
    airBp.type = "bandpass";
    airBp.frequency.value = 2100;
    airBp.Q.value = 0.55;
    rainAirGain = ctx.createGain();
    rainAirGain.gain.value = 0;
    airSrc.connect(airBp).connect(rainAirGain).connect(master);
    airSrc.start();

    // Raindrop patter bus: irregular stereo micro-droplets
    dropBus = ctx.createGain();
    dropBus.gain.value = 0;
    dropBus.connect(master);

    // Breeze / Pond water: soft low-mid noise
    const waterSrc = ctx.createBufferSource();
    waterSrc.buffer = noiseB;
    waterSrc.loop = true;
    const waterBp = ctx.createBiquadFilter();
    waterBp.type = "bandpass";
    waterBp.frequency.value = 310;
    waterBp.Q.value = 0.9;
    waterGain = ctx.createGain();
    waterGain.gain.value = 0;
    waterSrc.connect(waterBp).connect(waterGain).connect(master);
    waterSrc.start();

    // Night crickets: two soft detuned high tones gated by gentle chirps
    const c1 = ctx.createOscillator();
    const c2 = ctx.createOscillator();
    c1.frequency.value = 3850;
    c2.frequency.value = 3920;
    cricketPulse = ctx.createGain();
    cricketPulse.gain.value = 0;
    cricketGain = ctx.createGain();
    cricketGain.gain.value = 0;
    c1.connect(cricketPulse);
    c2.connect(cricketPulse);
    cricketPulse.connect(cricketGain).connect(master);
    c1.start();
    c2.start();

    return true;
  }

  function unlock() {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (!ensureGraph()) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  function isEnabled() {
    return enabled;
  }

  function setEnabled(next) {
    enabled = !!next;
    try { localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0"); } catch {}
    if (enabled) unlock();
    return enabled;
  }

  function scheduleRaindrop(at) {
    const src = ctx.createBufferSource();
    src.buffer = dropBuffer;
    const isDeep = Math.random() < 0.25;
    src.playbackRate.value = isDeep ? 0.55 + Math.random() * 0.25 : 0.75 + Math.random() * 0.45;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = isDeep ? 420 + Math.random() * 320 : 850 + Math.random() * 1450;
    bp.Q.value = 1.2 + Math.random() * 1.1;

    const g = ctx.createGain();
    g.gain.value = isDeep ? 0.05 + Math.random() * 0.06 : 0.025 + Math.random() * 0.055;

    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.7;

    src.connect(bp).connect(g).connect(pan).connect(dropBus);
    src.start(at);
  }

  function scheduleCricketChirp(now) {
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.065;
      cricketPulse.gain.setValueAtTime(0.0001, t);
      cricketPulse.gain.linearRampToValueAtTime(1, t + 0.012);
      cricketPulse.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);
    }
  }

  function update({ rainAmount = 0, dayAmount = 0, pondFactor = 0, paused = false } = {}) {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const active = enabled && !paused;

    master.gain.setTargetAtTime(active ? MASTER_LEVEL : 0, now, 0.25);
    if (!active) return;

    const rain = Math.max(0, Math.min(1, rainAmount));
    // Gentle non-periodic drift so the rain breathes like real wind/gusts
    const gust = 1 + 0.06 * Math.sin(now * 0.43) + 0.04 * Math.sin(now * 0.71);
    rainGain.gain.setTargetAtTime(rain * 0.56 * gust, now, 0.25);
    rainAirGain.gain.setTargetAtTime(rain * 0.07 * gust, now, 0.25);
    dropBus.gain.setTargetAtTime(rain * 0.85, now, 0.25);

    if (rain > 0.05) {
      if (nextDropAt < now) nextDropAt = now;
      // Schedule a small cluster of random raindrops slightly ahead of the audio clock
      while (nextDropAt < now + 0.12) {
        scheduleRaindrop(nextDropAt);
        nextDropAt += 0.025 + Math.random() * (0.09 / Math.max(0.25, rain));
      }
    }

    const waterTarget = (0.03 + 0.2 * Math.max(0, Math.min(1, pondFactor))) * (1 - rain * 0.5);
    const nightClear = Math.max(0, 1 - dayAmount * 1.4) * Math.max(0, 1 - rain);
    const cricketTarget = nightClear * 0.012;

    waterGain.gain.setTargetAtTime(waterTarget, now, 0.25);
    cricketGain.gain.setTargetAtTime(cricketTarget, now, 0.35);

    if (cricketTarget > 0.002 && now - lastCricketAt > 2.8 + Math.random() * 2.5) {
      lastCricketAt = now;
      scheduleCricketChirp(now);
    }
  }

  return { unlock, isEnabled, setEnabled, update };
}
