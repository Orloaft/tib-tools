import type { Catalog } from "../game/index.ts";

export interface LedgerEntry {
  label: string;
  gold: number;
  kind: "oneTime" | "perHour" | "perUse";
  note?: string;
}

export interface GoldAnalysis {
  faucets: LedgerEntry[];
  sinks: LedgerEntry[];
  starterKitCost: number;
  questGoldTotal: number;
  bestEarlyGoldPerHour: number;
  hoursToAffordKit: number;
}

/** Shop keys that make up the one-time "get equipped" outlay. */
const KIT_KEYS = ["axe", "pickaxe", "fishing_rod", "flint_steel", "hunting_bow", "weapon", "armor", "broken_reach_map"];

export function analyzeGold(catalog: Catalog, bestEarlyGoldPerHour: number): GoldAnalysis {
  const cost = (key: string): number => catalog.SHOP[key]?.cost ?? 0;

  const sinks: LedgerEntry[] = [];
  let starterKitCost = 0;
  for (const key of KIT_KEYS) {
    const c = cost(key);
    if (c <= 0) continue;
    starterKitCost += c;
    sinks.push({ label: catalog.SHOP[key]?.name ?? key, gold: c, kind: "oneTime" });
  }
  const potion = cost("potion");
  if (potion > 0) sinks.push({ label: "Health Potion", gold: potion, kind: "perUse", note: "ongoing combat upkeep" });

  const questGoldTotal = Object.values(catalog.QUESTS).reduce((sum, q) => sum + (q.rewardGold ?? 0), 0);

  const faucets: LedgerEntry[] = [
    { label: "Combat (best survivable, early game)", gold: Math.round(bestEarlyGoldPerHour), kind: "perHour" },
    { label: `All quests (${Object.keys(catalog.QUESTS).length}) one-time`, gold: questGoldTotal, kind: "oneTime" }
  ];

  // Keep 2 decimals: a fast early gold rate buys the kit in a couple of minutes,
  // and round1 would flatten that to "0".
  const hoursToAffordKit =
    bestEarlyGoldPerHour > 0 ? Math.round((starterKitCost / bestEarlyGoldPerHour) * 100) / 100 : Infinity;

  return { faucets, sinks, starterKitCost, questGoldTotal, bestEarlyGoldPerHour, hoursToAffordKit };
}
