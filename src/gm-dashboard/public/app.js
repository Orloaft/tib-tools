"use strict";

// GM Dashboard frontend. Live state via EventSource('/events'); control via
// fetch POST '/command'. No frameworks, no CDN.

const $ = (id) => document.getElementById(id);

let world = null;
let selectedFloor = null;
let floorTouched = false; // user picked a floor manually

// --- Live state (SSE) ------------------------------------------------------

function connect() {
  const es = new EventSource("/events");
  es.addEventListener("open", () => setConn(true));
  es.addEventListener("error", () => setConn(false));
  es.addEventListener("world", (e) => {
    try {
      world = JSON.parse(e.data);
    } catch {
      return;
    }
    setConn(true);
    render();
  });
}

function setConn(ok) {
  const el = $("conn");
  el.textContent = ok ? "live" : "disconnected";
  el.className = "badge " + (ok ? "badge-good" : "badge-bad");
}

// --- Rendering -------------------------------------------------------------

function render() {
  if (!world) return;
  $("c-players").textContent = world.counts.players;
  $("c-monsters").textContent = world.counts.monsters;
  $("c-npcs").textContent = world.counts.npcs;
  $("c-corpses").textContent = world.counts.corpses;

  renderFloorSelect();
  renderFloorLists();
  renderMinimap();
}

function renderFloorSelect() {
  const sel = $("floor-select");
  const floors = world.floors.length ? world.floors : [0];
  if (selectedFloor === null || (!floorTouched && !floors.includes(selectedFloor))) {
    selectedFloor = floors[0];
  }
  const want = floors.map((f) => String(f)).join(",");
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

function renderFloorLists() {
  const host = $("floor-lists");
  const by = entitiesByFloor();
  const floors = [...by.keys()].sort((a, b) => a - b);
  host.innerHTML = "";
  if (!floors.length) {
    host.innerHTML = '<div class="floor-counts">No entities.</div>';
    return;
  }
  for (const f of floors) {
    const g = by.get(f);
    const block = document.createElement("div");
    block.className = "floor-block";
    const counts =
      `players ${g.players.length} · monsters ${g.monsters.length} · ` +
      `npcs ${g.npcs.length} · corpses ${g.corpses.length} · resources ${g.nodes.length}`;
    block.innerHTML = `<h3>Floor ${f}</h3><div class="floor-counts">${counts}</div>`;
    appendRows(block, g.players, "player", (p) => `${p.name} L${p.level} (${Math.round(p.hp)}/${p.maxHp})`);
    appendRows(block, g.monsters, "monster", (m) => `${m.name || m.type} L${m.level} (${Math.round(m.hp)}/${m.maxHp})`);
    appendRows(block, g.npcs, "npc", (n) => `${n.name} [${n.role}]`);
    host.appendChild(block);
  }
}

function appendRows(block, list, kind, label) {
  for (const e of list) {
    const row = document.createElement("div");
    row.className = "ent-row ent-" + kind;
    row.innerHTML = `<span class="name">${esc(label(e))}</span><span class="ent-kind">${Math.round(e.x)},${Math.round(e.y)}</span>`;
    block.appendChild(row);
  }
}

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
    ctx.fillStyle = "#46506280";
    ctx.font = "13px system-ui";
    ctx.fillText("no entities on this floor", 14, 24);
    return;
  }

  // Auto-fit to bounds with padding; keep aspect square.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of all) {
    if (e.x < minX) minX = e.x;
    if (e.x > maxX) maxX = e.x;
    if (e.y < minY) minY = e.y;
    if (e.y > maxY) maxY = e.y;
  }
  const span = Math.max(maxX - minX, maxY - minY, 8);
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

  const plot = (list, color, r) => {
    ctx.fillStyle = color;
    for (const e of list) {
      const [px, py] = project(e.x, e.y);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  plot(nodes, "#46c7c7", 2.5);
  plot(corpses, "#9b8cff", 3);
  plot(npcs, "#ffcf4d", 3.5);
  plot(monsters, "#ff5d5d", 3.5);
  plot(players, "#4fd07a", 4.5);

  // Label players.
  ctx.fillStyle = "#d6dde8";
  ctx.font = "11px system-ui";
  for (const p of players) {
    const [px, py] = project(p.x, p.y);
    ctx.fillText(p.name, px + 6, py + 3);
  }
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
      if (!monster) return { error: "monster type required" };
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

async function sendCommand(kind) {
  const built = buildCommand(kind);
  if (built.error) {
    toast(built.error, false);
    return;
  }
  try {
    const res = await fetch("/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(built.cmd)
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) toast(kind + " sent", true);
    else toast((body && body.error) || `failed (${res.status})`, false);
  } catch (err) {
    toast(String(err), false);
  }
}

let toastTimer = null;
function toast(msg, ok) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show " + (ok ? "ok" : "err");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "toast";
  }, 2600);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// --- Wire up ---------------------------------------------------------------

document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cmd]");
  if (btn) sendCommand(btn.dataset.cmd);
});

$("floor-select").addEventListener("change", (e) => {
  selectedFloor = Number(e.target.value);
  floorTouched = true;
  renderMinimap();
});

connect();
