import { startDashboard } from "../gm-dashboard/server.ts";

// Starts the GM Dashboard: a live world inspector + control panel served over
// plain HTTP (SSE for live state, POST for commands). Requires a game server in
// dev mode (TIB_DEV=1 or E2E_TEST=1) reachable at --game-url (default
// ws://127.0.0.1:8787).
//
//   npm run gm-dashboard
//   node src/cli/gm-dashboard.ts --port 7070 --game-url ws://127.0.0.1:8787

const argv = process.argv.slice(2);

const port = numFlag("--port");
const gameUrl = strFlag("--game-url");
const name = strFlag("--name");

try {
  const server = await startDashboard({ port, gameUrl, name });
  console.log(`GM Dashboard running at ${server.url}`);
  console.log("Connected to the game server; streaming world state. Ctrl-C to stop.");

  const shutdown = () => {
    console.log("\nShutting down GM Dashboard ...");
    server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  console.error(`gm-dashboard failed — ${(err as Error).message}`);
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
