import { loadShared, type Shared } from "../game/index.ts";

/** One floor's cached tile grid + dimensions. */
export interface FloorMap {
  floor: number;
  cols: number;
  rows: number;
  /** Row strings, length === rows; each row length === cols. */
  tiles: string[];
  walkableCount: number;
}

export interface WorldMap {
  shared: Shared;
  floors: FloorMap[];
  byFloor: Map<number, FloorMap>;
  start: { floor: number; tx: number; ty: number };
  tile(floor: number, tx: number, ty: number): string;
  /** In-bounds and not a blocked tile. Reads the cached grid (cheap). */
  isWalkable(floor: number, tx: number, ty: number): boolean;
}

/**
 * Load every real floor's tiles once. `shared.tileAt`/`portalFor` rebuild the
 * whole floor grid on each call, so we cache the grids here and do all
 * per-tile work (walkability, BFS) against the cache.
 *
 * A floor is "real" when it has at least one walkable tile; the engine returns
 * an all-blocked default grid for indices past the authored set.
 */
export async function loadWorld(maxFloor = 15): Promise<WorldMap> {
  const shared = await loadShared();
  const floors: FloorMap[] = [];

  for (let f = 0; f <= maxFloor; f += 1) {
    const tiles = shared.makeFloorTiles(f);
    let walkableCount = 0;
    for (const row of tiles) {
      for (const ch of row) {
        if (!shared.isBlockedTile(ch)) walkableCount += 1;
      }
    }
    if (walkableCount === 0) continue; // unauthored / empty floor
    floors.push({ floor: f, cols: shared.floorCols(f), rows: shared.floorRows(f), tiles, walkableCount });
  }

  const byFloor = new Map(floors.map((fm) => [fm.floor, fm]));

  const tile = (floor: number, tx: number, ty: number): string => {
    const fm = byFloor.get(floor);
    if (!fm || tx < 0 || ty < 0 || tx >= fm.cols || ty >= fm.rows) return "#";
    return fm.tiles[ty]?.[tx] ?? "#";
  };

  return {
    shared,
    floors,
    byFloor,
    start: { floor: shared.START.floor, tx: Math.floor(shared.START.x), ty: Math.floor(shared.START.y) },
    tile,
    isWalkable: (floor, tx, ty) => !shared.isBlockedTile(tile(floor, tx, ty))
  };
}
