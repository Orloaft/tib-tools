import { loadBalance, loadCatalog, loadShared, type Shared } from "../game/index.ts";
import { analyzeSkills, type SkillRow } from "./skills.ts";
import { analyzeCombat, type CombatAnalysis } from "./combat.ts";
import { analyzeGold, type GoldAnalysis } from "./gold.ts";
import { resolveOptions, type EconomyOptions, type ResolvedOptions } from "./options.ts";
import { round1 } from "./xp.ts";

export interface EconomyParams {
  efficiency: number;
  maxLevel: number;
  milestones: [number, number, number];
}

export interface EconomyAnalysis {
  /** The resolved model parameters this projection was run with. */
  params: EconomyParams;
  maxLevel: number;
  totalXpToCap: number;
  signals: string[];
  skills: SkillRow[];
  combat: CombatAnalysis;
  gold: GoldAnalysis;
}

/**
 * Project skill progression, combat leveling, and the gold economy.
 *
 * Called with no args it reproduces the canonical projection (efficiency 0.7,
 * level cap 60). Pass `opts` to tune the model parameters.
 */
export async function analyzeEconomy(opts: EconomyOptions = {}): Promise<EconomyAnalysis> {
  const opt = resolveOptions(opts);
  const [shared, catalog, balance] = await Promise.all([loadShared(), loadCatalog(), loadBalance()]);

  const skills = analyzeSkills(shared, catalog, opt);
  const combat = analyzeCombat(shared, catalog, balance, opt);
  // Use the earliest checkpoint's best gold rate as the "early game" faucet.
  const earlyGoldPerHour = combat.perProfile[0]?.goldPerHour ?? 0;
  const gold = analyzeGold(catalog, earlyGoldPerHour);

  return {
    params: { efficiency: opt.efficiency, maxLevel: opt.maxLevel, milestones: opt.milestones },
    maxLevel: opt.maxLevel,
    totalXpToCap: shared.xpForLevel(opt.maxLevel),
    signals: deriveSignals(shared, opt, skills, combat, gold),
    skills,
    combat,
    gold
  };
}

function fmtHours(h: number): string {
  if (!Number.isFinite(h)) return "never";
  return h < 1 ? `${Math.round(h * 60)} min` : `${round1(h)} h`;
}

/** Plain-language headline takeaways derived from the projections. */
function deriveSignals(
  shared: Shared,
  opt: ResolvedOptions,
  skills: SkillRow[],
  combat: CombatAnalysis,
  gold: GoldAnalysis
): string[] {
  const out: string[] = [];
  const topMilestone = opt.milestones[2];

  const totalToCap = shared.xpForLevel(opt.maxLevel);
  out.push(`The skill curve needs only ${totalToCap.toLocaleString()} xp to reach level ${opt.maxLevel} — shallow next to action rates.`);

  // hoursToMilestone[2] is the top milestone (default level 50).
  const trainable = skills.filter((s) => s.trainable && Number.isFinite(s.hoursToMilestone[2]));
  const fastest = [...trainable].sort((a, b) => a.hoursToMilestone[2] - b.hoursToMilestone[2])[0];
  if (fastest) {
    out.push(
      `Fastest to level ${topMilestone}: ${fastest.skill} in ~${fmtHours(fastest.hoursToMilestone[2])} (${fastest.xpPerHourAtCap.toLocaleString()} xp/hr).`
    );
  }
  const subHour = trainable.filter((s) => s.hoursToMilestone[2] < 1).map((s) => s.skill);
  if (subHour.length >= 2) out.push(`${subHour.length} skills reach level ${topMilestone} in under an hour: ${subHour.join(", ")}.`);

  const smith = skills.find((s) => s.skill === "smithing");
  if (smith?.cappedAtLevel) out.push(`Smithing is content-capped at ~level ${smith.cappedAtLevel} — no repeatable training exists.`);

  const counts = new Map<string, number>();
  for (const p of combat.perProfile) counts.set(p.bestXpMonster, (counts.get(p.bestXpMonster) ?? 0) + 1);
  const dom = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (dom && dom[1] >= 3 && dom[0] !== "—") {
    out.push(`${dom[0]} is the best xp farm at ${dom[1]}/${combat.perProfile.length} checkpoints — an efficiency outlier worth re-tuning.`);
  }

  if (gold.starterKitCost > 0 && gold.questGoldTotal > 0) {
    out.push(
      `Quest gold (${gold.questGoldTotal}g) covers the whole starter kit (${gold.starterKitCost}g) ${round1(gold.questGoldTotal / gold.starterKitCost)}× over — early gold has almost no friction.`
    );
  }

  return out;
}

export type { EconomyOptions, ResolvedOptions } from "./options.ts";
export { resolveOptions } from "./options.ts";
export type { SkillRow, SkillDetail, SkillBand } from "./skills.ts";
export { analyzeSkillDetail, xpCurve } from "./skills.ts";
export type { CombatAnalysis, CombatBand, ProfileCombat } from "./combat.ts";
export type { GoldAnalysis, LedgerEntry } from "./gold.ts";
export { MAX_LEVEL } from "./xp.ts";
