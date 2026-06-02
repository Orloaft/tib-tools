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
npm run doctor:list -- monster # browse entities by kind (discover ids)
npm run doctor:refs -- wolf    # inbound + outbound refs (fuzzy id + "did you mean")
npm run doctor:report          # write out/content-doctor.html (gitignored)
```

Adds checks the substrate didn't have: unobtainable items (granted by no
source), shop/drop/quest item refs, orphan abilities, empty zones, duplicate
ids. The CLIs are coloured (severity-aware, auto-off when piped) with `--help`.
The HTML report is a searchable 3-pane explorer — clickable stat header,
per-kind/severity filter chips, an inline reference node-diagram for the
selected entity, finding↔entity links, keyboard nav, and `#hash` deep-links —
all in one self-contained file with no external libraries.

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
Server-Sent Events (`GET /events`) for live state, `POST /command` for control,
and `GET /meta` to populate the spawn/grant pickers from the real catalog.
Click an entity to inspect its full stats, click a tile for context actions
(teleport/spawn here), watch the live event feed, and follow a player on the
minimap. It shows a live/reconnecting status badge and survives a game restart
(both the admin link and the browser SSE auto-reconnect).

### World Doctor (`src/world-doctor/`, on the game adapter)

Map-integrity QA. Loads every floor's tiles, flood-fills reachability from
START across walking + portals, and checks the world holds together.

```bash
npm run world                      # all checks, grouped by floor, exit 1 on errors
npm run world -- --severity error  # filter by severity; also --floor <n>
npm run world:atlas                # write out/world-atlas.html (interactive map)
```

Checks: portals whose landing is blocked or leads to a missing floor;
walkable areas sealed off from START (with the content stranded inside);
spawns/resource-nodes/NPCs/trees on blocked or unreachable tiles; one-way
portals. The reachability model matches the engine's collision exactly
(orthogonal moves, 0.56-tile footprint) and accounts for the key-gated Jungle
Vault transport, so warnings are real, not artifacts. The atlas colours each
floor by reachable / unreachable / safe / road / blocked / portal with entity
dots; click a finding to fly to and pulse its exact tile, zoom/pan the map,
hover a portal for its destination, and step through issues with next/prev.

### Economy Simulator (`src/economy/`, on the content graph + `balance.ts`)

Turns the static balance numbers into a progression projection: time-to-level
per skill, combat leveling by checkpoint, and the gold faucet/sink ledger.

```bash
npm run economy                              # coloured report (signals + tables)
npm run economy -- --skill mining            # per-skill level-by-level dive
npm run economy -- --efficiency 0.5 --max-level 99   # tune the model
npm run economy:report                       # write out/economy.html (charts)
npm run economy:json                         # machine-readable
```

Reads every XP source and cost live from the catalog; the few server-private
action timings (swing speeds, smithing recipes) are mirrored in `rates.ts` with
a keep-in-sync note. It leads with **signals** — e.g. the skill curve is shallow
(everything maxes in minutes-to-hours), smithing is content-capped at ~level 4
(only 6 forges exist), one monster is the universal best XP farm, and quest gold
covers the starter kit several times over. The model parameters (action
efficiency, level cap, milestones) are exposed as flags and echoed in the
report. The HTML report adds hand-drawn charts: the XP curve, per-skill
time-to-level bars, combat xp/gold by checkpoint, and the gold ledger.

### Narrative Studio (`src/narrative/`, on the content graph)

Quest-dialogue QA + authoring. Lints every quest's dialogue, previews it in a
faithful in-game dialogue box, and exports edited YAML.

```bash
npm run narrative                         # lint all quest dialogue (exit 1 on errors)
npm run narrative -- preview southgate    # render a quest's dialogue in the terminal
npm run narrative -- yaml southgate       # print the dialogue YAML block
npm run narrative:studio                  # write out/narrative.html
```

The lint mirrors the server's token resolver exactly, so it catches dialogue
that would render broken in-game: unknown/object tokens (render as literal
braces / `[object Object]`), `{target.item.label}` on a quest with no reward
item, `{progress}` outside the progress stage, lines too long for the box, and
missing stages. The HTML studio is a writer's tool: pick a quest, click through
the real dialogue box (gold nameplate, token resolution, a progress slider for
the progress stage), switch to edit mode for live editing with colour-coded
token validation and live re-lint, then **Export YAML** to paste back into the
game (the game repo stays read-only).

## Roadmap

These substrates feed a set of larger tools (built as front-ends, not from
scratch):

| Tool | Substrate it builds on | Status |
| --- | --- | --- |
| **Content Doctor** — graph explorer + lint | content graph | ✅ built |
| **GM Dashboard** — live world inspector + control | dev admin channel | ✅ built |
| **World Doctor** — map reachability + portal QA | game adapter (`shared.ts`) | ✅ built |
| **Economy Simulator** — progression/economy projection | content graph + `balance.ts` | ✅ built |
| **Narrative Studio** — dialogue lint + preview + authoring | content graph | ✅ built |
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
  economy/        Economy Simulator: rates, xp curve, skills, combat, gold
  narrative/      Narrative Studio: tokens, model, lint, serialize, studio
  cli/            CLIs + format.ts (shared ANSI colour / table styling)
```
