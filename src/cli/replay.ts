import { recordSession } from "../replay/record.ts";
import { writeReplayViewer } from "../replay/viewer.ts";
import { bold, cyan, dim, gray, green, heading, table, wantsHelp } from "./format.ts";

// Session Replay — record a live session through the admin channel and scrub it.
//
//   node src/cli/replay.ts record [--seconds N] [--out path] [--url URL] [--name N]
//   node src/cli/replay.ts view <recording.jsonl> [--out out/replay.html]

const argv = process.argv.slice(2);
const sub = argv[0] && !argv[0].startsWith("-") ? argv[0] : undefined;

if (wantsHelp(argv) || !sub) {
  printHelp();
} else if (sub === "record") {
  await cmdRecord();
} else if (sub === "view") {
  await cmdView(argv[1]);
} else {
  console.error(`Unknown subcommand "${sub}". Use: record | view  (try --help)`);
  process.exitCode = 1;
}

async function cmdRecord(): Promise<void> {
  const url = argValue("--url");
  const seconds = numValue("--seconds");
  console.log(heading("TIB Session Replay — recording"));
  console.log(dim(`source ${url ?? "ws://127.0.0.1:8787"}${seconds ? ` · ${seconds}s` : " · until Ctrl-C"}`));
  console.log(dim("(requires the game server in dev mode: E2E_TEST=1 or TIB_DEV=1)\n"));

  const { done, stop } = recordSession({
    url,
    seconds,
    out: argValue("--out"),
    name: argValue("--name"),
    onTick: (s, frames) => process.stdout.write(`\r${cyan("●")} recording ${bold(`${s}s`)} ${gray("·")} ${frames} frames   `)
  });

  let stopped = false;
  const onSig = (): void => {
    if (stopped) return;
    stopped = true;
    process.stdout.write("\n" + dim("stopping…\n"));
    stop();
  };
  process.on("SIGINT", onSig);

  const result = await done;
  process.removeListener("SIGINT", onSig);
  console.log(`\n${green("✓")} Wrote ${bold(result.path)} — ${result.frames} frames over ${Math.round(result.durationMs / 100) / 10}s`);
  console.log(dim(`  View it: node src/cli/replay.ts view ${result.path}`));
}

async function cmdView(file: string | undefined): Promise<void> {
  if (!file) {
    console.error("Usage: replay view <recording.jsonl> [--out out/replay.html]");
    process.exitCode = 1;
    return;
  }
  const result = await writeReplayViewer(file, argValue("--out"));
  console.log(`${green("✓")} Wrote ${bold(result.path)} ${dim(`(${result.kib} KiB)`)} — ${result.frames} frames, ${result.durationSec}s`);
}

function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
function numValue(flag: string): number | undefined {
  const v = argValue(flag);
  return v === undefined ? undefined : Number(v);
}

function printHelp(): void {
  console.log(heading("TIB Session Replay"));
  console.log("Record a live game session through the admin channel, then scrub it in the browser.\n");
  console.log(bold("Commands"));
  console.log(
    table(
      [],
      [
        ["record", "Capture live world state to a JSONL recording (needs a dev-mode server)."],
        ["view <file>", "Build a scrubbable HTML timeline from a recording."]
      ],
      { indent: 2 }
    )
  );
  console.log("\n" + bold("Options"));
  console.log(
    table(
      [],
      [
        [cyan("--seconds <n>"), "record: stop after n seconds (default: until Ctrl-C)."],
        [cyan("--out <path>"), "record/view: output path."],
        [cyan("--url <ws>"), "record: game server URL (default ws://127.0.0.1:8787)."],
        [cyan("--name <n>"), "record: GM character name (default gm_replay)."],
        [cyan("-h, --help"), "Show this help."]
      ],
      { indent: 2 }
    )
  );
}
