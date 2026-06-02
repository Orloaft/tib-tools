import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { connectAdminWorld } from "../admin/index.ts";
import type { MergedWorld } from "../admin/index.ts";

export interface ReplayEntity {
  id: string;
  label: string;
  floor: number;
  x: number;
  y: number;
  hp?: number;
  maxHp?: number;
  sub?: string;
}

export interface ReplayEvent {
  type: string;
  text: string;
  floor: number | null;
  x: number | null;
  y: number | null;
  color: string | null;
}

export interface ReplayFrame {
  t: number;
  players: ReplayEntity[];
  monsters: ReplayEntity[];
  npcs: ReplayEntity[];
  counts: { players: number; monsters: number; npcs: number; corpses: number };
  events: ReplayEvent[];
}

export interface ReplayHeader {
  version: 1;
  startedAt: number;
  gameUrl: string;
}

export interface RecordOptions {
  url?: string;
  name?: string;
  out?: string;
  /** Stop after this many seconds. Omit to record until stop() / SIGINT. */
  seconds?: number;
  /** Minimum ms between recorded frames (throttle). Default 120 (~8 Hz). */
  frameIntervalMs?: number;
  /** Called with elapsed seconds + frame count roughly once per second. */
  onTick?: (seconds: number, frames: number) => void;
}

export interface RecordResult {
  path: string;
  frames: number;
  durationMs: number;
}

function trimWorld(world: MergedWorld): Pick<ReplayFrame, "players" | "monsters" | "npcs" | "counts"> {
  return {
    players: world.players.map((p) => ({ id: p.id, label: p.name, floor: p.floor, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, sub: `${p.classKey} L${p.level}` })),
    monsters: world.monsters.map((m) => ({ id: m.id, label: m.name, floor: m.floor, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, sub: `${m.role} · ${m.zone}` })),
    npcs: world.npcs.map((n) => ({ id: n.id, label: n.name, floor: n.floor, x: n.x, y: n.y, sub: n.role })),
    counts: { players: world.counts.players, monsters: world.counts.monsters, npcs: world.counts.npcs, corpses: world.counts.corpses }
  };
}

/**
 * Record a live session through the admin channel to a JSONL file (one header
 * line + one frame per line). Resolves after `seconds` (if set) or when the
 * returned stop() is called. Requires a dev-mode game server.
 */
export function recordSession(opts: RecordOptions = {}): { done: Promise<RecordResult>; stop: () => void } {
  const url = opts.url ?? "ws://127.0.0.1:8787";
  const out = resolve(opts.out ?? "out/replays/session.jsonl");
  const interval = opts.frameIntervalMs ?? 120;
  mkdirSync(dirname(out), { recursive: true });

  const stream = createWriteStream(out, { flags: "w" });
  const start = Date.now();
  let frames = 0;
  let lastFrameAt = 0;
  let lastSeq = -1;
  let stopFn: () => void = () => {};

  const done = new Promise<RecordResult>((resolvePromise) => {
    let finished = false;
    let conn: { close: () => Promise<void> } | null = null;

    const finish = async (): Promise<void> => {
      if (finished) return;
      finished = true;
      clearInterval(ticker);
      clearTimeout(timer);
      if (conn) await conn.close().catch(() => {});
      stream.end(() => resolvePromise({ path: out, frames, durationMs: Date.now() - start }));
    };
    stopFn = () => void finish();

    const ticker = setInterval(() => opts.onTick?.(Math.round((Date.now() - start) / 1000), frames), 1000);
    const timer = opts.seconds ? setTimeout(() => void finish(), opts.seconds * 1000) : (undefined as unknown as ReturnType<typeof setTimeout>);

    const header: ReplayHeader = { version: 1, startedAt: start, gameUrl: url };
    stream.write(JSON.stringify(header) + "\n");

    connectAdminWorld({
      url,
      name: opts.name ?? "gm_replay",
      onWorld: (world) => {
        const now = Date.now();
        if (now - lastFrameAt < interval) return;
        lastFrameAt = now;
        const fresh = world.events.filter((e) => e.seq > lastSeq);
        if (fresh.length > 0) lastSeq = fresh[fresh.length - 1]!.seq;
        const frame: ReplayFrame = {
          t: now - start,
          ...trimWorld(world),
          events: fresh.map((e) => ({ type: e.type, text: String(e.text), floor: e.floor, x: e.x, y: e.y, color: e.color }))
        };
        stream.write(JSON.stringify(frame) + "\n");
        frames += 1;
      }
    }).then(
      (c) => {
        conn = c;
      },
      () => void finish()
    );
  });

  return { done, stop: () => stopFn() };
}
