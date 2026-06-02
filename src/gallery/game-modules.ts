import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { locateGame } from "../game/index.ts";

/**
 * Import a node module from the GAME repo's install. The Visual Gallery needs
 * Playwright (to drive the client) and pngjs (to diff screenshots) — both are
 * dev dependencies of the game, and the gallery inherently requires the game
 * anyway, so we borrow them instead of adding deps to tib-tools.
 *
 * Uses a require rooted at the game's package.json so the package's real entry
 * point is resolved (a bare directory import fails under ESM).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function importGameModule(mod: string): Promise<any> {
  const require = createRequire(join(locateGame(), "package.json"));
  let entry: string;
  try {
    entry = require.resolve(mod);
  } catch {
    throw new Error(`The game repo has no "${mod}" installed. Run \`npm install\` in the game repo.`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = await import(pathToFileURL(entry).href);
  return m.default ?? m;
}
