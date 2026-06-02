import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { runTour, diffShots, buildGallery, summarize, tourTargets, type GalleryEntry } from "../gallery/index.ts";
import { bold, cyan, dim, green, heading, red, table, wantsHelp, yellow } from "./format.ts";

// Visual Gallery — auto-tour every zone in the live client, screenshot it, and
// diff against a blessed baseline.
//
//   node src/cli/gallery.ts tour [--running]   tour + diff + build the gallery
//   node src/cli/gallery.ts accept [--label z] bless current shots as the baseline
//   node src/cli/gallery.ts report             re-diff existing shots + rebuild html

const GAL = resolve("out/gallery");
const SHOTS = join(GAL, "shots");
const GOLDEN = join(GAL, "golden");
const DIFFS = join(GAL, "diffs");

const argv = process.argv.slice(2);
const sub = argv[0] && !argv[0].startsWith("-") ? argv[0] : undefined;

if (wantsHelp(argv) || !sub) {
  printHelp();
} else if (sub === "tour") {
  await cmdTour();
} else if (sub === "accept") {
  cmdAccept();
} else if (sub === "report") {
  await cmdReport();
} else {
  console.error(`Unknown subcommand "${sub}". Use: tour | accept | report  (try --help)`);
  process.exitCode = 1;
}

async function cmdTour(): Promise<void> {
  console.log(heading("TIB Visual Gallery — tour"));
  console.log(dim(argv.includes("--running") ? "using the running e2e game" : "starting an e2e game (vite + server)…") + "\n");
  const { shots } = await runTour({
    outDir: SHOTS,
    running: argv.includes("--running"),
    onStep: (i, total, t) => process.stdout.write(`\r${cyan("●")} ${i}/${total} ${bold(t.title)}        `)
  });
  process.stdout.write("\n\n");
  await diffAndBuild(shots.map((s) => ({ label: s.label, title: s.title, floor: s.floor })));
}

async function cmdReport(): Promise<void> {
  if (!existsSync(SHOTS)) {
    console.error("No shots yet — run `gallery tour` first.");
    process.exitCode = 1;
    return;
  }
  const labels = readdirSync(SHOTS).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
  const meta = new Map((await tourTargets()).map((t) => [t.label, t]));
  console.log(heading("TIB Visual Gallery — report"));
  await diffAndBuild(labels.map((label) => ({ label, title: meta.get(label)?.title ?? label, floor: meta.get(label)?.floor ?? 0 })));
}

async function diffAndBuild(items: Array<{ label: string; title: string; floor: number }>): Promise<void> {
  mkdirSync(DIFFS, { recursive: true });
  const entries: GalleryEntry[] = [];
  for (const it of items) {
    const shotPath = join(SHOTS, `${it.label}.png`);
    const goldenPath = join(GOLDEN, `${it.label}.png`);
    const hasGolden = existsSync(goldenPath);
    const diffPath = join(DIFFS, `${it.label}.png`);
    const result = await diffShots(shotPath, hasGolden ? goldenPath : null, diffPath);
    const hasDiff = result.status === "ok" || result.status === "changed";
    entries.push({
      label: it.label,
      title: it.title,
      floor: it.floor,
      shot: `shots/${it.label}.png`,
      golden: hasGolden ? `golden/${it.label}.png` : null,
      diff: hasDiff ? `diffs/${it.label}.png` : null,
      result
    });
  }

  const out = await buildGallery(GAL, entries);
  const s = summarize(entries);
  console.log(
    table(
      ["", "count"],
      [
        [green("unchanged"), String(s.ok)],
        [yellow("changed"), String(s.changed)],
        [red("size-changed"), String(s.size)],
        [cyan("new (no golden)"), String(s.added)]
      ],
      { alignRight: [1], indent: 2 }
    )
  );
  console.log(`\n${green("✓")} Wrote ${bold(out)} ${dim(`(${s.total} zones)`)}`);
  if (s.added > 0) console.log(dim("  First run? Review the shots, then `gallery accept` to set the baseline."));
}

function cmdAccept(): void {
  if (!existsSync(SHOTS)) {
    console.error("No shots to accept — run `gallery tour` first.");
    process.exitCode = 1;
    return;
  }
  mkdirSync(GOLDEN, { recursive: true });
  const only = argValue("--label");
  const files = readdirSync(SHOTS).filter((f) => f.endsWith(".png") && (!only || f === `${only}.png`));
  for (const f of files) copyFileSync(join(SHOTS, f), join(GOLDEN, f));
  console.log(`${green("✓")} Blessed ${bold(String(files.length))} shot(s) as the baseline${only ? ` (${only})` : ""}.`);
}

function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function printHelp(): void {
  console.log(heading("TIB Visual Gallery"));
  console.log("Auto-tour every zone in the live client, screenshot it, and diff vs a baseline.\n");
  console.log(bold("Commands"));
  console.log(
    table(
      [],
      [
        ["tour", "Drive the game through every zone, screenshot, diff, build the gallery."],
        ["accept", "Copy current shots to the golden baseline (bless them)."],
        ["report", "Re-diff existing shots against the baseline and rebuild the gallery."]
      ],
      { indent: 2 }
    )
  );
  console.log("\n" + bold("Options"));
  console.log(`  ${cyan("--running")}      tour: use an already-running e2e game instead of starting one.`);
  console.log(`  ${cyan("--label <id>")}   accept: bless only one zone.`);
  console.log(`  ${cyan("-h, --help")}     Show this help.`);
  console.log("\n" + dim("Output under out/gallery/ (shots, golden, diffs, index.html) — all local/gitignored."));
}
