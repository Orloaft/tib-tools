import type { WorldMap } from "./world.ts";
import type { PortalLink } from "./portals.ts";

export interface Reachability {
  /** "floor:tx:ty" keys reachable from START via walking + portals. */
  reachable: Set<string>;
  has(floor: number, tx: number, ty: number): boolean;
  /** Reachable walkable tile count per floor. */
  reachableCountByFloor: Map<number, number>;
}

export interface UnreachableRegion {
  floor: number;
  size: number;
  sampleTx: number;
  sampleTy: number;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

export const tileKey = (floor: number, tx: number, ty: number): string => `${floor}:${tx}:${ty}`;

/**
 * Flood-fill from START across 4-adjacent walkable tiles, crossing floors by
 * stepping onto a portal tile (which transports to the portal's destination).
 */
export function computeReachability(world: WorldMap, portals: PortalLink[]): Reachability {
  const portalAt = new Map<string, PortalLink[]>();
  for (const p of portals) {
    const k = tileKey(p.fromFloor, p.fromTx, p.fromTy);
    const list = portalAt.get(k);
    if (list) list.push(p);
    else portalAt.set(k, [p]);
  }

  const reachable = new Set<string>();
  const stack: Array<[number, number, number]> = [];
  const seed = (f: number, tx: number, ty: number): void => {
    const k = tileKey(f, tx, ty);
    if (!reachable.has(k)) {
      reachable.add(k);
      stack.push([f, tx, ty]);
    }
  };

  seed(world.start.floor, world.start.tx, world.start.ty);

  while (stack.length > 0) {
    const [f, tx, ty] = stack.pop()!;
    for (const [dx, dy] of DIRS) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (world.isWalkable(f, nx, ny)) seed(f, nx, ny);
    }
    const ps = portalAt.get(tileKey(f, tx, ty));
    if (ps) {
      for (const p of ps) {
        if (world.isWalkable(p.toFloor, p.toTx, p.toTy)) seed(p.toFloor, p.toTx, p.toTy);
      }
    }
  }

  const reachableCountByFloor = new Map<number, number>();
  for (const k of reachable) {
    const floor = Number(k.slice(0, k.indexOf(":")));
    reachableCountByFloor.set(floor, (reachableCountByFloor.get(floor) ?? 0) + 1);
  }

  return {
    reachable,
    has: (floor, tx, ty) => reachable.has(tileKey(floor, tx, ty)),
    reachableCountByFloor
  };
}

/**
 * Connected components of walkable-but-unreachable tiles on a floor — areas the
 * player can never step into (often decorative, but a large one can mean a
 * broken portal stranded real content).
 */
export function unreachableRegions(world: WorldMap, reach: Reachability): UnreachableRegion[] {
  const regions: UnreachableRegion[] = [];

  for (const fm of world.floors) {
    const visited = new Set<string>();
    for (let ty = 0; ty < fm.rows; ty += 1) {
      for (let tx = 0; tx < fm.cols; tx += 1) {
        const localKey = `${tx}:${ty}`;
        if (visited.has(localKey)) continue;
        if (!world.isWalkable(fm.floor, tx, ty)) continue;
        if (reach.has(fm.floor, tx, ty)) continue;

        // Flood the unreachable walkable component.
        let size = 0;
        const stack: Array<[number, number]> = [[tx, ty]];
        visited.add(localKey);
        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          size += 1;
          for (const [dx, dy] of DIRS) {
            const nx = cx + dx;
            const ny = cy + dy;
            const nk = `${nx}:${ny}`;
            if (visited.has(nk)) continue;
            if (!world.isWalkable(fm.floor, nx, ny)) continue;
            if (reach.has(fm.floor, nx, ny)) continue;
            visited.add(nk);
            stack.push([nx, ny]);
          }
        }
        regions.push({ floor: fm.floor, size, sampleTx: tx, sampleTy: ty });
      }
    }
  }

  return regions;
}
