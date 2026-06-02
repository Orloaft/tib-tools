import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Resolve the TIB game repository on disk.
 *
 * Resolution order:
 *   1. $TIB_GAME_DIR, if set (absolute or relative to CWD).
 *   2. The sibling default: ../tib relative to this tools repo.
 *
 * The tools repo never vendors game code — it reads the live source so the
 * tooling always reflects the current game. We validate a couple of marker
 * files so a misconfiguration fails loudly instead of importing nothing.
 */
let cached: string | undefined;

export function locateGame(): string {
  if (cached) return cached;

  const repoRoot = resolve(import.meta.dirname, "..", "..");
  const fromEnv = process.env.TIB_GAME_DIR;
  const gameDir = fromEnv ? resolve(fromEnv) : resolve(repoRoot, "..", "tib");

  const markers = ["package.json", join("src", "shared.ts")];
  const missing = markers.filter((m) => !existsSync(join(gameDir, m)));
  if (missing.length > 0) {
    throw new Error(
      [
        `Could not locate the TIB game repo at: ${gameDir}`,
        `  (missing: ${missing.join(", ")})`,
        ``,
        `Fix one of:`,
        `  • Check the game out as a sibling of tib-tools (so ../tib resolves), or`,
        `  • Set TIB_GAME_DIR to the game repo path, e.g.`,
        `      TIB_GAME_DIR=/path/to/tib npm run graph`
      ].join("\n")
    );
  }

  cached = gameDir;
  return gameDir;
}
