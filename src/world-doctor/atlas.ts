import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadCatalog } from "../game/index.ts";
import { analyzeWorld } from "./index.ts";

// Builds a self-contained interactive HTML atlas: per-floor canvas coloured by
// walkable / reachable / unreachable / safe / road / portal, with entity dots
// and the findings list. No external libraries.

interface AtlasEntity {
  tx: number;
  ty: number;
  kind: string;
  label: string;
}
interface AtlasPortal {
  tx: number;
  ty: number;
  toFloor: number;
  gated: boolean;
}
interface AtlasFloor {
  floor: number;
  cols: number;
  rows: number;
  /** rows*cols category chars, row-major: # . x s r P */
  grid: string;
  portals: AtlasPortal[];
  entities: AtlasEntity[];
}

export interface AtlasResult {
  path: string;
  kib: number;
  floors: number;
  findings: number;
}

export async function writeAtlas(outPath?: string): Promise<AtlasResult> {
  const [{ world, reach, portals, findings, summary }, catalog] = await Promise.all([analyzeWorld(), loadCatalog()]);
  const shared = world.shared;

  const portalsByFloor = new Map<number, AtlasPortal[]>();
  for (const p of portals) {
    const list = portalsByFloor.get(p.fromFloor) ?? [];
    list.push({ tx: p.fromTx, ty: p.fromTy, toFloor: p.toFloor, gated: Boolean(p.gated) });
    portalsByFloor.set(p.fromFloor, list);
  }

  const entitiesByFloor = new Map<number, AtlasEntity[]>();
  const push = (floor: number, e: AtlasEntity): void => {
    const list = entitiesByFloor.get(floor) ?? [];
    list.push(e);
    entitiesByFloor.set(floor, list);
  };
  for (const s of catalog.MONSTER_SPAWNS) push(s.floor, { tx: Math.floor(s.x), ty: Math.floor(s.y), kind: "spawn", label: s.type });
  for (const n of catalog.NPCS) push(n.floor, { tx: Math.floor(n.x), ty: Math.floor(n.y), kind: "npc", label: n.name });
  for (const n of catalog.MINING_NODES) push(n.floor, { tx: Math.floor(n.x), ty: Math.floor(n.y), kind: "mining", label: n.kind });
  for (const n of catalog.HERB_NODES) push(n.floor, { tx: Math.floor(n.x), ty: Math.floor(n.y), kind: "herb", label: n.label });
  for (const n of catalog.FISHING_NODES) push(n.floor, { tx: Math.floor(n.x), ty: Math.floor(n.y), kind: "fishing", label: n.id });
  for (const t of catalog.COMPOSED_TREE_NODES) push(t.floor, { tx: Math.floor(t.x), ty: Math.floor(t.y), kind: "tree", label: t.type });

  const floors: AtlasFloor[] = world.floors.map((fm) => {
    let grid = "";
    for (let ty = 0; ty < fm.rows; ty += 1) {
      for (let tx = 0; tx < fm.cols; tx += 1) {
        grid += categoryChar(world, shared, reach, fm.floor, tx, ty);
      }
    }
    return {
      floor: fm.floor,
      cols: fm.cols,
      rows: fm.rows,
      grid,
      portals: portalsByFloor.get(fm.floor) ?? [],
      entities: entitiesByFloor.get(fm.floor) ?? []
    };
  });

  const data = { floors, findings, summary };
  const html = renderHtml(data);
  const path = resolve(outPath ?? "out/world-atlas.html");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html, "utf8");
  return { path, kib: Math.round((Buffer.byteLength(html) / 1024) * 10) / 10, floors: floors.length, findings: findings.length };
}

function categoryChar(
  world: Awaited<ReturnType<typeof analyzeWorld>>["world"],
  shared: Awaited<ReturnType<typeof analyzeWorld>>["world"]["shared"],
  reach: Awaited<ReturnType<typeof analyzeWorld>>["reach"],
  floor: number,
  tx: number,
  ty: number
): string {
  if (!world.isWalkable(floor, tx, ty)) return "#";
  if (!reach.has(floor, tx, ty)) return "x"; // walkable but unreachable — the headline overlay
  if (shared.isSafeZone(floor, tx + 0.5, ty + 0.5)) return "s";
  if (shared.isRoadTile(world.tile(floor, tx, ty))) return "r";
  return ".";
}

function renderHtml(data: unknown): string {
  const json = JSON.stringify(data);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>TIB World Atlas</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f1210; color: #e7efe6; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
  header { padding: 10px 14px; border-bottom: 1px solid #232b22; display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; }
  header b { color: #9ee6b1; }
  .wrap { display: grid; grid-template-columns: 1fr 360px; gap: 0; height: calc(100vh - 46px); }
  .stage { overflow: auto; padding: 14px; }
  .side { border-left: 1px solid #232b22; overflow: auto; padding: 12px 14px; }
  .floors { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .floors button { background: #1b211b; color: #cfe0d2; border: 1px solid #2c382c; border-radius: 6px; padding: 5px 9px; cursor: pointer; }
  .floors button.active { background: #2f5d3a; border-color: #4f9d6a; color: #eafff0; }
  canvas { image-rendering: pixelated; border: 1px solid #232b22; background: #07090a; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; margin: 10px 0; color: #b9c6ba; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; border: 1px solid #0008; }
  .toggles { display: flex; gap: 14px; flex-wrap: wrap; margin: 6px 0 12px; }
  label.t { display: inline-flex; gap: 5px; align-items: center; color: #c2cdc2; cursor: pointer; }
  h3 { margin: 14px 0 6px; color: #cfe0d2; }
  .find { border: 1px solid #2a332a; border-radius: 6px; padding: 7px 9px; margin-bottom: 7px; }
  .find.error { border-color: #7a2b2b; } .find.warn { border-color: #7a6a2b; } .find.info { border-color: #2b4a6a; }
  .find .sub { color: #9ee6b1; font-family: ui-monospace, monospace; font-size: 12px; cursor: pointer; }
  .find .rule { color: #8aa; float: right; font-size: 11px; }
  .find .msg { color: #c7d2c7; margin-top: 3px; }
  .muted { color: #8fa08f; }
  input[type=search] { width: 100%; background: #0b0f0c; border: 1px solid #2c382c; color: #fff; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; }
</style></head>
<body>
<header>
  <span><b>TIB World Atlas</b></span>
  <span class="muted" id="summary"></span>
</header>
<div class="wrap">
  <div class="stage">
    <div class="floors" id="floorTabs"></div>
    <div class="legend">
      <span><i class="sw" style="background:#2f3b2f"></i>reachable</span>
      <span><i class="sw" style="background:#7a2b2b"></i>unreachable</span>
      <span><i class="sw" style="background:#2f5d3a"></i>safe</span>
      <span><i class="sw" style="background:#5a4a2a"></i>road</span>
      <span><i class="sw" style="background:#1a1f1a"></i>blocked</span>
      <span><i class="sw" style="background:#c8a24a"></i>portal</span>
    </div>
    <div class="toggles">
      <label class="t"><input type="checkbox" id="tEnt" checked>entities</label>
      <label class="t"><input type="checkbox" id="tPortals" checked>portals</label>
      <label class="t"><input type="checkbox" id="tGrid" checked>terrain</label>
    </div>
    <canvas id="cv"></canvas>
    <div id="hover" class="muted" style="margin-top:8px;height:18px"></div>
  </div>
  <div class="side">
    <h3>Findings</h3>
    <input type="search" id="q" placeholder="filter findings...">
    <div id="findings"></div>
  </div>
</div>
<script>
const DATA = ${json};
const CELL = 7;
const COLOR = { '#':'#1a1f1a', '.':'#2f3b2f', 'x':'#7a2b2b', 's':'#2f5d3a', 'r':'#5a4a2a' };
const EKOLOR = { spawn:'#e06a6a', npc:'#63c7e0', mining:'#c8a24a', herb:'#7cd07c', fishing:'#6ab0e6', tree:'#4f9d6a' };
let cur = DATA.floors[0];
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
document.getElementById('summary').textContent =
  DATA.summary.floors + ' floors · ' + DATA.summary.portals + ' portals · ' +
  DATA.summary.reachableTiles + '/' + DATA.summary.walkableTiles + ' tiles reachable · ' +
  DATA.summary.errors + ' err / ' + DATA.summary.warnings + ' warn / ' + DATA.summary.infos + ' info';

const tabs = document.getElementById('floorTabs');
DATA.floors.forEach((f, i) => {
  const b = document.createElement('button');
  b.textContent = 'Floor ' + f.floor;
  if (i === 0) b.classList.add('active');
  b.onclick = () => { cur = f; [...tabs.children].forEach(c => c.classList.remove('active')); b.classList.add('active'); draw(); };
  tabs.appendChild(b);
});
['tEnt','tPortals','tGrid'].forEach(id => document.getElementById(id).onchange = draw);

function draw() {
  const f = cur;
  cv.width = f.cols * CELL; cv.height = f.rows * CELL;
  ctx.clearRect(0,0,cv.width,cv.height);
  if (document.getElementById('tGrid').checked) {
    for (let ty=0; ty<f.rows; ty++) for (let tx=0; tx<f.cols; tx++) {
      const ch = f.grid[ty*f.cols+tx];
      ctx.fillStyle = COLOR[ch] || '#1a1f1a';
      ctx.fillRect(tx*CELL, ty*CELL, CELL, CELL);
    }
  } else { ctx.fillStyle='#07090a'; ctx.fillRect(0,0,cv.width,cv.height); }
  if (document.getElementById('tEnt').checked) {
    for (const e of f.entities) {
      ctx.fillStyle = EKOLOR[e.kind] || '#fff';
      ctx.beginPath(); ctx.arc(e.tx*CELL+CELL/2, e.ty*CELL+CELL/2, CELL*0.42, 0, 7); ctx.fill();
    }
  }
  if (document.getElementById('tPortals').checked) {
    for (const p of f.portals) {
      ctx.fillStyle = p.gated ? '#e0863a' : '#c8a24a';
      ctx.fillRect(p.tx*CELL, p.ty*CELL, CELL, CELL);
      ctx.strokeStyle = '#000'; ctx.strokeRect(p.tx*CELL+0.5, p.ty*CELL+0.5, CELL-1, CELL-1);
    }
  }
}
cv.addEventListener('mousemove', ev => {
  const r = cv.getBoundingClientRect();
  const tx = Math.floor((ev.clientX-r.left)/CELL), ty = Math.floor((ev.clientY-r.top)/CELL);
  const hits = cur.entities.filter(e => e.tx===tx && e.ty===ty).map(e => e.kind+':'+e.label);
  document.getElementById('hover').textContent = '('+tx+','+ty+') '+(hits.join(', ')||'');
});

function renderFindings(filter) {
  const box = document.getElementById('findings');
  box.innerHTML = '';
  const f = (filter||'').toLowerCase();
  for (const fi of DATA.findings) {
    if (f && !(fi.subject+' '+fi.message+' '+fi.rule).toLowerCase().includes(f)) continue;
    const d = document.createElement('div');
    d.className = 'find ' + fi.severity;
    d.innerHTML = '<span class="rule">'+fi.rule+'</span><span class="sub">'+fi.subject+'</span><div class="msg">'+fi.message+'</div>';
    d.querySelector('.sub').onclick = () => {
      const m = fi.subject.match(/floor:(\\d+)|@(\\d+)\\((\\d+),(\\d+)\\)|@(\\d+)/);
      const fm = fi.subject.match(/(?:floor:|@)(\\d+)/);
      if (fm) { const tgt = DATA.floors.find(x => x.floor === Number(fm[1])); if (tgt) { cur = tgt; [...tabs.children].forEach((c,i)=>c.classList.toggle('active', DATA.floors[i]===tgt)); draw(); } }
    };
    box.appendChild(d);
  }
}
document.getElementById('q').oninput = e => renderFindings(e.target.value);
draw(); renderFindings('');
</script>
</body></html>`;
}
