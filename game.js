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

document.addEventListener("keydown", e=>{
  if(e.key==="ArrowLeft") player.x--;
  if(e.key==="ArrowRight") player.x++;
  if(e.key==="ArrowUp") player.y--;
  if(e.key==="ArrowDown") player.y++;
});

function spawnObstacles(){
  obstacles = [];
  for(let y=2;y<14;y+=2){
    obstacles.push({
      x: Math.floor(Math.random()*GRID_W),
      y,
      speed: 0.02 + round*0.01
    });
  }
}

function update(){
  obstacles.forEach(o=>{
    o.x += o.speed;
    if(o.x>GRID_W) o.x=0;

    if(Math.floor(o.x)===player.x && o.y===player.y){
      playerDeath();
    }
  });

  if(player.y<0){
    crossings++;
    round++;
    document.getElementById("status").textContent="ROUND "+round;
    player.y=15;
    if(crossings===3){
      winGame();
    }
    spawnObstacles();
  }
}

function playerDeath(){
  deaths++;
  degradeAudio();
  document.getElementById("integrity").textContent =
    "INTEGRITY: "+Math.max(0,100-deaths*15)+"%";
  player = { x:8, y:15 };
}

function winGame(){
  ctx.fillStyle="green";
  ctx.fillRect(player.x*TILE, player.y*TILE, TILE, TILE);
  ctx.fillStyle="white";
  ctx.fillText("ASCENDED", 200, 250);
}

function draw(){
  ctx.fillStyle="#120a08";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.fillStyle="red";
  ctx.fillRect(player.x*TILE, player.y*TILE, TILE, TILE);

  ctx.fillStyle="orange";
  obstacles.forEach(o=>{
    ctx.fillRect(Math.floor(o.x)*TILE, o.y*TILE, TILE, TILE);
  });
}

function loop(){
  update();
  draw();
  requestAnimationFrame(loop);
}

spawnObstacles();
initAudio();
loop();