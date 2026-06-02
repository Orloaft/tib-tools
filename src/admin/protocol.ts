import type { ClientMessage } from "@game/src/types.ts";

/**
 * High-level GM/admin operations, expressed independently of the wire format.
 * Each maps onto a message the game server already accepts in dev/E2E mode
 * (DEV_TOOLS = E2E_TEST || TIB_DEV=1), so the admin channel needs no new game
 * code today — `toClientMessage` is the whole mapping.
 */
export type AdminCommand =
  | { kind: "spawnMonster"; monster: string; floor?: number; x?: number; y?: number; zone?: string }
  | { kind: "teleport"; floor: number; x: number; y: number }
  | {
      kind: "grant";
      items?: Array<{ id: string; qty: number }>;
      gold?: number;
      hp?: number;
      favor?: number;
      skills?: Record<string, number>;
    }
  | { kind: "dev"; args?: string }
  | { kind: "chat"; text: string }
  | { kind: "emitEvents"; count?: number; floor?: number; x?: number; y?: number; spread?: number }
  | { kind: "respawn" };

export function toClientMessage(cmd: AdminCommand): ClientMessage {
  switch (cmd.kind) {
    case "spawnMonster":
      return { type: "e2eSpawnMonster", monster: cmd.monster, floor: cmd.floor, x: cmd.x, y: cmd.y, zone: cmd.zone };
    case "teleport":
      return { type: "e2eGrantItems", floor: cmd.floor, x: cmd.x, y: cmd.y };
    case "grant":
      return { type: "e2eGrantItems", items: cmd.items, gold: cmd.gold, hp: cmd.hp, favor: cmd.favor, skills: cmd.skills };
    case "dev":
      return { type: "chat", text: cmd.args ? `/dev ${cmd.args}` : "/dev" };
    case "chat":
      return { type: "chat", text: cmd.text };
    case "emitEvents":
      return { type: "e2eEmitEvents", count: cmd.count, floor: cmd.floor, x: cmd.x, y: cmd.y, spread: cmd.spread };
    case "respawn":
      return { type: "respawn" };
  }
}
