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

## Roadmap

These substrates feed a set of larger tools (built as front-ends, not from
scratch):

| Tool | Substrate it builds on |
| --- | --- |
| **GM Dashboard** — live world inspector + control panel | dev admin channel |
| **Content Doctor** — full graph explorer + lint UI | content graph |
| **World Doctor** — map reachability + portal QA | game adapter (`shared.ts`) |
| **Narrative Studio** — dialogue/quest flow authoring | content graph |
| **Economy Simulator** — progression/economy projection | content graph + `balance.ts` |
| **Session Replay** — record/scrub playtests | dev admin channel |
| **Visual Gallery** — auto-tour + golden diff | game adapter + admin |

## Layout

```
src/
  game/           boundary to the game repo (locate + adapter)
  content-graph/  substrate 1: model + checks
  admin/          substrate 2: protocol + connector
  cli/            smoke/utility CLIs (graph-report, admin-ping)
```
