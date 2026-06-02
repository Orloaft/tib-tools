import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { connectAdminWorld, type AdminWorldConnection, type AdminStatus } from "../admin/index.ts";
import type { AdminCommand } from "../admin/index.ts";
import type { MergedWorld } from "../admin/index.ts";
import { loadCatalog } from "../game/index.ts";

/** Catalog-derived option lists the frontend uses to populate its pickers. */
interface DashboardMeta {
  monsters: Array<{ id: string; name: string }>;
  items: Array<{ id: string; label: string }>;
  floors: number[];
}

export interface DashboardOptions {
  /** HTTP port to serve on. Default 7070 (env GM_PORT). */
  port?: number;
  /** Game server WebSocket URL the admin connection joins. */
  gameUrl?: string;
  /** GM character name to join as. */
  name?: string;
  /** Min interval between SSE pushes, ms (throttle). Default 150 (~6.6 Hz). */
  throttleMs?: number;
}

export interface DashboardServer {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

const PUBLIC_DIR = path.join(import.meta.dirname, "public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

/**
 * Start the GM Dashboard HTTP server. Holds a single admin connection to the
 * game, maintains a delta-merged world model, and exposes:
 *
 *   GET  /         → static frontend (public/index.html, app.js, style.css)
 *   GET  /events   → Server-Sent Events stream of the merged world (throttled)
 *   POST /command  → relay an AdminCommand JSON to the game; 200/400
 *
 * Uses only Node built-ins (no `ws`): SSE rides on plain http responses.
 */
export async function startDashboard(opts: DashboardOptions = {}): Promise<DashboardServer> {
  const port = opts.port ?? Number(process.env.GM_PORT ?? 7070);
  const throttleMs = opts.throttleMs ?? 150;

  // Live SSE clients. Each gets the latest world on connect, then on every push.
  const sseClients = new Set<http.ServerResponse>();

  // Catalog-derived option lists for the frontend pickers. Loaded once, lazily,
  // so a missing/locked catalog only degrades the dropdowns (not the dashboard).
  let metaPromise: Promise<DashboardMeta> | undefined;
  const getMeta = (): Promise<DashboardMeta> => {
    if (!metaPromise) metaPromise = buildMeta(() => admin?.getWorld());
    return metaPromise;
  };

  let latestWorld: MergedWorld | undefined;
  let lastPush = 0;
  let pendingTimer: NodeJS.Timeout | undefined;
  let adminStatus: AdminStatus = "connecting";

  const broadcastStatus = (status: AdminStatus) => {
    adminStatus = status;
    if (sseClients.size === 0) return;
    const payload = `event: status\ndata: ${JSON.stringify({ status })}\n\n`;
    for (const res of sseClients) res.write(payload);
  };

  const pushWorld = (world: MergedWorld) => {
    latestWorld = world;
    const now = Date.now();
    const since = now - lastPush;
    if (since >= throttleMs) {
      flush();
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(flush, throttleMs - since);
    }
  };

  const flush = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
    lastPush = Date.now();
    if (!latestWorld || sseClients.size === 0) return;
    const payload = `event: world\ndata: ${JSON.stringify(latestWorld)}\n\n`;
    for (const res of sseClients) res.write(payload);
  };

  let admin: AdminWorldConnection;
  try {
    admin = await connectAdminWorld({
      url: opts.gameUrl,
      name: opts.name,
      onWorld: pushWorld,
      onStatus: broadcastStatus
    });
  } catch (err) {
    throw new Error(`GM Dashboard could not reach the game server: ${(err as Error).message}`);
  }
  adminStatus = admin.status;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/events") {
      handleEvents(req, res, sseClients, admin.getWorld(), adminStatus);
      return;
    }

    if (req.method === "GET" && pathname === "/meta") {
      getMeta().then(
        (meta) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(meta));
        },
        (err: unknown) => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      );
      return;
    }

    if (req.method === "POST" && pathname === "/command") {
      handleCommand(req, res, admin);
      return;
    }

    if (req.method === "GET") {
      handleStatic(pathname, res);
      return;
    }

    res.writeHead(405, { "content-type": "text/plain" });
    res.end("Method Not Allowed");
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const dashUrl = `http://127.0.0.1:${port}/`;

  return {
    port,
    url: dashUrl,
    async close() {
      if (pendingTimer) clearTimeout(pendingTimer);
      for (const res of sseClients) res.end();
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await admin.close();
    }
  };
}

function handleEvents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  clients: Set<http.ServerResponse>,
  seed: MergedWorld,
  status: AdminStatus
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  // Seed the current liveness and world immediately so a fresh page is never
  // blank and shows the right connection state on load.
  res.write(`event: status\ndata: ${JSON.stringify({ status })}\n\n`);
  res.write(`event: world\ndata: ${JSON.stringify(seed)}\n\n`);
  clients.add(res);
  req.on("close", () => {
    clients.delete(res);
  });
}

/**
 * Build the picker option lists from the live game catalog. Falls back to floor
 * ids from the current world if the catalog can't be loaded, so the endpoint
 * always returns something useful.
 */
async function buildMeta(currentWorld: () => MergedWorld | undefined): Promise<DashboardMeta> {
  const worldFloors = (): number[] => {
    const w = currentWorld();
    return w ? (w.maps.length ? w.maps : w.floors) : [];
  };
  try {
    const catalog = await loadCatalog();
    const monsters = Object.entries(catalog.MONSTERS)
      .map(([id, m]) => ({ id, name: m.name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const items = Object.entries(catalog.ITEMS)
      .map(([id, it]) => ({ id, label: it.label ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    // Prefer the live world's floor list; fall back to floors seen in spawns.
    let floors = worldFloors();
    if (floors.length === 0) {
      const set = new Set<number>();
      for (const s of catalog.MONSTER_SPAWNS) set.add(s.floor);
      floors = [...set].sort((a, b) => a - b);
    }
    return { monsters, items, floors };
  } catch {
    return { monsters: [], items: [], floors: worldFloors() };
  }
}

function handleCommand(req: http.IncomingMessage, res: http.ServerResponse, admin: AdminWorldConnection): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > 64 * 1024) {
      aborted = true;
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Body too large" }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (aborted) return;
    let cmd: AdminCommand;
    try {
      cmd = JSON.parse(Buffer.concat(chunks).toString("utf8")) as AdminCommand;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
      return;
    }
    if (!cmd || typeof cmd !== "object" || typeof (cmd as { kind?: unknown }).kind !== "string") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Missing command kind" }));
      return;
    }
    try {
      admin.send(cmd);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
    }
  });
}

function handleStatic(pathname: string, res: http.ServerResponse): void {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  // Resolve within PUBLIC_DIR and reject anything that escapes it.
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
    res.end(data);
  });
}
