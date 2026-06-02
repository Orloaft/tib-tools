import { connectAdmin } from "../admin/index.ts";
import type { StateSnapshot } from "@game/src/types.ts";

// Smoke CLI for the dev admin channel. Connects to a running game server,
// proves the read path (receives state) and the write path (spawns a monster
// and sees it appear), then disconnects. Requires the server in dev mode
// (TIB_DEV=1 or E2E_TEST=1).
//
//   npm run admin:ping
//   npm run admin:ping -- --url ws://127.0.0.1:8787 --name gm_probe

const argv = process.argv.slice(2);
const url = readFlag("--url") ?? undefined;
const name = readFlag("--name") ?? undefined;

// Snapshots are deltas — unchanged collections are omitted — so read defensively.
const len = (xs: unknown[] | undefined): number => xs?.length ?? 0;

console.log(`Connecting to ${url ?? "ws://127.0.0.1:8787"} ...`);

try {
  const admin = await connectAdmin({ url, name });
  console.log(`Connected. Player id: ${admin.id ?? "(none)"}`);

  const initial: StateSnapshot = await admin.waitForState(5000);
  console.log(`Read path OK — first snapshot (players ${len(initial.players)}, monsters ${len(initial.monsters)}).`);

  // Write path: spawn a monster next to the joiner (START is floor 0).
  console.log("Spawning a test wolf on floor 0 ...");
  admin.send({ kind: "spawnMonster", monster: "wolf", floor: 0, x: 55, y: 40 });

  let monsterSeen = false;
  for (let i = 0; i < 6 && !monsterSeen; i++) {
    const next = await admin.waitForState(5000);
    if (len(next.monsters) > 0) monsterSeen = true;
  }
  console.log(monsterSeen ? "Write path OK — spawned monster observed in a snapshot." : "Write path: no monster delta observed (check dev mode).");

  await admin.close();
  console.log(monsterSeen ? "Admin channel OK (read + write)." : "Admin channel connected, but write was not confirmed.");
  if (!monsterSeen) process.exitCode = 1;
} catch (err) {
  console.error(`admin:ping failed — ${(err as Error).message}`);
  process.exitCode = 1;
}

function readFlag(flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
}
