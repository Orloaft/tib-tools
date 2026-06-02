"use strict";

// GM Dashboard frontend. Live state via EventSource('/events'); control via
// fetch POST '/command'; picker options via GET '/meta'. No frameworks, no CDN.

const $ = (id) => document.getElementById(id);

let world = null;
let meta = null;
let selectedFloor = null;
let floorTouched = false; // user picked a floor manually
let follow = false; // keep the minimap centered on the selected player
let selection = null; // { kind: "player"|"monster"|"npc"|"corpse", id }
let activeTab = "roster";

// Event feed bookkeeping.
let seenSeq = -1; // highest event seq folded into the feed
let feedRows = []; // { type, text, x, y, floor, seq } newest last
let feedFloorOnly = false;
let unseenEvents = 0;

// Minimap projection state (rebuilt every draw) for hit-testing.
let projection = null; // { project(x,y)->[px,py], hit(px,py)->entity|null, mapSize }

// --- Live state (SSE) ------------------------------------------------------

function connect() {
  const es = new EventSource("/events");
  es.addEventListener("error", () => setConn("reconnecting"));
  es.addEventListener("status", (e) => {
    try { setConn(JSON.parse(e.data).status); } catch {}
  });
  es.addEventListener("world", (e) => {
    try { world = JSON.parse(e.data); } catch { return; }
    setConn("open");
    ingestEvents();
    render();
  });
}

function setConn(status) {
  const el = $("conn");
  const map = {
    open: ["live", "badge-good"],
    connecting: ["connecting…", "badge-warn"],
    reconnecting: ["reconnecting…", "badge-warn"],
    closed: ["disconnected", "badge-bad"]
  };
  const [label, cls] = map[status] || map.closed;
  el.textContent = label;
  el.className = "badge " + cls;
}

// --- Meta (picker options) -------------------------------------------------

async function loadMeta() {
  try {
    const res = await fetch("/meta");
    meta = await res.json();
  } catch {
    meta = { monsters: [], items: [], floors: [] };
  }
  fillSelect($("sp-monster"), meta.monsters, (m) => m.id, (m) => `${m.name} (${m.id})`, "monster…");
  fillSelect($("gr-item-id"), meta.items, (i) => i.id, (i) => `${i.label} (${i.id})`, "item…");
}

function fillSelect(sel, list, valueOf, labelOf, placeholder) {
  const prev = sel.value;
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = placeholder;
  sel.appendChild(ph);
  for (const item of list) {
    const opt = document.createElement("option");
    opt.value = valueOf(item);
    opt.textContent = labelOf(item);
    sel.appendChild(opt);
  }
  if (prev) sel.value = prev;
}

// --- Event feed ------------------------------------------------------------

function ingestEvents() {
  if (!world || !Array.isArray(world.events)) return;
  for (const ev of world.events) {
    if (ev.seq <= seenSeq) continue;
    seenSeq = ev.seq;
    feedRows.push(ev);
    if (activeTab !== "feed") unseenEvents += 1;
  }
  if (feedRows.length > 300) feedRows.splice(0, feedRows.length - 300);
}

function renderFeed() {
  const host = $("feed");
  const rows = feedFloorOnly ? feedRows.filter((e) => e.floor === selectedFloor) : feedRows;
  host.innerHTML = "";
  if (!rows.length) {
    host.innerHTML = '<p class="empty">No events yet.</p>';
    return;
  }
  // Show the most recent 200; column-reverse flow puts newest on top.
  for (const e of rows.slice(-200)) {
    const row = document.createElement("div");
    row.className = "feed-row";
    const loc = e.x != null && e.y != null ? `${e.floor != null ? "f" + e.floor + " " : ""}${Math.round(e.x)},${Math.round(e.y)}` : "";
    const color = e.color ? ` style="color:${cssColor(e.color)}"` : "";
    row.innerHTML =
      `<span class="ev-type">${esc(e.type)}</span>` +
      `<span class="ev-text"${color}>${esc(String(e.text))}</span>` +
      `<span class="ev-loc">${esc(loc)}</span>`;
    host.appendChild(row);
  }
}

function cssColor(c) {
  // Game colors may be hex or names; only allow safe-ish tokens.
  return /^#?[0-9a-zA-Z]+$/.test(c) ? (c[0] === "#" ? c : "#" + c).slice(0, 8) : "inherit";
}

// --- Rendering -------------------------------------------------------------

function render() {
  if (!world) return;
  const c = world.counts;
  $("c-players").textContent = c.players;
  $("c-monsters").textContent = c.monsters;
  $("c-npcs").textContent = c.npcs;
  $("c-corpses").textContent = c.corpses;
  $("c-nodes").textContent = c.trees + c.fishingNodes + c.miningNodes + c.herbNodes + c.fires;

  // Drop a stale selection if its entity is gone.
  if (selection && !findEntity(selection)) selection = null;

  renderFloorSelect();
  renderRoster();
  renderDetail();
  renderFeed();
  updateFeedBadge();
  renderMinimap();
}

function floorList() {
  const set = new Set(world.floors);
  if (world.maps) for (const f of world.maps) set.add(f);
  const out = [...set].sort((a, b) => a - b);
  return out.length ? out : [0];
}

function renderFloorSelect() {
  const sel = $("floor-select");
  const floors = floorList();
  if (selectedFloor === null || (!floorTouched && !floors.includes(selectedFloor))) {
    selectedFloor = floors[0];
  }
  const want = floors.join(",");
  if (sel.dataset.floors !== want) {
    sel.innerHTML = "";
    for (const f of floors) {
      const opt = document.createElement("option");
      opt.value = String(f);
      opt.textContent = "floor " + f;
      sel.appendChild(opt);
    }
    sel.dataset.floors = want;
  }
  sel.value = String(selectedFloor);
}

function entitiesByFloor() {
  const by = new Map();
  const add = (e, kind) => {
    if (!by.has(e.floor)) by.set(e.floor, { players: [], monsters: [], npcs: [], corpses: [], nodes: [] });
    by.get(e.floor)[kind].push(e);
  };
  for (const p of world.players) add(p, "players");
  for (const m of world.monsters) add(m, "monsters");
  for (const n of world.npcs) add(n, "npcs");
  for (const c of world.corpses) add(c, "corpses");
  for (const list of [world.trees, world.fishingNodes, world.miningNodes, world.herbNodes, world.fires]) {
    for (const r of list) add(r, "nodes");
  }
  return by;
}

function renderRoster() {
  const host = $("roster");
  const by = entitiesByFloor();
  const floors = [...by.keys()].sort((a, b) => a - b);
  host.innerHTML = "";
  if (!floors.length) {
    host.innerHTML = '<p class="empty">No entities in the world.</p>';
    return;
  }
  for (const f of floors) {
    const g = by.get(f);
    const group = document.createElement("div");
    group.className = "floor-group";
    const counts = `${g.players.length}p · ${g.monsters.length}m · ${g.npcs.length}n · ${g.corpses.length}c · ${g.nodes.length}r`;
    const h = document.createElement("h3");
    h.innerHTML = `<span>Floor ${f}</span><span class="fg-counts">${counts}</span>`;
    group.appendChild(h);
    for (const p of g.players) group.appendChild(rosterRow("player", p, `${p.name} · L${p.level}`, p.hp, p.maxHp));
    for (const m of g.monsters) group.appendChild(rosterRow("monster", m, `${m.name || m.type} · L${m.level}`, m.hp, m.maxHp));
    for (const n of g.npcs) group.appendChild(rosterRow("npc", n, `${n.name} · ${n.role}`, null, null));
    host.appendChild(group);
  }
}

function rosterRow(kind, e, label, hp, maxHp) {
  const row = document.createElement("div");
  row.className = "ent-row" + (isSelected(kind, e.id) ? " selected" : "");
  row.dataset.kind = kind;
  row.dataset.id = e.id;
  const hpHtml = hp != null && maxHp ? `<span class="hpbar"><i style="width:${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%"></i></span>` : "";
  row.innerHTML =
    `<span class="name"><i class="kind-pip pip-${kind}"></i>${esc(label)}</span>` +
    `${hpHtml}<span class="pos">${Math.round(e.x)},${Math.round(e.y)}</span>`;
  return row;
}

// --- Selection & detail ----------------------------------------------------

function isSelected(kind, id) {
  return selection && selection.kind === kind && selection.id === id;
}

function findEntity(sel) {
  if (!sel || !world) return null;
  const lists = { player: world.players, monster: world.monsters, npc: world.npcs, corpse: world.corpses };
  const list = lists[sel.kind];
  return list ? list.find((e) => e.id === sel.id) || null : null;
}

function selectEntity(kind, id, opts = {}) {
  selection = { kind, id };
  const e = findEntity(selection);
  if (e) {
    selectedFloor = e.floor;
    floorTouched = true;
  }
  if (opts.showDetail) setTab("detail");
  render();
}

function renderDetail() {
  const host = $("detail");
  const e = findEntity(selection);
  if (!e) {
    host.innerHTML = '<p class="empty">Nothing selected. Click an entity on the minimap or in the roster.</p>';
    return;
  }
  const kind = selection.kind;
  let html = "";
  const title = kind === "player" ? e.name : kind === "monster" ? e.name || e.type : kind === "npc" ? e.name : e.label;
  html += `<div class="detail-title"><i class="kind-pip pip-${kind === "corpse" ? "npc" : kind}"></i>${esc(title || kind)}</div>`;
  html += `<div class="detail-sub">${esc(kind)} · floor ${e.floor} · (${Math.round(e.x)}, ${Math.round(e.y)})</div>`;

  if (kind === "player") html += playerDetail(e);
  else if (kind === "monster") html += monsterDetail(e);
  else if (kind === "npc") html += npcDetail(e);
  else if (kind === "corpse") html += corpseDetail(e);

  // Context actions.
  html += `<div class="detail-actions">`;
  html += `<button data-act="center">Center map</button>`;
  html += `<button data-act="tp-to">Teleport GM here</button>`;
  html += `<button data-act="copy">Copy id</button>`;
  if (kind === "monster") html += `<button data-act="spawn-here">Spawn another here</button>`;
  html += `</div>`;
  host.innerHTML = html;
}

function bar(cls, val, max) {
  const pct = max ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;
  return `<div class="bar ${cls}"><i style="width:${pct}%"></i></div>`;
}

function kv(pairs) {
  return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

function playerDetail(p) {
  let h = kv([
    ["id", `<code>${esc(p.id)}</code>`],
    ["class", esc(p.classKey)],
    ["level", `${p.level} (xp ${p.xp})`],
    ["hp", `${Math.round(p.hp)} / ${p.maxHp}${bar("hp", p.hp, p.maxHp)}`],
    ["mana", `${Math.round(p.mana)} / ${p.maxMana}${bar("mana", p.mana, p.maxMana)}`],
    ["favor", `${Math.round(p.favor)} / ${p.maxFavor}${bar("favor", p.favor, p.maxFavor)}`],
    ["gold", String(p.gold)],
    ["gear", `weapon T${p.weaponTier} · armor T${p.armorTier}`],
    ["weight", `${Math.round(p.weight)} / ${p.maxWeight}`],
    ["state", `${p.dead ? "dead" : "alive"}${p.moving ? " · moving" : ""}${p.action ? " · " + p.action.type : ""}`]
  ]);
  const inv = (p.inventory || []).filter(Boolean);
  if (inv.length) {
    h += `<div class="detail-section"><h4>Inventory</h4><div class="chips">` +
      inv.map((it) => `<span class="chip">${esc(it.label || it.id)}${it.qty > 1 ? ` <span class="q">×${it.qty}</span>` : ""}</span>`).join("") +
      `</div></div>`;
  }
  const skills = (p.skills || []).filter((s) => s.level > 1);
  if (skills.length) {
    h += `<div class="detail-section"><h4>Skills</h4><div class="chips">` +
      skills.map((s) => `<span class="chip">${esc(s.label)} <span class="q">L${s.level}</span></span>`).join("") +
      `</div></div>`;
  }
  const quests = (p.quests || []).filter((q) => q.accepted && !q.claimed);
  if (quests.length) {
    h += `<div class="detail-section"><h4>Active quests</h4><div class="chips">` +
      quests.map((q) => `<span class="chip">${esc(q.title)} <span class="q">${q.progress}/${q.target}</span></span>`).join("") +
      `</div></div>`;
  }
  return h;
}

function monsterDetail(m) {
  const statuses = (m.statuses || []).join(", ") || "none";
  return kv([
    ["id", `<code>${esc(m.id)}</code>`],
    ["type", esc(m.type)],
    ["level", String(m.level)],
    ["role", esc(m.role)],
    ["zone", esc(m.zone)],
    ["hp", `${Math.round(m.hp)} / ${m.maxHp}${bar("hp", m.hp, m.maxHp)}`],
    ["target", m.targetId ? `<code>${esc(m.targetId)}</code>` : "—"],
    ["statuses", esc(statuses)],
    ["state", `${m.moving ? "moving" : "idle"}${m.attacking ? " · attacking" : ""}`]
  ]);
}

function npcDetail(n) {
  let h = kv([
    ["id", `<code>${esc(n.id)}</code>`],
    ["role", esc(n.role)],
    ["facing", esc(n.dir)]
  ]);
  if (n.dialogue) h += `<div class="detail-section"><h4>Dialogue</h4><div class="chips"><span class="chip">${esc(n.dialogue)}</span></div></div>`;
  return h;
}

function corpseDetail(c) {
  let h = kv([
    ["id", `<code>${esc(c.id)}</code>`],
    ["kind", esc(c.kind)],
    ["gold", String(c.gold)]
  ]);
  if (c.items && c.items.length) {
    h += `<div class="detail-section"><h4>Loot</h4><div class="chips">` +
      c.items.map((it) => `<span class="chip">${esc(it.id)}${it.qty > 1 ? ` <span class="q">×${it.qty}</span>` : ""}</span>`).join("") +
      `</div></div>`;
  }
  return h;
}

// --- Minimap ---------------------------------------------------------------

function renderMinimap() {
  const cv = $("minimap");
  const ctx = cv.getContext("2d");
  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0c0f14";
  ctx.fillRect(0, 0, W, H);

  const f = selectedFloor;
  const onFloor = (e) => e.floor === f;
  const players = world.players.filter(onFloor);
  const monsters = world.monsters.filter(onFloor);
  const npcs = world.npcs.filter(onFloor);
  const corpses = world.corpses.filter(onFloor);
  const nodes = [].concat(
    world.trees.filter(onFloor),
    world.fishingNodes.filter(onFloor),
    world.miningNodes.filter(onFloor),
    world.herbNodes.filter(onFloor),
    world.fires.filter(onFloor)
  );

  const all = [].concat(players, monsters, npcs, corpses, nodes);
  if (!all.length) {
    projection = null;
    ctx.fillStyle = "#46506280";
    ctx.font = "13px system-ui";
    ctx.fillText("no entities on this floor", 14, 24);
    return;
  }

  // Determine the view bounds. Follow mode centers a square window on the
  // selected (or first) player; otherwise auto-fit all entities on the floor.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of all) {
    if (e.x < minX) minX = e.x;
    if (e.x > maxX) maxX = e.x;
    if (e.y < minY) minY = e.y;
    if (e.y > maxY) maxY = e.y;
  }
  let span = Math.max(maxX - minX, maxY - minY, 8);
  if (follow) {
    const sel = findEntity(selection);
    const focus = (sel && sel.floor === f) ? sel : players[0];
    if (focus) {
      const win = 30; // tiles half-window
      minX = focus.x - win; maxX = focus.x + win;
      minY = focus.y - win; maxY = focus.y + win;
      span = win * 2;
    }
  }
  const pad = 24;
  const scale = (Math.min(W, H) - pad * 2) / span;
  const project = (x, y) => [pad + (x - minX) * scale, pad + (y - minY) * scale];

  // Grid hint.
  ctx.strokeStyle = "#1b2230";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gx = pad + ((W - pad * 2) * i) / 4;
    const gy = pad + ((H - pad * 2) * i) / 4;
    ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, H - pad); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(W - pad, gy); ctx.stroke();
  }

  // Build a hit list (screen-space) for hover/click, biggest dots last so they
  // win ties on top. Order matches draw order.
  const hits = [];
  const plot = (list, kind, color, r) => {
    ctx.fillStyle = color;
    for (const e of list) {
      const [px, py] = project(e.x, e.y);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      hits.push({ kind, e, px, py, r });
    }
  };
  plot(nodes, "node", "#46c7c7", 2.5);
  plot(corpses, "corpse", "#9b8cff", 3);
  plot(npcs, "npc", "#ffcf4d", 3.5);
  plot(monsters, "monster", "#ff5d5d", 3.5);
  plot(players, "player", "#4fd07a", 4.5);

  // Highlight the selection with a ring.
  const sel = findEntity(selection);
  if (sel && sel.floor === f) {
    const [px, py] = project(sel.x, sel.y);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Player labels.
  ctx.fillStyle = "#d6dde8";
  ctx.font = "11px system-ui";
  for (const p of players) {
    const [px, py] = project(p.x, p.y);
    ctx.fillText(p.name, px + 7, py + 3);
  }

  // Save projection for interaction (screen<->world + nearest-entity hit).
  projection = {
    minX, minY, scale, pad,
    toWorld: (px, py) => [minX + (px - pad) / scale, minY + (py - pad) / scale],
    hit: (px, py) => {
      let best = null, bestD = Infinity;
      for (const h of hits) {
        const d = Math.hypot(h.px - px, h.py - py);
        const tol = h.r + 4;
        if (d <= tol && d < bestD) { best = h; bestD = d; }
      }
      return best;
    }
  };
}

// Map pointer position to canvas-internal coordinates (account for CSS scaling).
function canvasPoint(ev) {
  const cv = $("minimap");
  const rect = cv.getBoundingClientRect();
  const px = ((ev.clientX - rect.left) / rect.width) * cv.width;
  const py = ((ev.clientY - rect.top) / rect.height) * cv.height;
  return [px, py];
}

function onMapMove(ev) {
  const tip = $("map-tip");
  if (!projection) { tip.hidden = true; return; }
  const [px, py] = canvasPoint(ev);
  const hit = projection.hit(px, py);
  const wrap = ev.currentTarget.parentElement; // map-wrap
  if (hit) {
    const e = hit.e;
    const name = hit.kind === "monster" ? (e.name || e.type) : (e.name || e.label || hit.kind);
    const extra = e.maxHp ? `${Math.round(e.hp)}/${e.maxHp} hp` : (e.level != null ? "L" + e.level : "");
    tip.innerHTML = `<b>${esc(name)}</b> <span class="tip-sub">${esc(hit.kind)}</span><br><span class="tip-sub">${Math.round(e.x)},${Math.round(e.y)}${extra ? " · " + esc(extra) : ""}</span>`;
    const rect = ev.currentTarget.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    tip.style.left = ev.clientX - wrapRect.left + 12 + "px";
    tip.style.top = ev.clientY - wrapRect.top + 12 + "px";
    tip.hidden = false;
    $("minimap").style.cursor = "pointer";
  } else {
    tip.hidden = true;
    $("minimap").style.cursor = "crosshair";
  }
}

function onMapClick(ev) {
  hideMenu();
  if (!projection) return;
  const [px, py] = canvasPoint(ev);
  const hit = projection.hit(px, py);
  if (hit) {
    selectEntity(hit.kind, hit.e.id, { showDetail: true });
    return;
  }
  // Empty tile: open a context menu of tile actions.
  const [wx, wy] = projection.toWorld(px, py);
  openMenu(ev, Math.round(wx), Math.round(wy));
}

// --- Map context menu (tile actions) --------------------------------------

function openMenu(ev, tx, ty) {
  const menu = $("map-menu");
  const wrap = ev.currentTarget.parentElement;
  const wrapRect = wrap.getBoundingClientRect();
  const monster = defaultMonster();
  menu.innerHTML =
    `<div class="menu-title">Tile floor ${selectedFloor} · (${tx}, ${ty})</div>` +
    `<button data-tile-act="tp">Teleport GM here</button>` +
    `<button data-tile-act="spawn">Spawn ${esc(monster)} here</button>` +
    `<button data-tile-act="emit">Emit events here</button>`;
  menu.dataset.tx = String(tx);
  menu.dataset.ty = String(ty);
  menu.dataset.monster = monster;
  let left = ev.clientX - wrapRect.left + 6;
  let top = ev.clientY - wrapRect.top + 6;
  menu.hidden = false;
  // Keep inside the wrap.
  const mRect = menu.getBoundingClientRect();
  if (left + mRect.width > wrapRect.width) left = wrapRect.width - mRect.width - 4;
  if (top + mRect.height > wrapRect.height) top = wrapRect.height - mRect.height - 4;
  menu.style.left = Math.max(0, left) + "px";
  menu.style.top = Math.max(0, top) + "px";
}

function hideMenu() {
  $("map-menu").hidden = true;
}

// The monster a tile "spawn here" uses: the picker selection if set, else a
// sensible common default (wolf), else the first catalog entry.
function defaultMonster() {
  const picked = $("sp-monster").value;
  if (picked) return picked;
  if (meta) {
    if (meta.monsters.some((m) => m.id === "wolf")) return "wolf";
    if (meta.monsters[0]) return meta.monsters[0].id;
  }
  return "wolf";
}

// --- Controls (POST /command) ----------------------------------------------

const num = (id) => {
  const v = $(id).value.trim();
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const str = (id) => {
  const v = $(id).value.trim();
  return v === "" ? undefined : v;
};

function buildCommand(kind) {
  switch (kind) {
    case "spawnMonster": {
      const monster = str("sp-monster");
      if (!monster) return { error: "pick a monster" };
      return { cmd: { kind, monster, floor: num("sp-floor"), x: num("sp-x"), y: num("sp-y") } };
    }
    case "teleport": {
      const floor = num("tp-floor"), x = num("tp-x"), y = num("tp-y");
      if (floor === undefined || x === undefined || y === undefined) return { error: "floor, x, y required" };
      return { cmd: { kind, floor, x, y } };
    }
    case "grant": {
      const cmd = { kind, gold: num("gr-gold"), hp: num("gr-hp"), favor: num("gr-favor") };
      const itemId = str("gr-item-id"), qty = num("gr-item-qty");
      if (itemId) cmd.items = [{ id: itemId, qty: qty ?? 1 }];
      return { cmd };
    }
    case "dev":
      return { cmd: { kind, args: str("dev-args") } };
    case "emitEvents":
      return { cmd: { kind, count: num("ev-count"), floor: num("ev-floor"), x: num("ev-x"), y: num("ev-y"), spread: num("ev-spread") } };
    case "respawn":
      return { cmd: { kind } };
    default:
      return { error: "unknown command" };
  }
}

async function postCommand(cmd, okMsg) {
  try {
    const res = await fetch("/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cmd)
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) toast(okMsg || cmd.kind + " sent", true);
    else toast((body && body.error) || `failed (${res.status})`, false);
  } catch (err) {
    toast(String(err), false);
  }
}

async function sendCommand(kind) {
  const built = buildCommand(kind);
  if (built.error) { toast(built.error, false); return; }
  await postCommand(built.cmd, kind + " sent");
}

let toastTimer = null;
function toast(msg, ok) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show " + (ok ? "ok" : "err");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 2600);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// --- Tabs ------------------------------------------------------------------

function setTab(name) {
  activeTab = name;
  if (name === "feed") { unseenEvents = 0; updateFeedBadge(); }
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  for (const b of document.querySelectorAll(".tab-body")) b.hidden = b.dataset.pane !== name;
}

function updateFeedBadge() {
  const b = $("feed-badge");
  if (unseenEvents > 0 && activeTab !== "feed") {
    b.textContent = unseenEvents > 99 ? "99+" : String(unseenEvents);
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

// --- Wire up ---------------------------------------------------------------

// Delegated clicks: control buttons, tabs, roster rows, detail/tile actions.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cmd]");
  if (btn) { sendCommand(btn.dataset.cmd); return; }

  const tab = e.target.closest(".tab[data-tab]");
  if (tab) { setTab(tab.dataset.tab); return; }

  const row = e.target.closest(".ent-row");
  if (row) { selectEntity(row.dataset.kind, row.dataset.id, { showDetail: true }); return; }

  const act = e.target.closest(".detail-actions button[data-act]");
  if (act) { detailAction(act.dataset.act); return; }

  const tileBtn = e.target.closest(".map-menu button[data-tile-act]");
  if (tileBtn) { tileAction(tileBtn.dataset.tileAct); return; }

  // Click outside the menu closes it.
  if (!e.target.closest(".map-menu") && !e.target.closest("#minimap")) hideMenu();
});

function detailAction(act) {
  const e = findEntity(selection);
  if (!e) return;
  if (act === "center") {
    selectedFloor = e.floor; floorTouched = true;
    if (selection.kind === "player") { follow = true; $("follow").checked = true; }
    render();
  } else if (act === "tp-to") {
    postCommand({ kind: "teleport", floor: e.floor, x: Math.round(e.x), y: Math.round(e.y) }, "teleported GM");
  } else if (act === "copy") {
    navigator.clipboard?.writeText(e.id).then(() => toast("id copied", true), () => toast("copy failed", false));
  } else if (act === "spawn-here") {
    postCommand({ kind: "spawnMonster", monster: e.type, floor: e.floor, x: Math.round(e.x), y: Math.round(e.y) }, "spawned " + e.type);
  }
}

function tileAction(act) {
  const menu = $("map-menu");
  const tx = Number(menu.dataset.tx), ty = Number(menu.dataset.ty), f = selectedFloor;
  const monster = menu.dataset.monster;
  hideMenu();
  if (act === "tp") {
    postCommand({ kind: "teleport", floor: f, x: tx, y: ty }, `teleported GM to ${tx},${ty}`);
  } else if (act === "spawn") {
    postCommand({ kind: "spawnMonster", monster, floor: f, x: tx, y: ty }, `spawned ${monster}`);
    // Mirror into the spawn form for convenience.
    $("sp-floor").value = f; $("sp-x").value = tx; $("sp-y").value = ty;
  } else if (act === "emit") {
    postCommand({ kind: "emitEvents", count: 6, floor: f, x: tx, y: ty, spread: 3 }, "emitted events");
  }
}

$("floor-select").addEventListener("change", (e) => {
  selectedFloor = Number(e.target.value);
  floorTouched = true;
  hideMenu();
  render();
});

$("follow").addEventListener("change", (e) => { follow = e.target.checked; renderMinimap(); });
$("feed-floor-only").addEventListener("change", (e) => { feedFloorOnly = e.target.checked; renderFeed(); });
$("feed-clear").addEventListener("click", () => { feedRows = []; renderFeed(); });

const map = $("minimap");
map.addEventListener("mousemove", onMapMove);
map.addEventListener("mouseleave", () => { $("map-tip").hidden = true; });
map.addEventListener("click", onMapClick);

// Keyboard niceties.
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) {
    if (e.key === "Enter") {
      const fs = e.target.closest("fieldset");
      const btn = fs && fs.querySelector("button[data-cmd]");
      if (btn) { e.preventDefault(); sendCommand(btn.dataset.cmd); }
    }
    return;
  }
  if (e.key === "Escape") { hideMenu(); selection = null; render(); }
  else if (e.key === "1") setTab("roster");
  else if (e.key === "2") setTab("detail");
  else if (e.key === "3") setTab("feed");
  else if (e.key === "f") { follow = !follow; $("follow").checked = follow; renderMinimap(); }
});

loadMeta();
connect();
