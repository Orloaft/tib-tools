import { loadCatalog } from "../game/index.ts";
import type { Finding } from "../content-graph/index.ts";
import { loadWorld, type WorldMap } from "./world.ts";
import { enumeratePortals, type PortalLink } from "./portals.ts";
import { computeReachability, unreachableRegions, type Reachability, type UnreachableRegion } from "./reachability.ts";
import { runWorldChecks } from "./checks.ts";

export interface WorldSummary {
  floors: number;
  portals: number;
  walkableTiles: number;
  reachableTiles: number;
  errors: number;
  warnings: number;
  infos: number;
}

export interface WorldAnalysis {
  world: WorldMap;
  portals: PortalLink[];
  reach: Reachability;
  regions: UnreachableRegion[];
  findings: Finding[];
  summary: WorldSummary;
}

/** Load the whole world, trace reachability, and run every map-integrity check. */
export async function analyzeWorld(): Promise<WorldAnalysis> {
  const [world, catalog] = await Promise.all([loadWorld(), loadCatalog()]);
  const portals = enumeratePortals(world);
  const reach = computeReachability(world, portals);
  const regions = unreachableRegions(world, reach);
  const findings = runWorldChecks({ world, catalog, portals, reach, regions });

  const walkableTiles = world.floors.reduce((sum, fm) => sum + fm.walkableCount, 0);
  const reachableTiles = [...reach.reachableCountByFloor.values()].reduce((sum, n) => sum + n, 0);

  return {
    world,
    portals,
    reach,
    regions,
    findings,
    summary: {
      floors: world.floors.length,
      portals: portals.length,
      walkableTiles,
      reachableTiles,
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warn").length,
      infos: findings.filter((f) => f.severity === "info").length
    }
  };
}

export { loadWorld } from "./world.ts";
export { enumeratePortals } from "./portals.ts";
export { computeReachability, unreachableRegions } from "./reachability.ts";
export type { WorldMap, FloorMap } from "./world.ts";
export type { PortalLink } from "./portals.ts";
export type { Reachability, UnreachableRegion } from "./reachability.ts";
