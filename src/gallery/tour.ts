import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureContentBuilt, locateGame } from "../game/index.ts";
import { importGameModule } from "./game-modules.ts";
import { tourTargets, type TourTarget } from "./targets.ts";

export interface TourOptions {
  outDir?: string;
  port?: number;
  /** A dev-mode e2e game is already running — don't start one. */
  running?: boolean;
  onStep?: (i: number, total: number, target: TourTarget) => void;
}

export interface TourShot {
  label: string;
  title: string;
  floor: number;
  file: string;
}

export interface TourResult {
  shots: TourShot[];
  outDir: string;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/**
 * Tour every zone in the live client and screenshot the world canvas. Drives the
 * game with Playwright (borrowed from the game's install). Starts an e2e game
 * (vite + server) unless `running` is set, and tears it down by process group.
 */
export async function runTour(opts: TourOptions = {}): Promise<TourResult> {
  const gameDir = locateGame();
  const port = opts.port ?? 5173;
  const outDir = resolve(opts.outDir ?? "out/gallery/shots");
  mkdirSync(outDir, { recursive: true });
  const targets = await tourTargets();

  // Spawn the server and vite directly (each its own process group) so teardown
  // is a clean group kill — npm/concurrently swallow the signal and orphan them.
  const procs: ChildProcess[] = [];
  if (!opts.running) {
    ensureContentBuilt(); // the server imports the generated catalog
    const env = { ...process.env, E2E_TEST: "1" };
    // Spawn the vite *binary* directly (not via npx, which exits and orphans
    // vite's esbuild children outside the group we try to kill).
    const viteBin = join(gameDir, "node_modules", ".bin", "vite");
    const server = spawn("node", ["server/index.ts"], { cwd: gameDir, env, detached: true, stdio: "ignore" });
    const vite = spawn(viteBin, ["--host", "127.0.0.1", "--port", String(port)], { cwd: gameDir, env, detached: true, stdio: "ignore" });
    server.unref();
    vite.unref();
    procs.push(server, vite);
  }

  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, opts.running ? 5000 : 90000);

    const pw = await importGameModule("@playwright/test");
    const chromium = pw.chromium ?? pw.default?.chromium;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`http://127.0.0.1:${port}/?e2e`);
      await page.locator("#nameInput").fill(`gallery_${Date.now().toString(36)}`);
      await page.locator("#joinButton").click();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.waitForFunction(() => Boolean((window as any).__TIB_E2E__?.self()), null, { timeout: 15000 });

      const shots: TourShot[] = [];
      for (let i = 0; i < targets.length; i += 1) {
        const t = targets[i]!;
        opts.onStep?.(i + 1, targets.length, t);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.evaluate((tt: TourTarget) => (window as any).__TIB_E2E__.send({ type: "e2eGrantItems", floor: tt.floor, x: tt.x, y: tt.y }), t);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.waitForFunction((fl: number) => (window as any).__TIB_E2E__?.self()?.floor === fl, t.floor, { timeout: 10000 }).catch(() => {});
        // The loading screen pops on a floor change; wait for it to appear and
        // then fully clear, otherwise we screenshot a mid-load (dark) canvas.
        await page.waitForFunction(() => document.getElementById("loadingScreen")?.classList.contains("hidden") === false, null, { timeout: 2500 }).catch(() => {});
        await page.waitForFunction(() => document.getElementById("loadingScreen")?.classList.contains("hidden") !== false, null, { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(1600); // settle base tiles + lazily-materialised trees/entities
        const file = join(outDir, `${t.label}.png`);
        await page.locator("#game canvas").screenshot({ path: file });
        shots.push({ label: t.label, title: t.title, floor: t.floor, file });
      }
      return { shots, outDir };
    } finally {
      await browser.close();
    }
  } finally {
    for (const sig of ["SIGTERM", "SIGKILL"] as const) {
      for (const p of procs) {
        if (!p.pid) continue;
        try {
          process.kill(-p.pid, sig); // negative pid = the whole process group
        } catch {
          /* group gone */
        }
        try {
          p.kill(sig); // and the process itself, in case the group is empty
        } catch {
          /* already gone */
        }
      }
      if (sig === "SIGTERM") await new Promise((r) => setTimeout(r, 800));
    }
  }
}
