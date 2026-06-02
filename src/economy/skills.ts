import type { Catalog, Shared } from "../game/index.ts";
import type { ResolvedOptions } from "./options.ts";
import { hoursToLevel, round1, xpBetween } from "./xp.ts";
import {
  BREWING_MS,
  BREW_XP,
  cookingMs,
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
  /** Milestone levels (from options) the hours map to, e.g. [10, 30, 50]. */
  milestones: [number, number, number];
  /** Hours to reach each milestone from level 1 (Infinity if unreachable). */
  hoursToMilestone: [number, number, number];
  cappedAtLevel?: number;
  notes: string[];
}

/** One row of a per-skill level-by-level deep dive. */
export interface SkillBand {
  level: number;
  xpPerHour: number;
  /** Cumulative hours to reach this level from level 1 (Infinity if unreachable). */
  cumulativeHours: number;
}

export interface SkillDetail {
  skill: string;
  trainable: boolean;
  bestMethodAtCap: string;
  cappedAtLevel?: number;
  bands: SkillBand[];
  notes: string[];
}

/** Lowest level whose cumulative xp exceeds `xp` (i.e. the level `xp` total buys). */
function levelForXp(shared: Shared, xp: number): number {
  let lvl = 1;
  while (lvl < 200 && shared.xpForLevel(lvl + 1) <= xp) lvl += 1;
  return lvl;
}

/**
 * A skill's xp/hr-at-level function, plus its repeatability and cap. Centralised
 * so both the summary rows and the deep-dive bands derive from the same model.
 */
interface SkillModel {
  skill: string;
  /** Repeatable rate at a given level (post-efficiency). 0 = no progress here. */
  rateAt: (level: number) => number;
  /** Best method label at the cap level. */
  methodAt: (level: number) => string;
  notes: string[];
  /** Set for content-capped (non-repeatable) skills like smithing. */
  cappedAtLevel?: number;
}

function buildModels(shared: Shared, catalog: Catalog, opt: ResolvedOptions): SkillModel[] {
  const E = opt.efficiency;

  // Mining: best unlocked ore tier; swings speed up with level.
  const oreTiers = Object.entries(shared.ORE_TIERS);
  const bestOreAt = (level: number) =>
    oreTiers
      .filter(([, t]) => t.reqLevel <= level)
      .reduce<{ xp: number; label: string } | null>(
        (best, [, t]) => (!best || t.xp > best.xp ? { xp: t.xp, label: t.label } : best),
        null
      );

  // Woodcutting: best tree by felling rate at this level.
  const trees = Object.values(catalog.TREE_TYPES);
  const bestTreeAt = (level: number) => {
    let best: { rate: number; label: string } | null = null;
    for (const t of trees) {
      if (t.requiredLevel > level) continue;
      const fellSec = (t.chopsRequired * woodcutSwingMs(level, t.baseSwingMs, t.minSwingMs, t.requiredLevel)) / 1000;
      const rate = (t.xp / fellSec) * 3600 * E;
      if (!best || rate > best.rate) best = { rate, label: t.label };
    }
    return best;
  };

  // Foraging: best unlocked herb node xp.
  const herbXpAt = (level: number) =>
    catalog.HERB_NODES.filter((n) => (n.requiredLevel ?? 1) <= level).reduce<number>(
      (best, n) => Math.max(best, n.xp ?? 0),
      0
    );

  // Cooking: best cookable dish xp (level-independent best, faster with level).
  let bestDishXp = 0;
  for (const item of Object.values(catalog.ITEMS)) {
    if (item.use?.kind === "cook_on_fire") bestDishXp = Math.max(bestDishXp, item.use.xp ?? 0);
  }

  const bestFireXp = Math.max(...Object.values(FIRE_XP));

  return [
    {
      skill: "mining",
      rateAt: (level) => {
        const t = bestOreAt(level);
        return t ? (t.xp / (miningSwingMs(level) / 1000)) * 3600 * E : 0;
      },
      methodAt: (level) => {
        const t = bestOreAt(level);
        return t ? `${t.label} (${t.xp} xp/swing)` : "—";
      },
      notes: ["Each swing yields 1 ore + xp; better ore unlocks with level and swings speed up."]
    },
    {
      skill: "woodcutting",
      rateAt: (level) => bestTreeAt(level)?.rate ?? 0,
      methodAt: (level) => bestTreeAt(level)?.label ?? "—",
      notes: ["Feeds firemaking (logs)."]
    },
    {
      skill: "fishing",
      rateAt: (level) => (FISHING_XP / (fishingCatchMs(level) / 1000)) * 3600 * E,
      methodAt: () => `catch (${FISHING_XP} xp, flat)`,
      notes: ["Flat xp per catch — rate only rises as catches speed up. Feeds cooking."]
    },
    {
      skill: "foraging",
      rateAt: (level) => (herbXpAt(level) / (HERB_GATHER_MS / 1000)) * 3600 * E,
      methodAt: (level) => `best herb (${herbXpAt(level)} xp, ${HERB_GATHER_MS / 1000}s)`,
      notes: ["Feeds alchemy (herbs)."]
    },
    {
      skill: "cooking",
      rateAt: (level) => (bestDishXp / (cookingMs(level) / 1000)) * 3600 * E,
      methodAt: () => `best dish (${bestDishXp} xp)`,
      notes: ["Consumes raw fish from fishing — throughput is gated by fishing supply."]
    },
    {
      skill: "firemaking",
      rateAt: () => (bestFireXp / (FIREMAKING_MS / 1000)) * 3600 * E,
      methodAt: () => `best log (${bestFireXp} xp/fire)`,
      notes: ["Consumes logs from woodcutting. Fire time is a model parameter."]
    },
    {
      skill: "alchemy",
      rateAt: () => (BREW_XP / (BREWING_MS / 1000)) * 3600 * E,
      methodAt: () => `brew potion (${BREW_XP} xp)`,
      notes: ["Consumes a herb + empty flask per brew. Brew time is a model parameter."]
    }
  ];
}

/** The non-repeatable smithing model, computed separately (content-capped). */
function smithingRow(shared: Shared): SkillRow {
  const totalXp = SMITHING_RECIPES.reduce((sum, r) => sum + r.xp, 0);
  const cap = levelForXp(shared, totalXp);
  return {
    skill: "smithing",
    trainable: false,
    bestMethodAtCap: `${SMITHING_RECIPES.length} one-time forges`,
    xpPerHourAtCap: 0,
    milestones: [10, 30, 50],
    hoursToMilestone: [cap >= 10 ? 0 : Infinity, Infinity, Infinity],
    cappedAtLevel: cap,
    notes: [
      `Only ${SMITHING_RECIPES.length} forges exist (3 weapon + 3 armor tiers) = ${totalXp} total xp.`,
      `Smithing can never exceed ~level ${cap} without new recipes.`
    ]
  };
}

function rowFromModel(shared: Shared, m: SkillModel, opt: ResolvedOptions): SkillRow {
  const [m1, m2, m3] = opt.milestones;
  return {
    skill: m.skill,
    trainable: true,
    bestMethodAtCap: m.methodAt(opt.maxLevel),
    xpPerHourAtCap: Math.round(m.rateAt(opt.maxLevel)),
    milestones: opt.milestones,
    hoursToMilestone: [
      round1(hoursToLevel(shared, 1, m1, m.rateAt)),
      round1(hoursToLevel(shared, 1, m2, m.rateAt)),
      round1(hoursToLevel(shared, 1, m3, m.rateAt))
    ],
    notes: m.notes
  };
}

export function analyzeSkills(shared: Shared, catalog: Catalog, opt: ResolvedOptions): SkillRow[] {
  const rows = buildModels(shared, catalog, opt).map((m) => rowFromModel(shared, m, opt));
  rows.push(smithingRow(shared));
  return rows;
}

/**
 * Level-by-level (banded) breakdown for one skill: xp/hr and cumulative hours at
 * each band level up to the cap. `step` controls the band granularity.
 */
export function analyzeSkillDetail(
  shared: Shared,
  catalog: Catalog,
  opt: ResolvedOptions,
  skill: string,
  step = 5
): SkillDetail | null {
  if (skill === "smithing") {
    const row = smithingRow(shared);
    return {
      skill: "smithing",
      trainable: false,
      bestMethodAtCap: row.bestMethodAtCap,
      cappedAtLevel: row.cappedAtLevel,
      bands: [],
      notes: row.notes
    };
  }
  const model = buildModels(shared, catalog, opt).find((m) => m.skill === skill);
  if (!model) return null;

  const levels: number[] = [];
  for (let lvl = 1; lvl < opt.maxLevel; lvl += step) levels.push(lvl);
  if (levels[levels.length - 1] !== opt.maxLevel) levels.push(opt.maxLevel);

  let cumulative = 0;
  let prev = 1;
  const bands: SkillBand[] = [];
  for (const level of levels) {
    // Integrate cumulative hours from the previous band level to this one.
    if (level > prev) {
      const seg = hoursToLevel(shared, prev, level, model.rateAt);
      cumulative = Number.isFinite(cumulative) && Number.isFinite(seg) ? cumulative + seg : Infinity;
      prev = level;
    }
    bands.push({
      level,
      xpPerHour: Math.round(model.rateAt(level)),
      cumulativeHours: round1(cumulative)
    });
  }
  return {
    skill,
    trainable: true,
    bestMethodAtCap: model.methodAt(opt.maxLevel),
    bands,
    notes: model.notes
  };
}

/** Exposed for callers that want the raw xp-per-level cost curve (HTML report). */
export function xpCurve(shared: Shared, maxLevel: number): { level: number; cumulativeXp: number; xpToNext: number }[] {
  const out: { level: number; cumulativeXp: number; xpToNext: number }[] = [];
  for (let lvl = 1; lvl <= maxLevel; lvl += 1) {
    out.push({
      level: lvl,
      cumulativeXp: shared.xpForLevel(lvl),
      xpToNext: lvl < maxLevel ? xpBetween(shared, lvl, lvl + 1) : 0
    });
  }
  return out;
}
