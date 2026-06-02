import type { Analysis, Finding } from "../content-graph/types.ts";
import type { GraphEdge, GraphNode, ReferenceGraph } from "./graph.ts";

/**
 * The data payload inlined into the HTML report. Kept flat and JSON-friendly so
 * it embeds cleanly and the in-page vanilla JS can index it without any libs.
 *
 * Each finding is pre-resolved to the graph node key it concerns (`entityKey`),
 * so the report can wire bidirectional links (finding ⇄ entity) without
 * re-deriving the mapping in the browser.
 */
interface ReportFinding extends Finding {
  /** The graph node key this finding concerns, or null if it maps to no node. */
  entityKey: string | null;
}

interface ReportData {
  generatedAt: string;
  counts: Record<string, number>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  findings: ReportFinding[];
  summary: { errors: number; warnings: number; infos: number };
}

/**
 * Resolve a finding's `subject` to a graph node key. Subjects come in a few
 * shapes; we want them all to land on a real, navigable node when possible:
 *   - `kind:id`                     (item:potion, quest:foo, zone:bar, …)
 *   - `spawn:<type>@floor …`        → monster:<type>
 *   - `drop:<monsterType>`          → monster:<monsterType>
 *   - `treeType:<id>` / `tree:<type>@…` → tree:<id>
 *   - `mining:<nodeId>` / `herb:<id>` / `fishing:<id>` → node ids (no graph node)
 */
function findingEntityKey(subject: string, nodeKeys: Set<string>): string | null {
  const i = subject.indexOf(":");
  if (i < 0) return null;
  const kind = subject.slice(0, i);
  let rest = subject.slice(i + 1);

  // Strip any "@floor …/coords" location suffix that some subjects carry.
  const at = rest.indexOf("@");
  if (at >= 0) rest = rest.slice(0, at);

  // Normalise the subject's pseudo-kind to a real graph node kind.
  const map: Record<string, string> = {
    spawn: "monster",
    drop: "monster",
    target: "monster",
    treeType: "tree"
  };
  const realKind = map[kind] ?? kind;
  const candidate = `${realKind}:${rest}`;
  if (nodeKeys.has(candidate)) return candidate;

  // Last resort: try the raw subject (already a key for item/quest/zone/…).
  if (nodeKeys.has(subject)) return subject;
  return null;
}

/**
 * Render a single self-contained HTML file: inline data + styles + vanilla JS,
 * no external libraries or network calls. The page is an entity explorer (search
 * / filter by kind, click for inbound+outbound references with a mini node-link
 * diagram) plus a bidirectionally-linked findings panel.
 */
export function renderReport(analysis: Analysis, graph: ReferenceGraph): string {
  const nodes = [...graph.nodes.values()].sort((a, b) => a.key.localeCompare(b.key));
  const nodeKeys = new Set(nodes.map((n) => n.key));

  const findings: ReportFinding[] = analysis.findings.map((f) => ({
    ...f,
    entityKey: findingEntityKey(f.subject, nodeKeys)
  }));

  const data: ReportData = {
    generatedAt: new Date().toISOString(),
    counts: { ...analysis.summary.counts },
    nodes,
    edges: graph.edges,
    findings,
    summary: {
      errors: analysis.summary.errors,
      warnings: analysis.summary.warnings,
      infos: analysis.summary.infos
    }
  };

  // Escape </script> so the inline JSON can't break out of the script tag.
  const json = JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TIB Content Doctor</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="brand">
    <h1>TIB Content Doctor</h1>
    <div id="meta"></div>
  </div>
  <div id="stats" class="stats"></div>
</header>
<main>
  <section id="explorer">
    <div class="panel-head">
      <h2>Entities</h2>
      <span id="entityCount" class="pill"></span>
    </div>
    <div class="controls">
      <div class="search-wrap">
        <input id="search" type="search" placeholder="Search entities…  ( / to focus )" autocomplete="off" spellcheck="false">
        <kbd class="search-hint">Esc</kbd>
      </div>
      <div id="kindFilters" class="kind-filters"></div>
    </div>
    <ul id="entityList" class="entity-list" tabindex="0"></ul>
  </section>
  <section id="detail">
    <div class="panel-head"><h2>Details</h2></div>
    <div id="detailBody" class="detail-body">
      <p class="placeholder">Select an entity to see its references and related findings.</p>
    </div>
  </section>
  <section id="findings">
    <div class="panel-head">
      <h2>Findings</h2>
      <span id="findingCount" class="pill"></span>
    </div>
    <div id="findingFilters" class="sev-filters"></div>
    <div id="findingList" class="finding-list"></div>
  </section>
</main>
<script id="data" type="application/json">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}

const STYLE = `
:root {
  --bg: #0e1014; --panel: #161922; --panel2: #1d212c; --panel3: #232836;
  --border: #2a2f3c; --border2: #353c4d;
  --text: #d9dee6; --muted: #8a93a3; --faint: #5c6575;
  --accent: #6aa3ff; --accent-dim: #2c4775;
  --error: #ff6b6b; --warn: #f5c451; --info: #6fb3d1; --ok: #6bd28a;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--bg); color: var(--text); display: flex; flex-direction: column; }
::selection { background: var(--accent-dim); }

header { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap;
  padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--panel); }
.brand { display: flex; flex-direction: column; gap: 2px; }
h1 { font-size: 17px; margin: 0; letter-spacing: 0.01em; }
#meta { color: var(--faint); font-size: 11.5px; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); margin: 0; }

.stats { display: flex; flex-wrap: wrap; gap: 8px; }
.stat { display: flex; align-items: baseline; gap: 6px; background: var(--panel2); border: 1px solid var(--border);
  border-radius: 6px; padding: 5px 11px; font-size: 12px; cursor: pointer; user-select: none;
  transition: border-color .12s, background .12s; }
.stat:hover { border-color: var(--border2); background: var(--panel3); }
.stat b { font-size: 14px; font-variant-numeric: tabular-nums; }
.stat .lbl { color: var(--muted); }
.stat.active { border-color: var(--accent); background: var(--accent-dim); }
.stat.sev-error b { color: var(--error); } .stat.sev-warn b { color: var(--warn); }
.stat.sev-info b { color: var(--info); } .stat.sev-ok b { color: var(--ok); }
.stat-divider { width: 1px; align-self: stretch; background: var(--border); margin: 2px 2px; }

main { flex: 1; min-height: 0; display: grid; grid-template-columns: 330px 1fr 370px; gap: 14px;
  padding: 14px 20px; align-items: stretch; }
section { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px;
  display: flex; flex-direction: column; min-height: 0; }
.panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.pill { font-size: 11px; color: var(--muted); background: var(--panel2); border: 1px solid var(--border);
  border-radius: 10px; padding: 1px 8px; font-variant-numeric: tabular-nums; }

.controls { display: flex; flex-direction: column; gap: 9px; margin-bottom: 11px; }
.search-wrap { position: relative; }
input[type=search] { width: 100%; padding: 8px 38px 8px 11px; background: var(--panel2); color: var(--text);
  border: 1px solid var(--border); border-radius: 7px; font-size: 13px; }
input[type=search]:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-dim); }
input[type=search]::-webkit-search-cancel-button { display: none; }
.search-hint { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 10px;
  color: var(--faint); background: var(--panel3); border: 1px solid var(--border); border-radius: 4px;
  padding: 1px 5px; pointer-events: none; opacity: 0; transition: opacity .12s; }
.search-wrap.has-text .search-hint { opacity: 1; }

.kind-filters, .sev-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { cursor: pointer; user-select: none; font-size: 11px; padding: 3px 9px; border-radius: 12px;
  border: 1px solid var(--border); background: var(--panel2); color: var(--muted); transition: all .1s; }
.chip:hover { border-color: var(--border2); color: var(--text); }
.chip.on { color: var(--text); border-color: var(--accent); background: var(--accent-dim); }
.chip .ct { opacity: .65; margin-left: 3px; font-variant-numeric: tabular-nums; }
.chip.sev-error.on { border-color: var(--error); background: rgba(255,107,107,.15); }
.chip.sev-warn.on { border-color: var(--warn); background: rgba(245,196,81,.13); }
.chip.sev-info.on { border-color: var(--info); background: rgba(111,179,209,.13); }

.entity-list, .finding-list { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; min-height: 0; }
.entity-list { scroll-padding: 40px 0; }
.entity-list:focus { outline: none; }
.entity-list li { padding: 6px 9px; border-radius: 6px; cursor: pointer; display: flex; gap: 9px;
  align-items: baseline; border: 1px solid transparent; }
.entity-list li:hover { background: var(--panel2); }
.entity-list li.sel { background: var(--accent-dim); border-color: var(--accent); }
.entity-list li.cursor:not(.sel) { background: var(--panel2); border-color: var(--border2); }
.kind-badge { font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--bg);
  background: var(--muted); border-radius: 4px; padding: 1px 5px; min-width: 50px; text-align: center; flex: none; }
.kb-monster { background: #d98a6a; } .kb-item { background: #6bd28a; } .kb-npc { background: #c79bff; }
.kb-quest { background: #f5c451; } .kb-zone { background: #6fb3d1; } .kb-ability { background: #ff8fce; }
.kb-class { background: #9fb4d8; } .kb-ore { background: #b0855a; } .kb-tree { background: #7ab87a; }
.kb-shop { background: #e0c060; }
.eid { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.elabel { color: var(--faint); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entity-list li .fdot { margin-left: auto; font-size: 11px; flex: none; }
mark { background: rgba(245,196,81,.32); color: inherit; border-radius: 2px; padding: 0 1px; }

.detail-body { overflow: auto; flex: 1; min-height: 0; }
.placeholder { color: var(--faint); font-size: 13px; }
.detail-head { display: flex; align-items: center; gap: 9px; margin-bottom: 2px; }
.detail-head h3 { margin: 0; font-size: 17px; }
.detail-sub { color: var(--muted); font-size: 12px; margin: 0 0 12px; font-family: ui-monospace, monospace; }

.graphviz { background: var(--panel2); border: 1px solid var(--border); border-radius: 8px;
  margin-bottom: 14px; overflow: hidden; }
.graphviz svg { display: block; width: 100%; }
.gv-empty { color: var(--faint); font-size: 12px; padding: 14px; text-align: center; }

.refgroup { margin-bottom: 12px; }
.refgroup h4 { margin: 0 0 6px; font-size: 11px; color: var(--muted); text-transform: uppercase;
  letter-spacing: 0.06em; display: flex; gap: 6px; align-items: center; }
.refgroup h4 .n { color: var(--faint); }
.ref { padding: 4px 7px; border-radius: 6px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
.ref:hover { background: var(--panel2); }
.edge-label { font-size: 11px; color: var(--accent); min-width: 88px; font-family: ui-monospace, monospace; flex: none; }
.ref.dangling .eid { color: var(--error); }
.ref.dangling .edge-label { color: var(--error); }
.muted { color: var(--muted); } .empty { color: var(--faint); font-size: 12px; padding: 6px 7px; }

.related { margin-top: 4px; border-top: 1px solid var(--border); padding-top: 12px; }
.related h4 { margin: 0 0 8px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }

.finding { border-left: 3px solid var(--border); padding: 8px 11px; margin-bottom: 8px;
  background: var(--panel2); border-radius: 0 7px 7px 0; cursor: pointer; transition: background .1s; }
.finding:hover { background: var(--panel3); }
.finding.error { border-left-color: var(--error); } .finding.warn { border-left-color: var(--warn); }
.finding.info { border-left-color: var(--info); }
.finding.flash { animation: flash 1s ease-out; }
@keyframes flash { 0% { background: var(--accent-dim); } 100% { background: var(--panel2); } }
.finding .fhead { display: flex; gap: 8px; align-items: baseline; }
.finding .sev-ico { font-weight: 700; flex: none; }
.finding.error .sev-ico { color: var(--error); } .finding.warn .sev-ico { color: var(--warn); }
.finding.info .sev-ico { color: var(--info); }
.finding .fsub { font-size: 12.5px; color: var(--text); font-weight: 600; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.finding .rule { font-size: 10.5px; color: var(--faint); font-family: ui-monospace, monospace; margin-left: auto; flex: none; }
.finding .fmsg { font-size: 12px; margin-top: 4px; color: var(--muted); line-height: 1.4; }
.finding .flink { font-size: 11px; color: var(--accent); margin-top: 5px; }

.ok-banner { color: var(--ok); font-size: 13px; padding: 6px 7px; }

@media (max-width: 1180px) {
  main { grid-template-columns: 1fr; height: auto; }
  section { max-height: 70vh; }
}
`;

const SCRIPT = `
const DATA = JSON.parse(document.getElementById("data").textContent);
const $ = (s, r = document) => r.querySelector(s);
const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function svg(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

// ── Indices ────────────────────────────────────────────────────────────────
const outByKey = new Map(), inByKey = new Map();
for (const e of DATA.edges) {
  (outByKey.get(e.from) || outByKey.set(e.from, []).get(e.from)).push(e);
  (inByKey.get(e.to) || inByKey.set(e.to, []).get(e.to)).push(e);
}
const nodeByKey = new Map(DATA.nodes.map(n => [n.key, n]));
const kinds = [...new Set(DATA.nodes.map(n => n.kind))].sort();
// findings grouped by the entity key they concern (for the detail panel).
const findingsByKey = new Map();
DATA.findings.forEach((f, i) => {
  f._i = i;
  if (!f.entityKey) return;
  (findingsByKey.get(f.entityKey) || findingsByKey.set(f.entityKey, []).get(f.entityKey)).push(f);
});

// ── Meta line ────────────────────────────────────────────────────────────────
const when = new Date(DATA.generatedAt);
$("#meta").textContent = "generated " + when.toLocaleString() + " · " +
  DATA.nodes.length + " entities · " + DATA.edges.length + " references";

// ── State ──────────────────────────────────────────────────────────────────
const activeKinds = new Set(kinds);
const activeSev = new Set(["error", "warn", "info"]);
let quickFilter = null;          // "error" | "warn" | "info" | "any" | null — entity-list filter by finding severity
let selectedKey = null;
let cursorIdx = -1;              // keyboard cursor into the visible list
let visible = [];               // current visible entity nodes

// ── Stats header (clickable) ─────────────────────────────────────────────────
const stats = $("#stats");
const ENTITY_STATS = ["monsters","items","npcs","quests","zones","abilities"];
const KIND_FOR_STAT = { monsters:"monster", items:"item", npcs:"npc", quests:"quest", zones:"zone", abilities:"ability" };
for (const key of ENTITY_STATS) {
  if (DATA.counts[key] == null) continue;
  const s = el("div", "stat");
  s.dataset.kind = KIND_FOR_STAT[key];
  s.append(el("b", null, String(DATA.counts[key])), el("span", "lbl", key));
  s.onclick = () => soloKind(s.dataset.kind);
  stats.append(s);
}
stats.append(Object.assign(el("div", "stat-divider")));
const SEV_STATS = [["errors","error",DATA.summary.errors],["warnings","warn",DATA.summary.warnings],["info","info",DATA.summary.infos]];
const sevStatEls = {};
for (const [lbl, sev, n] of SEV_STATS) {
  const s = el("div", "stat sev-" + sev);
  s.append(el("b", null, String(n)), el("span", "lbl", lbl));
  s.onclick = () => toggleSevQuick(sev);
  sevStatEls[sev] = s;
  stats.append(s);
}
if (DATA.summary.errors === 0) {
  const ok = el("div", "stat sev-ok");
  ok.append(el("b", null, "✓"), el("span", "lbl", "no errors"));
  stats.append(ok);
}

function soloKind(kind) {
  // Toggle: if this kind is the only active one, restore all; else solo it.
  const isSolo = activeKinds.size === 1 && activeKinds.has(kind);
  activeKinds.clear();
  if (isSolo) for (const k of kinds) activeKinds.add(k);
  else activeKinds.add(kind);
  syncKindChips(); syncStatHighlight(); renderList();
}
// Click a severity stat: filter the entity list to entities with a finding of
// that severity, and narrow the findings panel to the same severity. Clicking
// the active one clears back to showing everything.
function toggleSevQuick(sev) {
  quickFilter = quickFilter === sev ? null : sev;
  // The findings panel mirrors a severity quick-filter (not the catch-all "any").
  activeSev.clear();
  if (quickFilter === null || quickFilter === "any") ["error", "warn", "info"].forEach(s => activeSev.add(s));
  else activeSev.add(quickFilter);
  syncSevChips(); syncStatHighlight(); renderList(); renderFindings();
}
function syncStatHighlight() {
  for (const s of stats.querySelectorAll(".stat[data-kind]"))
    s.classList.toggle("active", activeKinds.size === 1 && activeKinds.has(s.dataset.kind));
  for (const sev in sevStatEls) sevStatEls[sev].classList.toggle("active", quickFilter === sev);
  issuesChip.classList.toggle("on", quickFilter === "any");
}

// ── Kind filter chips ────────────────────────────────────────────────────────
const kindChips = new Map();
const kindFilters = $("#kindFilters");
for (const k of kinds) {
  const chip = el("span", "chip on");
  chip.append(document.createTextNode(k), el("span", "ct", String(DATA.nodes.filter(n => n.kind === k).length)));
  chip.onclick = () => { chip.classList.contains("on") ? activeKinds.delete(k) : activeKinds.add(k);
    chip.classList.toggle("on"); syncStatHighlight(); renderList(); };
  kindChips.set(k, chip); kindFilters.append(chip);
}
// "with findings" chip — entities that carry at least one finding of any kind.
const issuesChip = el("span", "chip");
issuesChip.append(document.createTextNode("⚑ with findings"), el("span", "ct", String(findingsByKey.size)));
issuesChip.onclick = () => { toggleSevQuick("any"); };
kindFilters.append(issuesChip);

function syncKindChips() { for (const [k, chip] of kindChips) chip.classList.toggle("on", activeKinds.has(k)); }

// ── Entity list ──────────────────────────────────────────────────────────────
const search = $("#search");
const searchWrap = search.closest(".search-wrap");
search.addEventListener("input", () => { searchWrap.classList.toggle("has-text", !!search.value); cursorIdx = -1; renderList(); });

function highlight(text, q) {
  if (!q) return document.createTextNode(text);
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return document.createTextNode(text);
  const frag = document.createDocumentFragment();
  frag.append(text.slice(0, idx));
  frag.append(el("mark", null, text.slice(idx, idx + q.length)));
  frag.append(text.slice(idx + q.length));
  return frag;
}

function passesQuick(n) {
  if (quickFilter === null) return true;
  if (quickFilter === "any") return findingsByKey.has(n.key);
  return (findingsByKey.get(n.key) || []).some(f => f.severity === quickFilter);
}

function renderList() {
  const q = search.value.trim().toLowerCase();
  const list = $("#entityList");
  list.innerHTML = "";
  visible = DATA.nodes.filter(n => activeKinds.has(n.kind) && passesQuick(n) &&
    (!q || n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)));
  $("#entityCount").textContent = visible.length + (visible.length === 1 ? " entity" : " entities");
  if (!visible.length) { list.append(el("li", "empty", "No matching entities.")); return; }
  const cap = visible.slice(0, 600);
  cap.forEach((n, i) => {
    const li = el("li");
    if (n.key === selectedKey) li.classList.add("sel");
    if (i === cursorIdx) li.classList.add("cursor");
    li.append(el("span", "kind-badge kb-" + n.kind, n.kind));
    const idSpan = el("span", "eid"); idSpan.append(highlight(n.id, q)); li.append(idSpan);
    if (n.label !== n.id) { const l = el("span", "elabel"); l.append(highlight(n.label, q)); li.append(l); }
    const fs = findingsByKey.get(n.key);
    if (fs && fs.length) {
      const worst = fs.some(f=>f.severity==="error") ? "error" : fs.some(f=>f.severity==="warn") ? "warn" : "info";
      const dot = el("span", "fdot"); dot.style.color = "var(--" + worst + ")"; dot.textContent = "⚑";
      dot.title = fs.length + " finding(s)"; li.append(dot);
    }
    li.onclick = () => { cursorIdx = i; select(n.key); };
    list.append(li);
  });
  if (visible.length > 600) list.append(el("li", "empty", "…" + (visible.length - 600) + " more (refine search)"));
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function select(key, opts) {
  selectedKey = key;
  if (!opts || !opts.keepHash) location.hash = "e/" + key;
  renderList();
  const n = nodeByKey.get(key);
  const body = $("#detailBody");
  body.innerHTML = "";
  if (!n) { body.append(el("p", "placeholder", "Unknown entity " + key)); return; }

  const head = el("div", "detail-head");
  head.append(el("span", "kind-badge kb-" + n.kind, n.kind), el("h3", null, n.id));
  body.append(head);
  body.append(el("p", "detail-sub", n.key + (n.label !== n.id ? "  ·  " + n.label : "")));

  const out = outByKey.get(key) || [];
  const inb = inByKey.get(key) || [];

  // Mini node-link diagram of the immediate neighbourhood.
  body.append(renderGraphViz(n, out, inb));

  body.append(refGroup("Outbound", "references", out, "to"));
  body.append(refGroup("Inbound", "referenced by", inb, "from"));

  // Related findings.
  const fs = findingsByKey.get(key) || [];
  const rel = el("div", "related");
  rel.append(el("h4", null, "Related findings (" + fs.length + ")"));
  if (!fs.length) rel.append(el("div", "empty", "No findings for this entity."));
  for (const f of fs) rel.append(findingCard(f, true));
  body.append(rel);
  body.scrollTop = 0;
}

function refGroup(title, verb, edges, endpoint) {
  // Collapse duplicate endpoints under the same label (e.g. 4 identical spawns).
  const g = el("div", "refgroup");
  const h = el("h4"); h.append(document.createTextNode(title + " — " + verb + " ")); h.append(el("span", "n", String(uniqueEndpoints(edges, endpoint)) ));
  g.append(h);
  if (!edges.length) { g.append(el("div", "empty", "(none)")); return g; }
  const byLabel = new Map();
  for (const e of edges) {
    const m = byLabel.get(e.label) || byLabel.set(e.label, new Map()).get(e.label);
    if (!m.has(e[endpoint])) m.set(e[endpoint], e);
  }
  for (const [label, m] of [...byLabel].sort((a,b)=>a[0].localeCompare(b[0]))) {
    for (const e of m.values()) {
      const otherKey = e[endpoint];
      const other = nodeByKey.get(otherKey);
      const real = other && (other.label !== other.id || hasAnyEdge(otherKey));
      const row = el("div", "ref"); if (!real && !other) row.classList.add("dangling");
      const arrow = endpoint === "to" ? "—" + label + "→" : "←" + label + "—";
      row.append(el("span", "edge-label", arrow));
      const idSpan = el("span", "eid", other ? other.id : otherKey); row.append(idSpan);
      if (other && other.label !== other.id) row.append(el("span", "elabel", other.label));
      row.onclick = () => select(otherKey);
      g.append(row);
    }
  }
  return g;
}
function uniqueEndpoints(edges, endpoint) { return new Set(edges.map(e => e[endpoint])).size; }
function hasAnyEdge(key) { return (outByKey.get(key)||[]).length || (inByKey.get(key)||[]).length; }

// ── Mini reference graph (SVG node-link diagram) ─────────────────────────────
function renderGraphViz(center, out, inb) {
  const wrap = el("div", "graphviz");
  // De-dup neighbours by endpoint, keep a representative label.
  const pick = (edges, endpoint) => {
    const m = new Map();
    for (const e of edges) if (!m.has(e[endpoint])) m.set(e[endpoint], e.label);
    return [...m].map(([k, label]) => ({ key: k, label }));
  };
  const outs = pick(out, "to");
  const ins = pick(inb, "from");
  if (!outs.length && !ins.length) { wrap.append(el("div", "gv-empty", "No references — isolated node.")); return wrap; }

  const W = 338, rowH = 26, sideMax = Math.max(outs.length, ins.length);
  const H = Math.max(90, sideMax * rowH + 36);
  const cx = W / 2, cy = H / 2;
  const s = svg("svg", { viewBox: "0 0 " + W + " " + H, height: String(H) });

  const colX = { in: 64, out: W - 64 };
  const place = (arr, x) => arr.slice(0, 7).map((nb, i) => {
    const total = Math.min(arr.length, 7);
    const y = total === 1 ? cy : (H - 24) / (total - 1) * i + 12;
    return { ...nb, x, y };
  });
  const inPos = place(ins, colX.in), outPos = place(outs, colX.out);

  const COLOR = { monster:"#d98a6a", item:"#6bd28a", npc:"#c79bff", quest:"#f5c451", zone:"#6fb3d1",
    ability:"#ff8fce", class:"#9fb4d8", ore:"#b0855a", tree:"#7ab87a", shop:"#e0c060" };
  const colorOf = k => { const nn = nodeByKey.get(k); return nn ? (COLOR[nn.kind] || "#8a93a3") : "#ff6b6b"; };

  // Edges first (under nodes).
  for (const p of inPos) s.append(svg("line", { x1: p.x, y1: p.y, x2: cx, y2: cy, stroke: "#3a4252", "stroke-width": "1.3" }));
  for (const p of outPos) s.append(svg("line", { x1: cx, y1: cy, x2: p.x, y2: p.y, stroke: "#3a4252", "stroke-width": "1.3" }));

  const drawNode = (x, y, key, label, isCenter) => {
    const g = svg("g", { class: "gv-node", style: "cursor:pointer" });
    const r = isCenter ? 9 : 6;
    g.append(svg("circle", { cx: x, cy: y, r: String(r), fill: colorOf(key), stroke: "#0e1014", "stroke-width": "1.5" }));
    const nn = nodeByKey.get(key);
    const t = svg("text", { x: String(x), y: String(y + (isCenter ? 24 : 0)), "text-anchor": isCenter ? "middle" : (x < cx ? "start" : "end"),
      dx: isCenter ? "0" : (x < cx ? "10" : "-10"), dy: isCenter ? "0" : "3.5",
      fill: isCenter ? "#d9dee6" : "#8a93a3", "font-size": isCenter ? "11" : "10", "font-family": "ui-monospace, monospace" });
    t.textContent = ((nn ? nn.id : key) || "").slice(0, isCenter ? 22 : 13);
    g.append(t);
    if (!isCenter) { g.onclick = () => select(key); const tt = svg("title"); tt.textContent = label + " · " + key; g.append(tt); }
    return g;
  };
  for (const p of inPos) s.append(drawNode(p.x, p.y, p.key, p.label, false));
  for (const p of outPos) s.append(drawNode(p.x, p.y, p.key, p.label, false));
  s.append(drawNode(cx, cy, center.key, center.id, true));

  // Column captions.
  if (ins.length) s.append(Object.assign(svg("text", { x: "8", y: "12", fill: "#5c6575", "font-size": "9" }), { textContent: "INBOUND" }));
  if (outs.length) s.append(Object.assign(svg("text", { x: String(W - 8), y: "12", "text-anchor": "end", fill: "#5c6575", "font-size": "9" }), { textContent: "OUTBOUND" }));
  wrap.append(s);
  return wrap;
}

// ── Findings panel ───────────────────────────────────────────────────────────
const SEV_ICON = { error: "✗", warn: "!", info: "·" };
const sevFilters = $("#findingFilters");
const sevChips = {};
for (const s of ["error", "warn", "info"]) {
  const n = DATA.findings.filter(f => f.severity === s).length;
  const chip = el("span", "chip sev-" + s + " on");
  chip.append(document.createTextNode(s), el("span", "ct", String(n)));
  chip.onclick = () => { activeSev.has(s) ? activeSev.delete(s) : activeSev.add(s); chip.classList.toggle("on"); renderFindings(); };
  sevChips[s] = chip; sevFilters.append(chip);
}
function syncSevChips() { for (const s in sevChips) sevChips[s].classList.toggle("on", activeSev.has(s)); }

function findingCard(f, compact) {
  const d = el("div", "finding " + f.severity);
  d.dataset.fi = f._i;
  const head = el("div", "fhead");
  head.append(el("span", "sev-ico", SEV_ICON[f.severity]));
  head.append(el("span", "fsub", f.subject));
  head.append(el("span", "rule", f.rule));
  d.append(head, el("div", "fmsg", f.message));
  if (!compact && f.entityKey) {
    const n = nodeByKey.get(f.entityKey);
    d.append(el("div", "flink", "→ open " + (n ? n.id : f.entityKey)));
  }
  d.onclick = () => { if (f.entityKey && nodeByKey.has(f.entityKey)) { select(f.entityKey); location.hash = "f/" + f._i; } };
  return d;
}

function renderFindings() {
  const wrap = $("#findingList");
  wrap.innerHTML = "";
  const fs = DATA.findings.filter(f => activeSev.has(f.severity));
  $("#findingCount").textContent = fs.length + (fs.length === 1 ? " finding" : " findings");
  if (!DATA.findings.length) { wrap.append(el("div", "ok-banner", "✓ No issues found — every reference resolves.")); return; }
  if (!fs.length) { wrap.append(el("div", "empty", "No findings for the selected severities.")); return; }
  for (const f of fs) wrap.append(findingCard(f, false));
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
const listEl = $("#entityList");
function moveCursor(delta) {
  const max = Math.min(visible.length, 600) - 1;
  if (max < 0) return;
  cursorIdx = cursorIdx < 0 ? (delta > 0 ? 0 : max) : Math.max(0, Math.min(max, cursorIdx + delta));
  renderList();
  const li = listEl.children[cursorIdx];
  if (li && li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
}
document.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement !== search) { e.preventDefault(); search.focus(); search.select(); return; }
  if (e.key === "Escape") {
    if (search.value) { search.value = ""; searchWrap.classList.remove("has-text"); cursorIdx = -1; renderList(); }
    else search.blur();
    return;
  }
  if (document.activeElement === search && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault(); listEl.focus(); moveCursor(e.key === "ArrowDown" ? 1 : -1); return;
  }
  if (e.key === "ArrowDown") { e.preventDefault(); moveCursor(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveCursor(-1); }
  else if (e.key === "Enter" && cursorIdx >= 0 && visible[cursorIdx]) select(visible[cursorIdx].key);
});

// ── Deep-linking ─────────────────────────────────────────────────────────────
function applyHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (h.startsWith("e/")) { const k = h.slice(2); if (nodeByKey.has(k)) select(k, { keepHash: true }); }
  else if (h.startsWith("f/")) {
    const f = DATA.findings[Number(h.slice(2))];
    if (f) { if (f.entityKey && nodeByKey.has(f.entityKey)) select(f.entityKey, { keepHash: true });
      requestAnimationFrame(() => { const card = $('#findingList .finding[data-fi="' + f._i + '"]');
        if (card) { card.scrollIntoView({ block: "center" }); card.classList.add("flash"); setTimeout(() => card.classList.remove("flash"), 1000); } }); }
  }
}
window.addEventListener("hashchange", applyHash);

// ── Boot ─────────────────────────────────────────────────────────────────────
syncStatHighlight();
renderList();
renderFindings();
applyHash();
`;
