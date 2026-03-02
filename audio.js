// audio.js — Crossing Field
// Start-gated, 2 stems, degradation + collapse slow-down.
// Fixes "first degradation loudness jump" via a one-time fast duck.
// Also applies ongoing loudness compensation as distortion increases.

let audioCtx;
let percBuffer;
let massBuffer;

let percSource;
let massSource;

let masterGain;
let filter;
let distortion;

let degradation = 0;
let collapsing = false;
let firstDegradeHit = false;

// Tweak these to taste
const BASE_MASTER = 0.85;     // overall level
const MIN_MASTER = 0.55;      // lowest level after compensation
const DIST_COMP_DB = 12;      // how much we can trim at max distortion

// First-hit duck (kills the initial loudness jump)
const FIRST_HIT_DUCK_DB = 5.5;     // dip amount on first degrade
const FIRST_HIT_DUCK_MS = 2;     // time to dip
const FIRST_HIT_RECOVER_MS = 11000;  // time to recover to compensated target

function setOverlayMsg(msg){
  const el = document.getElementById("overlayMsg");
  if (el) el.textContent = msg;
}
function setStatus(msg){
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

async function initAudio(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== "running") await audioCtx.resume();

  setOverlayMsg("Loading audio...");

  const percUrl = new URL("audio/percussion.m4a", window.location.href).toString();
  const massUrl = new URL("audio/mass.m4a", window.location.href).toString();

  percBuffer = await loadBuffer(percUrl);
  massBuffer = await loadBuffer(massUrl);

  masterGain = audioCtx.createGain();
  masterGain.gain.value = BASE_MASTER;

  filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 8000;
  filter.Q.value = 0.7;

  distortion = audioCtx.createWaveShaper();
  distortion.curve = makeDistortion(0);
  distortion.oversample = "2x";

  masterGain.connect(filter);
  filter.connect(distortion);
  distortion.connect(audioCtx.destination);

  startLoop();
}

async function loadBuffer(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);

  const arr = await res.arrayBuffer();
  try{
    return await audioCtx.decodeAudioData(arr);
  } catch{
    throw new Error(
      `Decode failed for ${url}. If desktop audio fails, export stems as .mp3 and update paths.`
    );
  }
}

function startLoop(){
  safeStop();

  // reset state
  degradation = 0;
  firstDegradeHit = false;
  collapsing = false;

  // reset processing
  filter.frequency.setValueAtTime(8000, audioCtx.currentTime);
  distortion.curve = makeDistortion(0);
  masterGain.gain.setValueAtTime(BASE_MASTER, audioCtx.currentTime);

  percSource = audioCtx.createBufferSource();
  massSource = audioCtx.createBufferSource();

  percSource.buffer = percBuffer;
  massSource.buffer = massBuffer;

  percSource.loop = true;
  massSource.loop = true;

  const gainPerc = audioCtx.createGain();
  const gainMass = audioCtx.createGain();

  gainPerc.gain.value = 1.0;
  gainMass.gain.value = 0.7;

  percSource.connect(gainPerc);
  massSource.connect(gainMass);

  gainPerc.connect(masterGain);
  gainMass.connect(masterGain);

  // gameplay tempo
  percSource.playbackRate.value = 1.2;
  massSource.playbackRate.value = 1.2;

  const when = audioCtx.currentTime + 0.03;
  percSource.start(when);
  massSource.start(when);
}

function safeStop(){
  try{ percSource?.stop(); } catch {}
  try{ massSource?.stop(); } catch {}
  percSource = null;
  massSource = null;
}

// ---- Degradation + loudness compensation ----

function degradeAudio(){
  if (!audioCtx || !filter || !distortion || !percSource || !massSource) return;
  if (collapsing) return;

  const prev = degradation;
  degradation = Math.min(1, degradation + 0.15);

  // Darken progressively
  const lp = 8000 - (6000 * degradation);
  filter.frequency.setTargetAtTime(Math.max(900, lp), audioCtx.currentTime, 0.05);

  // Distortion amount rises
  const distAmount = degradation * 60;
  distortion.curve = makeDistortion(distAmount);

  // Slightly speed up as it degrades
  const rate = 1.2 + degradation * 0.1;
  percSource.playbackRate.setTargetAtTime(rate, audioCtx.currentTime, 0.05);
  massSource.playbackRate.setTargetAtTime(rate, audioCtx.currentTime, 0.05);

  // Comp target for this level
  const target = getCompTarget(degradation);

  // FIRST degradation only: quick duck to remove perceived jump
  if (!firstDegradeHit && prev === 0 && degradation > 0){
    firstDegradeHit = true;

    const t0 = audioCtx.currentTime;
    const duckGain = Math.pow(10, (-FIRST_HIT_DUCK_DB) / 20);

    masterGain.gain.cancelScheduledValues(t0);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t0);

    // fast dip
    masterGain.gain.linearRampToValueAtTime(
      clamp(masterGain.gain.value * duckGain, 0.0001, 1),
      t0 + (FIRST_HIT_DUCK_MS / 1000)
    );

    // recover to compensated target
    masterGain.gain.linearRampToValueAtTime(
      target,
      t0 + (FIRST_HIT_DUCK_MS + FIRST_HIT_RECOVER_MS) / 1000
    );

  } else {
    // normal compensation (smooth)
    applyLoudnessComp(degradation);
  }
}

function getCompTarget(d){
  const trimDb = -DIST_COMP_DB * Math.pow(d, 0.9);
  const trim = Math.pow(10, trimDb / 20);
  return clamp(BASE_MASTER * trim, MIN_MASTER, BASE_MASTER);
}

function applyLoudnessComp(d){
  const target = getCompTarget(d);
  const t0 = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setTargetAtTime(target, t0, 0.08);
}

// ---- Collapse behavior when integrity hits 0 ----

function collapseAudio(){
  if (!audioCtx || !percSource || !massSource || !masterGain) return;
  if (collapsing) return;
  collapsing = true;
function ascendAudio(){
  if (!audioCtx || !percSource || !massSource || !masterGain || !filter) return;

  const t0 = audioCtx.currentTime;

  // Stop any current ramps
  try { percSource.playbackRate.cancelScheduledValues(t0); } catch {}
  try { massSource.playbackRate.cancelScheduledValues(t0); } catch {}
  try { masterGain.gain.cancelScheduledValues(t0); } catch {}
  try { filter.frequency.cancelScheduledValues(t0); } catch {}

  // Start from current values
  percSource.playbackRate.setValueAtTime(percSource.playbackRate.value, t0);
  massSource.playbackRate.setValueAtTime(massSource.playbackRate.value, t0);

  masterGain.gain.setValueAtTime(masterGain.gain.value, t0);
  filter.frequency.setValueAtTime(filter.frequency.value, t0);

  // Speed up and out
  percSource.playbackRate.linearRampToValueAtTime(2.0, t0 + 3.0);
  massSource.playbackRate.linearRampToValueAtTime(2.0, t0 + 3.0);

  // Brighten a bit
  filter.frequency.linearRampToValueAtTime(14000, t0 + 2.3);

  // Slight swell, then evaporate
  masterGain.gain.linearRampToValueAtTime(0.95, t0 + 1.5);
  masterGain.gain.linearRampToValueAtTime(0.0001, t0 + 4.8);

  setTimeout(() => {
    safeStop();
  }, 5200);
}
  const t0 = audioCtx.currentTime;
function ascendAudio(){
  if (!audioCtx || !percSource || !massSource || !masterGain) return;
  if (collapsing) return;

  const t0 = audioCtx.currentTime;

  // Cancel any current ramps
  percSource.playbackRate.cancelScheduledValues(t0);
  massSource.playbackRate.cancelScheduledValues(t0);

  // Start from current rate
  percSource.playbackRate.setValueAtTime(percSource.playbackRate.value, t0);
  massSource.playbackRate.setValueAtTime(massSource.playbackRate.value, t0);

  // Speed up and out
  percSource.playbackRate.linearRampToValueAtTime(1.85, t0 + 2.8);
  massSource.playbackRate.linearRampToValueAtTime(1.85, t0 + 2.8);

  // Brighten
  filter.frequency.cancelScheduledValues(t0);
  filter.frequency.setValueAtTime(filter.frequency.value, t0);
  filter.frequency.linearRampToValueAtTime(12000, t0 + 2.4);

  // Slight lift in gain
  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setValueAtTime(masterGain.gain.value, t0);
  masterGain.gain.linearRampToValueAtTime(0.95, t0 + 1.6);

  // Fade out after peak
  masterGain.gain.linearRampToValueAtTime(0.0001, t0 + 4.5);

  setTimeout(() => {
    safeStop();
  }, 5000);
}
  // Drawn-out slow down over ~3.5s
  percSource.playbackRate.cancelScheduledValues(t0);
  massSource.playbackRate.cancelScheduledValues(t0);

  percSource.playbackRate.setValueAtTime(percSource.playbackRate.value, t0);
  massSource.playbackRate.setValueAtTime(massSource.playbackRate.value, t0);

  percSource.playbackRate.linearRampToValueAtTime(0.35, t0 + 3.5);
  massSource.playbackRate.linearRampToValueAtTime(0.35, t0 + 3.5);

  // Fade down to near silence
  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setValueAtTime(masterGain.gain.value, t0);
  masterGain.gain.linearRampToValueAtTime(0.0001, t0 + 4.2);

  // stop after fade
  setTimeout(() => {
    safeStop();
  }, 4500);
}
function ascendAudio(){
  if (!audioCtx || !percSource || !massSource || !masterGain || !filter) return;
  if (collapsing) return; // optional. remove if you want ascension even after collapse

  const t0 = audioCtx.currentTime;

  // cancel any running automation
  percSource.playbackRate.cancelScheduledValues(t0);
  massSource.playbackRate.cancelScheduledValues(t0);
  masterGain.gain.cancelScheduledValues(t0);
  filter.frequency.cancelScheduledValues(t0);

  // start from current values
  percSource.playbackRate.setValueAtTime(percSource.playbackRate.value, t0);
  massSource.playbackRate.setValueAtTime(massSource.playbackRate.value, t0);
  masterGain.gain.setValueAtTime(masterGain.gain.value, t0);
  filter.frequency.setValueAtTime(filter.frequency.value, t0);

  // speed up and lift
  percSource.playbackRate.linearRampToValueAtTime(2.0, t0 + 3.0);
  massSource.playbackRate.linearRampToValueAtTime(2.0, t0 + 3.0);

  // brighten
  filter.frequency.linearRampToValueAtTime(14000, t0 + 2.2);

  // slight swell then vanish
  masterGain.gain.linearRampToValueAtTime(0.95, t0 + 1.4);
  masterGain.gain.linearRampToValueAtTime(0.0001, t0 + 4.8);

  setTimeout(() => {
    safeStop();
  }, 5200);
}
// ---- Helpers ----

function makeDistortion(amount){
  const k = amount;
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const x = (i * 2 / n) - 1;
    curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function clamp(x, a, b){
  return Math.max(a, Math.min(b, x));
}
