import type { Shared } from "../game/index.ts";

/** Default practical content cap: ore tiers / smithing / the combat profiles top out ~50-58. */
export const MAX_LEVEL = 60;

/** XP needed to go from `from` to `to` on the shared skill curve. */
export function xpBetween(shared: Shared, from: number, to: number): number {
  return shared.xpForLevel(to) - shared.xpForLevel(from);
}

/**
 * Hours to train from level `from` to `to`, integrating per level because the
 * xp rate usually changes with level (faster swings, better ore unlocks).
 * `xpPerHourAt(level)` returns the rate while sitting at that level; 0/negative
 * means "no progress possible from here" and the integration stops (returns
 * Infinity for the unreachable remainder).
 */
export function hoursToLevel(shared: Shared, from: number, to: number, xpPerHourAt: (level: number) => number): number {
  let hours = 0;
  for (let lvl = from; lvl < to; lvl += 1) {
    const rate = xpPerHourAt(lvl);
    if (!(rate > 0)) return Infinity;
    hours += xpBetween(shared, lvl, lvl + 1) / rate;
  }
  return hours;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
