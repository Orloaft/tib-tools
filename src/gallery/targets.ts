import { loadShared } from "../game/index.ts";

export interface TourTarget {
  /** Stable id used for the shot filename. */
  label: string;
  title: string;
  floor: number;
  x: number;
  y: number;
}

/**
 * One representative shot per zone — the zone's centre. Zones come from
 * shared.ZONES, so the tour automatically covers new biomes as they're added.
 */
export async function tourTargets(): Promise<TourTarget[]> {
  const shared = await loadShared();
  const targets: TourTarget[] = [];
  for (const zone of Object.values(shared.ZONES)) {
    targets.push({
      label: zone.id,
      title: `${zone.label} (floor ${zone.floor})`,
      floor: zone.floor,
      x: Math.round(((zone.x1 + zone.x2) / 2) * 10) / 10,
      y: Math.round(((zone.y1 + zone.y2) / 2) * 10) / 10
    });
  }
  return targets.sort((a, b) => a.floor - b.floor || a.label.localeCompare(b.label));
}
