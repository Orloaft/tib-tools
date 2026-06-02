import { analyzeWorld } from "../world-doctor/index.ts";
import type { Finding, Severity } from "../content-graph/index.ts";
import {
  bold,
  dim,
  cyan,
  gray,
  green,
  heading,
  rule,
  table,
  severityColor,
  SEVERITY_SYMBOL,
  wantsHelp
} from "./format.ts";
import { findingFloor } from "../world-doctor/locate.ts";

// World Doctor — map reachability + portal QA.
//
//   node src/cli/world-doctor.ts check   run all checks (exit 1 on errors)
//   node src/cli/world-doctor.ts atlas   write out/world-atlas.html

const ORDER: Severity[] = ["error", "warn", "info"];
const SEV_LABEL: Record<Severity, string> = { error: "ERROR", warn: "WARN", info: "INFO" };

const argv = process.argv.slice(2);
const sub = argv[0] && !argv[0].startsWith("-") ? argv[0] : "check";

if (wantsHelp(argv)) {
  printHelp();
} else if (sub === "check") {
  await runCheck();
} else if (sub === "atlas") {
  const outArg = argValue("--out");
  const { writeAtlas } = await import("../world-doctor/atlas.ts");
  const out = await writeAtlas(outArg);
  console.log(
    `${green("✓")} Wrote ${bold(out.path)} ${dim(`(${out.kib} KiB)`)} — ${out.floors} floors, ${out.findings} findings`
  );
} else {
  console.error(`Unknown subcommand "${sub}". Use: check | atlas  (try --help)`);
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(heading("TIB World Doctor"));
  console.log("Map-integrity QA: reachability flood-fill from START + portal/placement checks.\n");
  console.log(bold("Usage"));
  console.log("  node src/cli/world-doctor.ts <command> [options]\n");
  console.log(bold("Commands"));
  console.log(
    table(
      [],
      [
        ["check", "Run all checks and print findings (exit 1 on errors)."],
        ["atlas", "Write an interactive HTML atlas of the world."]
      ],
      { indent: 2 }
    )
  );
  console.log("\n" + bold("Options"));
  console.log(
    table(
      [],
      [
        [cyan("--floor <n>"), "check: only show findings on floor n."],
        [cyan("--severity <s>"), "check: only show error | warn | info findings."],
        [cyan("--out <path>"), "atlas: output path (default out/world-atlas.html)."],
        [cyan("-h, --help"), "Show this help."]
      ],
      { indent: 2 }
    )
  );
  console.log("\n" + bold("Examples"));
  console.log(dim("  node src/cli/world-doctor.ts check --severity error"));
  console.log(dim("  node src/cli/world-doctor.ts check --floor 6"));
  console.log(dim("  node src/cli/world-doctor.ts atlas --out out/atlas.html"));
}

async function runCheck(): Promise<void> {
  const { summary, findings } = await analyzeWorld();

  const floorFilter = parseFloorFilter();
  const sevFilter = parseSeverityFilter();

  // The summary always reflects the whole world; filters only narrow the list.
  const pct = summary.walkableTiles
    ? Math.round((summary.reachableTiles / summary.walkableTiles) * 1000) / 10
    : 100;

  console.log(heading("TIB World Doctor"));
  console.log(
    `${bold(String(summary.floors))} floors ${gray("·")} ` +
      `${bold(String(summary.portals))} portals ${gray("·")} ` +
      `${bold(reachColor(pct)(pct + "%"))} reachable ` +
      dim(`(${summary.reachableTiles.toLocaleString()}/${summary.walkableTiles.toLocaleString()} walkable tiles from START)`)
  );

  console.log(
    "\n" +
      table(
        ["severity", "count"],
        ORDER.map((s) => [
          severityColor(s)(`${SEVERITY_SYMBOL[s]} ${SEV_LABEL[s]}`),
          severityColor(s)(String(tally(findings, s)))
        ]),
        { alignRight: [1], indent: 2 }
      )
  );

  let shown = findings;
  if (floorFilter !== undefined) shown = shown.filter((f) => findingFloor(f) === floorFilter);
  if (sevFilter) shown = shown.filter((f) => f.severity === sevFilter);

  const activeFilters: string[] = [];
  if (floorFilter !== undefined) activeFilters.push(`floor ${floorFilter}`);
  if (sevFilter) activeFilters.push(`severity ${sevFilter}`);

  console.log("");
  if (findings.length === 0) {
    console.log(green("✓ No map-integrity issues found."));
    return;
  }
  if (activeFilters.length > 0) {
    console.log(dim(`Filtered by ${activeFilters.join(", ")} — ${shown.length} of ${findings.length} finding(s).\n`));
  }

  if (shown.length === 0) {
    console.log(dim("No findings match the filter."));
  } else {
    printGroupedByFloor(shown);
  }

  console.log(rule());
  console.log(
    `${severityColor("error")(summary.errors + " error(s)")}, ` +
      `${severityColor("warn")(summary.warnings + " warning(s)")}, ` +
      `${severityColor("info")(summary.infos + " info")}`
  );
  if (summary.errors > 0) process.exitCode = 1;
}

/** Group findings by floor (a "—" bucket for world-wide ones), then by severity. */
function printGroupedByFloor(findings: Finding[]): void {
  const byFloor = new Map<number | null, Finding[]>();
  for (const f of findings) {
    const fl = findingFloor(f);
    const key = fl === undefined ? null : fl;
    const list = byFloor.get(key);
    if (list) list.push(f);
    else byFloor.set(key, [f]);
  }

  const keys = [...byFloor.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  for (const key of keys) {
    const group = byFloor.get(key)!;
    const label = key === null ? "World-wide" : `Floor ${key}`;
    const counts = ORDER.map((s) => tally(group, s)).filter((n) => n > 0).reduce((a, b) => a + b, 0);
    console.log(cyan(bold(label)) + dim(`  (${counts} finding${counts === 1 ? "" : "s"})`));
    group.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
    for (const f of group) {
      const sev = severityColor(f.severity);
      console.log(
        `  ${sev(SEVERITY_SYMBOL[f.severity])} ${bold(f.subject)}  ${gray(`[${f.rule}]`)}`
      );
      console.log(`     ${dim(f.message)}`);
    }
    console.log("");
  }
}

function tally(findings: Finding[], sev: Severity): number {
  return findings.filter((f) => f.severity === sev).length;
}

function reachColor(pct: number): (s: string | number) => string {
  return pct >= 99 ? green : pct >= 90 ? cyan : (s) => s as string;
}

function parseFloorFilter(): number | undefined {
  const v = argValue("--floor");
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) {
    console.error(`Invalid --floor "${v}" — expected an integer.`);
    process.exit(2);
  }
  return n;
}

function parseSeverityFilter(): Severity | undefined {
  const v = argValue("--severity");
  if (v === undefined) return undefined;
  if (v !== "error" && v !== "warn" && v !== "info") {
    console.error(`Invalid --severity "${v}" — expected error | warn | info.`);
    process.exit(2);
  }
  return v;
}

function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
