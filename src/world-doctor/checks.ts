import type { Finding } from "../content-graph/index.ts";
import type { Catalog } from "../game/index.ts";
import type { WorldMap } from "./world.ts";
import type { PortalLink } from "./portals.ts";
import type { Reachability, UnreachableRegion } from "./reachability.ts";

export interface WorldContext {
  world: WorldMap;
  catalog: Catalog;
  portals: PortalLink[];
  reach: Reachability;
  regions: UnreachableRegion[];
}

/** Unreachable walkable components at/above this many tiles are worth a warning. */
const LARGE_UNREACHABLE_MIN = 60;
/** A return portal within this many tiles of a portal's landing counts as two-way. */
const PORTAL_RETURN_RADIUS = 3;

export function runWorldChecks(ctx: WorldContext): Finding[] {
  const findings: Finding[] = [];
  const cutoffFloors = floorReachabilityChecks(ctx, findings);
  unreachableRegionChecks(ctx, findings);
  portalChecks(ctx, findings);
  placementChecks(ctx, findings, cutoffFloors);
  return findings;
}

/** A real floor with zero reachable tiles is entirely cut off from START. */
function floorReachabilityChecks(ctx: WorldContext, out: Finding[]): Set<number> {
  const cutoff = new Set<number>();
  for (const fm of ctx.world.floors) {
    const reached = ctx.reach.reachableCountByFloor.get(fm.floor) ?? 0;
    if (reached === 0) {
      cutoff.add(fm.floor);
      out.push({
        rule: "floor.unreachable",
        severity: "error",
        subject: `floor:${fm.floor}`,
        message: `Floor ${fm.floor} is entirely unreachable from START — no portal path leads to it.`
      });
    }
  }
  return cutoff;
}

function unreachableRegionChecks(ctx: WorldContext, out: Finding[]): void {
  for (const r of ctx.regions) {
    if (r.size < LARGE_UNREACHABLE_MIN) continue;
    out.push({
      rule: "region.unreachable",
      severity: "warn",
      subject: `floor:${r.floor}@(${r.sampleTx},${r.sampleTy})`,
      message: `Floor ${r.floor} has a ${r.size}-tile walkable area unreachable from START (near ${r.sampleTx},${r.sampleTy}) — possible stranded content or a broken portal.`
    });
  }
}

function portalChecks(ctx: WorldContext, out: Finding[]): void {
  for (const p of ctx.portals) {
    const subject = `portal:${p.fromFloor}@(${p.fromTx},${p.fromTy})->${p.toFloor}`;

    if (!ctx.world.byFloor.has(p.toFloor)) {
      out.push({
        rule: "portal.deadFloor",
        severity: "error",
        subject,
        message: `Portal tile "${p.sourceTile}" leads to floor ${p.toFloor}, which has no authored map.`
      });
      continue;
    }

    if (!ctx.world.isWalkable(p.toFloor, p.toTx, p.toTy)) {
      out.push({
        rule: "portal.blockedLanding",
        severity: "error",
        subject,
        message: `Portal lands on a blocked tile "${ctx.world.tile(p.toFloor, p.toTx, p.toTy)}" at floor ${p.toFloor} (${p.toTx},${p.toTy}) — players would be stuck.`
      });
    }

    if (!p.gated && !hasReturnPortal(ctx, p)) {
      out.push({
        rule: "portal.oneWay",
        severity: "info",
        subject,
        message: `Portal to floor ${p.toFloor} has no return portal near its landing (${p.toTx},${p.toTy}) — one-way (may be intentional).`
      });
    }
  }
}

function hasReturnPortal(ctx: WorldContext, p: PortalLink): boolean {
  return ctx.portals.some(
    (q) =>
      q.fromFloor === p.toFloor &&
      q.toFloor === p.fromFloor &&
      Math.abs(q.fromTx - p.toTx) <= PORTAL_RETURN_RADIUS &&
      Math.abs(q.fromTy - p.toTy) <= PORTAL_RETURN_RADIUS
  );
}

/** Is any 4-adjacent tile both walkable and reachable from START? */
function adjacentReachable(world: WorldMap, reach: Reachability, floor: number, tx: number, ty: number): boolean {
  return [
    [tx + 1, ty],
    [tx - 1, ty],
    [tx, ty + 1],
    [tx, ty - 1]
  ].some(([ax, ay]) => world.isWalkable(floor, ax!, ay!) && reach.has(floor, ax!, ay!));
}

function placementChecks(ctx: WorldContext, out: Finding[], cutoff: Set<number>): void {
  const { world, catalog, reach } = ctx;

  // Monsters stand on their spawn tile — but behaviour changes what "valid"
  // means: ranged turrets are designed to sit on water/blocked tiles and be
  // fought from the shore; burrowers ambush from underground and only need a
  // reachable adjacent tile to be triggered (like a tree).
  for (const s of catalog.MONSTER_SPAWNS) {
    const tx = Math.floor(s.x);
    const ty = Math.floor(s.y);
    if (!world.byFloor.has(s.floor)) continue;
    const def = catalog.MONSTERS[s.type];
    const subject = `spawn:${s.type}@${s.floor}(${tx},${ty})`;

    if (def?.ranged) continue; // anchored water turret — blocked/unreachable tile is by design

    if (def?.burrow) {
      if (cutoff.has(s.floor)) continue;
      const triggerable = adjacentReachable(world, reach, s.floor, tx, ty);
      if (!triggerable) {
        out.push({
          rule: "spawn.unworkable",
          severity: "warn",
          subject,
          message: `Burrower "${s.type}" has no reachable adjacent tile — a player can never get close enough to trigger it.`
        });
      }
      continue;
    }

    if (!world.isWalkable(s.floor, tx, ty)) {
      out.push({
        rule: "spawn.blocked",
        severity: "warn",
        subject,
        message: `Melee monster "${s.type}" spawns on a blocked tile "${world.tile(s.floor, tx, ty)}" — it may be stuck in terrain.`
      });
    } else if (!cutoff.has(s.floor) && !reach.has(s.floor, tx, ty)) {
      out.push({
        rule: "spawn.stranded",
        severity: "warn",
        subject,
        message: `Monster spawn "${s.type}" is in an area unreachable from START.`
      });
    }
  }

  // Resource nodes: the *approach* tile is where the player stands.
  const approachNodes: Array<{ kind: string; id: string; floor: number; ax: number; ay: number }> = [
    ...catalog.MINING_NODES.map((n) => ({ kind: "mining", id: n.id, floor: n.floor, ax: n.approachX, ay: n.approachY })),
    ...catalog.HERB_NODES.map((n) => ({ kind: "herb", id: n.id, floor: n.floor, ax: n.approachX, ay: n.approachY })),
    ...catalog.FISHING_NODES.map((n) => ({ kind: "fishing", id: n.id, floor: n.floor, ax: n.approachX, ay: n.approachY }))
  ];
  for (const n of approachNodes) {
    const tx = Math.floor(n.ax);
    const ty = Math.floor(n.ay);
    if (!world.byFloor.has(n.floor)) continue;
    if (!world.isWalkable(n.floor, tx, ty)) {
      out.push({
        rule: "node.blockedApproach",
        severity: "error",
        subject: `${n.kind}:${n.id}`,
        message: `${n.kind} node "${n.id}" approach tile (${tx},${ty}) on floor ${n.floor} is blocked — unworkable.`
      });
    } else if (!cutoff.has(n.floor) && !reach.has(n.floor, tx, ty)) {
      out.push({
        rule: "node.stranded",
        severity: "warn",
        subject: `${n.kind}:${n.id}`,
        message: `${n.kind} node "${n.id}" approach is unreachable from START.`
      });
    }
  }

  // NPCs stand on their tile.
  for (const npc of catalog.NPCS) {
    const tx = Math.floor(npc.x);
    const ty = Math.floor(npc.y);
    if (!world.byFloor.has(npc.floor)) continue;
    if (!world.isWalkable(npc.floor, tx, ty)) {
      out.push({
        rule: "npc.blocked",
        severity: "error",
        subject: `npc:${npc.id}`,
        message: `NPC "${npc.id}" stands on a blocked tile "${world.tile(npc.floor, tx, ty)}" at floor ${npc.floor} (${tx},${ty}).`
      });
    } else if (!cutoff.has(npc.floor) && !reach.has(npc.floor, tx, ty)) {
      out.push({
        rule: "npc.stranded",
        severity: "warn",
        subject: `npc:${npc.id}`,
        message: `NPC "${npc.id}" is in an area unreachable from START.`
      });
    }
  }

  // Trees are chopped from an adjacent tile — need at least one reachable neighbour.
  for (const t of catalog.COMPOSED_TREE_NODES) {
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    if (!world.byFloor.has(t.floor) || cutoff.has(t.floor)) continue;
    if (!adjacentReachable(world, reach, t.floor, tx, ty)) {
      out.push({
        rule: "tree.unworkable",
        severity: "warn",
        subject: `tree:${t.type}@${t.floor}(${tx},${ty})`,
        message: `Tree "${t.type}" at floor ${t.floor} (${tx},${ty}) has no reachable adjacent tile to chop from.`
      });
    }
  }
}
