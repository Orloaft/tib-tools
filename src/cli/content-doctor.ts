import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeContent, loadModel } from "../content-graph/index.ts";
import type { Finding, GraphCounts, Severity } from "../content-graph/index.ts";
import { buildGraph } from "../content-doctor/graph.ts";
import type { GraphNode, NodeKind, ReferenceGraph } from "../content-doctor/graph.ts";
import { renderReport } from "../content-doctor/report.ts";
import {
  bold,
  cyan,
  dim,
  gray,
  green,
  heading,
  red,
  rule,
  SEVERITY_SYMBOL,
  severityColor,
  table,
  wantsHelp,
  yellow
} from "./format.ts";

// Content Doctor — the full graph explorer + lint front-end over the content
// graph substrate.
//
//   node src/cli/content-doctor.ts check                run all checks, exit 1 on error
//   node src/cli/content-doctor.ts list [kind]          browse entities by kind
//   node src/cli/content-doctor.ts refs <id|kind:id>    inbound + outbound references
//   node src/cli/content-doctor.ts report [--out path]  self-contained HTML explorer

const ORDER: Severity[] = ["error", "warn", "info"];
const SEV_LABEL: Record<Severity, string> = { error: "ERROR", warn: "WARN", info: "INFO" };

const [command, ...rest] = process.argv.slice(2);

if (wantsHelp(process.argv.slice(2)) && command !== "check" && command !== "refs" && command !== "list" && command !== "report") {
  usage();
} else {
  switch (command) {
    case "check":
      await cmdCheck();
      break;
    case "list":
      await cmdList(rest);
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
}

function usage(): void {
  console.log(heading("TIB Content Doctor"));
  console.log("Content QA over the live game content graph.\n");
  console.log(bold("Usage:") + dim("  content-doctor <command> [args]\n"));
  console.log(
    table(
      ["command", "what it does"],
      [
        [cyan("check"), "run every check; exit 1 if any errors"],
        [cyan("list [kind]"), "browse entities (e.g. " + dim("list monster") + ")"],
        [cyan("refs <id>"), "inbound + outbound references for an entity"],
        [cyan("report [--out P]"), "write self-contained HTML explorer"]
      ],
      { indent: 2 }
    )
  );
  console.log("");
  console.log(bold("Flags:"));
  console.log("  " + cyan("--out <path>") + dim("   report only — output file (default out/content-doctor.html)"));
  console.log("  " + cyan("-h, --help") + dim("     show this help"));
  console.log("");
  console.log(dim("refs accepts a bare id (`wolf`), a kind:id key (`item:potion`), or a"));
  console.log(dim("fuzzy fragment — it suggests close matches when nothing resolves."));
}

async function cmdCheck(): Promise<void> {
  if (wantsHelp(rest)) {
    console.log("check — run every referential-integrity / content check.");
    console.log(dim("Exits 1 when any error-severity finding is present (CI / pre-commit)."));
    return;
  }
  const analysis = await analyzeContent();
  printReport(analysis.findings, analysis.summary.counts);
  if (analysis.summary.errors > 0) process.exitCode = 1;
}

async function cmdList(args: string[]): Promise<void> {
  if (wantsHelp(args)) {
    console.log("list [kind] — browse entities, optionally filtered to one kind.");
    console.log(dim("Run without a kind to see the kind tally; pass a kind to list its ids."));
    return;
  }
  const model = await loadModel();
  const graph = buildGraph(model);
  const kinds = [...new Set([...graph.nodes.values()].map((n) => n.kind))].sort() as NodeKind[];
  const wanted = args[0]?.toLowerCase();

  if (!wanted) {
    console.log(heading("Entities by kind"));
    const rows = kinds.map((k) => [cyan(k), String(graph.byKind(k).length)]);
    console.log(table(["kind", "count"], rows, { alignRight: [1] }));
    console.log("");
    console.log(dim("Pass a kind to list its ids, e.g. ") + cyan("content-doctor list monster"));
    return;
  }

  if (!kinds.includes(wanted as NodeKind)) {
    console.error(red(`Unknown kind "${wanted}".`));
    console.error(dim("Known kinds: ") + kinds.map((k) => cyan(k)).join(", "));
    process.exitCode = 1;
    return;
  }

  const nodes = graph.byKind(wanted as NodeKind);
  console.log(heading(`${wanted} (${nodes.length})`));
  const rows = nodes.map((n) => {
    const out = graph.outbound(n.key).length;
    const inb = graph.inbound(n.key).length;
    return [n.id, n.label !== n.id ? dim(n.label) : dim("—"), gray(`${inb}↙ ${out}↗`)];
  });
  console.log(table(["id", "label", "refs"], rows, { indent: 2 }));
  console.log("");
  console.log(dim("refs columns: ↙ inbound · ↗ outbound. Inspect one with ") + cyan(`refs ${wanted}:${nodes[0]?.id ?? "<id>"}`));
}

async function cmdRefs(args: string[]): Promise<void> {
  if (wantsHelp(args)) {
    console.log("refs <id|kind:id> — show what an entity references and what references it.");
    console.log(dim("Accepts a fuzzy fragment and suggests matches when nothing resolves exactly."));
    return;
  }
  const target = args[0];
  if (!target) {
    console.error(red("refs: an entity id (or kind:id) is required") + dim(", e.g. `refs wolf` or `refs item:potion`."));
    process.exitCode = 1;
    return;
  }
  const model = await loadModel();
  const graph = buildGraph(model);
  const matches = graph.resolve(target);

  if (matches.length === 0) {
    console.error(red(`No entity matches "${target}".`));
    const suggestions = graph.suggest(target);
    if (suggestions.length > 0) {
      console.error(dim("Did you mean:"));
      for (const s of suggestions) {
        const label = s.label !== s.id ? dim(" — " + s.label) : "";
        console.error("  " + cyan(s.key) + label);
      }
      console.error(dim("\nTip: ") + cyan("content-doctor list <kind>") + dim(" to browse all ids of a kind."));
    }
    process.exitCode = 1;
    return;
  }

  matches.forEach((node, i) => {
    if (i > 0) console.log("");
    printNodeRefs(graph, node);
  });
}

function printNodeRefs(graph: ReferenceGraph, node: GraphNode): void {
  const label = node.label !== node.id ? dim(" — " + node.label) : "";
  console.log(bold(node.id) + label + "  " + gray(`(${node.kind})`));
  console.log(gray(`key ${node.key}`));

  const out = graph.outbound(node.key);
  const inb = graph.inbound(node.key);

  console.log("");
  console.log(cyan(`outbound (${out.length})`) + dim(` — what ${node.id} references`));
  if (out.length === 0) console.log(dim("  (none)"));
  for (const [lbl, edges] of groupByLabel(out, "to")) {
    console.log("  " + green("--" + lbl + "-->"));
    for (const e of edges) console.log("    " + describe(graph, e.to));
  }

  console.log("");
  console.log(yellow(`inbound (${inb.length})`) + dim(` — what references ${node.id}`));
  if (inb.length === 0) console.log(dim("  (none)"));
  for (const [lbl, edges] of groupByLabel(inb, "from")) {
    console.log("  " + green("<--" + lbl + "--"));
    for (const e of edges) console.log("    " + describe(graph, e.from));
  }
}

/** Group edges by their relationship label, collapsing duplicate endpoints. */
function groupByLabel(
  edges: ReturnType<ReferenceGraph["outbound"]>,
  endpoint: "to" | "from"
): Array<[string, Array<{ to: string; from: string; label: string }>]> {
  const byLabel = new Map<string, Map<string, { to: string; from: string; label: string }>>();
  for (const e of edges) {
    const inner = byLabel.get(e.label) ?? new Map();
    byLabel.set(e.label, inner);
    const key = e[endpoint];
    if (!inner.has(key)) inner.set(key, e);
  }
  return [...byLabel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lbl, m]) => [lbl, [...m.values()]] as [string, typeof edges]);
}

function describe(graph: ReferenceGraph, key: string): string {
  const node = graph.nodes.get(key);
  if (!node) return red(key) + dim(" (dangling)");
  return node.label !== node.id ? `${node.id} ${dim("(" + node.label + ")")}` : node.id;
}

async function cmdReport(args: string[]): Promise<void> {
  if (wantsHelp(args)) {
    console.log("report [--out PATH] — write the self-contained HTML explorer.");
    console.log(dim("Default path: out/content-doctor.html (gitignored). No external libs."));
    return;
  }
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : "out/content-doctor.html";
  const abs = resolve(process.cwd(), outPath);

  const [analysis, model] = await Promise.all([analyzeContent(), loadModel()]);
  const graph = buildGraph(model);
  const html = renderReport(analysis, graph);

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, html, "utf8");
  console.log(green("✓ ") + `Wrote ${bold(abs)} ${dim(`(${(html.length / 1024).toFixed(1)} KiB)`)}`);
  console.log(
    dim(`  ${graph.nodes.size} entities · ${graph.edges.length} references · ${analysis.findings.length} findings`)
  );
}

function printReport(findings: Finding[], counts: GraphCounts): void {
  console.log(heading("TIB Content Doctor"));

  // Counts as an aligned table (kind · count), wrapped a few per row for scan.
  const entries = Object.entries(counts);
  const perRow = 4;
  const rows: string[][] = [];
  for (let i = 0; i < entries.length; i += perRow) {
    const cells: string[] = [];
    for (const [k, v] of entries.slice(i, i + perRow)) cells.push(bold(String(v)) + " " + dim(k));
    rows.push(cells);
  }
  console.log(table([], rows, { indent: 0 }));
  console.log("");

  if (findings.length === 0) {
    console.log(green("✓ No issues found.") + dim("  Every reference resolves and nothing is unreachable."));
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
  const i = findings.filter((f) => f.severity === "info").length;
  console.log(rule(56));
  const parts = [
    (e ? red : gray)(`${e} error${e === 1 ? "" : "s"}`),
    (w ? yellow : gray)(`${w} warning${w === 1 ? "" : "s"}`),
    gray(`${i} info`)
  ];
  console.log(parts.join(dim("  ·  ")) + (e === 0 ? "  " + green("✓ no errors") : ""));
}
