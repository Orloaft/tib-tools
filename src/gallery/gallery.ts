import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiffResult } from "./diff.ts";

export interface GalleryEntry {
  label: string;
  title: string;
  floor: number;
  shot: string; // relative path from the html
  golden: string | null;
  diff: string | null;
  result: DiffResult;
}

export interface GallerySummary {
  total: number;
  changed: number;
  added: number;
  ok: number;
  size: number;
}

export function summarize(entries: GalleryEntry[]): GallerySummary {
  return {
    total: entries.length,
    changed: entries.filter((e) => e.result.status === "changed").length,
    added: entries.filter((e) => e.result.status === "new").length,
    ok: entries.filter((e) => e.result.status === "ok").length,
    size: entries.filter((e) => e.result.status === "size").length
  };
}

export async function buildGallery(dir: string, entries: GalleryEntry[]): Promise<string> {
  const summary = summarize(entries);
  const html = render(JSON.stringify({ entries, summary }));
  const out = join(dir, "index.html");
  await writeFile(out, html, "utf8");
  return out;
}

const CLIENT = `
let filter = 'all';
function card(e){
  var s = e.result.status;
  var pct = s==='new' ? 'new baseline' : s==='size' ? 'size changed' : e.result.pct + '% changed';
  var panes = '<div class="img"><span>shot</span><img src="'+e.shot+'"></div>';
  if(e.golden) panes += '<div class="img"><span>golden</span><img src="'+e.golden+'"></div>';
  if(e.diff) panes += '<div class="img"><span>diff</span><img src="'+e.diff+'"></div>';
  return '<div class="card '+s+'" data-status="'+s+'"><div class="head"><b>'+esc(e.title)+'</b><span class="badge '+s+'">'+s+' · '+pct+'</span></div><div class="panes">'+panes+'</div></div>';
}
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];}); }
function render(){
  var box = document.getElementById('grid'); box.innerHTML='';
  DATA.entries.forEach(function(e){
    if(filter==='changed' && !(e.result.status==='changed'||e.result.status==='size')) return;
    if(filter==='new' && e.result.status!=='new') return;
    box.insertAdjacentHTML('beforeend', card(e));
  });
}
document.querySelectorAll('[data-filter]').forEach(function(b){ b.onclick=function(){ filter=b.getAttribute('data-filter'); document.querySelectorAll('[data-filter]').forEach(function(x){x.classList.remove('on');}); b.classList.add('on'); render(); }; });
document.getElementById('summary').textContent = DATA.summary.total+' zones · '+DATA.summary.changed+' changed · '+DATA.summary.added+' new · '+DATA.summary.ok+' unchanged';
render();
`;

function render(json: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>TIB Visual Gallery</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;background:#0f1210;color:#e7efe6;font:13px/1.45 ui-sans-serif,system-ui,sans-serif}
  header{padding:10px 16px;border-bottom:1px solid #232b22;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  header b{color:#9ee6b1}.muted{color:#8fa08f}
  .filters{display:flex;gap:6px;margin-left:auto}
  .filters button{background:#1b211b;color:#cfe0d2;border:1px solid #2c382c;border-radius:6px;padding:5px 11px;cursor:pointer}
  .filters button.on{background:#2f5d3a;border-color:#4f9d6a;color:#eafff0}
  #grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px;padding:14px}
  .card{border:1px solid #232b22;border-radius:10px;overflow:hidden;background:#121712}
  .card.changed{border-color:#7a5a2b}.card.size{border-color:#7a2b2b}.card.new{border-color:#2b4a6a}
  .head{display:flex;justify-content:space-between;align-items:center;padding:9px 11px;background:#0c0f0c}
  .badge{font-size:11px;font-weight:700;border-radius:10px;padding:2px 9px;background:#2a332a;color:#9ee6b1}
  .badge.changed{background:#6a5a1f;color:#ffeebb}.badge.size{background:#7a2b2b;color:#ffd9d9}.badge.new{background:#23415f;color:#bfe0ff}.badge.ok{background:#244a2f;color:#bfffd0}
  .panes{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:2px;background:#000}
  .img{position:relative}.img span{position:absolute;top:4px;left:4px;background:rgba(0,0,0,.6);color:#cfe0d2;font-size:10px;padding:1px 5px;border-radius:4px}
  .img img{width:100%;display:block;image-rendering:pixelated}
</style></head>
<body>
<header>
  <span><b>TIB Visual Gallery</b></span><span class="muted" id="summary"></span>
  <div class="filters">
    <button data-filter="all" class="on">all</button>
    <button data-filter="changed">changed</button>
    <button data-filter="new">new</button>
  </div>
</header>
<div id="grid"></div>
<script>const DATA = ${json};</script>
<script>${CLIENT}</script>
</body></html>`;
}
