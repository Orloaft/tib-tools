import type { Finding } from "../content-graph/index.ts";
import { REQUIRED_PHASES, type NarrativeModel, type QuestNarrative } from "./model.ts";
import { buildContext, renderLine, tokenProblem } from "./tokens.ts";

// The bottom dialogue box is ~840px wide at 18px text; ~86 chars wrap per line,
// and it reads comfortably at up to ~3 lines before it grows tall.
const CHARS_PER_LINE = 86;
const MAX_BOX_LINES = 3;

export function lintNarrative(model: NarrativeModel): Finding[] {
  const out: Finding[] = [];
  for (const q of model.quests) lintQuest(q, out);
  return out;
}

function sampleCtx(q: QuestNarrative, progress: number): Record<string, unknown> {
  return buildContext({
    targetCount: q.targetCount,
    rewardGold: q.rewardGold,
    rewardXp: q.rewardXp,
    hasItem: q.hasItem,
    itemId: q.id,
    itemLabel: q.itemLabel,
    npcName: q.giverName,
    playerName: "Wanderer",
    progress
  });
}

function lintQuest(q: QuestNarrative, out: Finding[]): void {
  const present = new Set(q.stages.filter((s) => s.lines.length > 0).map((s) => s.phase));
  for (const phase of REQUIRED_PHASES) {
    if (!present.has(phase)) {
      out.push({
        rule: "phase.empty",
        severity: "warn",
        subject: `quest:${q.id}`,
        message: `No "${phase}" dialogue — the game falls back to the giver's generic line.`
      });
    }
  }

  for (const stage of q.stages) {
    const progress = stage.phase === "progress" ? Math.max(1, Math.floor(q.targetCount / 2)) : 0;
    const ctx = sampleCtx(q, progress);

    for (const line of stage.lines) {
      for (const token of line.tokens) {
        const problem = tokenProblem(token, q.hasItem);
        if (problem) {
          out.push({
            rule: "token.unresolved",
            severity: "error",
            subject: `quest:${q.id}/${stage.phase}`,
            message: `${problem} (${line.speaker} line)`
          });
        } else if (stage.phase !== "progress" && (token === "progress" || token === "target.remaining")) {
          out.push({
            rule: "token.phase",
            severity: "warn",
            subject: `quest:${q.id}/${stage.phase}`,
            message: `"{${token}}" in the ${stage.phase} stage always shows ${
              token === "progress" ? "0" : "the full count"
            } — progress isn't tracked outside the progress stage`
          });
        }
      }

      const rendered = renderLine(line.raw, ctx);
      const boxLines = Math.ceil(rendered.length / CHARS_PER_LINE);
      if (boxLines > MAX_BOX_LINES) {
        out.push({
          rule: "line.long",
          severity: "warn",
          subject: `quest:${q.id}/${stage.phase}`,
          message: `A ${line.speaker} line is ~${boxLines} box-lines (${rendered.length} chars) — may overflow the dialogue box`
        });
      }
    }
  }
}
