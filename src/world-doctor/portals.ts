import type { WorldMap } from "./world.ts";

export interface PortalLink {
  fromFloor: number;
  fromTx: number;
  fromTy: number;
  sourceTile: string;
  toFloor: number;
  toX: number;
  toY: number;
  toTx: number;
  toTy: number;
  /** Gated/special transport handled inline in the server (not in portalForRaw). */
  gated?: boolean;
}

/**
 * Transports the game server resolves inline rather than through
 * `shared.portalForRaw`. Mirrored here so reachability is accurate — keep in
 * sync with server/index.ts. Currently just the key-gated Jungle Vault entrance
 * (floor 9 tile "K" -> the vault interior on the same floor).
 */
interface SpecialTransport {
  fromFloor: number;
  sourceTile: string;
  toFloor: number;
  toX: number;
  toY: number;
}
const SPECIAL_TRANSPORTS: SpecialTransport[] = [{ fromFloor: 9, sourceTile: "K", toFloor: 9, toX: 84.5, toY: 44.5 }];

/**
 * Every portal tile in the world. The engine's `portalForRaw` maps purely
 * (floor, tileChar) -> destination, so we resolve each distinct char once per
 * floor (instead of calling the grid-rebuilding `portalFor` on all ~88k tiles).
 */
export function enumeratePortals(world: WorldMap): PortalLink[] {
  const links: PortalLink[] = [];

  for (const fm of world.floors) {
    const special = new Map(
      SPECIAL_TRANSPORTS.filter((s) => s.fromFloor === fm.floor).map((s) => [s.sourceTile, s] as const)
    );
    const destForChar = new Map<string, { floor: number; x: number; y: number; gated?: boolean } | null>();

    for (let ty = 0; ty < fm.rows; ty += 1) {
      const row = fm.tiles[ty] ?? "";
      for (let tx = 0; tx < fm.cols; tx += 1) {
        const ch = row[tx] ?? "#";
        let dest = destForChar.get(ch);
        if (dest === undefined) {
          const sp = special.get(ch);
          dest = sp
            ? { floor: sp.toFloor, x: sp.toX, y: sp.toY, gated: true }
            : world.shared.portalFor(fm.floor, tx, ty);
          destForChar.set(ch, dest);
        }
        if (!dest) continue;
        links.push({
          fromFloor: fm.floor,
          fromTx: tx,
          fromTy: ty,
          sourceTile: ch,
          toFloor: dest.floor,
          toX: dest.x,
          toY: dest.y,
          toTx: Math.floor(dest.x),
          toTy: Math.floor(dest.y),
          gated: dest.gated
        });
      }
    }
  }

  return links;
}
