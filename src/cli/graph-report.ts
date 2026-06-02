import { analyzeContent } from "../content-graph/index.ts";
import type { Finding, GraphCounts, Severity } from "../content-graph/index.ts";
import { bold, dim, gray, green, heading, red, rule, SEVERITY_SYMBOL, severityColor, table, yellow } from "./format.ts";

// Smoke/utility CLI for the content-graph substrate. Loads the live game
// content, builds the cross-file model, runs the integrity checks, and prints a
// report. With --check it exits non-zero on any error (CI / pre-commit use).
//
//   npm run graph          human report
//   npm run graph:check    exit 1 if any errors
//   npm run graph:json     machine-readable

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const checkMode = args.has("--check");

const ORDER: Severity[] = ["error", "warn", "info"];
const SEV_LABEL: Record<Severity, string> = { error: "ERROR", warn: "WARN", info: "INFO" };

const analysis = await analyzeContent();

if (asJson) {
  console.log(JSON.stringify(analysis, null, 2));
} else {
  printReport(analysis.findings, analysis.summary.counts);
}

if (checkMode && analysis.summary.errors > 0) {
  process.exitCode = 1;
}

function printReport(findings: Finding[], counts: GraphCounts): void {
  console.log(heading("TIB content graph"));

  const entries = Object.entries(counts);
  const perRow = 4;
  const rows: string[][] = [];
  for (let i = 0; i < entries.length; i += perRow) {
    const cells: string[] = [];
    for (const [k, v] of entries.slice(i, i + perRow)) cells.push(bold(String(v)) + " " + dim(k));
    rows.push(cells);
  }
  console.log(table([], rows));
  console.log("");

  if (findings.length === 0) {
    console.log(green("✓ No referential-integrity issues found."));
    return;
  }

  for (const severity of ORDER) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    const color = severityColor(severity);
    console.log(color(`${SEVERITY_SYMBOL[severity]} ${SEV_LABEL[severity]} (${group.length})`));
    for (const f of group) {
      console.log("   " + bold(f.subject) + "  " + gray(`[${f.rule}]`));
      console.log("      " + dim(f.message));
    }
    console.log("");
  }

  const e = findings.filter((f) => f.severity === "error").length;
  const w = findings.filter((f) => f.severity === "warn").length;
  console.log(rule(48));
  console.log((e ? red : gray)(`${e} error(s)`) + dim("  ·  ") + (w ? yellow : gray)(`${w} warning(s)`));
}
