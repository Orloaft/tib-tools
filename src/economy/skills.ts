import type { Catalog, Shared } from "../game/index.ts";
import { hoursToLevel, MAX_LEVEL, round1 } from "./xp.ts";
import {
  BREWING_MS,
  BREW_XP,
  cookingMs,
  DEFAULT_EFFICIENCY,
  FIREMAKING_MS,
  FIRE_XP,
  fishingCatchMs,
  FISHING_XP,
  HERB_GATHER_MS,
  miningSwingMs,
  SMITHING_RECIPES,
  woodcutSwingMs
} from "./rates.ts";

export interface SkillRow {
  skill: string;
  /** Repeatable training exists (false for content-capped skills like smithing). */
  trainable: boolean;
  bestMethodAtCap: string;
  xpPerHourAtCap: number;
  /** Hours to reach 10 / 30 / 50 from level 1 (Infinity if unreachable). */
  hoursTo10: number;
  hoursTo30: number;
  hoursTo50: number;
  cappedAtLevel?: number;
  notes: string[];
}

const E = DEFAULT_EFFICIENCY;

/** Lowest level whose cumulative xp exceeds `xp` (i.e. the level `xp` total buys). */
function levelForXp(shared: Shared, xp: number): number {
  let lvl = 1;
  while (lvl < 200 && shared.xpForLevel(lvl + 1) <= xp) lvl += 1;
  return lvl;
}

export function analyzeSkills(shared: Shared, catalog: Catalog): SkillRow[] {
  return [
    miningRow(shared),
    woodcuttingRow(shared, catalog),
    fishingRow(shared),
    foragingRow(shared, catalog),
    cookingRow(shared, catalog),
    firemakingRow(shared),
    alchemyRow(shared),
    smithingRow(shared)
  ];
}

function projectRepeatable(
  shared: Shared,
  skill: string,
  bestMethodAtCap: string,
  xpPerHourAt: (level: number) => number,
  notes: string[]
): SkillRow {
  return {
    skill,
    trainable: true,
    bestMethodAtCap,
    xpPerHourAtCap: Math.round(xpPerHourAt(MAX_LEVEL)),
    hoursTo10: round1(hoursToLevel(shared, 1, 10, xpPerHourAt)),
    hoursTo30: round1(hoursToLevel(shared, 1, 30, xpPerHourAt)),
    hoursTo50: round1(hoursToLevel(shared, 1, 50, xpPerHourAt)),
    notes
  };
}

function miningRow(shared: Shared): SkillRow {
  const tiers = Object.entries(shared.ORE_TIERS);
  const bestTierAt = (level: number) =>
    tiers
      .filter(([, t]) => t.reqLevel <= level)
      .reduce<{ xp: number; label: string } | null>((best, [, t]) => (!best || t.xp > best.xp ? { xp: t.xp, label: t.label } : best), null);
  const rate = (level: number): number => {
    const t = bestTierAt(level);
    if (!t) return 0;
    return (t.xp / (miningSwingMs(level) / 1000)) * 3600 * E;
  };
  const capTier = bestTierAt(MAX_LEVEL);
  return projectRepeatable(shared, "mining", capTier ? `${capTier.label} (${capTier.xp} xp/swing)` : "—", rate, [
    "Each swing yields 1 ore + xp; better ore unlocks with level and swings speed up."
  ]);
}

function woodcuttingRow(shared: Shared, catalog: Catalog): SkillRow {
  const trees = Object.values(catalog.TREE_TYPES);
  const bestAt = (level: number) => {
    let best: { rate: number; label: string } | null = null;
    for (const t of trees) {
      if (t.requiredLevel > level) continue;
      const fellSec = (t.chopsRequired * woodcutSwingMs(level, t.baseSwingMs, t.minSwingMs, t.requiredLevel)) / 1000;
      const rate = (t.xp / fellSec) * 3600 * E;
      if (!best || rate > best.rate) best = { rate, label: t.label };
    }
    return best;
  };
  const rate = (level: number) => bestAt(level)?.rate ?? 0;
  return projectRepeatable(shared, "woodcutting", bestAt(MAX_LEVEL)?.label ?? "—", rate, [
    "Feeds firemaking (logs)."
  ]);
}

function fishingRow(shared: Shared): SkillRow {
  const rate = (level: number) => (FISHING_XP / (fishingCatchMs(level) / 1000)) * 3600 * E;
  return projectRepeatable(shared, "fishing", `catch (${FISHING_XP} xp, flat)`, rate, [
    "Flat xp per catch — rate only rises as catches speed up. Feeds cooking."
  ]);
}

function foragingRow(shared: Shared, catalog: Catalog): SkillRow {
  const nodes = catalog.HERB_NODES;
  const bestXpAt = (level: number) =>
    nodes
      .filter((n) => (n.requiredLevel ?? 1) <= level)
      .reduce<number>((best, n) => Math.max(best, n.xp ?? 0), 0);
  const rate = (level: number) => (bestXpAt(level) / (HERB_GATHER_MS / 1000)) * 3600 * E;
  const capXp = bestXpAt(MAX_LEVEL);
  return projectRepeatable(shared, "foraging", `best herb (${capXp} xp, ${HERB_GATHER_MS / 1000}s)`, rate, [
    "Feeds alchemy (herbs)."
  ]);
}

function cookingRow(shared: Shared, catalog: Catalog): SkillRow {
  let bestXp = 0;
  for (const item of Object.values(catalog.ITEMS)) {
    if (item.use?.kind === "cook_on_fire") bestXp = Math.max(bestXp, item.use.xp ?? 0);
  }
  const rate = (level: number) => (bestXp / (cookingMs(level) / 1000)) * 3600 * E;
  return projectRepeatable(shared, "cooking", `best dish (${bestXp} xp)`, rate, [
    "Consumes raw fish from fishing — throughput is gated by fishing supply."
  ]);
}

function firemakingRow(shared: Shared): SkillRow {
  const bestXp = Math.max(...Object.values(FIRE_XP));
  const rate = (_level: number) => (bestXp / (FIREMAKING_MS / 1000)) * 3600 * E; // level-independent
  return projectRepeatable(shared, "firemaking", `best log (${bestXp} xp/fire)`, rate, [
    "Consumes logs from woodcutting. Fire time is a model parameter."
  ]);
}

function alchemyRow(shared: Shared): SkillRow {
  const rate = (_level: number) => (BREW_XP / (BREWING_MS / 1000)) * 3600 * E;
  return projectRepeatable(shared, "alchemy", `brew potion (${BREW_XP} xp)`, rate, [
    "Consumes a herb + empty flask per brew. Brew time is a model parameter."
  ]);
}

function smithingRow(shared: Shared): SkillRow {
  // Smithing is NOT repeatable: each recipe is a one-time tier upgrade, so the
  // whole skill is content-capped at the sum of all six forges' xp.
  const totalXp = SMITHING_RECIPES.reduce((sum, r) => sum + r.xp, 0);
  const cap = levelForXp(shared, totalXp);
  return {
    skill: "smithing",
    trainable: false,
    bestMethodAtCap: `${SMITHING_RECIPES.length} one-time forges`,
    xpPerHourAtCap: 0,
    hoursTo10: cap >= 10 ? 0 : Infinity,
    hoursTo30: Infinity,
    hoursTo50: Infinity,
    cappedAtLevel: cap,
    notes: [
      `Only ${SMITHING_RECIPES.length} forges exist (3 weapon + 3 armor tiers) = ${totalXp} total xp.`,
      `Smithing can never exceed ~level ${cap} without new recipes.`
    ]
  };
}
