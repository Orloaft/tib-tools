import { readFileSync, writeFileSync } from "node:fs";
import { importGameModule } from "./game-modules.ts";

export interface DiffResult {
  /** "ok" (under threshold), "changed", "new" (no golden), or "size" (dim mismatch). */
  status: "ok" | "changed" | "new" | "size";
  changedPixels: number;
  totalPixels: number;
  pct: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readPng(path: string): Promise<any> {
  const pngjs = await importGameModule("pngjs");
  const PNG = pngjs.PNG ?? pngjs;
  return PNG.sync.read(readFileSync(path));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function newPng(width: number, height: number): Promise<any> {
  return importGameModule("pngjs").then((pngjs) => {
    const PNG = pngjs.PNG ?? pngjs;
    return new PNG({ width, height });
  });
}

/** Per-channel tolerance before a pixel counts as changed. */
const CHANNEL_TOLERANCE = 24;

/**
 * Pixel-diff `shotPath` against `goldenPath`. Writes a diff image highlighting
 * changed pixels in magenta to `diffOutPath`. Returns change metrics; `pct`
 * over `thresholdPct` means "changed".
 */
// Live monsters wander between runs, so a populated zone diffs ~0.3-1.1% even
// with identical tilesets. Set the "changed" bar above that floor so it flags
// real tileset/biome changes, not entity movement. (The diff image is always
// produced, so sub-threshold changes are still reviewable.)
export async function diffShots(shotPath: string, goldenPath: string | null, diffOutPath: string, thresholdPct = 2): Promise<DiffResult> {
  const shot = await readPng(shotPath);
  if (!goldenPath) return { status: "new", changedPixels: 0, totalPixels: shot.width * shot.height, pct: 0 };

  const golden = await readPng(goldenPath);
  if (shot.width !== golden.width || shot.height !== golden.height) {
    return { status: "size", changedPixels: 0, totalPixels: shot.width * shot.height, pct: 100 };
  }

  const { width, height } = shot;
  const out = await newPng(width, height);
  let changed = 0;
  const a = shot.data as Uint8Array;
  const b = golden.data as Uint8Array;
  const o = out.data as Uint8Array;

  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i]! - b[i]!);
    const dg = Math.abs(a[i + 1]! - b[i + 1]!);
    const db = Math.abs(a[i + 2]! - b[i + 2]!);
    const diff = dr > CHANNEL_TOLERANCE || dg > CHANNEL_TOLERANCE || db > CHANNEL_TOLERANCE;
    if (diff) {
      changed += 1;
      o[i] = 0xff;
      o[i + 1] = 0x00;
      o[i + 2] = 0xff;
      o[i + 3] = 0xff;
    } else {
      // Dim the unchanged background so changes pop.
      o[i] = Math.round(a[i]! * 0.25);
      o[i + 1] = Math.round(a[i + 1]! * 0.25);
      o[i + 2] = Math.round(a[i + 2]! * 0.25);
      o[i + 3] = 0xff;
    }
  }

  const pngjs = await importGameModule("pngjs");
  const PNG = pngjs.PNG ?? pngjs;
  writeFileSync(diffOutPath, PNG.sync.write(out));

  const totalPixels = width * height;
  const pct = Math.round((changed / totalPixels) * 10000) / 100;
  return { status: pct > thresholdPct ? "changed" : "ok", changedPixels: changed, totalPixels, pct };
}
