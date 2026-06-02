import { analyzeNarrative, buildContext, renderLine, serializeDialogue } from "../narrative/index.ts";
import type { QuestNarrative } from "../narrative/index.ts";
import type { Finding, Severity } from "../content-graph/index.ts";
import { bold, cyan, dim, gray, green, heading, rule, severityColor, SEVERITY_SYMBOL, table, wantsHelp, yellow } from "./format.ts";

// Narrative Studio — quest dialogue lint, preview, and an HTML authoring studio.
//
//   node src/cli/narrative.ts lint                 lint all quest dialogue (exit 1 on errors)
//   node src/cli/narrative.ts preview <questId>    render a quest's dialogue in the terminal
//   node src/cli/narrative.ts yaml <questId>       print the dialogue YAML block
//   node src/cli/narrative.ts studio [--out PATH]  write out/narrative.html

const argv = process.argv.slice(2);
const sub = argv[0] && !argv[0].startsWith("-") ? argv[0] : "lint";
const ORDER: Severity[] = ["error", "warn", "info"];

if (wantsHelp(argv)) {
  printHelp();
} else if (sub === "lint") {
  await cmdLint();
} else if (sub === "preview") {
  await cmdPreview(argv[1]);
} else if (sub === "yaml") {
  await cmdYaml(argv[1]);
} else if (sub === "studio") {
  const { writeStudio } = await import("../narrative/studio.ts");
  const out = await writeStudio(argValue("--out"));
  console.log(`${green("✓")} Wrote ${bold(out.path)} ${dim(`(${out.kib} KiB)`)} — ${out.quests} quests, ${out.findings} findings`);
} else {
  console.error(`Unknown subcommand "${sub}". Use: lint | preview | yaml | studio  (try --help)`);
  process.exitCode = 1;
}

function ctxFor(q: QuestNarrative, progress: number): Record<string, unknown> {
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

async function cmdLint(): Promise<void> {
  const { summary, findings } = await analyzeNarrative();

  console.log(heading("TIB Narrative Studio"));
  console.log(`${bold(String(summary.quests))} quests ${gray("·")} ${bold(String(summary.lines))} dialogue lines\n`);
  console.log(
    table(
      ["severity", "count"],
      ORDER.map((s) => [severityColor(s)(`${SEVERITY_SYMBOL[s]} ${s.toUpperCase()}`), severityColor(s)(String(tally(findings, s)))]),
      { alignRight: [1], indent: 2 }
    )
  );
  console.log("");

  if (findings.length === 0) {
    console.log(green("✓ No dialogue issues found."));
    return;
  }

  // Group by quest for readability.
  const byQuest = new Map<string, Finding[]>();
  for (const f of findings) {
    const quest = f.subject.split("/")[0]!;
    (byQuest.get(quest) ?? byQuest.set(quest, []).get(quest)!).push(f);
  }
  for (const [quest, group] of byQuest) {
    console.log(cyan(bold(quest)));
    group.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
    for (const f of group) {
      const stage = f.subject.includes("/") ? gray(` (${f.subject.split("/")[1]})`) : "";
      console.log(`  ${severityColor(f.severity)(SEVERITY_SYMBOL[f.severity])} ${f.message}${stage} ${gray(`[${f.rule}]`)}`);
    }
    console.log("");
  }

  console.log(rule());
  console.log(
    `${severityColor("error")(summary.errors + " error(s)")}, ${severityColor("warn")(summary.warnings + " warning(s)")}`
  );
  if (summary.errors > 0) process.exitCode = 1;
}

async function cmdPreview(id: string | undefined): Promise<void> {
  const quest = await findQuest(id);
  if (!quest) return;

  console.log(heading(quest.title));
  console.log(
    `${dim("id")} ${quest.id} ${gray("·")} ${dim("kind")} ${quest.kind} ${gray("·")} ${dim("giver")} ${quest.giverName} ` +
      `${gray("·")} ${dim("target")} ${quest.targetCount}${quest.hasItem ? ` ${quest.itemLabel}` : ""}\n`
  );

  for (const stage of quest.stages) {
    const progress = stage.phase === "progress" ? Math.max(1, Math.floor(quest.targetCount / 2)) : 0;
    const ctx = ctxFor(quest, progress);
    const note = stage.phase === "progress" ? gray(` (progress ${progress}/${quest.targetCount})`) : "";
    console.log(`${yellow("──")} ${bold(stage.phase)}${note} ${yellow("──")}`);
    for (const line of stage.lines) {
      const who = line.speaker === "npc" ? yellow(`❬${quest.giverName}❭`) : cyan("❬Wanderer❭");
      console.log(`  ${who} ${renderLine(line.raw, ctx)}`);
    }
    console.log("");
  }
}

async function cmdYaml(id: string | undefined): Promise<void> {
  const quest = await findQuest(id);
  if (!quest) return;
  process.stdout.write(serializeDialogue(quest));
}

async function findQuest(id: string | undefined): Promise<QuestNarrative | null> {
  const { model } = await analyzeNarrative();
  if (!id) {
    console.error("Usage: narrative <preview|yaml> <questId>");
    console.error(dim(`Quests: ${model.quests.map((q) => q.id).join(", ")}`));
    process.exitCode = 1;
    return null;
  }
  const quest = model.quests.find((q) => q.id === id);
  if (!quest) {
    console.error(`No quest "${id}".`);
    console.error(dim(`Quests: ${model.quests.map((q) => q.id).join(", ")}`));
    process.exitCode = 1;
    return null;
  }
  return quest;
}

function tally(findings: Finding[], sev: Severity): number {
  return findings.filter((f) => f.severity === sev).length;
}

function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function printHelp(): void {
  console.log(heading("TIB Narrative Studio"));
  console.log("Quest dialogue lint, terminal preview, and an HTML authoring studio.\n");
  console.log(bold("Commands"));
  console.log(
    table(
      [],
      [
        ["lint", "Lint all quest dialogue (tokens, length, structure); exit 1 on errors."],
        ["preview <id>", "Render a quest's dialogue in the terminal with tokens resolved."],
        ["yaml <id>", "Print the quest's dialogue YAML block (copy back into the game)."],
        ["studio", "Write an interactive HTML studio (preview + edit + export)."]
      ],
      { indent: 2 }
    )
  );
  console.log("\n" + bold("Options"));
  console.log(`  ${cyan("--out <path>")}  studio: output path (default out/narrative.html).`);
  console.log(`  ${cyan("-h, --help")}    Show this help.`);
}
