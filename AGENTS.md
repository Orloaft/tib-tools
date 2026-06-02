# tib-tools Agent Guide

Standalone developer tooling for the TIB game. Lives beside the game repo and
reads it as a sibling — the game repo stays free of tool bloat.

## Stack

- TypeScript run directly under Node (>=22) via type-stripping — same as the
  game. No build step; run `node src/...ts` directly.
- ESM (`"type": "module"`). Use `.ts` extensions in imports.
- Tiny dependency surface: `typescript` + `@types/node` only. The admin channel
  uses Node's built-in global `WebSocket` (no `ws` dependency).

## The game boundary (important)

- Never vendor or copy game code/data. Read it live through `src/game/`.
- Resolution: `$TIB_GAME_DIR`, else `../tib`.
- Reuse the game's real types via the `@game/*` tsconfig alias (e.g.
  `import type { ClientMessage } from "@game/src/types.ts"`). Don't redeclare
  shapes that already exist in the game.
- Runtime imports of game modules go through `adapter.ts` (dynamic import of the
  `TIB_GAME_DIR`-resolved path). Type-checking assumes the `../tib` default.

## Workflow

- Run `npm run check` (typecheck + content graph) before committing.
- Keep each tool a thin front-end over the two substrates (content graph, admin
  channel). Add new substrate capability under `src/content-graph` or
  `src/admin` rather than reaching into the game from a tool directly.
- Prefer small, verifiable slices; a tool should have a CLI or test that proves
  it against real game content/state.

## Gotchas

- The game's `src/generated/catalog.ts` is git-ignored and built from
  `content/*.yaml`. The adapter builds it on demand; don't assume it exists.
- Admin commands only work against a server in dev mode (`TIB_DEV=1` or
  `E2E_TEST=1`); transient joins are likewise dev-only.
