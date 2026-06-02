import type { Catalog } from "../game/index.ts";
import { extractTokens } from "./tokens.ts";

/** Phases in the order the player meets them. `missingItems` is optional. */
export const PHASES = ["intro", "progress", "turnIn", "claimed", "missingItems"] as const;
export type Phase = (typeof PHASES)[number];
export const REQUIRED_PHASES: Phase[] = ["intro", "progress", "turnIn", "claimed"];

export interface LineModel {
  speaker: "npc" | "player";
  raw: string;
  tokens: string[];
}

export interface StageModel {
  phase: Phase;
  lines: LineModel[];
}

export interface QuestNarrative {
  id: string;
  title: string;
  kind: string;
  giverId: string;
  giverName: string;
  hasItem: boolean;
  itemLabel: string | null;
  targetCount: number;
  rewardGold: number;
  rewardXp: number;
  stages: StageModel[];
}

export interface NarrativeModel {
  quests: QuestNarrative[];
}

export function buildNarrative(catalog: Catalog): NarrativeModel {
  const npcName = new Map(catalog.NPCS.map((n) => [n.id, n.name]));

  const quests: QuestNarrative[] = Object.values(catalog.QUESTS).map((q) => {
    const stages: StageModel[] = [];
    for (const phase of PHASES) {
      const lines = q.dialogue?.[phase];
      if (!Array.isArray(lines)) continue; // missingItems often absent
      stages.push({
        phase,
        lines: lines.map((line) => {
          const speaker: "npc" | "player" = "npc" in line ? "npc" : "player";
          const raw = "npc" in line ? line.npc : line.player;
          return { speaker, raw, tokens: extractTokens(raw) };
        })
      });
    }

    return {
      id: q.id,
      title: q.title,
      kind: q.kind,
      giverId: q.giverId,
      giverName: npcName.get(q.giverId) ?? "(unknown NPC)",
      hasItem: Boolean(q.itemId),
      itemLabel: q.itemId ? catalog.ITEMS[q.itemId]?.label ?? q.itemId : null,
      targetCount: q.targetCount,
      rewardGold: q.rewardGold,
      rewardXp: q.rewardXp,
      stages
    };
  });

  return { quests };
}
