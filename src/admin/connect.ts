import type { StateSnapshot } from "@game/src/types.ts";
import type { WireServerMessage } from "@game/src/wire.ts";
import { loadWire } from "../game/index.ts";
import { toClientMessage, type AdminCommand } from "./protocol.ts";

/** Liveness of the underlying admin socket to the game server. */
export type AdminStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface AdminOptions {
  /** Game server WebSocket URL. Default ws://127.0.0.1:8787. */
  url?: string;
  /** Character name to join as. Default "gm_probe". */
  name?: string;
  /**
   * Join transiently (never persisted). Default true. Transient joins are only
   * honoured by a server in dev/E2E mode; against a plain server the name is
   * persisted like any character.
   */
  transient?: boolean;
  /** Called on every state snapshot the server pushes. */
  onState?: (state: StateSnapshot) => void;
  /**
   * Auto-reconnect if the socket drops (e.g. the game restarts). Default true.
   * The first connect still rejects on failure; reconnects happen silently in
   * the background with capped backoff.
   */
  reconnect?: boolean;
  /** Called whenever the socket's liveness changes. */
  onStatus?: (status: AdminStatus) => void;
}

export interface AdminConnection {
  /** Player id assigned by the server (from the welcome message). */
  readonly id: string | undefined;
  /** Floor ids the server advertises (welcome `maps`); empty until welcomed. */
  readonly maps: number[];
  /** Current socket liveness. */
  readonly status: AdminStatus;
  /** Send a high-level admin command. */
  send(cmd: AdminCommand): void;
  /** The most recent raw state snapshot (deltas are not merged here). */
  latestState(): StateSnapshot | undefined;
  /** Resolve with the next state snapshot (or the current one if already seen). */
  waitForState(timeoutMs?: number): Promise<StateSnapshot>;
  close(): Promise<void>;
}

const DEFAULT_URL = "ws://127.0.0.1:8787";
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8000;

/**
 * Open an admin connection to a running game server. Resolves once the server
 * has acknowledged the join (welcome). The connection is the foundation the GM
 * Dashboard (and session replay) will build on.
 *
 * When `reconnect` is enabled (default) the connection transparently re-opens
 * the socket and re-joins if the game restarts, so a long-lived dashboard keeps
 * working across server bounces. State/status callbacks fire across the bounce;
 * the resolved handle stays the same.
 */
export async function connectAdmin(opts: AdminOptions = {}): Promise<AdminConnection> {
  const url = opts.url ?? DEFAULT_URL;
  const name = opts.name ?? "gm_probe";
  const transient = opts.transient ?? true;
  const reconnect = opts.reconnect ?? true;

  // The server sends state as a compact wire form; reuse the game's own decoder
  // so the connection surfaces a fully-expanded StateSnapshot.
  const { normalizeServerMessage } = await loadWire();

  let id: string | undefined;
  let maps: number[] = [];
  let latest: StateSnapshot | undefined;
  let status: AdminStatus = "connecting";
  let ws: WebSocket | undefined;
  let closedByUser = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const stateWaiters: Array<(state: StateSnapshot) => void> = [];

  const setStatus = (next: AdminStatus) => {
    if (status === next) return;
    status = next;
    opts.onStatus?.(next);
  };

  // Resolves on the first successful welcome; later reconnects reuse `connection`.
  let resolveFirst!: (conn: AdminConnection) => void;
  let rejectFirst!: (err: Error) => void;
  let settled = false;
  const ready = new Promise<AdminConnection>((res, rej) => {
    resolveFirst = res;
    rejectFirst = rej;
  });

  const scheduleReconnect = () => {
    if (closedByUser || !reconnect) return;
    setStatus("reconnecting");
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(open, delay);
  };

  const open = () => {
    reconnectTimer = undefined;
    const sock = new WebSocket(url);
    ws = sock;

    sock.addEventListener("error", () => {
      // The first failure (no welcome yet) rejects; afterwards we just retry.
      if (!settled) {
        if (reconnect) {
          scheduleReconnect();
        } else {
          settled = true;
          rejectFirst(new Error(`Admin connection failed (is the game server running at ${url} in dev mode?)`));
        }
      }
    });

    sock.addEventListener("open", () => {
      sock.send(JSON.stringify({ type: "join", name, transient }));
    });

    sock.addEventListener("message", (event: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }

      const msg = normalizeServerMessage(raw as WireServerMessage);

      if (msg.type === "welcome") {
        id = msg.id;
        maps = Array.isArray(msg.maps) ? msg.maps : [];
        reconnectAttempt = 0;
        setStatus("open");
        if (!settled) {
          settled = true;
          resolveFirst(connection);
        }
        return;
      }

      if (msg.type === "state") {
        latest = msg;
        opts.onState?.(latest);
        while (stateWaiters.length > 0) stateWaiters.shift()?.(latest);
      }
    });

    sock.addEventListener("close", () => {
      if (closedByUser) {
        setStatus("closed");
        return;
      }
      // A drop after we were live (or any drop with reconnect on) retries.
      if (reconnect) scheduleReconnect();
      else setStatus("closed");
    });
  };

  const connection: AdminConnection = {
    get id() {
      return id;
    },
    get maps() {
      return maps;
    },
    get status() {
      return status;
    },
    send(cmd: AdminCommand) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error("Admin connection is not open");
      }
      ws.send(JSON.stringify(toClientMessage(cmd)));
    },
    latestState() {
      return latest;
    },
    waitForState(timeoutMs = 5000) {
      return new Promise<StateSnapshot>((res, rej) => {
        const timer = setTimeout(() => rej(new Error("Timed out waiting for a state snapshot")), timeoutMs);
        stateWaiters.push((state) => {
          clearTimeout(timer);
          res(state);
        });
      });
    },
    close() {
      return new Promise<void>((res) => {
        closedByUser = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          setStatus("closed");
          res();
          return;
        }
        ws.addEventListener("close", () => res());
        ws.close();
      });
    }
  };

  open();
  return ready;
}
