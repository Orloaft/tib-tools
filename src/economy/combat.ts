import type { Balance, Catalog, Shared } from "../game/index.ts";
import { round1, xpBetween } from "./xp.ts";

export interface ProfileCombat {
  label: string;
  level: number;
  bestXpMonster: string;
  xpPerHour: number;
  bestGoldMonster: string;
  goldPerHour: number;
}

export interface CombatBand {
  fromLabel: string;
  fromLevel: number;
  toLabel: string;
  toLevel: number;
  /** Best survivable xp rate at the *from* checkpoint. */
  xpPerHour: number;
  monster: string;
  hours: number;
}

export interface CombatAnalysis {
  perProfile: ProfileCombat[];
  bands: CombatBand[];
  hoursToTop: number;
}

/**
 * Combat progression: at each player checkpoint, the best *survivable* monster
 * to farm for player-xp and for gold, and the projected hours to climb between
 * checkpoints. Survivable = the profile kills it before it kills them 1v1.
 */
export function analyzeCombat(shared: Shared, catalog: Catalog, balance: Balance): CombatAnalysis {
  const profiles = balance.DEFAULT_COMBAT_PROFILES;
  const monsters = Object.entries(catalog.MONSTERS);

  const perProfile: ProfileCombat[] = profiles.map((profile) => {
    let bestXp = { monster: "—", xpPerHour: 0 };
    let bestGold = { monster: "—", goldPerHour: 0 };
    for (const [id, monster] of monsters) {
      // Level-appropriate content only: you farm what you can plausibly reach,
      // not bosses several zones ahead (even if the formula says you'd win).
      // The window is generous at low levels where the early monsters already
      // out-level a fresh character.
      if (balance.monsterCombatLevel(monster) > profile.level + 10) continue;
      const ttk = balance.estimateTimeToKill(monster, profile);
      const ttd = balance.estimateTimeToDie(monster, profile);
      if (!(ttk < ttd)) continue; // not survivable to farm 1v1
      const xpPerHour = monster.xp * (3600 / Math.max(0.1, ttk));
      if (xpPerHour > bestXp.xpPerHour) bestXp = { monster: id, xpPerHour };
      const avgGold = (monster.gold[0] + monster.gold[1]) / 2;
      const goldPerHour = avgGold * (3600 / Math.max(0.1, ttk));
      if (goldPerHour > bestGold.goldPerHour) bestGold = { monster: id, goldPerHour };
    }
    return {
      label: profile.label,
      level: profile.level,
      bestXpMonster: bestXp.monster,
      xpPerHour: Math.round(bestXp.xpPerHour),
      bestGoldMonster: bestGold.monster,
      goldPerHour: Math.round(bestGold.goldPerHour)
    };
  });

  const bands: CombatBand[] = [];
  for (let i = 0; i < perProfile.length - 1; i += 1) {
    const from = perProfile[i]!;
    const to = perProfile[i + 1]!;
    const rate = from.xpPerHour;
    const hours = rate > 0 ? xpBetween(shared, from.level, to.level) / rate : Infinity;
    bands.push({
      fromLabel: from.label,
      fromLevel: from.level,
      toLabel: to.label,
      toLevel: to.level,
      xpPerHour: rate,
      monster: from.bestXpMonster,
      hours: round1(hours)
    });
  }

  const hoursToTop = round1(bands.reduce((sum, b) => sum + (Number.isFinite(b.hours) ? b.hours : 0), 0));
  return { perProfile, bands, hoursToTop };
}
