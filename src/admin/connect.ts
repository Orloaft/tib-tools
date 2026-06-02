import type { StateSnapshot } from "@game/src/types.ts";
import type { WireServerMessage } from "@game/src/wire.ts";
import { loadWire } from "../game/index.ts";
import { toClientMessage, type AdminCommand } from "./protocol.ts";

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
}

export interface AdminConnection {
  /** Player id assigned by the server (from the welcome message). */
  readonly id: string | undefined;
  /** Send a high-level admin command. */
  send(cmd: AdminCommand): void;
  /** The most recent raw state snapshot (deltas are not merged here). */
  latestState(): StateSnapshot | undefined;
  /** Resolve with the next state snapshot (or the current one if already seen). */
  waitForState(timeoutMs?: number): Promise<StateSnapshot>;
  close(): Promise<void>;
}

const DEFAULT_URL = "ws://127.0.0.1:8787";

/**
 * Open an admin connection to a running game server. Resolves once the server
 * has acknowledged the join (welcome). The connection is the foundation the GM
 * Dashboard (and session replay) will build on.
 */
export async function connectAdmin(opts: AdminOptions = {}): Promise<AdminConnection> {
  const url = opts.url ?? DEFAULT_URL;
  const name = opts.name ?? "gm_probe";
  const transient = opts.transient ?? true;

  // The server sends state as a compact wire form; reuse the game's own decoder
  // so the connection surfaces a fully-expanded StateSnapshot.
  const { normalizeServerMessage } = await loadWire();

  return new Promise<AdminConnection>((resolve, reject) => {
    const ws = new WebSocket(url);
    let id: string | undefined;
    let latest: StateSnapshot | undefined;
    const stateWaiters: Array<(state: StateSnapshot) => void> = [];

    const fail = (reason: string) => reject(new Error(`${reason} (is the game server running at ${url} in dev mode?)`));

    ws.addEventListener("error", () => fail("Admin connection failed"));

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "join", name, transient }));
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }

      const msg = normalizeServerMessage(raw as WireServerMessage);

      if (msg.type === "welcome") {
        id = msg.id;
        resolve(connection);
        return;
      }

      if (msg.type === "state") {
        latest = msg;
        opts.onState?.(latest);
        while (stateWaiters.length > 0) stateWaiters.shift()?.(latest);
      }
    });

    const connection: AdminConnection = {
      get id() {
        return id;
      },
      send(cmd: AdminCommand) {
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
          ws.addEventListener("close", () => res());
          ws.close();
        });
      }
    };
  });
}
