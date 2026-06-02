import { startDashboard } from "../gm-dashboard/server.ts";
import { bold, cyan, dim, gray, green, red, wantsHelp } from "./format.ts";

// Starts the GM Dashboard: a live world inspector + control panel served over
// plain HTTP (SSE for live state, POST for commands, GET /meta for picker data).
// Requires a game server in dev mode (TIB_DEV=1 or E2E_TEST=1) reachable at
// --game-url (default ws://127.0.0.1:8787).
//
//   npm run gm
//   node src/cli/gm-dashboard.ts --port 7070 --game-url ws://127.0.0.1:8787

const argv = process.argv.slice(2);

if (wantsHelp(argv)) {
  console.log(`${bold("GM Dashboard")} — live world inspector + control panel

${dim("Usage")}
  node src/cli/gm-dashboard.ts [--port <n>] [--game-url <ws-url>] [--name <s>]

${dim("Flags")}
  --port      HTTP port to serve on            ${gray("(default 7070, env GM_PORT)")}
  --game-url  game server WebSocket URL         ${gray("(default ws://127.0.0.1:8787)")}
  --name      GM character name to join as      ${gray("(default gm_probe)")}

${dim("Note")} the game server must run in dev mode (${cyan("TIB_DEV=1")} or ${cyan("E2E_TEST=1")}).`);
  process.exit(0);
}

const port = numFlag("--port");
const gameUrl = strFlag("--game-url");
const name = strFlag("--name");

try {
  const server = await startDashboard({ port, gameUrl, name });
  console.log(`${green("●")} ${bold("GM Dashboard")} running at ${cyan(server.url)}`);
  console.log(gray("Connected to the game server; streaming world state. Ctrl-C to stop."));

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    console.log(gray("\nShutting down GM Dashboard …"));
    server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  console.error(`${red("✗")} gm-dashboard failed — ${(err as Error).message}`);
  process.exitCode = 1;
}

function strFlag(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function numFlag(flag: string): number | undefined {
  const raw = strFlag(flag);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
