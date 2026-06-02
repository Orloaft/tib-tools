import { DEFAULT_EFFICIENCY } from "./rates.ts";
import { MAX_LEVEL } from "./xp.ts";

/**
 * Tunable model parameters for the economy projection. All optional — omitting
 * any field falls back to the documented defaults, so `analyzeEconomy()` with no
 * args reproduces the canonical projection.
 */
export interface EconomyOptions {
  /** Fraction of wall-clock actually spent acting (0..1). Default 0.7. */
  efficiency?: number;
  /** Level cap the projection targets. Default 60. */
  maxLevel?: number;
  /** Skill-progression milestones (levels) the report columns report. Default [10, 30, 50]. */
  milestones?: [number, number, number];
}

/** Options with every field resolved to a concrete value. */
export interface ResolvedOptions {
  efficiency: number;
  maxLevel: number;
  milestones: [number, number, number];
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Resolve user-supplied options against the defaults, sanitising ranges. */
export function resolveOptions(opts: EconomyOptions = {}): ResolvedOptions {
  const efficiency = clamp(opts.efficiency ?? DEFAULT_EFFICIENCY, 0.01, 1);
  const maxLevel = Math.round(clamp(opts.maxLevel ?? MAX_LEVEL, 2, 200));
  const milestones = (opts.milestones ?? [10, 30, 50]).map((m) =>
    Math.round(clamp(m, 2, maxLevel))
  ) as [number, number, number];
  return { efficiency, maxLevel, milestones };
}
