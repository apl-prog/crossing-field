// game.js — Liberando: Crossing Field (fixed audio start)
// Starts Web Audio only after a user gesture (keydown or tap/click), so music works on iOS/Chrome.

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

// Audio boot guard
let audioStarted = false;

function tryStartAudio() {
  if (audioStarted) return;
  audioStarted = true;

  // initAudio is defined in audio.js
  initAudio().catch(err => {
    console.error("Audio init failed:", err);
    audioStarted = false; // allow retry
  });
}

// Controls + audio unlock
document.addEventListener("keydown", e => {
  tryStartAudio();

  if (hasWon) return;

  if (e.key === "ArrowLeft")  player.x--;
  if (e.key === "ArrowRight") player.x++;
  if (e.key === "ArrowUp")    player.y--;
  if (e.key === "ArrowDown")  player.y++;

  // clamp to grid
  player.x = Math.max(0, Math.min(GRID_W - 1, player.x));
  player.y = Math.max(0, Math.min(GRID_H - 1, player.y));
});

// Tap/click also unlocks audio for mobile
canvas.addEventListener("pointerdown", () => {
  tryStartAudio();
}, { passive: true });

function spawnObstacles() {
  obstacles = [];
  for (let y = 2; y < 14; y += 2) {
    obstacles.push({
      x: Math.floor(Math.random() * GRID_W),
      y,
      speed: 0.02 + round * 0.01
    });
  }
}

function update() {
  if (hasWon) return;

  // Move obstacles
  obstacles.forEach(o => {
    o.x += o.speed;
    if (o.x > GRID_W) o.x = 0;

    // collision check
    if (Math.floor(o.x) === player.x && o.y === player.y) {
      playerDeath();
    }
  });

  // Reached top
  if (player.y < 0) {
    crossings++;
    round++;

    player.y = 15;
    player.x = 8;

    if (crossings >= 3) {
      winGame();
      return;
    }

    document.getElementById("status").textContent = "ROUND " + round;
    spawnObstacles();
  }
}

function playerDeath() {
  deaths++;

  // degradeAudio is defined in audio.js
  if (typeof degradeAudio === "function") degradeAudio();

  const integrity = Math.max(0, 100 - deaths * 15);
  document.getElementById("integrity").textContent = "INTEGRITY: " + integrity + "%";

  player = { x: 8, y: 15 };
}

function winGame() {
  hasWon = true;
  document.getElementById("status").textContent = "ASCENSION";
}

function draw() {
  // background
  ctx.fillStyle = "#120a08";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // goal band
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, 0, canvas.width, TILE);

  // obstacles
  ctx.fillStyle = "#d07a2a"; // orange-ish blocks
  obstacles.forEach(o => {
    ctx.fillRect(Math.floor(o.x) * TILE, o.y * TILE, TILE, TILE);
  });

  // player
  if (!hasWon) {
    ctx.fillStyle = "#c7372c"; // red
    ctx.fillRect(player.x * TILE, player.y * TILE, TILE, TILE);
  } else {
    // green hood + scepter (simple)
    ctx.fillStyle = "#2fbf5a"; // hood
    ctx.fillRect(player.x * TILE, player.y * TILE, TILE, TILE);
    ctx.fillStyle = "#d8d8d8"; // scepter
    ctx.fillRect(player.x * TILE + TILE - 6, player.y * TILE + 6, 3, TILE - 12);

    ctx.fillStyle = "#e6e6e6";
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ASCENDED", canvas.width / 2, canvas.height / 2);
    ctx.font = "12px monospace";
    ctx.fillText("RECOVERY TEAM: LA5", canvas.width / 2, canvas.height / 2 + 18);
  }
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

spawnObstacles();
loop();
