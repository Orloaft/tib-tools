import { loadCatalog } from "../game/index.ts";
import type { Finding } from "../content-graph/index.ts";
import { buildNarrative, type NarrativeModel } from "./model.ts";
import { lintNarrative } from "./lint.ts";

export interface NarrativeSummary {
  quests: number;
  lines: number;
  errors: number;
  warnings: number;
  infos: number;
}

export interface NarrativeAnalysis {
  model: NarrativeModel;
  findings: Finding[];
  summary: NarrativeSummary;
}

export async function analyzeNarrative(): Promise<NarrativeAnalysis> {
  const catalog = await loadCatalog();
  const model = buildNarrative(catalog);
  const findings = lintNarrative(model);

  const lines = model.quests.reduce(
    (sum, q) => sum + q.stages.reduce((s, st) => s + st.lines.length, 0),
    0
  );

  return {
    model,
    findings,
    summary: {
      quests: model.quests.length,
      lines,
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warn").length,
      infos: findings.filter((f) => f.severity === "info").length
    }
  };
}

export { buildNarrative, PHASES, REQUIRED_PHASES } from "./model.ts";
export type { NarrativeModel, QuestNarrative, StageModel, LineModel, Phase } from "./model.ts";
export { lintNarrative } from "./lint.ts";
export { serializeDialogue } from "./serialize.ts";
export { buildContext, renderLine, validLeaves, extractTokens, tokenProblem } from "./tokens.ts";
