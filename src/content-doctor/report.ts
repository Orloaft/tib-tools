import type { Analysis } from "../content-graph/types.ts";
import type { GraphEdge, GraphNode, ReferenceGraph } from "./graph.ts";

/**
 * The data payload inlined into the HTML report. Kept flat and JSON-friendly so
 * it embeds cleanly and the in-page vanilla JS can index it without any libs.
 */
interface ReportData {
  generatedAt: string;
  counts: Record<string, number>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  findings: Analysis["findings"];
  summary: { errors: number; warnings: number; infos: number };
}

/**
 * Render a single self-contained HTML file: inline data + styles + vanilla JS,
 * no external libraries or network calls. The page is an entity explorer (search
 * / filter by kind, click for inbound+outbound references) plus a findings panel
 * grouped by severity.
 */
export function renderReport(analysis: Analysis, graph: ReferenceGraph): string {
  const data: ReportData = {
    generatedAt: new Date().toISOString(),
    counts: { ...analysis.summary.counts },
    nodes: [...graph.nodes.values()].sort((a, b) => a.key.localeCompare(b.key)),
    edges: graph.edges,
    findings: analysis.findings,
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
  <h1>TIB Content Doctor</h1>
  <div id="meta"></div>
</header>
<div id="counts" class="counts"></div>
<main>
  <section id="explorer">
    <h2>Entities</h2>
    <div class="controls">
      <input id="search" type="search" placeholder="Search entities by id or label…" autocomplete="off">
      <div id="kindFilters" class="kind-filters"></div>
    </div>
    <ul id="entityList" class="entity-list"></ul>
  </section>
  <section id="detail">
    <h2>Details</h2>
    <div id="detailBody" class="detail-body"><p class="muted">Select an entity to see its references.</p></div>
  </section>
  <section id="findings">
    <h2>Findings</h2>
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
  --bg: #0f1115; --panel: #171a21; --panel2: #1d212b; --border: #2a2f3a;
  --text: #d7dce3; --muted: #8b93a1; --accent: #6aa3ff;
  --error: #ff6b6b; --warn: #f5c451; --info: #6fb3d1;
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: var(--bg); color: var(--text); }
header { display: flex; align-items: baseline; gap: 16px; padding: 14px 20px;
  border-bottom: 1px solid var(--border); background: var(--panel); }
h1 { font-size: 18px; margin: 0; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted);
  margin: 0 0 10px; }
#meta { color: var(--muted); font-size: 12px; }
.counts { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 20px; border-bottom: 1px solid var(--border); }
.count { background: var(--panel2); border: 1px solid var(--border); border-radius: 6px;
  padding: 4px 10px; font-size: 12px; }
.count b { color: var(--accent); }
main { display: grid; grid-template-columns: 320px 1fr 360px; gap: 14px; padding: 14px 20px;
  align-items: start; }
section { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
.controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
input[type=search] { width: 100%; padding: 7px 10px; background: var(--panel2); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px; }
.kind-filters, .sev-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { cursor: pointer; user-select: none; font-size: 11px; padding: 3px 8px; border-radius: 12px;
  border: 1px solid var(--border); background: var(--panel2); color: var(--muted); }
.chip.on { color: var(--text); border-color: var(--accent); }
.entity-list, .finding-list { list-style: none; margin: 0; padding: 0; max-height: 70vh; overflow: auto; }
.entity-list li { padding: 6px 8px; border-radius: 5px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
.entity-list li:hover { background: var(--panel2); }
.entity-list li.sel { background: #243047; }
.kind-badge { font-size: 10px; text-transform: uppercase; color: var(--muted); min-width: 56px; }
.eid { color: var(--text); }
.elabel { color: var(--muted); font-size: 12px; }
.detail-body h3 { margin: 0 0 4px; font-size: 15px; }
.detail-body .sub { color: var(--muted); font-size: 12px; margin-bottom: 12px; }
.refgroup { margin-bottom: 14px; }
.refgroup h4 { margin: 0 0 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.ref { padding: 4px 6px; border-radius: 5px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
.ref:hover { background: var(--panel2); }
.edge-label { font-size: 11px; color: var(--accent); min-width: 84px; }
.muted { color: var(--muted); }
.finding { border-left: 3px solid var(--border); padding: 7px 10px; margin-bottom: 8px;
  background: var(--panel2); border-radius: 0 5px 5px 0; }
.finding.error { border-left-color: var(--error); }
.finding.warn { border-left-color: var(--warn); }
.finding.info { border-left-color: var(--info); }
.finding .fhead { display: flex; gap: 8px; align-items: baseline; }
.finding .rule { font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; }
.finding .fsub { font-size: 12px; cursor: pointer; color: var(--accent); }
.finding .fmsg { font-size: 12px; margin-top: 3px; }
.sev-count.error { color: var(--error); } .sev-count.warn { color: var(--warn); } .sev-count.info { color: var(--info); }
.empty { color: var(--muted); font-size: 12px; padding: 8px; }
@media (max-width: 1100px) { main { grid-template-columns: 1fr; } }
`;

const SCRIPT = `
const DATA = JSON.parse(document.getElementById("data").textContent);
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

// Index edges by endpoint.
const outByKey = new Map(), inByKey = new Map();
for (const e of DATA.edges) {
  (outByKey.get(e.from) || outByKey.set(e.from, []).get(e.from)).push(e);
  (inByKey.get(e.to) || inByKey.set(e.to, []).get(e.to)).push(e);
}
const nodeByKey = new Map(DATA.nodes.map(n => [n.key, n]));
const kinds = [...new Set(DATA.nodes.map(n => n.kind))].sort();

// Meta + counts.
$("#meta").textContent = "generated " + DATA.generatedAt + " · " + DATA.nodes.length + " entities · " + DATA.edges.length + " references";
const counts = $("#counts");
for (const [k, v] of Object.entries(DATA.counts)) {
  const c = el("span", "count"); c.append(el("b", null, String(v)), document.createTextNode(" " + k)); counts.append(c);
}
{
  const s = DATA.summary;
  const add = (cls, label, n) => { const c = el("span", "count"); const b = el("b", "sev-count " + cls, String(n)); c.append(b, document.createTextNode(" " + label)); counts.append(c); };
  add("error", "errors", s.errors); add("warn", "warnings", s.warnings); add("info", "info", s.infos);
}

// Kind filter chips.
const activeKinds = new Set(kinds);
const kindFilters = $("#kindFilters");
for (const k of kinds) {
  const chip = el("span", "chip on", k + " (" + DATA.nodes.filter(n => n.kind === k).length + ")");
  chip.onclick = () => { chip.classList.toggle("on"); chip.classList.contains("on") ? activeKinds.add(k) : activeKinds.delete(k); renderList(); };
  kindFilters.append(chip);
}

const search = $("#search");
search.oninput = renderList;
let selectedKey = null;

function renderList() {
  const q = search.value.trim().toLowerCase();
  const list = $("#entityList");
  list.innerHTML = "";
  const items = DATA.nodes.filter(n => activeKinds.has(n.kind) &&
    (!q || n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)));
  if (!items.length) { list.append(el("li", "empty", "No matching entities.")); return; }
  for (const n of items.slice(0, 500)) {
    const li = el("li"); if (n.key === selectedKey) li.classList.add("sel");
    li.append(el("span", "kind-badge", n.kind), el("span", "eid", n.id));
    if (n.label !== n.id) li.append(el("span", "elabel", n.label));
    li.onclick = () => select(n.key);
    list.append(li);
  }
  if (items.length > 500) list.append(el("li", "empty", "…" + (items.length - 500) + " more (refine search)"));
}

function select(key) {
  selectedKey = key;
  renderList();
  const n = nodeByKey.get(key);
  const body = $("#detailBody");
  body.innerHTML = "";
  if (!n) { body.append(el("p", "muted", "Unknown entity " + key)); return; }
  body.append(el("h3", null, n.id));
  body.append(el("div", "sub", n.kind + (n.label !== n.id ? " · " + n.label : "")));

  const out = outByKey.get(key) || [];
  const inb = inByKey.get(key) || [];
  body.append(refGroup("Outbound — references " + out.length + " entit" + (out.length === 1 ? "y" : "ies"), out, "to"));
  body.append(refGroup("Inbound — referenced by " + inb.length + " entit" + (inb.length === 1 ? "y" : "ies"), inb, "from"));
}

function refGroup(title, edges, endpoint) {
  const g = el("div", "refgroup");
  g.append(el("h4", null, title));
  if (!edges.length) { g.append(el("div", "empty", "(none)")); return g; }
  for (const e of edges) {
    const otherKey = e[endpoint];
    const other = nodeByKey.get(otherKey);
    const row = el("div", "ref");
    const arrow = endpoint === "to" ? "--" + e.label + "-->" : "<--" + e.label + "--";
    row.append(el("span", "edge-label", arrow));
    row.append(el("span", "eid", other ? other.id : otherKey));
    if (other && other.label !== other.id) row.append(el("span", "elabel", other.label));
    row.onclick = () => select(otherKey);
    g.append(row);
  }
  return g;
}

// Findings.
const sevOrder = ["error", "warn", "info"];
const activeSev = new Set(sevOrder);
const sevFilters = $("#findingFilters");
for (const s of sevOrder) {
  const n = DATA.findings.filter(f => f.severity === s).length;
  const chip = el("span", "chip on", s + " (" + n + ")");
  chip.onclick = () => { chip.classList.toggle("on"); chip.classList.contains("on") ? activeSev.add(s) : activeSev.delete(s); renderFindings(); };
  sevFilters.append(chip);
}
function renderFindings() {
  const wrap = $("#findingList");
  wrap.innerHTML = "";
  const fs = DATA.findings.filter(f => activeSev.has(f.severity));
  if (!fs.length) { wrap.append(el("div", "empty", "No findings for the selected severities.")); return; }
  for (const f of fs) {
    const d = el("div", "finding " + f.severity);
    const head = el("div", "fhead");
    const sub = el("span", "fsub", f.subject);
    sub.onclick = () => { const k = subjectToKey(f.subject); if (k && nodeByKey.has(k)) select(k); };
    head.append(sub, el("span", "rule", "[" + f.rule + "]"));
    d.append(head, el("div", "fmsg", f.message));
    wrap.append(d);
  }
}
// "item:potion" / "shop:axe" -> graph key; pass through known kinds only.
function subjectToKey(subject) {
  const i = subject.indexOf(":");
  if (i < 0) return null;
  const kind = subject.slice(0, i);
  return DATA.nodes.some(n => n.kind === kind) ? subject : null;
}

renderList();
renderFindings();
`;
