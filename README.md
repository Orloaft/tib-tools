# tib-tools

Standalone developer tooling for the **TIB** game, kept in its own repo so the
game repo stays lean. Nothing here ships in the game build — these are
author-time and debug-time tools.

The tools read the game's **live source** (content, map logic, server protocol)
through a thin adapter, so they always reflect the current game with zero
duplicated data or types.

## How it reaches the game

The game repo is read as a **sibling** on disk. Resolution order:

1. `$TIB_GAME_DIR`, if set.
2. `../tib` relative to this repo (the default checkout layout).

```
/mnt/nxt-dev/
  ├─ tib/         ← the game
  └─ tib-tools/   ← this repo
```

All coupling lives in [`src/game/`](src/game): `locate.ts` finds the repo,
`adapter.ts` dynamic-imports the game's `catalog.ts` and `shared.ts` (building
content first if needed). Type reuse goes through the `@game/*` tsconfig alias,
so the tools use the game's **real** types — no shape duplication.

## Setup

```bash
npm install
npm run typecheck
```

Type-checking assumes the game is at `../tib`. Runtime honours `TIB_GAME_DIR`.

## What's here today

This repo starts with the two **shared substrates** the larger tools build on.

### 1. Content graph (`src/content-graph/`)

Builds a cross-file model from the game's content and runs
referential-integrity checks that per-file schema validation can't see — a
reference in one content file pointing at something (un)defined in another.

```bash
npm run graph         # human-readable report
npm run graph:check   # exit 1 on any error (CI / pre-commit)
npm run graph:json    # machine-readable
```

Catches, e.g.: spawns of unknown monsters, quests with missing givers/targets/
items, mining nodes with unknown ore kinds, tree types dropping unknown items,
and monsters that can never be encountered (no spawn, no quest).

### 2. Dev admin channel (`src/admin/`)

A typed WebSocket connector to a running game server, mapping high-level GM
commands (spawn, teleport, grant, `/dev`, emit events, respawn) onto dev hooks
the server already accepts. Uses Node's built-in `WebSocket` — no dependencies.

```bash
# Run the game server in dev mode first: TIB_DEV=1 node server/index.ts
npm run admin:ping
```

> Admin commands require the server in dev mode (`TIB_DEV=1` or `E2E_TEST=1`).

## Tools

### Content Doctor (`src/content-doctor/`, on the content graph)

The full content QA tool: the extended check set, a queryable reference graph,
and a self-contained HTML explorer.

```bash
npm run doctor                 # run every check, exit 1 on errors
npm run doctor:refs -- wolf    # inbound + outbound references for any entity
npm run doctor:report          # write out/content-doctor.html (gitignored)
```

Adds checks the substrate didn't have: unobtainable items (granted by no
source), shop/drop/quest item refs, orphan abilities, empty zones, duplicate
ids. The HTML report is a searchable 3-pane explorer (entities · references ·
findings) with no external libraries.

### GM Dashboard (`src/gm-dashboard/`, on the dev admin channel)

A live web panel to watch and control a running game: entity counts and
per-floor lists, a canvas minimap, and controls (spawn, teleport, grant, `/dev`,
emit events, respawn).

```bash
# 1. game server in dev mode (from ../tib):  E2E_TEST=1 node server/index.ts
# 2. dashboard:
npm run gm                     # serves http://127.0.0.1:7070  (GM_PORT to change)
```

The dashboard server holds one admin connection, merges the server's delta
snapshots into a full world model, and bridges the browser with zero deps:
Server-Sent Events (`GET /events`) for live state and `POST /command` for
control.

### World Doctor (`src/world-doctor/`, on the game adapter)

Map-integrity QA. Loads every floor's tiles, flood-fills reachability from
START across walking + portals, and checks the world holds together.

```bash
npm run world          # run all checks, exit 1 on errors
npm run world:atlas    # write out/world-atlas.html (interactive map)
```

Checks: portals whose landing is blocked or leads to a missing floor;
walkable areas sealed off from START (with the content stranded inside);
spawns/resource-nodes/NPCs/trees on blocked or unreachable tiles; one-way
portals. The reachability model matches the engine's collision exactly
(orthogonal moves, 0.56-tile footprint) and accounts for the key-gated Jungle
Vault transport, so warnings are real, not artifacts. The atlas colours each
floor by reachable / unreachable / safe / road / blocked / portal with entity
dots — the sealed regions show up at a glance.

## Roadmap

These substrates feed a set of larger tools (built as front-ends, not from
scratch):

| Tool | Substrate it builds on | Status |
| --- | --- | --- |
| **Content Doctor** — graph explorer + lint | content graph | ✅ built |
| **GM Dashboard** — live world inspector + control | dev admin channel | ✅ built |
| **World Doctor** — map reachability + portal QA | game adapter (`shared.ts`) | ✅ built |
| **Narrative Studio** — dialogue/quest flow authoring | content graph | planned |
| **Economy Simulator** — progression/economy projection | content graph + `balance.ts` | planned |
| **Session Replay** — record/scrub playtests | dev admin channel | planned |
| **Visual Gallery** — auto-tour + golden diff | game adapter + admin | planned |

## Layout

```
src/
  game/           boundary to the game repo (locate + adapter)
  content-graph/  substrate 1: model + checks (base + extended)
  content-doctor/ Content Doctor: grants model, reference graph, HTML report
  admin/          substrate 2: protocol, connector, world delta-merge
  gm-dashboard/   GM Dashboard: SSE server + vanilla-JS frontend
  world-doctor/   World Doctor: floors, portals, reachability, checks, atlas
  cli/            CLIs (graph-report, content-doctor, admin-ping, gm-dashboard, world-doctor)
```
