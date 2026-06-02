import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadCatalog, type Catalog } from "../game/index.ts";
import type { Finding } from "../content-graph/index.ts";
import { analyzeWorld } from "./index.ts";

// Builds a self-contained interactive HTML atlas: per-floor canvas coloured by
// walkable / reachable / unreachable / safe / road / portal, with entity dots,
// the findings list, zoom/pan, fly-to-finding, and portal/entity inspection.
// No external libraries.

interface AtlasEntity {
  tx: number;
  ty: number;
  kind: string;
  label: string;
  reachable: boolean;
}
interface AtlasPortal {
  tx: number;
  ty: number;
  toFloor: number;
  toTx: number;
  toTy: number;
  gated: boolean;
}
interface AtlasFloor {
  floor: number;
  cols: number;
  rows: number;
  /** rows*cols category chars, row-major: # . x s r */
  grid: string;
  portals: AtlasPortal[];
  entities: AtlasEntity[];
}

/** A finding plus a resolved location the UI can fly to. */
interface AtlasFinding extends Finding {
  /** Floor the finding lives on (undefined for non-spatial). */
  floor?: number;
  /** Tile to centre on, when known. */
  tx?: number;
  ty?: number;
  /** Region span (tiles) when the finding is about an area — drives a softer zoom. */
  span?: number;
}

export interface AtlasResult {
  path: string;
  kib: number;
  floors: number;
  findings: number;
}

export async function writeAtlas(outPath?: string): Promise<AtlasResult> {
  const [analysis, catalog] = await Promise.all([analyzeWorld(), loadCatalog()]);
  const { world, reach, regions, portals, findings, summary } = analysis;
  const shared = world.shared;

  const portalsByFloor = new Map<number, AtlasPortal[]>();
  for (const p of portals) {
    const list = portalsByFloor.get(p.fromFloor) ?? [];
    list.push({ tx: p.fromTx, ty: p.fromTy, toFloor: p.toFloor, toTx: p.toTx, toTy: p.toTy, gated: Boolean(p.gated) });
    portalsByFloor.set(p.fromFloor, list);
  }

  const entitiesByFloor = new Map<number, AtlasEntity[]>();
  const push = (floor: number, e: Omit<AtlasEntity, "reachable">): void => {
    const list = entitiesByFloor.get(floor) ?? [];
    list.push({ ...e, reachable: reach.has(floor, e.tx, e.ty) });
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

  const located = findings.map((f) => locateFinding(f, catalog, regions));

  const start = { floor: world.start.floor, tx: world.start.tx, ty: world.start.ty };
  const data = { floors, findings: located, summary, start };
  const html = renderHtml(data);
  const path = resolve(outPath ?? "out/world-atlas.html");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html, "utf8");
  return { path, kib: Math.round((Buffer.byteLength(html) / 1024) * 10) / 10, floors: floors.length, findings: findings.length };
}

/**
 * Resolve a finding's subject to a concrete tile so the atlas can fly there.
 * Done here (not in the browser) because it needs the catalog: node findings'
 * subjects encode the node tile, but the issue is about the *approach* tile.
 */
function locateFinding(
  f: Finding,
  catalog: Catalog,
  regions: ReadonlyArray<{ floor: number; size: number; sampleTx: number; sampleTy: number }>
): AtlasFinding {
  const s = f.subject;
  let m: RegExpExecArray | null;

  // region: "floor:6@(78,44)" — flag the whole sealed component (use its size).
  if ((m = /^floor:(\d+)@\((\d+),(\d+)\)/.exec(s))) {
    const floor = Number(m[1]);
    const tx = Number(m[2]);
    const ty = Number(m[3]);
    const region = regions.find((r) => r.floor === floor && r.sampleTx === tx && r.sampleTy === ty);
    return { ...f, floor, tx, ty, span: region ? Math.max(8, Math.round(Math.sqrt(region.size) * 1.6)) : undefined };
  }

  // floor-wide: "floor:6"
  if ((m = /^floor:(\d+)$/.exec(s))) {
    return { ...f, floor: Number(m[1]) };
  }

  // portal: "portal:1@(55,1)->0" — the source tile.
  if ((m = /^portal:(\d+)@\((\d+),(\d+)\)/.exec(s))) {
    return { ...f, floor: Number(m[1]), tx: Number(m[2]), ty: Number(m[3]) };
  }

  // entity on a tile: "spawn:type@3(81,25)" / "tree:type@3(22,7)"
  if ((m = /@(\d+)\((\d+),(\d+)\)/.exec(s))) {
    return { ...f, floor: Number(m[1]), tx: Number(m[2]), ty: Number(m[3]) };
  }

  // node findings: subject is "kind:id"; the issue is the approach tile.
  if ((m = /^(mining|herb|fishing):(.+)$/.exec(s))) {
    const kind = m[1];
    const id = m[2]!;
    const node =
      kind === "mining"
        ? catalog.MINING_NODES.find((n) => n.id === id)
        : kind === "herb"
          ? catalog.HERB_NODES.find((n) => n.id === id)
          : catalog.FISHING_NODES.find((n) => n.id === id);
    if (node) {
      return { ...f, floor: node.floor, tx: Math.floor(node.approachX), ty: Math.floor(node.approachY) };
    }
  }

  // npc: "npc:id" — look it up.
  if ((m = /^npc:(.+)$/.exec(s))) {
    const npc = catalog.NPCS.find((n) => n.id === m![1]);
    if (npc) return { ...f, floor: npc.floor, tx: Math.floor(npc.x), ty: Math.floor(npc.y) };
  }

  return { ...f };
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TIB World Atlas</title>
<style>
  :root { color-scheme: dark; --bg:#0f1210; --panel:#141a14; --line:#232b22; --accent:#9ee6b1; --mono: ui-monospace, SFMono-Regular, Menlo, monospace; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: #e7efe6; font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
  header { padding: 9px 14px; border-bottom: 1px solid var(--line); display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; }
  header b { color: var(--accent); font-size: 14px; }
  header .summary { color: #8fa08f; }
  header .summary .err { color:#ff8b8b; } header .summary .warn { color:#e6cf6a; }
  .wrap { display: grid; grid-template-columns: 1fr 380px; height: calc(100vh - 42px); }
  .stage { position: relative; overflow: hidden; background:
      radial-gradient(circle at 50% 0%, #131a14, #0a0d0b 70%); }
  .floors { position:absolute; top:10px; left:10px; z-index:5; display: flex; gap: 6px; flex-wrap: wrap; max-width: calc(100% - 20px); }
  .floors button { background: rgba(20,26,20,.82); color: #cfe0d2; border: 1px solid #2c382c; border-radius: 6px; padding: 4px 9px; cursor: pointer; font-size:12px; backdrop-filter: blur(3px); }
  .floors button.active { background: #2f5d3a; border-color: #4f9d6a; color: #eafff0; }
  .floors button .badge { color:#ff8b8b; font-weight:700; margin-left:5px; }
  #view { position:absolute; inset:0; cursor: grab; touch-action: none; }
  #view.grabbing { cursor: grabbing; }
  #cv { position:absolute; left:0; top:0; transform-origin: 0 0; image-rendering: pixelated; box-shadow: 0 0 0 1px #232b22, 0 18px 50px #0009; }
  .controls { position:absolute; right:10px; top:10px; z-index:5; display:flex; flex-direction:column; gap:6px; align-items:flex-end; }
  .ctlrow { display:flex; gap:6px; }
  .controls button { background: rgba(20,26,20,.82); color:#cfe0d2; border:1px solid #2c382c; border-radius:6px; padding:5px 9px; cursor:pointer; min-width:30px; font-size:13px; backdrop-filter: blur(3px); }
  .controls button:hover { border-color:#4f9d6a; }
  .toggles { position:absolute; left:10px; bottom:10px; z-index:5; display:flex; gap:12px; background: rgba(15,18,16,.82); padding:6px 10px; border:1px solid var(--line); border-radius:8px; backdrop-filter: blur(3px); }
  label.t { display: inline-flex; gap: 5px; align-items: center; color: #c2cdc2; cursor: pointer; user-select:none; }
  .legend { position:absolute; right:10px; bottom:10px; z-index:5; display:flex; gap:10px; flex-wrap:wrap; max-width:46%; justify-content:flex-end;
            background: rgba(15,18,16,.82); padding:6px 10px; border:1px solid var(--line); border-radius:8px; color:#b9c6ba; backdrop-filter: blur(3px); }
  .legend span { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
  .sw { width: 11px; height: 11px; border-radius: 3px; display:inline-block; border:1px solid #0008; }
  .sw.dot { border-radius:50%; }
  #tip { position:absolute; z-index:9; pointer-events:none; background:#0b0f0c; border:1px solid #3a4a3a; border-radius:6px; padding:6px 8px; font-size:12px; color:#e7efe6; max-width:260px; box-shadow:0 6px 20px #000a; display:none; }
  #tip .k { color:#9ee6b1; font-family:var(--mono); }
  #tip .muted { color:#8fa08f; }
  .side { border-left: 1px solid var(--line); overflow: hidden; display:flex; flex-direction:column; background: var(--panel); }
  .side .head { padding: 10px 14px 8px; border-bottom:1px solid var(--line); }
  .side h3 { margin: 0 0 8px; color: #cfe0d2; font-size:13px; display:flex; justify-content:space-between; align-items:center; }
  .navbtns { display:flex; gap:6px; }
  .navbtns button { background:#1b211b; color:#cfe0d2; border:1px solid #2c382c; border-radius:6px; padding:3px 9px; cursor:pointer; font-size:12px; }
  .navbtns button:hover { border-color:#4f9d6a; }
  .sevfilter { display:flex; gap:6px; margin-top:8px; }
  .sevfilter button { flex:1; background:#10140f; border:1px solid #2c382c; border-radius:6px; padding:4px; cursor:pointer; color:#b9c6ba; font-size:11px; }
  .sevfilter button.on.error { background:#3a1d1d; border-color:#7a2b2b; color:#ffb3b3; }
  .sevfilter button.on.warn { background:#33301a; border-color:#7a6a2b; color:#ecd98a; }
  .sevfilter button.on.info { background:#1b2733; border-color:#2b4a6a; color:#a9cdf0; }
  input[type=search] { width:100%; background:#0b0f0c; border:1px solid #2c382c; color:#fff; border-radius:6px; padding:6px 8px; margin-top:8px; }
  #findings { overflow:auto; padding: 8px 12px 16px; flex:1; }
  .find { border: 1px solid #2a332a; border-left-width:3px; border-radius: 6px; padding: 7px 9px; margin-bottom: 7px; cursor:pointer; transition: background .12s, border-color .12s; }
  .find:hover { background:#19211a; }
  .find.error { border-left-color: #c44; } .find.warn { border-left-color: #c9a93a; } .find.info { border-left-color: #4a78a8; }
  .find.sel { background:#1d271d; border-color:#4f9d6a; }
  .find .sub { color: #9ee6b1; font-family: var(--mono); font-size: 12px; word-break:break-all; }
  .find .rule { color: #8aa; float: right; font-size: 11px; margin-left:8px; }
  .find .msg { color: #c7d2c7; margin-top: 3px; }
  .find .sev { font-weight:700; margin-right:5px; }
  .find.error .sev { color:#ff8b8b; } .find.warn .sev { color:#e6cf6a; } .find.info .sev { color:#a9cdf0; }
  .find .nohit { color:#6a786a; font-style:italic; font-size:11px; }
  .empty { color:#8fa08f; padding:8px 2px; }
</style></head>
<body>
<header>
  <span><b>TIB World Atlas</b></span>
  <span class="summary" id="summary"></span>
</header>
<div class="wrap">
  <div class="stage">
    <div class="floors" id="floorTabs"></div>
    <div class="controls">
      <div class="ctlrow">
        <button id="zin" title="Zoom in">+</button>
        <button id="zout" title="Zoom out">−</button>
        <button id="fit" title="Fit floor to view">Fit</button>
      </div>
      <div class="ctlrow">
        <button id="prev" title="Previous issue">◀ issue</button>
        <button id="next" title="Next issue">issue ▶</button>
      </div>
    </div>
    <div id="view">
      <canvas id="cv"></canvas>
    </div>
    <div class="toggles">
      <label class="t"><input type="checkbox" id="tEnt" checked>entities</label>
      <label class="t"><input type="checkbox" id="tPortals" checked>portals</label>
      <label class="t"><input type="checkbox" id="tGrid" checked>terrain</label>
    </div>
    <div class="legend">
      <span><i class="sw" style="background:#2f3b2f"></i>reachable</span>
      <span><i class="sw" style="background:#9c2b2b"></i>unreachable</span>
      <span><i class="sw" style="background:#2f5d3a"></i>safe</span>
      <span><i class="sw" style="background:#5a4a2a"></i>road</span>
      <span><i class="sw" style="background:#1a1f1a"></i>blocked</span>
      <span><i class="sw" style="background:#c8a24a"></i>portal</span>
      <span><i class="sw dot" style="background:#e06a6a"></i>spawn</span>
      <span><i class="sw dot" style="background:#63c7e0"></i>npc</span>
    </div>
    <div id="tip"></div>
  </div>
  <div class="side">
    <div class="head">
      <h3><span>Findings</span><span class="navbtns"><button id="pPrev">↑ prev</button><button id="pNext">next ↓</button></span></h3>
      <div class="sevfilter">
        <button class="on error" data-sev="error" id="fError"></button>
        <button class="on warn" data-sev="warn" id="fWarn"></button>
        <button class="on info" data-sev="info" id="fInfo"></button>
      </div>
      <input type="search" id="q" placeholder="filter findings…">
    </div>
    <div id="findings"></div>
  </div>
</div>
<script>
const DATA = ${json};
const CELL = 7;
const COLOR = { '#':'#1a1f1a', '.':'#2f3b2f', 'x':'#9c2b2b', 's':'#2f5d3a', 'r':'#5a4a2a' };
const EKOLOR = { spawn:'#e06a6a', npc:'#63c7e0', mining:'#c8a24a', herb:'#7cd07c', fishing:'#6ab0e6', tree:'#4f9d6a' };
const SEV_SYM = { error:'✗', warn:'!', info:'·' };

const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const view = document.getElementById('view');
const tabs = document.getElementById('floorTabs');
const tip = document.getElementById('tip');

// View transform: world pixels -> screen via scale + translate (applied to canvas).
let cur = DATA.floors[0];
let scale = 1, ox = 0, oy = 0;
let highlight = null;     // {tx,ty,span,t0} pulsing marker in world tiles
let raf = null;
let selIdx = -1;          // selected finding index (into the *visible* list)

const counts = (sev) => DATA.findings.filter(f => f.severity === sev).length;
document.getElementById('summary').innerHTML =
  DATA.summary.floors + ' floors · ' + DATA.summary.portals + ' portals · ' +
  DATA.summary.reachableTiles.toLocaleString() + '/' + DATA.summary.walkableTiles.toLocaleString() + ' tiles reachable · ' +
  '<span class="err">' + DATA.summary.errors + ' err</span> / ' +
  '<span class="warn">' + DATA.summary.warnings + ' warn</span> / ' +
  DATA.summary.infos + ' info';
document.getElementById('fError').textContent = '✗ ' + counts('error');
document.getElementById('fWarn').textContent = '! ' + counts('warn');
document.getElementById('fInfo').textContent = '· ' + counts('info');

// ---- floor tabs (with per-floor error badge) ----
const errByFloor = {};
for (const f of DATA.findings) if (f.severity === 'error' && f.floor != null) errByFloor[f.floor] = (errByFloor[f.floor]||0)+1;
DATA.floors.forEach((f) => {
  const b = document.createElement('button');
  b.innerHTML = 'Floor ' + f.floor + (errByFloor[f.floor] ? ' <span class="badge">✗' + errByFloor[f.floor] + '</span>' : '');
  b.dataset.floor = f.floor;
  b.onclick = () => selectFloor(f.floor, true);
  tabs.appendChild(b);
});
function markActiveTab() {
  [...tabs.children].forEach(c => c.classList.toggle('active', Number(c.dataset.floor) === cur.floor));
}

function selectFloor(floor, fit) {
  const tgt = DATA.floors.find(x => x.floor === floor);
  if (!tgt) return false;
  cur = tgt;
  location.hash = 'floor=' + floor;
  markActiveTab();
  if (fit) fitView();
  draw();
  return true;
}

// ---- view math ----
function fitView() {
  const W = view.clientWidth, H = view.clientHeight, pad = 24;
  const fw = cur.cols * CELL, fh = cur.rows * CELL;
  scale = Math.min((W - pad) / fw, (H - pad) / fh);
  scale = Math.max(0.15, Math.min(scale, 6));
  ox = (W - fw * scale) / 2;
  oy = (H - fh * scale) / 2;
  applyTransform();
}
function applyTransform() {
  cv.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + scale + ')';
}
function zoomAt(factor, sx, sy) {
  const ns = Math.max(0.15, Math.min(8, scale * factor));
  // keep the world point under (sx,sy) fixed
  const wx = (sx - ox) / scale, wy = (sy - oy) / scale;
  scale = ns;
  ox = sx - wx * scale; oy = sy - wy * scale;
  applyTransform();
}

// fly so that world-tile (tx,ty) is centred, zooming to comfortably frame a span.
function flyTo(floor, tx, ty, span) {
  if (floor != null && floor !== cur.floor) selectFloor(floor, false);
  const W = view.clientWidth, H = view.clientHeight;
  const tiles = Math.max(10, span || 14);
  let ns = Math.min(W, H) / (tiles * CELL);
  ns = Math.max(0.4, Math.min(ns, 4));
  const wx = (tx + 0.5) * CELL, wy = (ty + 0.5) * CELL;
  scale = ns;
  ox = W / 2 - wx * scale;
  oy = H / 2 - wy * scale;
  applyTransform();
  highlight = { tx, ty, span: span || 0, t0: performance.now() };
  startPulse();
}

// ---- drawing ----
function draw() {
  const f = cur;
  cv.width = f.cols * CELL; cv.height = f.rows * CELL;
  if (document.getElementById('tGrid').checked) {
    for (let ty=0; ty<f.rows; ty++) for (let tx=0; tx<f.cols; tx++) {
      const ch = f.grid[ty*f.cols+tx];
      ctx.fillStyle = COLOR[ch] || '#1a1f1a';
      ctx.fillRect(tx*CELL, ty*CELL, CELL, CELL);
    }
    // make unreachable regions pop with a subtle outline-ish glow at low zoom
  } else { ctx.fillStyle='#07090a'; ctx.fillRect(0,0,cv.width,cv.height); }

  if (document.getElementById('tGrid').checked) markUnreachableRegions(f);

  if (document.getElementById('tPortals').checked) {
    for (const p of f.portals) {
      ctx.fillStyle = p.gated ? '#e0863a' : '#c8a24a';
      ctx.fillRect(p.tx*CELL, p.ty*CELL, CELL, CELL);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.strokeRect(p.tx*CELL+0.5, p.ty*CELL+0.5, CELL-1, CELL-1);
    }
  }
  if (document.getElementById('tEnt').checked) {
    for (const e of f.entities) {
      ctx.fillStyle = EKOLOR[e.kind] || '#fff';
      ctx.beginPath(); ctx.arc(e.tx*CELL+CELL/2, e.ty*CELL+CELL/2, CELL*0.42, 0, 7); ctx.fill();
      if (!e.reachable) { ctx.strokeStyle = '#ff5b5b'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(e.tx*CELL+CELL/2, e.ty*CELL+CELL/2, CELL*0.55, 0, 7); ctx.stroke(); }
    }
  }
  // START marker
  if (DATA.start && DATA.start.floor === f.floor) {
    const sx = DATA.start.tx*CELL+CELL/2, sy = DATA.start.ty*CELL+CELL/2;
    ctx.strokeStyle = '#eafff0'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(sx-4,sy); ctx.lineTo(sx+4,sy); ctx.moveTo(sx,sy-4); ctx.lineTo(sx,sy+4); ctx.stroke();
    ctx.font = '8px sans-serif'; ctx.fillStyle = '#eafff0'; ctx.fillText('START', sx+5, sy-3);
  }
  drawHighlight();
}

// Outline unreachable ('x') tiles whose neighbour isn't unreachable, so the
// sealed red regions read clearly even when zoomed out.
function markUnreachableRegions(f) {
  const isX = (tx, ty) => tx>=0 && ty>=0 && tx<f.cols && ty<f.rows && f.grid[ty*f.cols+tx] === 'x';
  ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = Math.max(1, CELL*0.18);
  for (let ty=0; ty<f.rows; ty++) for (let tx=0; tx<f.cols; tx++) {
    if (f.grid[ty*f.cols+tx] !== 'x') continue;
    const x = tx*CELL, y = ty*CELL;
    ctx.beginPath();
    if (!isX(tx,ty-1)) { ctx.moveTo(x,y); ctx.lineTo(x+CELL,y); }
    if (!isX(tx,ty+1)) { ctx.moveTo(x,y+CELL); ctx.lineTo(x+CELL,y+CELL); }
    if (!isX(tx-1,ty)) { ctx.moveTo(x,y); ctx.lineTo(x,y+CELL); }
    if (!isX(tx+1,ty)) { ctx.moveTo(x+CELL,y); ctx.lineTo(x+CELL,y+CELL); }
    ctx.stroke();
  }
}

function drawHighlight() {
  if (!highlight) return;
  const now = performance.now();
  const dt = (now - highlight.t0) / 1000;
  if (dt > 3) { highlight = null; stopPulse(); return; }
  const cx = (highlight.tx+0.5)*CELL, cy = (highlight.ty+0.5)*CELL;
  const baseR = Math.max(CELL*1.6, (highlight.span||0)*CELL*0.5);
  const pulse = (Math.sin(dt*5) + 1) / 2; // 0..1
  ctx.save();
  ctx.strokeStyle = 'rgba(255,235,120,' + (0.85 - dt*0.15) + ')';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, baseR + pulse*CELL*1.5, 0, 7); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,160,60,0.9)';
  ctx.beginPath(); ctx.arc(cx, cy, CELL*0.7, 0, 7); ctx.stroke();
  ctx.restore();
}
function startPulse() { if (!raf) loopPulse(); }
function stopPulse() { if (raf) { cancelAnimationFrame(raf); raf = null; } }
function loopPulse() { draw(); raf = highlight ? requestAnimationFrame(loopPulse) : null; }

// ---- pan & zoom interaction ----
let dragging = false, lastX = 0, lastY = 0, moved = 0;
view.addEventListener('pointerdown', ev => {
  dragging = true; moved = 0; lastX = ev.clientX; lastY = ev.clientY;
  view.classList.add('grabbing'); view.setPointerCapture(ev.pointerId);
});
view.addEventListener('pointermove', ev => {
  if (dragging) {
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    ox += dx; oy += dy; lastX = ev.clientX; lastY = ev.clientY; applyTransform();
  } else {
    showTip(ev);
  }
});
view.addEventListener('pointerup', ev => {
  view.classList.remove('grabbing');
  if (dragging && moved < 4) handleClick(ev);
  dragging = false;
});
view.addEventListener('pointerleave', () => { tip.style.display='none'; });
view.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = view.getBoundingClientRect();
  zoomAt(ev.deltaY < 0 ? 1.12 : 1/1.12, ev.clientX - r.left, ev.clientY - r.top);
}, { passive: false });

function screenToTile(ev) {
  const r = view.getBoundingClientRect();
  const wx = (ev.clientX - r.left - ox) / scale, wy = (ev.clientY - r.top - oy) / scale;
  return { tx: Math.floor(wx / CELL), ty: Math.floor(wy / CELL) };
}

function pick(tx, ty) {
  const port = cur.portals.find(p => p.tx===tx && p.ty===ty);
  const ents = cur.entities.filter(e => e.tx===tx && e.ty===ty);
  return { port, ents };
}

function showTip(ev) {
  const { tx, ty } = screenToTile(ev);
  if (tx<0||ty<0||tx>=cur.cols||ty>=cur.rows) { tip.style.display='none'; return; }
  const { port, ents } = pick(tx, ty);
  let html = '<div class="muted">(' + tx + ',' + ty + ')</div>';
  if (port) html += '<div><span class="k">portal</span> → floor ' + port.toFloor + ' @(' + port.toTx + ',' + port.toTy + ')' + (port.gated ? ' <span class="muted">[gated]</span>' : '') + '</div>';
  for (const e of ents) html += '<div><span class="k">' + e.kind + '</span> ' + e.label + (e.reachable ? '' : ' <span style="color:#ff8b8b">⚠ unreachable</span>') + '</div>';
  if (!port && ents.length === 0) { tip.style.display='none'; return; }
  tip.innerHTML = html;
  tip.style.display = 'block';
  const r = view.getBoundingClientRect();
  let x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
  if (x + 270 > r.width) x = ev.clientX - r.left - tip.offsetWidth - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

function handleClick(ev) {
  const { tx, ty } = screenToTile(ev);
  const { port, ents } = pick(tx, ty);
  if (port) { flyTo(port.toFloor, port.toTx, port.toTy, 12); return; }
  if (ents.length) { flyTo(cur.floor, tx, ty, 10); }
}

// ---- findings list ----
const sevOn = { error:true, warn:true, info:true };
let visible = [];   // findings currently rendered (filtered)

function passesFilter(fi, q) {
  if (!sevOn[fi.severity]) return false;
  if (q && !(fi.subject+' '+fi.message+' '+fi.rule).toLowerCase().includes(q)) return false;
  return true;
}

function renderFindings() {
  const box = document.getElementById('findings');
  const q = (document.getElementById('q').value || '').toLowerCase();
  box.innerHTML = '';
  visible = DATA.findings.filter(fi => passesFilter(fi, q));
  if (visible.length === 0) { box.innerHTML = '<div class="empty">No findings match.</div>'; selIdx = -1; return; }
  visible.forEach((fi, i) => {
    const d = document.createElement('div');
    d.className = 'find ' + fi.severity + (i === selIdx ? ' sel' : '');
    const loc = fi.tx != null ? '' : '<span class="nohit"> · no tile</span>';
    d.innerHTML = '<span class="rule">' + fi.rule + '</span>' +
      '<span class="sev">' + SEV_SYM[fi.severity] + '</span>' +
      '<span class="sub">' + fi.subject + '</span>' + loc +
      '<div class="msg">' + fi.message + '</div>';
    d.onclick = () => focusFinding(i, true);
    box.appendChild(d);
  });
}

function focusFinding(i, scroll) {
  if (i < 0 || i >= visible.length) return;
  selIdx = i;
  const fi = visible[i];
  [...document.querySelectorAll('.find')].forEach((el, k) => el.classList.toggle('sel', k === i));
  if (scroll) document.querySelectorAll('.find')[i]?.scrollIntoView({ block:'nearest' });
  if (fi.tx != null) flyTo(fi.floor, fi.tx, fi.ty, fi.span || (fi.floor!=null?14:0));
  else if (fi.floor != null) selectFloor(fi.floor, true);
}

function stepFinding(dir) {
  if (visible.length === 0) return;
  let i = selIdx < 0 ? (dir > 0 ? 0 : visible.length - 1) : selIdx + dir;
  i = (i + visible.length) % visible.length;
  focusFinding(i, true);
}

document.getElementById('q').oninput = () => { selIdx = -1; renderFindings(); };
['fError','fWarn','fInfo'].forEach(id => {
  const btn = document.getElementById(id);
  btn.onclick = () => { const s = btn.dataset.sev; sevOn[s] = !sevOn[s]; btn.classList.toggle('on', sevOn[s]); selIdx = -1; renderFindings(); };
});
document.getElementById('pPrev').onclick = () => stepFinding(-1);
document.getElementById('pNext').onclick = () => stepFinding(1);
document.getElementById('prev').onclick = () => stepFinding(-1);
document.getElementById('next').onclick = () => stepFinding(1);

// ---- controls ----
document.getElementById('zin').onclick = () => zoomAt(1.25, view.clientWidth/2, view.clientHeight/2);
document.getElementById('zout').onclick = () => zoomAt(1/1.25, view.clientWidth/2, view.clientHeight/2);
document.getElementById('fit').onclick = () => { highlight = null; stopPulse(); fitView(); draw(); };
['tEnt','tPortals','tGrid'].forEach(id => document.getElementById(id).onchange = draw);

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'n' || e.key === 'ArrowRight') { stepFinding(1); e.preventDefault(); }
  else if (e.key === 'p' || e.key === 'ArrowLeft') { stepFinding(-1); e.preventDefault(); }
  else if (e.key === 'f') { highlight = null; stopPulse(); fitView(); draw(); }
});
window.addEventListener('resize', () => { fitView(); draw(); });

// ---- boot ----
const hashFloor = (location.hash.match(/floor=(\\d+)/) || [])[1];
if (hashFloor && DATA.floors.some(f => f.floor === Number(hashFloor))) cur = DATA.floors.find(f => f.floor === Number(hashFloor));
markActiveTab();
renderFindings();
fitView();
draw();
</script>
</body></html>`;
}
