import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeEconomy, analyzeSkillDetail, resolveOptions, type EconomyAnalysis, type EconomyOptions } from "../economy/index.ts";
import { loadCatalog, loadShared } from "../game/index.ts";
import { renderEconomyReport } from "../economy/report.ts";
import { bold, cyan, dim, gray, green, heading, red, rule, table, wantsHelp, yellow } from "./format.ts";

// Economy Simulator — project skill progression, combat leveling, and gold flow.
//
//   node src/cli/economy.ts                       human report
//   node src/cli/economy.ts --json                machine-readable
//   node src/cli/economy.ts --skill mining        per-skill level-by-level dive
//   node src/cli/economy.ts report [--out PATH]   self-contained HTML report

const argv = process.argv.slice(2);

if (wantsHelp(argv)) {
  printHelp();
  process.exit(0);
}

const opts = parseModelOptions(argv);
const sub = argv[0] && !argv[0].startsWith("-") ? argv[0] : undefined;

if (sub === "report") {
  await cmdReport();
} else {
  const skill = argValue("--skill");
  const a = await analyzeEconomy(opts);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(a, null, 2));
  } else if (skill) {
    await skillDive(skill, a);
  } else {
    report(a);
  }
}

// ── option parsing ───────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function parseModelOptions(args: string[]): EconomyOptions {
  const out: EconomyOptions = {};
  const eff = takeNum(args, "--efficiency");
  if (eff !== undefined) out.efficiency = eff;
  const max = takeNum(args, "--max-level");
  if (max !== undefined) out.maxLevel = max;
  const ms = argValue("--milestones");
  if (ms) {
    const parts = ms.split(",").map((p) => Number(p.trim()));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      out.milestones = [parts[0]!, parts[1]!, parts[2]!];
    }
  }
  return out;
}

function takeNum(args: string[], flag: string): number | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return undefined;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n)) {
    console.error(red(`${flag} expects a number, got "${args[i + 1]}".`));
    process.exit(1);
  }
  return n;
}

// ── formatting helpers ───────────────────────────────────────────────────────

function hrs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n <= 0) return "0";
  if (n < 1) return `${Math.round(n * 60) || "<1"}m`;
  return `${round1(n)}h`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function paramLine(a: EconomyAnalysis): string {
  const ms = a.params.milestones;
  return dim(
    `efficiency ${Math.round(a.params.efficiency * 100)}%  ·  level cap ${a.params.maxLevel}  ·  ` +
      `milestones L${ms.join("/L")}  ·  ${a.totalXpToCap.toLocaleString()} xp to cap`
  );
}

// ── reports ──────────────────────────────────────────────────────────────────

function report(a: EconomyAnalysis): void {
  const [m1, m2, m3] = a.params.milestones;
  console.log(bold(cyan("TIB Economy Simulator")));
  console.log(paramLine(a));
  console.log(dim(`Skill curve: 70·(L-1)^1.55 cumulative · gathering at ~${Math.round(a.params.efficiency * 100)}% efficiency`));
  console.log("");

  console.log(heading("Signals"));
  for (const s of a.signals) console.log(`  ${cyan("▸")} ${bold(s)}`);
  console.log("");

  // Skills
  console.log(heading("Skill progression"));
  console.log(dim(`  hours from level 1 · best method · ${Math.round(a.params.efficiency * 100)}% efficiency`));
  const skillRows = a.skills.map((s) => {
    const capped = Boolean(s.cappedAtLevel);
    const name = capped ? yellow(s.skill) : s.skill;
    const cols = [
      name,
      cell(hrs(s.hoursToMilestone[0]), capped),
      cell(hrs(s.hoursToMilestone[1]), capped),
      cell(hrs(s.hoursToMilestone[2]), capped),
      s.trainable ? green(s.xpPerHourAtCap.toLocaleString()) : dim("n/a"),
      capped ? yellow(`[capped ~L${s.cappedAtLevel}] `) + dim(s.bestMethodAtCap) : s.bestMethodAtCap
    ];
    return cols;
  });
  console.log(
    table([`skill`, `to ${m1}`, `to ${m2}`, `to ${m3}`, `xp/hr@cap`, `method`], skillRows, {
      alignRight: [1, 2, 3, 4],
      indent: 2
    })
  );
  console.log("");
  for (const s of a.skills) for (const note of s.notes) console.log(gray(`  · ${s.skill}: ${note}`));
  console.log("");

  // Combat
  console.log(heading("Combat / player leveling"));
  console.log(dim("  best survivable farm per checkpoint"));
  const dom = bestXpDominator(a);
  const combatRows = a.combat.perProfile.map((p) => [
    p.label,
    String(p.level),
    cyan(p.xpPerHour.toLocaleString()),
    p.bestXpMonster === dom ? yellow(p.bestXpMonster) : p.bestXpMonster,
    green(p.goldPerHour.toLocaleString()),
    p.bestGoldMonster
  ]);
  console.log(
    table(["checkpoint", "Lv", "xp/hr", "best xp farm", "gold/hr", "best gold farm"], combatRows, {
      alignRight: [1, 2, 4],
      indent: 2
    })
  );
  console.log("");
  console.log(dim("  Climb between checkpoints (player xp):"));
  for (const b of a.combat.bands) {
    console.log(
      `    ${b.fromLabel} (L${b.fromLevel}) → ${b.toLabel} (L${b.toLevel}): ${bold(hrs(b.hours))} at ${b.xpPerHour.toLocaleString()} xp/hr farming ${cyan(b.monster)}`
    );
  }
  console.log(`  ${dim("Total:")} ~${bold(hrs(a.combat.hoursToTop))} of combat from fresh to jungle-ready.`);
  console.log("");

  // Gold
  console.log(heading("Gold economy"));
  console.log(dim("  Faucets:"));
  for (const f of a.gold.faucets) {
    console.log(`    ${green("+")} ${f.label}: ${green(`${f.gold.toLocaleString()}${f.kind === "perHour" ? " g/hr" : " g"}`)}`);
  }
  console.log(dim("  Sinks:"));
  for (const s of a.gold.sinks) {
    const tag = s.kind === "perUse" ? " (per use)" : "";
    console.log(`    ${red("-")} ${s.label}: ${red(`${s.gold} g`)}${tag}${s.note ? gray(` — ${s.note}`) : ""}`);
  }
  console.log("");
  console.log(`  Starter kit (tools + first gear + map): ${bold(`${a.gold.starterKitCost} g`)}`);
  console.log(`  Quest gold available (one-time): ${bold(`${a.gold.questGoldTotal} g`)}`);
  console.log(
    `  Time to afford the kit by combat alone: ${bold(hrs(a.gold.hoursToAffordKit))} ` +
      `(or covered ${green(`${round1(a.gold.questGoldTotal / Math.max(1, a.gold.starterKitCost))}×`)} by quest gold)`
  );
  console.log(rule(72));
}

function cell(text: string, capped: boolean): string {
  if (text === "—") return dim(text);
  return capped ? yellow(text) : text;
}

function bestXpDominator(a: EconomyAnalysis): string | undefined {
  const counts = new Map<string, number>();
  for (const p of a.combat.perProfile) counts.set(p.bestXpMonster, (counts.get(p.bestXpMonster) ?? 0) + 1);
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  return top && top[1] >= 3 && top[0] !== "—" ? top[0] : undefined;
}

async function skillDive(skill: string, a: EconomyAnalysis): Promise<void> {
  const opt = resolveOptions(opts);
  const [shared, catalog] = await Promise.all([loadShared(), loadCatalog()]);
  const detail = analyzeSkillDetail(shared, catalog, opt, skill);
  if (!detail) {
    const names = a.skills.map((s) => s.skill).join(", ");
    console.error(red(`Unknown skill "${skill}". Try one of: ${names}`));
    process.exit(1);
  }

  console.log(bold(cyan(`Skill deep-dive — ${detail.skill}`)));
  console.log(paramLine(a));
  console.log("");
  if (!detail.trainable) {
    console.log(yellow(`  ${detail.skill} is content-capped at ~level ${detail.cappedAtLevel}: ${detail.bestMethodAtCap}.`));
    for (const note of detail.notes) console.log(gray(`  · ${note}`));
    return;
  }
  console.log(dim(`  best method at cap: ${detail.bestMethodAtCap}`));
  const rows = detail.bands.map((b) => [
    `L${b.level}`,
    cyan(b.xpPerHour.toLocaleString()),
    Number.isFinite(b.cumulativeHours) ? hrs(b.cumulativeHours) : dim("never")
  ]);
  console.log(table(["level", "xp/hr", "cumulative hrs"], rows, { alignRight: [1, 2], indent: 2 }));
  console.log("");
  for (const note of detail.notes) console.log(gray(`  · ${note}`));
}

async function cmdReport(): Promise<void> {
  const outPath = argValue("--out") ?? "out/economy.html";
  const abs = resolve(process.cwd(), outPath);
  const html = await renderEconomyReport(opts);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, html, "utf8");
  console.log(`Wrote ${abs} (${(html.length / 1024).toFixed(1)} KiB)`);
  const opt = resolveOptions(opts);
  console.log(dim(`  efficiency ${Math.round(opt.efficiency * 100)}% · level cap ${opt.maxLevel}`));
}

function printHelp(): void {
  console.log(bold(cyan("TIB Economy Simulator")));
  console.log(dim("Project skill progression, combat leveling, and the gold faucet/sink ledger."));
  console.log("");
  console.log(bold("Usage"));
  console.log("  node src/cli/economy.ts [options]            human report");
  console.log("  node src/cli/economy.ts --json [options]     machine-readable JSON");
  console.log("  node src/cli/economy.ts --skill <name>       per-skill level-by-level dive");
  console.log("  node src/cli/economy.ts report [--out PATH]  self-contained HTML report");
  console.log("");
  console.log(bold("Model parameters") + dim(" (tune the projection; defaults reproduce the canonical model)"));
  console.log(`  ${cyan("--efficiency <0..1>")}    fraction of wall-clock spent acting        ${dim("(default 0.7)")}`);
  console.log(`  ${cyan("--max-level <n>")}        level cap the projection targets           ${dim("(default 60)")}`);
  console.log(`  ${cyan("--milestones a,b,c")}     skill time-to-level milestone columns      ${dim("(default 10,30,50)")}`);
  console.log("");
  console.log(bold("Other flags"));
  console.log(`  ${cyan("--skill <name>")}         deep-dive one skill (mining, woodcutting, fishing, …)`);
  console.log(`  ${cyan("--out <path>")}           output path for the HTML report            ${dim("(report only)")}`);
  console.log(`  ${cyan("--json")}                 emit the full analysis as JSON`);
  console.log(`  ${cyan("--help, -h")}             show this help`);
  console.log("");
  console.log(bold("Examples"));
  console.log(dim("  node src/cli/economy.ts --efficiency 0.5 --max-level 99"));
  console.log(dim("  node src/cli/economy.ts --skill mining --max-level 99"));
  console.log(dim("  node src/cli/economy.ts report --out out/economy.html"));
}
