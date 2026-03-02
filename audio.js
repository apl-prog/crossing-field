// audio.js — debug version (prints fetch URLs + shows errors on screen)

let audioCtx;
let percBuffer, massBuffer;
let percSource, massSource;
let masterGain, filter, distortion;

let degradation = 0;

function uiStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

async function initAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== "running") await audioCtx.resume();

    uiStatus("LOADING AUDIO");

    // Build absolute URLs so there is zero ambiguity about base paths
    const percUrl = new URL("audio/percussion.m4a", window.location.href).toString();
    const massUrl = new URL("audio/mass.m4a", window.location.href).toString();

    console.log("Fetching:", percUrl);
    console.log("Fetching:", massUrl);

    percBuffer = await loadBuffer(percUrl);
    massBuffer = await loadBuffer(massUrl);

    // Master chain
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;

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

    uiStatus("ROUND 1");
    console.log("Audio running. audioCtx.state =", audioCtx.state);
  } catch (err) {
    console.error(err);
    uiStatus("AUDIO ERROR (open console)");
    throw err;
  }
}

async function loadBuffer(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const arr = await res.arrayBuffer();
  try {
    return await audioCtx.decodeAudioData(arr);
  } catch {
    throw new Error(`Decode failed for ${url} (unsupported/corrupt audio)`);
  }
}

function startLoop() {
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

  // speed
  percSource.playbackRate.value = 1.2;
  massSource.playbackRate.value = 1.2;

  const when = audioCtx.currentTime + 0.03;
  percSource.start(when);
  massSource.start(when);
}

function safeStop() {
  try { percSource?.stop(); } catch {}
  try { massSource?.stop(); } catch {}
  percSource = null;
  massSource = null;
}

function degradeAudio() {
  if (!audioCtx || !filter || !distortion || !percSource || !massSource) return;

  degradation = Math.min(1, degradation + 0.15);

  const lp = 8000 - (6000 * degradation);
  filter.frequency.setTargetAtTime(Math.max(900, lp), audioCtx.currentTime, 0.05);

  distortion.curve = makeDistortion(degradation * 60);

  const rate = 1.2 + degradation * 0.1;
  percSource.playbackRate.setTargetAtTime(rate, audioCtx.currentTime, 0.05);
  massSource.playbackRate.setTargetAtTime(rate, audioCtx.currentTime, 0.05);
}

function makeDistortion(amount) {
  const k = amount;
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2 / n) - 1;
    curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}
