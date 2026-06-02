import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ReplayFrame, ReplayHeader } from "./record.ts";

export interface Replay {
  header: ReplayHeader;
  frames: ReplayFrame[];
}

export function loadReplay(path: string): Replay {
  const lines = readFileSync(resolve(path), "utf8").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error(`Empty replay: ${path}`);
  const header = JSON.parse(lines[0]!) as ReplayHeader;
  const frames = lines.slice(1).map((l) => JSON.parse(l) as ReplayFrame);
  return { header, frames };
}

export interface ViewerResult {
  path: string;
  kib: number;
  frames: number;
  durationSec: number;
}

export async function writeReplayViewer(replayPath: string, outPath?: string): Promise<ViewerResult> {
  const replay = loadReplay(replayPath);
  const out = resolve(outPath ?? "out/replay.html");
  const html = render(JSON.stringify(replay));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, "utf8");
  const durationSec = replay.frames.length ? Math.round((replay.frames[replay.frames.length - 1]!.t / 1000) * 10) / 10 : 0;
  return { path: out, kib: Math.round((Buffer.byteLength(html) / 1024) * 10) / 10, frames: replay.frames.length, durationSec };
}

const CLIENT = `
const frames = DATA.frames;
const COLOR = { players:'#63e0a0', monsters:'#e06a6a', npcs:'#e6c463' };
let i = 0, playing = false, speed = 1, clock = 0, raf = 0, lastT = 0, floor = null;

const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const scrub = document.getElementById('scrub'), playBtn = document.getElementById('play');
const dur = frames.length ? frames[frames.length-1].t : 0;
scrub.max = String(Math.max(0, frames.length-1));

function fmt(ms){ var s = Math.floor(ms/1000); return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2); }
function floorsIn(f){ var s = {}; ['players','monsters','npcs'].forEach(function(k){ f[k].forEach(function(e){ s[e.floor]=1; }); }); return Object.keys(s).map(Number).sort(function(a,b){return a-b;}); }
function pickFloor(f){ if(floor!==null && floorsIn(f).indexOf(floor)>=0) return floor; var best=null,bc=-1; var c={}; ['players','monsters','npcs'].forEach(function(k){ f[k].forEach(function(e){ c[e.floor]=(c[e.floor]||0)+1; }); }); for(var k in c){ if(c[k]>bc){bc=c[k];best=Number(k);} } return best; }
function bounds(fl){ var minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9,any=false;
  frames.forEach(function(f){ ['players','monsters','npcs'].forEach(function(k){ f[k].forEach(function(e){ if(e.floor!==fl) return; any=true; if(e.x<minx)minx=e.x; if(e.y<miny)miny=e.y; if(e.x>maxx)maxx=e.x; if(e.y>maxy)maxy=e.y; }); }); });
  if(!any) return {minx:0,miny:0,maxx:110,maxy:72}; var pad=3; return {minx:minx-pad,miny:miny-pad,maxx:maxx+pad,maxy:maxy+pad}; }

let curFloor = null, curBounds = null;
function draw(){
  var f = frames[i]; if(!f) return;
  var fl = pickFloor(f);
  if(fl !== curFloor){ curFloor = fl; curBounds = bounds(fl); renderFloorTabs(f); }
  var b = curBounds, W = cv.width, H = cv.height;
  ctx.clearRect(0,0,W,H); ctx.fillStyle='#0a0d0a'; ctx.fillRect(0,0,W,H);
  var sx = W/Math.max(1,(b.maxx-b.minx)), sy = H/Math.max(1,(b.maxy-b.miny)), s=Math.min(sx,sy);
  function px(x){ return (x-b.minx)*s; } function py(y){ return (y-b.miny)*s; }
  ['npcs','monsters','players'].forEach(function(k){
    f[k].forEach(function(e){ if(e.floor!==fl) return;
      ctx.fillStyle = COLOR[k]; ctx.beginPath(); ctx.arc(px(e.x),py(e.y), k==='players'?5:4, 0, 7); ctx.fill();
      if(e.maxHp){ var hpf=Math.max(0,Math.min(1,e.hp/e.maxHp)); ctx.strokeStyle='rgba(0,0,0,.6)'; ctx.fillStyle=hpf>0.5?'#6c6':hpf>0.25?'#cc6':'#c66'; ctx.fillRect(px(e.x)-6, py(e.y)-9, 12*hpf, 2); }
    });
  });
  document.getElementById('time').textContent = fmt(f.t)+' / '+fmt(dur);
  document.getElementById('counts').textContent = 'floor '+fl+' · '+f.counts.players+'p '+f.counts.monsters+'m '+f.counts.npcs+'n '+f.counts.corpses+'c';
  renderEvents();
  scrub.value = String(i);
}
function renderFloorTabs(f){
  var box = document.getElementById('floors'); box.innerHTML='';
  floorsIn(f).forEach(function(fl){ var b=document.createElement('button'); b.className='tab'+(fl===curFloor?' active':''); b.textContent='Floor '+fl; b.onclick=function(){ floor=fl; curFloor=null; draw(); }; box.appendChild(b); });
}
function renderEvents(){
  var box = document.getElementById('events'); var out=[]; var seen=0;
  for(var j=0;j<=i;j++){ frames[j].events.forEach(function(e){ out.push('<div class="ev"><span class="et">'+esc(e.type)+'</span> '+esc(e.text)+(e.floor!=null?' <span class="ef">f'+e.floor+'</span>':'')+'</div>'); }); }
  box.innerHTML = out.slice(-120).reverse().join('') || '<div class="muted">no events yet</div>';
}
function esc(s){ return String(s).replace(/[&<>]/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c];}); }

function seek(idx){ i=Math.max(0,Math.min(frames.length-1,idx)); clock=frames[i]?frames[i].t:0; draw(); }
function tick(ts){ if(!playing){ return; } if(!lastT) lastT=ts; clock += (ts-lastT)*speed; lastT=ts;
  while(i<frames.length-1 && frames[i+1].t<=clock) i++;
  draw();
  if(i>=frames.length-1){ playing=false; playBtn.textContent='▶'; }
  if(playing) raf=requestAnimationFrame(tick);
}
playBtn.onclick = function(){ playing=!playing; playBtn.textContent=playing?'❚❚':'▶'; lastT=0; if(playing){ if(i>=frames.length-1) seek(0); raf=requestAnimationFrame(tick); } };
scrub.oninput = function(e){ playing=false; playBtn.textContent='▶'; seek(Number(e.target.value)); };
document.querySelectorAll('[data-speed]').forEach(function(b){ b.onclick=function(){ speed=Number(b.getAttribute('data-speed')); document.querySelectorAll('[data-speed]').forEach(function(x){x.classList.remove('on');}); b.classList.add('on'); }; });
document.addEventListener('keydown', function(e){ if(e.key===' '){ e.preventDefault(); playBtn.click(); } if(e.key==='ArrowRight') seek(i+1); if(e.key==='ArrowLeft') seek(i-1); });
seek(0);
`;

function render(json: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>TIB Session Replay</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;background:#0f1210;color:#e7efe6;font:13px/1.45 ui-sans-serif,system-ui,sans-serif}
  header{padding:10px 16px;border-bottom:1px solid #232b22;display:flex;gap:16px;align-items:baseline}
  header b{color:#9ee6b1}.muted{color:#8fa08f}
  .wrap{display:grid;grid-template-columns:1fr 340px;height:calc(100vh - 92px)}
  .stage{padding:14px;overflow:auto}.side{border-left:1px solid #232b22;overflow:auto;padding:12px}
  canvas{background:#0a0d0a;border:1px solid #232b22;width:100%;max-width:900px;aspect-ratio:1.5;image-rendering:pixelated}
  .floors{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
  .tab{background:#1b211b;color:#cfe0d2;border:1px solid #2c382c;border-radius:6px;padding:4px 9px;cursor:pointer;font-size:12px}
  .tab.active{background:#2f5d3a;border-color:#4f9d6a;color:#eafff0}
  .transport{display:flex;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid #232b22;background:#0c0f0c}
  .transport button{background:#1b211b;color:#cfe0d2;border:1px solid #2c382c;border-radius:6px;padding:6px 12px;cursor:pointer}
  .transport button.on{background:#2f5d3a;border-color:#4f9d6a;color:#eafff0}
  #scrub{flex:1;accent-color:#4f9d6a}#time{font-variant-numeric:tabular-nums;color:#9ee6b1}
  .legend{display:flex;gap:14px;margin-top:8px;color:#b9c6ba}.sw{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:5px;vertical-align:middle}
  h3{margin:2px 0 8px;color:#cfe0d2}
  .ev{border-bottom:1px solid #1c241c;padding:4px 0;color:#c7d2c7}.et{color:#9ee6b1;font-family:ui-monospace,monospace;font-size:11px}.ef{color:#8aa;font-size:11px}
</style></head>
<body>
<header><span><b>TIB Session Replay</b></span><span class="muted" id="counts"></span></header>
<div class="wrap">
  <div class="stage">
    <canvas id="cv" width="900" height="600"></canvas>
    <div class="floors" id="floors"></div>
    <div class="legend">
      <span><i class="sw" style="background:#63e0a0"></i>players</span>
      <span><i class="sw" style="background:#e06a6a"></i>monsters</span>
      <span><i class="sw" style="background:#e6c463"></i>npcs</span>
      <span class="muted">space = play/pause · ←/→ = step</span>
    </div>
  </div>
  <div class="side"><h3>Events</h3><div id="events"></div></div>
</div>
<div class="transport">
  <button id="play">▶</button>
  <input type="range" id="scrub" min="0" value="0">
  <span id="time">0:00 / 0:00</span>
  <button data-speed="1" class="on">1×</button>
  <button data-speed="2">2×</button>
  <button data-speed="4">4×</button>
</div>
<script>const DATA = ${json};</script>
<script>${CLIENT}</script>
</body></html>`;
}
