let audioCtx;
let percBuffer;
let massBuffer;

let percSource;
let massSource;

let masterGain;
let distortion;
let filter;
let bitcrusher;

let degradation = 0; // increases with each death

async function initAudio(){
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  percBuffer = await loadBuffer("audio/percussion.m4a");
  massBuffer = await loadBuffer("audio/mass.m4a");

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.9;

  filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 8000;

  distortion = audioCtx.createWaveShaper();
  distortion.curve = makeDistortion(0);

  masterGain.connect(filter);
  filter.connect(distortion);
  distortion.connect(audioCtx.destination);

  startLoop();
}

async function loadBuffer(url){
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  return await audioCtx.decodeAudioData(arr);
}

function startLoop(){
  percSource = audioCtx.createBufferSource();
  massSource = audioCtx.createBufferSource();

  percSource.buffer = percBuffer;
  massSource.buffer = massBuffer;

  percSource.loop = true;
  massSource.loop = true;

  const gainPerc = audioCtx.createGain();
  const gainMass = audioCtx.createGain();

  gainPerc.gain.value = 1;
  gainMass.gain.value = 0.7;

  percSource.connect(gainPerc);
  massSource.connect(gainMass);

  gainPerc.connect(masterGain);
  gainMass.connect(masterGain);

  percSource.playbackRate.value = 1.2;
  massSource.playbackRate.value = 1.2;

  percSource.start();
  massSource.start();
}

function degradeAudio(){
  degradation += 0.15;
  degradation = Math.min(degradation, 1);

  filter.frequency.value = 8000 - (6000 * degradation);
  distortion.curve = makeDistortion(degradation * 50);

  percSource.playbackRate.value = 1.2 + degradation * 0.1;
  massSource.playbackRate.value = 1.2 + degradation * 0.1;
}

function makeDistortion(amount){
  const k = amount;
  const n = 44100;
  const curve = new Float32Array(n);
  for(let i=0;i<n;i++){
    const x = (i*2/n)-1;
    curve[i] = (3+k)*x*20*Math.PI/180/(Math.PI+k*Math.abs(x));
  }
  return curve;
}