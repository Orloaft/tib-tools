import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { analyzeNarrative } from "./index.ts";

export interface StudioResult {
  path: string;
  kib: number;
  quests: number;
  findings: number;
}

export async function writeStudio(outPath?: string): Promise<StudioResult> {
  const { model, findings, summary } = await analyzeNarrative();
  const data = { quests: model.quests, findings, summary };
  const html = render(JSON.stringify(data));
  const path = resolve(outPath ?? "out/narrative.html");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html, "utf8");
  return {
    path,
    kib: Math.round((Buffer.byteLength(html) / 1024) * 10) / 10,
    quests: summary.quests,
    findings: findings.length
  };
}

// The client script uses ONLY single-quote strings + concatenation (no template
// literals / ${...}) so it injects cleanly into this outer template literal.
const CLIENT = `
const PHASES = ['intro','progress','turnIn','claimed','missingItems'];
const REQUIRED = ['intro','progress','turnIn','claimed'];
const TOKEN_RE = /\\{([^}]+)\\}/g;
const work = JSON.parse(JSON.stringify(DATA.quests));
const state = { id: work[0] && work[0].id, phase: 'intro', progress: 1, idx: 0, resolved: true, edit: false };

function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
function quest(id){ return work.find(function(q){ return q.id === id; }); }
function tokensOf(t){ var m, out=[]; TOKEN_RE.lastIndex=0; while((m=TOKEN_RE.exec(t))) out.push(m[1]); return out; }
function leaves(hasItem){ var l=['progress','target.count','target.remaining','reward.gold','reward.xp','player.name','npc.name']; if(hasItem){ l.push('target.item.id'); l.push('target.item.label'); } return l; }
function tokenProblem(tok, hasItem){
  if(leaves(hasItem).indexOf(tok) >= 0) return null;
  if(!hasItem && tok.indexOf('target.item') === 0) return 'no reward item — renders literally';
  if(['target','target.item','reward','player','npc'].indexOf(tok) >= 0) return 'object, not a value — renders as [object Object]';
  return 'unknown token — renders as literal text';
}
function ctxOf(q, progress){
  return { progress: progress,
    target: { count: q.targetCount, remaining: Math.max(0, q.targetCount - progress), item: q.hasItem ? { id: q.id, label: q.itemLabel || q.id } : null },
    reward: { gold: q.rewardGold, xp: q.rewardXp }, player: { name: 'Wanderer' }, npc: { name: q.giverName } };
}
function renderLine(text, ctx){
  return text.replace(TOKEN_RE, function(_m, key){
    var parts = key.split('.'); var v = ctx;
    for(var i=0;i<parts.length;i++){ if(v == null) return '{'+key+'}'; v = v[parts[i]]; }
    return v == null ? '{'+key+'}' : String(v);
  });
}
function lintQuest(q){
  var out = [];
  var present = {};
  q.stages.forEach(function(s){ if(s.lines.length) present[s.phase]=1; });
  REQUIRED.forEach(function(p){ if(!present[p]) out.push({severity:'warn',rule:'phase.empty',phase:p,message:'No "'+p+'" dialogue — falls back to the giver\\'s generic line.'}); });
  q.stages.forEach(function(s){
    var progress = s.phase === 'progress' ? Math.max(1, Math.floor(q.targetCount/2)) : 0;
    var ctx = ctxOf(q, progress);
    s.lines.forEach(function(line){
      tokensOf(line.raw).forEach(function(tok){
        var prob = tokenProblem(tok, q.hasItem);
        if(prob) out.push({severity:'error',rule:'token.unresolved',phase:s.phase,message:'"{'+tok+'}" — '+prob});
        else if(s.phase !== 'progress' && (tok==='progress'||tok==='target.remaining')) out.push({severity:'warn',rule:'token.phase',phase:s.phase,message:'"{'+tok+'}" in '+s.phase+' always shows '+(tok==='progress'?'0':'the full count')});
      });
      var rendered = renderLine(line.raw, ctx);
      var boxLines = Math.ceil(rendered.length / 86);
      if(boxLines > 3) out.push({severity:'warn',rule:'line.long',phase:s.phase,message:'A '+line.speaker+' line is ~'+boxLines+' box-lines ('+rendered.length+' chars)'});
    });
  });
  return out;
}
function yamlString(s){ return '"' + s.replace(/\\\\/g,'\\\\\\\\').replace(/"/g,'\\\\"') + '"'; }
function serialize(q){
  var out = ['dialogue:'];
  q.stages.forEach(function(s){ out.push('  '+s.phase+':'); s.lines.forEach(function(l){ out.push('    - '+l.speaker+': '+yamlString(l.raw)); }); });
  return out.join('\\n') + '\\n';
}

function badge(n, sev){ return n ? '<span class="badge '+sev+'">'+n+'</span>' : ''; }
function renderList(){
  var filter = (document.getElementById('q').value||'').toLowerCase();
  var box = document.getElementById('list'); box.innerHTML='';
  work.forEach(function(q){
    if(filter && (q.id+' '+q.title).toLowerCase().indexOf(filter) < 0) return;
    var f = lintQuest(q);
    var errs = f.filter(function(x){return x.severity==='error';}).length;
    var warns = f.filter(function(x){return x.severity==='warn';}).length;
    var d = document.createElement('div');
    d.className = 'q' + (q.id===state.id?' active':'');
    d.innerHTML = '<div class="q-top"><b>'+esc(q.title)+'</b>'+badge(errs,'error')+badge(warns,'warn')+'</div><div class="q-sub">'+esc(q.id)+' · '+q.kind+' · '+esc(q.giverName)+'</div>';
    d.onclick = function(){ state.id=q.id; state.phase='intro'; state.idx=0; render(); };
    box.appendChild(d);
  });
}
function stageOf(q, phase){ return q.stages.find(function(s){ return s.phase===phase; }); }
function renderTabs(q){
  var box = document.getElementById('tabs'); box.innerHTML='';
  PHASES.forEach(function(p){
    var st = stageOf(q,p); if(!st) return;
    var b = document.createElement('button');
    b.className = 'tab' + (p===state.phase?' active':'');
    b.textContent = p + ' (' + st.lines.length + ')';
    b.onclick = function(){ state.phase=p; state.idx=0; render(); };
    box.appendChild(b);
  });
}
function currentProgress(q){ return state.phase==='progress' ? state.progress : 0; }
function renderBox(q){
  var st = stageOf(q, state.phase);
  var wrap = document.getElementById('stage'); wrap.innerHTML='';
  if(!st || !st.lines.length){ wrap.innerHTML = '<div class="empty">No lines in this stage.</div>'; return; }
  var ctx = ctxOf(q, currentProgress(q));
  if(state.edit){
    st.lines.forEach(function(line, i){
      var row = document.createElement('div'); row.className='edit-row '+line.speaker;
      var who = document.createElement('span'); who.className='who'; who.textContent = line.speaker==='npc'?q.giverName:'Wanderer';
      var ta = document.createElement('textarea'); ta.value = line.raw; ta.rows = 2;
      ta.oninput = function(){ line.raw = ta.value; renderBox(q); renderLint(q); renderList(); };
      var prev = document.createElement('div'); prev.className='edit-prev'; prev.innerHTML = highlight(line.raw, q.hasItem, ctx);
      row.appendChild(who); row.appendChild(ta); row.appendChild(prev); wrap.appendChild(row);
    });
    return;
  }
  // Play mode: faithful dialogue box, one line at a time.
  if(state.idx >= st.lines.length) state.idx = st.lines.length-1;
  var line = st.lines[state.idx];
  var text = state.resolved ? esc(renderLine(line.raw, ctx)) : highlight(line.raw, q.hasItem, ctx);
  var who = line.speaker==='npc' ? q.giverName : 'Wanderer';
  var box = document.createElement('div'); box.className='dialogue';
  box.innerHTML = '<div class="dialogue-speaker '+(line.speaker)+'">'+esc(who)+'</div>'+
    '<div class="dialogue-line">'+text+'</div>'+
    '<div class="dialogue-foot"><span class="counter">'+(state.idx+1)+' / '+st.lines.length+'</span><button class="continue">'+(state.idx<st.lines.length-1?'Continue ▸':'End')+'</button></div>';
  box.querySelector('.continue').onclick = function(e){ e.stopPropagation(); state.idx = (state.idx+1) % st.lines.length; renderBox(q); };
  box.onclick = function(){ state.idx = (state.idx+1) % st.lines.length; renderBox(q); };
  wrap.appendChild(box);
}
function highlight(raw, hasItem, ctx){
  // Show raw text with tokens coloured (green ok / red broken), tooltip resolved.
  return esc(raw).replace(/\\{([^}]+)\\}/g, function(_m, key){
    var prob = tokenProblem(key, hasItem);
    var val = renderLine('{'+key+'}', ctx);
    return '<span class="tok '+(prob?'bad':'ok')+'" title="'+esc(prob?prob:('→ '+val))+'">{'+esc(key)+'}</span>';
  });
}
function renderLint(q){
  var f = lintQuest(q);
  var box = document.getElementById('lint'); box.innerHTML='';
  if(!f.length){ box.innerHTML = '<div class="ok">✓ No issues in this quest.</div>'; return; }
  f.forEach(function(x){
    var d = document.createElement('div'); d.className='finding '+x.severity;
    d.innerHTML = '<span class="rule">'+x.rule+'</span><span class="ph">'+x.phase+'</span><div class="msg">'+esc(x.message)+'</div>';
    d.onclick = function(){ if(stageOf(q,x.phase)){ state.phase=x.phase; state.idx=0; render(); } };
    box.appendChild(d);
  });
}
function exportYaml(){
  var q = quest(state.id); if(!q) return;
  var yaml = serialize(q);
  var ta = document.getElementById('exportText'); ta.value = yaml;
  document.getElementById('exportModal').classList.remove('hidden');
  ta.select();
  if(navigator.clipboard) navigator.clipboard.writeText(yaml).then(function(){ toast('Copied dialogue YAML'); }, function(){});
}
function toast(msg){ var t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); }, 1600); }

function render(){
  var q = quest(state.id); if(!q) return;
  renderList();
  document.getElementById('title').textContent = q.title;
  document.getElementById('meta').innerHTML = 'id <b>'+esc(q.id)+'</b> · kind <b>'+q.kind+'</b> · giver <b>'+esc(q.giverName)+'</b> · target <b>'+q.targetCount+(q.hasItem?' '+esc(q.itemLabel):'')+'</b>';
  renderTabs(q);
  var ps = document.getElementById('progrow');
  if(state.phase==='progress'){ ps.classList.remove('hidden'); var sl=document.getElementById('prog'); sl.max=q.targetCount; sl.value=state.progress=Math.min(state.progress,q.targetCount); document.getElementById('proglabel').textContent = state.progress+' / '+q.targetCount; }
  else ps.classList.add('hidden');
  document.getElementById('modeBtn').textContent = state.edit ? '▶ Preview' : '✎ Edit';
  document.getElementById('resolvedBtn').classList.toggle('on', state.resolved);
  document.getElementById('resolvedBtn').style.display = state.edit ? 'none' : '';
  renderBox(q);
  renderLint(q);
}

document.getElementById('q').oninput = renderList;
document.getElementById('modeBtn').onclick = function(){ state.edit=!state.edit; render(); };
document.getElementById('resolvedBtn').onclick = function(){ state.resolved=!state.resolved; render(); };
document.getElementById('prog').oninput = function(e){ state.progress=Number(e.target.value); render(); };
document.getElementById('exportBtn').onclick = exportYaml;
document.getElementById('exportClose').onclick = function(){ document.getElementById('exportModal').classList.add('hidden'); };
render();
`;

function render(json: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>TIB Narrative Studio</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;background:#0f1210;color:#e7efe6;font:13px/1.45 ui-sans-serif,system-ui,sans-serif}
  header{padding:10px 16px;border-bottom:1px solid #232b22;display:flex;gap:16px;align-items:baseline}
  header b{color:#9ee6b1}.muted{color:#8fa08f}
  .wrap{display:grid;grid-template-columns:300px 1fr 320px;height:calc(100vh - 44px)}
  .col{overflow:auto;padding:12px}.col.mid{background:#0c0f0c}
  .side{border-left:1px solid #232b22}.left{border-right:1px solid #232b22}
  input[type=search]{width:100%;background:#0b0f0c;border:1px solid #2c382c;color:#fff;border-radius:6px;padding:7px 9px;margin-bottom:10px}
  .q{padding:8px 9px;border:1px solid #222a22;border-radius:7px;margin-bottom:7px;cursor:pointer;background:#141914}
  .q:hover{border-color:#3a4a3a}.q.active{border-color:#4f9d6a;background:#18241a}
  .q-top{display:flex;align-items:center;gap:6px}.q-top b{flex:1}.q-sub{color:#8fa08f;font-size:11px;margin-top:2px}
  .badge{font-size:11px;font-weight:700;border-radius:10px;padding:1px 7px}.badge.error{background:#7a2b2b;color:#ffd9d9}.badge.warn{background:#6a5a1f;color:#ffeebb}
  h2{margin:2px 0 4px;font-size:20px}.meta{color:#9fb0a0;margin-bottom:12px}
  .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .tabs{display:flex;gap:6px;flex-wrap:wrap}
  .tab{background:#1b211b;color:#cfe0d2;border:1px solid #2c382c;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:12px}
  .tab.active{background:#2f5d3a;border-color:#4f9d6a;color:#eafff0}
  .btn{background:#1b211b;color:#cfe0d2;border:1px solid #2c382c;border-radius:6px;padding:5px 10px;cursor:pointer}
  .btn.on{background:#2f5d3a;border-color:#4f9d6a;color:#eafff0}.btn.primary{background:#d6a84f;color:#17140d;border-color:#e2bd6a;font-weight:700}
  .row{display:flex;gap:10px;align-items:center;margin-bottom:12px}.row.hidden{display:none}
  input[type=range]{flex:1;accent-color:#4f9d6a}
  .stagewrap{display:flex;align-items:center;justify-content:center;min-height:240px;padding:30px 10px}
  /* faithful in-game dialogue box */
  .dialogue{position:relative;width:min(680px,100%);padding:24px 26px 18px;border:2px solid rgba(247,212,134,.5);border-radius:12px;
    background:linear-gradient(180deg,rgba(24,19,34,.98),rgba(13,11,20,.99));box-shadow:0 18px 50px rgba(0,0,0,.6);cursor:pointer}
  .dialogue-speaker{position:absolute;top:-14px;left:22px;padding:3px 13px;color:#1b1410;font-size:13px;font-weight:800;letter-spacing:.3px;background:linear-gradient(180deg,#f7d486,#d9a441);border-radius:6px}
  .dialogue-speaker.player{background:linear-gradient(180deg,#9fd6ff,#4f9dd9)}
  .dialogue-line{min-height:62px;color:#eef3ed;font-size:18px;line-height:1.5}
  .dialogue-foot{display:flex;justify-content:space-between;align-items:center;margin-top:10px}
  .counter{color:#8fa08f;font-size:12px}.continue{background:transparent;border:1px solid rgba(247,212,134,.5);color:#f7d486;border-radius:6px;padding:5px 12px;cursor:pointer}
  .tok{border-radius:4px;padding:0 2px}.tok.ok{background:rgba(120,200,140,.18);color:#9ee6b1}.tok.bad{background:rgba(220,90,90,.25);color:#ff9b9b;text-decoration:underline wavy}
  .edit-row{display:grid;grid-template-columns:84px 1fr 1fr;gap:10px;align-items:start;margin-bottom:10px}
  .edit-row .who{color:#f7d486;font-weight:700;font-size:12px;padding-top:6px}.edit-row.player .who{color:#9fd6ff}
  textarea{width:100%;background:#0b0f0c;border:1px solid #2c382c;color:#eef3ed;border-radius:6px;padding:7px;font:14px/1.4 ui-sans-serif,system-ui;resize:vertical}
  .edit-prev{font-size:14px;color:#cdd8cd;padding:7px;border:1px dashed #2c382c;border-radius:6px;min-height:38px}
  .empty{color:#8fa08f;font-style:italic}
  h3{margin:2px 0 8px;color:#cfe0d2}
  .finding{border:1px solid #2a332a;border-radius:6px;padding:7px 9px;margin-bottom:7px;cursor:pointer}
  .finding.error{border-color:#7a2b2b}.finding.warn{border-color:#6a5a1f}
  .finding .rule{color:#9ee6b1;font-family:ui-monospace,monospace;font-size:11px}.finding .ph{float:right;color:#8aa;font-size:11px}
  .finding .msg{margin-top:3px;color:#c7d2c7}.ok{color:#9ee6b1}
  .modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}
  .modal.hidden{display:none}.modal-box{background:#141914;border:1px solid #2c382c;border-radius:10px;padding:16px;width:min(680px,92vw)}
  .modal-box textarea{height:300px;font-family:ui-monospace,monospace;font-size:12px}
  .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#2f5d3a;color:#eafff0;padding:8px 16px;border-radius:8px;opacity:0;transition:opacity .2s;pointer-events:none}
  .toast.show{opacity:1}
</style></head>
<body>
<header>
  <span><b>TIB Narrative Studio</b></span>
  <span class="muted" id="summary"></span>
</header>
<div class="wrap">
  <div class="col left">
    <input type="search" id="q" placeholder="filter quests...">
    <div id="list"></div>
  </div>
  <div class="col mid">
    <h2 id="title"></h2>
    <div class="meta" id="meta"></div>
    <div class="toolbar">
      <div class="tabs" id="tabs"></div>
      <span style="flex:1"></span>
      <button class="btn on" id="resolvedBtn" title="Toggle token resolution">tokens: resolved</button>
      <button class="btn" id="modeBtn">✎ Edit</button>
      <button class="btn primary" id="exportBtn">Export YAML</button>
    </div>
    <div class="row hidden" id="progrow"><span class="muted">progress</span><input type="range" id="prog" min="0" value="1"><span id="proglabel" class="muted"></span></div>
    <div class="stagewrap" id="stage"></div>
  </div>
  <div class="col side">
    <h3>Lint</h3>
    <div id="lint"></div>
  </div>
</div>
<div class="modal hidden" id="exportModal"><div class="modal-box">
  <h3>Dialogue YAML <span class="muted">(copied — paste into content/quests/&lt;id&gt;.yaml)</span></h3>
  <textarea id="exportText" readonly></textarea>
  <div style="text-align:right;margin-top:10px"><button class="btn" id="exportClose">Close</button></div>
</div></div>
<div class="toast" id="toast"></div>
<script>const DATA = ${json};</script>
<script>${CLIENT}
document.getElementById('summary').textContent = DATA.summary.quests + ' quests · ' + DATA.summary.lines + ' lines · ' + DATA.summary.errors + ' err / ' + DATA.summary.warnings + ' warn';
</script>
</body></html>`;
}
