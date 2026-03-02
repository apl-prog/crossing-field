// audio.js — Crossing Field
// 2 stems (percussion + mass), looped.
// Deaths degrade audio. Integrity 0 collapses (slowdown + fade).
// Winning triggers ASCENSION: jump to 1:57 (117s) into the tracks.

let audioCtx;
let percBuffer;
let massBuffer;

let percSource;
let massSource;

let gainPerc;
let gainMass;

let masterGain;
let filter;
let distortion;

let degradation = 0;
let collapsing = false;
let firstDegradeHit = false;

// Mix / loudness tuning
const BASE_MASTER = 0.70;     // overall level
const MIN_MASTER = 0.38;      // lowest level after compensation
const DIST_COMP_DB = 24;      // trim at max distortion

// First-hit duck to prevent the initial loudness jump
const FIRST_HIT_DUCK_DB = 11.0;
const FIRST_HIT_DUCK_MS = 320;
const FIRST_HIT_RECOVER_MS = 1400;

// Win jump target (1:57)
const ASCEND_JUMP_SEC = 117;

// ---- UI helpers (optional) ----
function setOverlayMsg(msg){
  const el = document.getElementById("overlayMsg");
  if (el) el.textContent = msg;
}
function setStatus(msg){
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

// ---- Public API (called by game.js) ----
async function initAudio(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== "running") await audioCtx.resume();

  setOverlayMsg("Loading audio...");

  const percUrl = new URL("audio/percussion.m4a", window.location.href).toString();
  const massUrl = new URL("audio/mass.m4a", window.location.href).toString();

  percBuffer = await loadBuffer(percUrl);
  massBuffer = await loadBuffer(massUrl);

  buildGraph();
  startLoop();
}

function degradeAudio(){
  if (!audioCtx || !filter || !distortion || !percSource || !massSource) return;
  if (collapsing) return;

  const prev = degradation;
  degradation = Math.min(1, degradation + 0.15);

  // Darken progressively
  const lp = 8000 - (6000 * degradation);
  filter.frequency.setTargetAtTime(Math.max(900, lp), audioCtx.currentTime, 0.05);

  // Speed up slightly as it degrades
  const rate = 1.2 + degradation * 0.1;
  percSource.playbackRate.setTargetAtTime(rate, audioCtx.currentTime, 0.05);
  massSource.playbackRate.setTargetAtTime(rate, audioCtx.currentTime, 0.05);

  // Loudness compensation target for this degradation level
  const target = getCompTarget(degradation);

  // FIRST degradation only: pre-duck, then distort, then recover
  if (!firstDegradeHit && prev === 0 && degradation > 0){
    firstDegradeHit = true;

    const t0 = audioCtx.currentTime;
    const duckGain = Math.pow(10, (-FIRST_HIT_DUCK_DB) / 20);

    masterGain.gain.cancelScheduledValues(t0);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t0);

    // Fast dip (starts immediately)
    masterGain.gain.linearRampToValueAtTime(
      clamp(masterGain.gain.value * duckGain, 0.0001, 1),
      t0 + (FIRST_HIT_DUCK_MS / 1000)
    );

    // Apply distortion shortly after dip begins
  setTimeout(() => {
  const distAmount = degradation * 60;
  distortion.curve = makeDistortion(distAmount);
}, Math.min(40, FIRST_HIT_DUCK_MS));

    // Recover to compensated target
    masterGain.gain.linearRampToValueAtTime(
      target,
      t0 + (FIRST_HIT_DUCK_MS + FIRST_HIT_RECOVER_MS) / 1000
    );

  } else {
    // Normal distortion update + smooth compensation
    const distAmount = degradation * 60;
    distortion.curve = makeDistortion(distAmount);
    applyLoudnessComp(degradation);
  }
}

function collapseAudio(){
  if (!audioCtx || !percSource || !massSource || !masterGain) return;
  if (collapsing) return;
  collapsing = true;

  const t0 = audioCtx.currentTime;

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
  if (!audioCtx || !percBuffer || !massBuffer) return;

  // If we were collapsing, allow ascension to override
  collapsing = false;

  // Brief dim then jump (prevents click and feels intentional)
  const t0 = audioCtx.currentTime;

  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setValueAtTime(masterGain.gain.value, t0);
  masterGain.gain.linearRampToValueAtTime(0.0001, t0 + 0.18);

  setTimeout(() => {
    restartAt(ASCEND_JUMP_SEC);
  }, 190);
}

// ---- Core graph ----
function buildGraph(){
  // Master -> filter -> distortion -> destination
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
}

function startLoop(){
  safeStop();

  degradation = 0;
  collapsing = false;
  firstDegradeHit = false;

  filter.frequency.setValueAtTime(8000, audioCtx.currentTime);
  distortion.curve = makeDistortion(0);

  // Set base gain at compensated target (degradation=0)
  masterGain.gain.setValueAtTime(getCompTarget(0), audioCtx.currentTime);

  percSource = audioCtx.createBufferSource();
  massSource = audioCtx.createBufferSource();

  percSource.buffer = percBuffer;
  massSource.buffer = massBuffer;

  percSource.loop = true;
  massSource.loop = true;

  gainPerc = audioCtx.createGain();
  gainMass = audioCtx.createGain();

  gainPerc.gain.value = 1.0;
  gainMass.gain.value = 0.7;

  percSource.connect(gainPerc);
  massSource.connect(gainMass);

  gainPerc.connect(masterGain);
  gainMass.connect(masterGain);

  // Baseline tempo
  percSource.playbackRate.value = 1.2;
  massSource.playbackRate.value = 1.2;

  const when = audioCtx.currentTime + 0.03;
  percSource.start(when);
  massSource.start(when);
}

function restartAt(offsetSec){
  if (!audioCtx || !percBuffer || !massBuffer) return;

  safeStop();

  percSource = audioCtx.createBufferSource();
  massSource = audioCtx.createBufferSource();

  percSource.buffer = percBuffer;
  massSource.buffer = massBuffer;

  percSource.loop = true;
  massSource.loop = true;

  gainPerc = audioCtx.createGain();
  gainMass = audioCtx.createGain();

  gainPerc.gain.value = 1.0;
  gainMass.gain.value = 0.7;

  percSource.connect(gainPerc);
  massSource.connect(gainMass);

  gainPerc.connect(masterGain);
  gainMass.connect(masterGain);

  // Keep current degradation "character" on ascension
  // (optional: reset degradation here if you want it clean)
  applyLoudnessComp(degradation);

  // Restore baseline tempo (or keep slightly elevated if you want)
  percSource.playbackRate.value = 1.2;
  massSource.playbackRate.value = 1.2;

  // Clamp offset to buffer duration (safe if your files are shorter than 1:57)
  const offP = (offsetSec % percBuffer.duration + percBuffer.duration) % percBuffer.duration;
  const offM = (offsetSec % massBuffer.duration + massBuffer.duration) % massBuffer.duration;

  // Fade in after jump to avoid click
  const t0 = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setValueAtTime(0.0001, t0);
  masterGain.gain.linearRampToValueAtTime(getCompTarget(degradation), t0 + 0.35);

  const when = t0 + 0.03;
  percSource.start(when, offP);
  massSource.start(when, offM);
}

function safeStop(){
  try { percSource?.stop(); } catch {}
  try { massSource?.stop(); } catch {}
  percSource = null;
  massSource = null;
}

// ---- Loudness compensation ----
function getCompTarget(d){
  const trimDb = -DIST_COMP_DB * Math.pow(d, 0.9);
  const trim = Math.pow(10, trimDb / 20);
  return clamp(BASE_MASTER * trim, MIN_MASTER, BASE_MASTER);
}

function applyLoudnessComp(d){
  const target = getCompTarget(d);
  const t0 = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setTargetAtTime(target, t0, 0.10);
}

// ---- Loading + DSP helpers ----
async function loadBuffer(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const arr = await res.arrayBuffer();
  return await audioCtx.decodeAudioData(arr);
}

function makeDistortion(amount){
  // Soft-ish distortion curve
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

// Expose functions globally (explicit, avoids any module-scope surprises)
window.initAudio = initAudio;
window.degradeAudio = degradeAudio;
window.collapseAudio = collapseAudio;
window.ascendAudio = ascendAudio;
