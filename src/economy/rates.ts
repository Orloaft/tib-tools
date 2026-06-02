// Action timings and crafting recipes that live as private constants/functions
// in server/index.ts (not exported, so we can't import them). Mirrored here so
// the simulator's rates are accurate — KEEP IN SYNC with server/index.ts.
//
// The *tunable content* (xp values, gold, costs, level gates) is always read
// live from the catalog; only these structural timing formulas are mirrored.

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** ms per mining swing (one swing = one ore + the tier's xp). */
export function miningSwingMs(level: number): number {
  return clamp(3800 - (level - 1) * 85, 1700, 3800);
}

/** ms per fishing catch. */
export function fishingCatchMs(level: number): number {
  return clamp(3600 - (level - 1) * 80, 1600, 3600);
}

/** ms per cook. */
export function cookingMs(level: number): number {
  return clamp(2800 - (level - 1) * 55, 1300, 2800);
}

/** ms per woodcutting swing; a tree takes `chopsRequired` swings. */
export function woodcutSwingMs(level: number, baseSwingMs: number, minSwingMs: number, requiredLevel: number): number {
  return clamp(baseSwingMs - Math.max(0, level - requiredLevel) * 75, minSwingMs, baseSwingMs);
}

/** ms per herb gather (fixed). */
export const HERB_GATHER_MS = 2600;

/** Fishing grants a flat xp per catch (server: `const xp = 18`). */
export const FISHING_XP = 18;

/** Alchemy grants a flat xp per brew (server: `BREW_XP`). */
export const BREW_XP = 30;

/** Firemaking xp per fire, keyed by the log consumed (content/items.yaml). */
export const FIRE_XP: Record<string, number> = { logs: 10, pine_logs: 18 };

// --- Model parameters (not in the server; documented assumptions, tunable) ----

/** Lighting a fire is near-instant; pace it by the log-handling loop. */
export const FIREMAKING_MS = 1800;
/** Brewing a potion is near-instant; pace it by the flask/herb loop. */
export const BREWING_MS = 1800;
/**
 * Fraction of wall-clock actually spent performing an action (vs. walking
 * between nodes, banking, node respawn waits). Applied to every gathering rate.
 */
export const DEFAULT_EFFICIENCY = 0.7;

/** Smithing recipes (server: SMITHING_RECIPES). Each is a one-time tier upgrade. */
export interface SmithRecipe {
  slot: "weapon" | "armor";
  tier: number;
  bar: string;
  qty: number;
  level: number;
  xp: number;
  label: string;
}
export const SMITHING_RECIPES: SmithRecipe[] = [
  { slot: "weapon", tier: 1, bar: "copper_bar", qty: 1, level: 1, xp: 35, label: "Copper Edge" },
  { slot: "weapon", tier: 2, bar: "iron_bar", qty: 2, level: 10, xp: 80, label: "Iron Edge" },
  { slot: "weapon", tier: 3, bar: "mithril_bar", qty: 2, level: 40, xp: 150, label: "Mithril Edge" },
  { slot: "armor", tier: 1, bar: "tin_bar", qty: 1, level: 1, xp: 35, label: "Tin-Riveted Mail" },
  { slot: "armor", tier: 2, bar: "silver_bar", qty: 2, level: 20, xp: 95, label: "Silvered Mail" },
  { slot: "armor", tier: 3, bar: "adamant_bar", qty: 2, level: 50, xp: 175, label: "Adamant Mail" }
];
