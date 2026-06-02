import { loadShared } from "../game/index.ts";
import { analyzeEconomy, type EconomyAnalysis } from "./index.ts";
import { resolveOptions, type EconomyOptions } from "./options.ts";
import { xpCurve } from "./skills.ts";

/** Flat, JSON-friendly payload inlined into the HTML report. */
interface ReportData {
  generatedAt: string;
  params: EconomyAnalysis["params"];
  totalXpToCap: number;
  signals: string[];
  curve: { level: number; cumulativeXp: number; xpToNext: number }[];
  skills: EconomyAnalysis["skills"];
  combat: EconomyAnalysis["combat"];
  gold: EconomyAnalysis["gold"];
}

/**
 * Render a single self-contained HTML report visualising the economy projection:
 * the XP curve, per-skill time-to-level bars, combat xp/gold-per-hour bars, and
 * the gold faucet/sink ledger — with the SIGNALS leading. Hand-drawn charts on
 * canvas; no external libraries or network calls.
 */
export async function renderEconomyReport(opts: EconomyOptions = {}): Promise<string> {
  const opt = resolveOptions(opts);
  const [analysis, shared] = await Promise.all([analyzeEconomy(opts), loadShared()]);

  const data: ReportData = {
    generatedAt: new Date().toISOString(),
    params: analysis.params,
    totalXpToCap: analysis.totalXpToCap,
    signals: analysis.signals,
    curve: xpCurve(shared, opt.maxLevel),
    skills: analysis.skills,
    combat: analysis.combat,
    gold: analysis.gold
  };

  const json = JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TIB Economy Simulator</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>TIB Economy Simulator</h1>
  <div id="meta"></div>
</header>
<div id="params" class="params"></div>
<main>
  <section id="signals" class="full">
    <h2>Signals</h2>
    <ul id="signalList" class="signal-list"></ul>
  </section>
  <section id="curveSec">
    <h2>XP curve — cumulative xp to level</h2>
    <canvas id="curve" width="660" height="300"></canvas>
    <div class="legend"><span class="key area"></span> cumulative xp &nbsp; <span class="key line"></span> xp to next level</div>
  </section>
  <section id="skillsSec">
    <h2>Time to level — per skill (hours to L<span id="topMs"></span>)</h2>
    <div id="skillBars" class="bars"></div>
  </section>
  <section id="combatSec">
    <h2>Combat — xp/hr &amp; gold/hr by checkpoint</h2>
    <canvas id="combat" width="660" height="320"></canvas>
    <div class="legend"><span class="key xp"></span> xp/hr &nbsp; <span class="key gold"></span> gold/hr</div>
  </section>
  <section id="goldSec">
    <h2>Gold ledger — faucets vs sinks</h2>
    <div id="ledger" class="ledger"></div>
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
  --xp: #6aa3ff; --gold: #f5c451; --good: #6ed09a; --warn: #f5c451; --dead: #ff6b6b;
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: var(--bg); color: var(--text); }
header { display: flex; align-items: baseline; gap: 16px; padding: 14px 20px;
  border-bottom: 1px solid var(--border); background: var(--panel); }
h1 { font-size: 18px; margin: 0; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted);
  margin: 0 0 12px; }
#meta { color: var(--muted); font-size: 12px; }
.params { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 20px; border-bottom: 1px solid var(--border); }
.param { background: var(--panel2); border: 1px solid var(--border); border-radius: 6px;
  padding: 4px 10px; font-size: 12px; color: var(--muted); }
.param b { color: var(--accent); font-weight: 600; }
main { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 14px 20px; align-items: start; }
section { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
section.full { grid-column: 1 / -1; }
canvas { width: 100%; height: auto; display: block; }
.legend { margin-top: 8px; font-size: 12px; color: var(--muted); }
.key { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -2px; margin-right: 4px; }
.key.area { background: var(--xp); } .key.line { background: var(--good); }
.key.xp { background: var(--xp); } .key.gold { background: var(--gold); }
.signal-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.signal-list li { background: var(--panel2); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0;
  padding: 9px 12px; font-size: 13.5px; }
.bars { display: grid; gap: 9px; }
.bar-row { display: grid; grid-template-columns: 96px 1fr 64px; gap: 10px; align-items: center; }
.bar-name { font-size: 13px; }
.bar-name .tag { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; margin-left: 6px;
  padding: 1px 5px; border-radius: 8px; }
.tag.capped { background: rgba(245,196,81,.16); color: var(--warn); }
.tag.dead { background: rgba(255,107,107,.16); color: var(--dead); }
.bar-track { background: var(--panel2); border: 1px solid var(--border); border-radius: 5px; height: 18px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; background: var(--good); }
.bar-fill.warnf { background: var(--warn); } .bar-fill.deadf { background: var(--dead); opacity: .5; }
.bar-val { font-size: 12px; color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
.bar-sub { grid-column: 2 / -1; font-size: 11px; color: var(--muted); margin-top: -4px; }
.ledger { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.led-col h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 8px; }
.led-col.faucets h3 { color: var(--good); } .led-col.sinks h3 { color: var(--dead); }
.led-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0;
  border-bottom: 1px solid var(--border); font-size: 13px; }
.led-row .v { font-variant-numeric: tabular-nums; white-space: nowrap; }
.led-row.faucet .v { color: var(--good); } .led-row.sink .v { color: var(--dead); }
.led-row .note { color: var(--muted); font-size: 11px; }
.led-net { grid-column: 1 / -1; margin-top: 8px; padding: 10px 12px; background: var(--panel2);
  border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.led-net b { color: var(--accent); }
@media (max-width: 980px) { main { grid-template-columns: 1fr; } }
`;

const SCRIPT = `
const DATA = JSON.parse(document.getElementById("data").textContent);
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const fmt = n => Number(n).toLocaleString();
const hrs = h => !isFinite(h) ? "never" : h <= 0 ? "0" : h < 1 ? (Math.round(h*60) || "<1") + "m" : (Math.round(h*10)/10)+"h";

// Meta + params.
$("#meta").textContent = "generated " + DATA.generatedAt;
const ms = DATA.params.milestones;
$("#topMs").textContent = ms[2];
const params = $("#params");
const addParam = (label, val) => { const p = el("span", "param"); p.append(document.createTextNode(label + " "), el("b", null, String(val))); params.append(p); };
addParam("efficiency", Math.round(DATA.params.efficiency*100) + "%");
addParam("level cap", DATA.params.maxLevel);
addParam("milestones", "L" + ms.join(" / L"));
addParam("xp to cap", fmt(DATA.totalXpToCap));

// Signals.
const sl = $("#signalList");
for (const s of DATA.signals) sl.append(el("li", null, s));

// --- canvas helpers ---
function setupCanvas(cv) {
  const ratio = window.devicePixelRatio || 1;
  const w = cv.width, h = cv.height;
  cv.width = w * ratio; cv.height = h * ratio;
  cv.style.width = w + "px"; cv.style.height = "auto";
  const ctx = cv.getContext("2d");
  ctx.scale(ratio, ratio);
  return { ctx, w, h };
}
const COL = { grid: "#2a2f3a", muted: "#8b93a1", text: "#d7dce3", xp: "#6aa3ff", gold: "#f5c451", good: "#6ed09a" };

// --- XP curve (area = cumulative, line = xp-to-next) ---
(function drawCurve() {
  const cv = $("#curve"); const { ctx, w, h } = setupCanvas(cv);
  const pad = { l: 58, r: 16, t: 14, b: 26 };
  const pts = DATA.curve;
  const maxCum = Math.max(1, ...pts.map(p => p.cumulativeXp));
  const maxNext = Math.max(1, ...pts.map(p => p.xpToNext));
  const minL = pts[0].level, maxL = pts[pts.length-1].level;
  const xOf = lv => pad.l + (lv - minL) / Math.max(1, maxL - minL) * (w - pad.l - pad.r);
  const yCum = v => h - pad.b - v / maxCum * (h - pad.t - pad.b);
  const yNext = v => h - pad.b - v / maxNext * (h - pad.t - pad.b);

  // gridlines + y labels (cumulative scale)
  ctx.font = "11px system-ui"; ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const v = maxCum * i / 4, y = yCum(v);
    ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = COL.muted; ctx.textAlign = "right"; ctx.fillText(fmt(Math.round(v)), pad.l - 6, y);
  }
  // x labels
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let lv = minL; lv <= maxL; lv += Math.max(1, Math.round((maxL-minL)/6))) ctx.fillText("L"+lv, xOf(lv), h - pad.b + 6);

  // area (cumulative)
  ctx.beginPath(); ctx.moveTo(xOf(minL), h - pad.b);
  for (const p of pts) ctx.lineTo(xOf(p.level), yCum(p.cumulativeXp));
  ctx.lineTo(xOf(maxL), h - pad.b); ctx.closePath();
  const g = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  g.addColorStop(0, "rgba(106,163,255,.42)"); g.addColorStop(1, "rgba(106,163,255,.04)");
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => { const x = xOf(p.level), y = yCum(p.cumulativeXp); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = COL.xp; ctx.lineWidth = 2; ctx.stroke();

  // xp-to-next line (own scale)
  ctx.beginPath();
  pts.forEach((p, i) => { const x = xOf(p.level), y = yNext(p.xpToNext); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = COL.good; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
})();

// --- Per-skill time-to-top-milestone bars ---
(function drawSkillBars() {
  const wrap = $("#skillBars");
  const finite = DATA.skills.filter(s => isFinite(s.hoursToMilestone[2]));
  const maxH = Math.max(0.001, ...finite.map(s => s.hoursToMilestone[2]));
  for (const s of DATA.skills) {
    const row = el("div", "bar-row");
    const name = el("div", "bar-name"); name.append(el("span", null, s.skill));
    if (s.cappedAtLevel) name.append(el("span", "tag capped", "cap L" + s.cappedAtLevel));
    else if (!isFinite(s.hoursToMilestone[2])) name.append(el("span", "tag dead", "dead"));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    const h = s.hoursToMilestone[2];
    if (s.cappedAtLevel || !isFinite(h)) { fill.className = "bar-fill deadf"; fill.style.width = "100%"; }
    else { fill.style.width = Math.max(2, h / maxH * 100) + "%"; if (h < 1) fill.classList.add("warnf"); }
    track.append(fill);
    const val = el("div", "bar-val", s.cappedAtLevel ? "capped" : hrs(h));
    row.append(name, track, val);
    wrap.append(row);
    const sub = el("div", "bar-sub", (s.trainable ? fmt(s.xpPerHourAtCap) + " xp/hr · " : "") + s.bestMethodAtCap);
    const rw = el("div", "bar-row"); rw.append(el("div"), sub, el("div")); wrap.append(rw);
  }
})();

// --- Combat xp/hr & gold/hr by checkpoint (grouped bars) ---
(function drawCombat() {
  const cv = $("#combat"); const { ctx, w, h } = setupCanvas(cv);
  const pad = { l: 56, r: 56, t: 14, b: 44 };
  const rows = DATA.combat.perProfile;
  if (!rows.length) return;
  const maxXp = Math.max(1, ...rows.map(r => r.xpPerHour));
  const maxGold = Math.max(1, ...rows.map(r => r.goldPerHour));
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
  const groupW = plotW / rows.length, barW = Math.min(26, groupW / 3);

  ctx.font = "11px system-ui";
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + plotH * i / 4;
    ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = COL.xp; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(fmt(Math.round(maxXp * (1 - i/4))), pad.l - 6, y);
    ctx.fillStyle = COL.gold; ctx.textAlign = "left";
    ctx.fillText(fmt(Math.round(maxGold * (1 - i/4))), w - pad.r + 6, y);
  }
  rows.forEach((r, i) => {
    const cx = pad.l + groupW * i + groupW / 2;
    const xpH = r.xpPerHour / maxXp * plotH, goH = r.goldPerHour / maxGold * plotH;
    ctx.fillStyle = COL.xp; ctx.fillRect(cx - barW - 2, pad.t + plotH - xpH, barW, xpH);
    ctx.fillStyle = COL.gold; ctx.fillRect(cx + 2, pad.t + plotH - goH, barW, goH);
    ctx.fillStyle = COL.text; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(r.label, cx, h - pad.b + 6);
    ctx.fillStyle = COL.muted; ctx.fillText("L" + r.level, cx, h - pad.b + 22);
  });
})();

// --- Gold ledger ---
(function drawLedger() {
  const wrap = $("#ledger");
  const fau = el("div", "led-col faucets"); fau.append(el("h3", null, "Faucets (in)"));
  const tagOf = k => k === "perHour" ? " /hr" : k === "perUse" ? " /use" : "";
  for (const f of DATA.gold.faucets) {
    const row = el("div", "led-row faucet");
    row.append(el("span", null, f.label));
    row.append(el("span", "v", "+" + fmt(f.gold) + "g" + tagOf(f.kind)));
    fau.append(row);
  }
  const snk = el("div", "led-col sinks"); snk.append(el("h3", null, "Sinks (out)"));
  for (const s of DATA.gold.sinks) {
    const row = el("div", "led-row sink");
    const left = el("span"); left.append(document.createTextNode(s.label));
    if (s.note) left.append(el("span", "note", " — " + s.note));
    row.append(left, el("span", "v", "-" + fmt(s.gold) + "g" + tagOf(s.kind)));
    snk.append(row);
  }
  wrap.append(fau, snk);
  const g = DATA.gold;
  const net = el("div", "led-net");
  net.innerHTML = "Starter kit costs <b>" + fmt(g.starterKitCost) + "g</b>. Quest gold (<b>" + fmt(g.questGoldTotal) +
    "g</b> one-time) covers it <b>" + (Math.round(g.questGoldTotal / Math.max(1, g.starterKitCost) * 10)/10) +
    "×</b> over. Combat alone affords the kit in <b>" + hrs(g.hoursToAffordKit) + "</b> at " + fmt(g.bestEarlyGoldPerHour) + " g/hr.";
  wrap.append(net);
})();
`;
