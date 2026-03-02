// audio.js — start-gated, 2 stems, degradation + collapse slow-down.
// Adds loudness compensation so distortion doesn't jump volume.

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

// Tweak these to taste
const BASE_MASTER = 0.85;     // overall level
const MIN_MASTER = 0.55;      // how low master can be pushed by compensation
const DIST_COMP_DB = 10;      // how much we can trim at max distortion (approx)

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
    throw new Error(`Decode failed for ${url}. Desktop browser may not support .m4a (try Chrome/Safari or export mp3).`);
  }
}

function startLoop(){
  safeStop();

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

  percSource.playbackRate.value = 1.2;
  massSource.playbackRate.value = 1.2;

  const when = audioCtx.currentTime + 0.03;
  percSource.start(when);
  massSource.start(when);

  // Reset collapse flag if restarting
  collapsing = false;
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

  // Loudness compensation:
  // As distortion increases, trim master a bit to avoid "jump".
  // Map degradation 0..1 to a gain trim.
  applyLoudnessComp(degradation);
}

function applyLoudnessComp(d){
  // approximate trim curve: -0dB at 0, down to about -DIST_COMP_DB at 1
  // convert dB to gain
  const trimDb = -DIST_COMP_DB * Math.pow(d, 0.9);
  const trim = Math.pow(10, trimDb / 20);

  const target = clamp(BASE_MASTER * trim, MIN_MASTER, BASE_MASTER);

  masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
  masterGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.08);
}

// ---- Collapse behavior when integrity hits 0 ----

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

  // Fade down to near silence a bit after slowdown starts
  masterGain.gain.cancelScheduledValues(t0);
  masterGain.gain.setValueAtTime(masterGain.gain.value, t0);
  masterGain.gain.linearRampToValueAtTime(0.0001, t0 + 4.2);

  // Optional: stop after fade (keeps CPU lower)
  setTimeout(() => {
    safeStop();
  }, 4500);
}

// ---- Helpers ----

function makeDistortion(amount){
  const k = amount;
  const n = 44100;
  const curve = new Float32Array(n);
  for(let i=0;i<n;i++){
    const x = (i*2/n)-1;
    curve[i] = ((3+k)*x*20*Math.PI/180) / (Math.PI + k*Math.abs(x));
  }
  return curve;
}

function clamp(x, a, b){
  return Math.max(a, Math.min(b, x));
}
