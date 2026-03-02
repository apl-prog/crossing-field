// game.js — Crossing Field
// Win when player reaches the top band (row 0).
// On integrity 0: trigger slow-down "collapse" audio + freeze input.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const TILE = 32;
const GRID_W = 16;
const GRID_H = 16;

let player = { x: 8, y: 15 };
let round = 1;
let deaths = 0;
let crossings = 0;

let obstacles = [];
let hasWon = false;
let started = false;
let isCollapsed = false;

// Overlay start gate
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const overlayMsg = document.getElementById("overlayMsg");

startBtn.addEventListener("click", async () => {
  if (started) return;

  try{
    overlayMsg.textContent = "Loading audio...";
    await initAudio();
    started = true;
    overlay.classList.add("hidden");
    document.getElementById("status").textContent = "ROUND 1";
  } catch(e){
    console.error(e);
    overlayMsg.textContent = String(e.message || e);
  }
});

// Movement helper
function move(dx, dy){
  if (!started || hasWon || isCollapsed) return;

  player.x += dx;
  player.y += dy;

  player.x = Math.max(0, Math.min(GRID_W - 1, player.x));
  player.y = Math.max(0, Math.min(GRID_H - 1, player.y));
}

// Keyboard controls
document.addEventListener("keydown", e => {
  if (!started) return;

  if (e.key === "ArrowLeft") move(-1, 0);
  if (e.key === "ArrowRight") move(1, 0);
  if (e.key === "ArrowUp") move(0, -1);
  if (e.key === "ArrowDown") move(0, 1);
});

// Mobile swipe controls
let touchStart = null;

canvas.addEventListener("pointerdown", e => {
  if (!started) return;
  if (isCollapsed) return;

  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  touchStart = { x: e.clientX, y: e.clientY };
}, { passive: false });

canvas.addEventListener("pointermove", e => {
  if (!started) return;
  e.preventDefault();
}, { passive: false });

canvas.addEventListener("pointerup", e => {
  if (!started || !touchStart) return;
  if (isCollapsed) return;

  e.preventDefault();

  const dx = e.clientX - touchStart.x;
  const dy = e.clientY - touchStart.y;

  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const THRESH = 18;

  if (adx < THRESH && ady < THRESH) {
    touchStart = null;
    return;
  }

  if (adx > ady) move(dx > 0 ? 1 : -1, 0);
  else move(0, dy > 0 ? 1 : -1);

  touchStart = null;
}, { passive: false });

function spawnObstacles(){
  obstacles = [];

  // Keep the top band (row 0) as "goal row" with no obstacles.
  // Start obstacles at row 2.
  for (let y = 2; y < 14; y += 2){
    obstacles.push({
      x: Math.floor(Math.random() * GRID_W),
      y,
      speed: 0.02 + round * 0.01
    });
  }
}

function updateIntegrityUI(){
  const integrity = Math.max(0, 100 - deaths * 15);
  document.getElementById("integrity").textContent = "INTEGRITY: " + integrity + "%";
  return integrity;
}

function triggerCollapse(){
  if (isCollapsed) return;
  isCollapsed = true;

  document.getElementById("status").textContent = "INTEGRITY FAILURE";

  // slow drawn-out audio collapse
  if (typeof collapseAudio === "function") collapseAudio();

  // Optional: after a few seconds, show message
  setTimeout(() => {
    if (!hasWon) document.getElementById("status").textContent = "RECOVERY FAILED";
  }, 4200);
}

function playerDeath(){
  deaths++;

  if (typeof degradeAudio === "function") degradeAudio();

  const integrity = updateIntegrityUI();

  // Reset position
  player = { x: 8, y: 15 };

  if (integrity <= 0){
    triggerCollapse();
  }
}

function winGame(){
  hasWon = true;
  document.getElementById("status").textContent = "ASCENSION";
}

function update(){
  if (!started || hasWon || isCollapsed) return;

  obstacles.forEach(o => {
    o.x += o.speed;
    if (o.x > GRID_W) o.x = 0;

    if (Math.floor(o.x) === player.x && o.y === player.y){
      playerDeath();
    }
  });

  // WIN CONDITION: reach the discolored top row (row 0)
  if (player.y === 0){
    crossings++;
    round++;

    // reset position for next crossing
    player = { x: 8, y: 15 };

    if (crossings >= 3){
      winGame();
      return;
    }

    document.getElementById("status").textContent = "ROUND " + round;
    spawnObstacles();
  }
}

function draw(){
  ctx.fillStyle = "#120a08";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // goal band (row 0)
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, 0, canvas.width, TILE);

  // obstacles
  ctx.fillStyle = "#d07a2a";
  obstacles.forEach(o => {
    ctx.fillRect(Math.floor(o.x) * TILE, o.y * TILE, TILE, TILE);
  });

  // player
  if (!hasWon){
    ctx.fillStyle = isCollapsed ? "#5a5a5a" : "#c7372c";
    ctx.fillRect(player.x * TILE, player.y * TILE, TILE, TILE);
  } else {
    // green hood + scepter
    ctx.fillStyle = "#2fbf5a";
    ctx.fillRect(player.x * TILE, player.y * TILE, TILE, TILE);
    ctx.fillStyle = "#d8d8d8";
    ctx.fillRect(player.x * TILE + TILE - 6, player.y * TILE + 6, 3, TILE - 12);

    ctx.fillStyle = "#e6e6e6";
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ASCENDED", canvas.width / 2, canvas.height / 2);
    ctx.font = "12px monospace";
    ctx.fillText("RECOVERY TEAM: LA5", canvas.width / 2, canvas.height / 2 + 18);
  }
}

function loop(){
  update();
  draw();
  requestAnimationFrame(loop);
}

spawnObstacles();
updateIntegrityUI();
loop();
