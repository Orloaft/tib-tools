import type { QuestNarrative } from "./model.ts";

/** A double-quoted YAML scalar with the escapes the content files use. */
function yamlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Emit the `dialogue:` block for a quest in the authored content-file format, so
 * an edited script can be pasted back into content/quests/<id>.yaml. (The game
 * repo is read-only from here — this is copy/paste output, not a writer.)
 */
export function serializeDialogue(quest: QuestNarrative): string {
  const out: string[] = ["dialogue:"];
  for (const stage of quest.stages) {
    out.push(`  ${stage.phase}:`);
    for (const line of stage.lines) {
      out.push(`    - ${line.speaker}: ${yamlString(line.raw)}`);
    }
  }
  return out.join("\n") + "\n";
}
