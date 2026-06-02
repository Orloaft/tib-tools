import { analyzeContent } from "../content-graph/index.ts";
import type { Finding, GraphCounts, Severity } from "../content-graph/index.ts";

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

const SYMBOL: Record<Severity, string> = { error: "✗", warn: "!", info: "·" };
const ORDER: Severity[] = ["error", "warn", "info"];

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
  console.log("TIB content graph");
  console.log("─".repeat(48));
  const countLine = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join("  ·  ");
  console.log(countLine);
  console.log("");

  if (findings.length === 0) {
    console.log("✓ No referential-integrity issues found.");
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

  const e = findings.filter((f) => f.severity === "error").length;
  const w = findings.filter((f) => f.severity === "warn").length;
  console.log("─".repeat(48));
  console.log(`${e} error(s), ${w} warning(s)`);
}
