import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeContent, loadModel } from "../content-graph/index.ts";
import type { Finding, GraphCounts, Severity } from "../content-graph/index.ts";
import { buildGraph } from "../content-doctor/graph.ts";
import { renderReport } from "../content-doctor/report.ts";

// Content Doctor — the full graph explorer + lint front-end over the content
// graph substrate.
//
//   node src/cli/content-doctor.ts check                run all checks, exit 1 on error
//   node src/cli/content-doctor.ts refs <entityId>      inbound + outbound references
//   node src/cli/content-doctor.ts report [--out path]  self-contained HTML explorer

const SYMBOL: Record<Severity, string> = { error: "✗", warn: "!", info: "·" };
const ORDER: Severity[] = ["error", "warn", "info"];

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "check":
    await cmdCheck();
    break;
  case "refs":
    await cmdRefs(rest);
    break;
  case "report":
    await cmdReport(rest);
    break;
  default:
    usage();
    process.exitCode = command ? 1 : 0;
}

function usage(): void {
  console.log("Content Doctor");
  console.log("Usage:");
  console.log("  content-doctor check                 run all checks, exit 1 on error");
  console.log("  content-doctor refs <entityId>       show inbound + outbound references");
  console.log("  content-doctor report [--out PATH]   write self-contained HTML explorer");
}

async function cmdCheck(): Promise<void> {
  const analysis = await analyzeContent();
  printReport(analysis.findings, analysis.summary.counts);
  if (analysis.summary.errors > 0) process.exitCode = 1;
}

async function cmdRefs(args: string[]): Promise<void> {
  const target = args[0];
  if (!target) {
    console.error("refs: an entity id (or kind:id) is required, e.g. `refs wolf` or `refs item:potion`.");
    process.exitCode = 1;
    return;
  }
  const model = await loadModel();
  const graph = buildGraph(model);
  const matches = graph.resolve(target);
  if (matches.length === 0) {
    console.error(`No entity matches "${target}".`);
    process.exitCode = 1;
    return;
  }
  for (const node of matches) {
    const label = node.label !== node.id ? ` — ${node.label}` : "";
    console.log(`${node.key}${label}`);
    const out = graph.outbound(node.key);
    const inb = graph.inbound(node.key);

    console.log(`  outbound (${out.length}) — what ${node.id} references:`);
    if (out.length === 0) console.log("    (none)");
    for (const e of out) console.log(`    --${e.label}--> ${describe(graph, e.to)}`);

    console.log(`  inbound (${inb.length}) — what references ${node.id}:`);
    if (inb.length === 0) console.log("    (none)");
    for (const e of inb) console.log(`    ${describe(graph, e.from)} --${e.label}-->`);
    console.log("");
  }
}

function describe(graph: ReturnType<typeof buildGraph>, key: string): string {
  const node = graph.nodes.get(key);
  if (!node) return key;
  return node.label !== node.id ? `${key} (${node.label})` : key;
}

async function cmdReport(args: string[]): Promise<void> {
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : "out/content-doctor.html";
  const abs = resolve(process.cwd(), outPath);

  const [analysis, model] = await Promise.all([analyzeContent(), loadModel()]);
  const graph = buildGraph(model);
  const html = renderReport(analysis, graph);

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, html, "utf8");
  console.log(`Wrote ${abs} (${(html.length / 1024).toFixed(1)} KiB)`);
  console.log(`  ${graph.nodes.size} entities, ${graph.edges.length} references, ${analysis.findings.length} findings`);
}

function printReport(findings: Finding[], counts: GraphCounts): void {
  console.log("TIB Content Doctor");
  console.log("─".repeat(56));
  console.log(
    Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join("  ·  ")
  );
  console.log("");

  if (findings.length === 0) {
    console.log("✓ No issues found.");
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
  const i = findings.filter((f) => f.severity === "info").length;
  console.log("─".repeat(56));
  console.log(`${e} error(s), ${w} warning(s), ${i} info`);
}
