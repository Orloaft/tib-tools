import { analyzeWorld } from "../world-doctor/index.ts";
import type { Severity } from "../content-graph/index.ts";

// World Doctor — map reachability + portal QA.
//
//   node src/cli/world-doctor.ts check   run all checks (exit 1 on errors)
//   node src/cli/world-doctor.ts atlas   write out/world-atlas.html

const sub = process.argv[2] ?? "check";

const SYMBOL: Record<Severity, string> = { error: "✗", warn: "!", info: "·" };
const ORDER: Severity[] = ["error", "warn", "info"];

if (sub === "check") {
  await runCheck();
} else if (sub === "atlas") {
  const outArg = argValue("--out");
  const { writeAtlas } = await import("../world-doctor/atlas.ts");
  const out = await writeAtlas(outArg);
  console.log(`Wrote ${out.path} (${out.kib} KiB) — ${out.floors} floors, ${out.findings} findings`);
} else {
  console.error(`Unknown subcommand "${sub}". Use: check | atlas`);
  process.exitCode = 1;
}

async function runCheck(): Promise<void> {
  const { summary, findings } = await analyzeWorld();

  console.log("TIB World Doctor");
  console.log("─".repeat(60));
  console.log(
    `${summary.floors} floors  ·  ${summary.portals} portals  ·  ` +
      `${summary.reachableTiles}/${summary.walkableTiles} walkable tiles reachable from START`
  );
  console.log("");

  if (findings.length === 0) {
    console.log("✓ No map-integrity issues found.");
    return;
  }

  for (const severity of ORDER) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    console.log(`${SYMBOL[severity]} ${severity.toUpperCase()} (${group.length})`);
    for (const f of group) {
      console.log(`   ${f.subject}  [${f.rule}]`);
      console.log(`      ${f.message}`);
    }
    console.log("");
  }

  console.log("─".repeat(60));
  console.log(`${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} info`);
  if (summary.errors > 0) process.exitCode = 1;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
