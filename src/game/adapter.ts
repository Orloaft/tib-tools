import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { locateGame } from "./locate.ts";

// Reuse the game's real module shapes — no duplication. These `typeof import`
// types resolve through the `@game/*` tsconfig path alias (-> ../tib), while the
// runtime import below uses the TIB_GAME_DIR-resolved absolute path.
export type Catalog = typeof import("@game/src/generated/catalog.ts");
export type Shared = typeof import("@game/src/shared.ts");
export type Wire = typeof import("@game/src/wire.ts");

let catalogPromise: Promise<Catalog> | undefined;
let sharedPromise: Promise<Shared> | undefined;
let wirePromise: Promise<Wire> | undefined;

function importFromGame<T>(relPath: string): Promise<T> {
  const abs = join(locateGame(), relPath);
  // A dynamic import of a computed path is `Promise<any>`; cast to the real shape.
  return import(pathToFileURL(abs).href) as Promise<T>;
}

/**
 * The catalog (src/generated/catalog.ts) is git-ignored in the game repo and
 * produced by `npm run content:build`. Build it on demand so the tools work
 * against a fresh checkout without a manual pre-step.
 */
export function ensureContentBuilt(force = false): void {
  const gameDir = locateGame();
  const catalog = join(gameDir, "src", "generated", "catalog.ts");
  if (force || !existsSync(catalog)) {
    execFileSync("node", ["scripts/build-content.ts"], { cwd: gameDir, stdio: "inherit" });
  }
}

export function loadCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    ensureContentBuilt();
    catalogPromise = importFromGame<Catalog>("src/generated/catalog.ts");
  }
  return catalogPromise;
}

export function loadShared(): Promise<Shared> {
  if (!sharedPromise) {
    sharedPromise = importFromGame<Shared>("src/shared.ts");
  }
  return sharedPromise;
}

/** The wire codec — used to decode the server's compact state snapshots. */
export function loadWire(): Promise<Wire> {
  if (!wirePromise) {
    wirePromise = importFromGame<Wire>("src/wire.ts");
  }
  return wirePromise;
}
