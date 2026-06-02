import { analyzeEconomy } from "../economy/index.ts";

// Economy Simulator — project skill progression, combat leveling, and gold flow.
//
//   node src/cli/economy.ts          human report
//   node src/cli/economy.ts --json   machine-readable

const asJson = process.argv.includes("--json");
const a = await analyzeEconomy();

if (asJson) {
  console.log(JSON.stringify(a, null, 2));
} else {
  report();
}

function hrs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return n < 1 ? `${Math.round(n * 60)}m` : `${n}h`;
}

function report(): void {
  const line = "─".repeat(72);
  console.log("TIB Economy Simulator");
  console.log(line);
  console.log(`Skill curve: 70·(L-1)^1.55 cumulative · ${a.totalXpToCap.toLocaleString()} xp to level ${a.maxLevel} · gathering at ~70% efficiency`);
  console.log("");

  console.log("SIGNALS");
  for (const s of a.signals) console.log(`  ▸ ${s}`);
  console.log("");

  // Skills
  console.log("SKILL PROGRESSION (hours from level 1, best method)");
  console.log("  skill         to10    to30    to50    xp/hr@cap  method");
  for (const s of a.skills) {
    const name = s.skill.padEnd(12);
    const to10 = hrs(s.hoursTo10).padStart(6);
    const to30 = hrs(s.hoursTo30).padStart(6);
    const to50 = hrs(s.hoursTo50).padStart(6);
    const rate = (s.trainable ? String(s.xpPerHourAtCap) : "n/a").padStart(9);
    const cap = s.cappedAtLevel ? `[capped ~L${s.cappedAtLevel}] ` : "";
    console.log(`  ${name}${to10}  ${to30}  ${to50}  ${rate}  ${cap}${s.bestMethodAtCap}`);
  }
  console.log("");
  for (const s of a.skills) {
    for (const note of s.notes) console.log(`  · ${s.skill}: ${note}`);
  }
  console.log("");

  // Combat
  console.log("COMBAT / PLAYER LEVELING (best survivable farm per checkpoint)");
  console.log("  checkpoint     Lv   xp/hr     best xp farm        gold/hr   best gold farm");
  for (const p of a.combat.perProfile) {
    console.log(
      `  ${p.label.padEnd(14)} ${String(p.level).padStart(2)}  ${String(p.xpPerHour).padStart(7)}   ${p.bestXpMonster.padEnd(18)}  ${String(p.goldPerHour).padStart(7)}   ${p.bestGoldMonster}`
    );
  }
  console.log("");
  console.log("  Climb between checkpoints (player xp):");
  for (const b of a.combat.bands) {
    console.log(`    ${b.fromLabel} (L${b.fromLevel}) → ${b.toLabel} (L${b.toLevel}): ${hrs(b.hours)} at ${b.xpPerHour} xp/hr farming ${b.monster}`);
  }
  console.log(`  Total: ~${hrs(a.combat.hoursToTop)} of combat from fresh to jungle-ready.`);
  console.log("");

  // Gold
  console.log("GOLD ECONOMY");
  console.log("  Faucets:");
  for (const f of a.gold.faucets) console.log(`    + ${f.label}: ${f.gold}${f.kind === "perHour" ? " g/hr" : " g"}`);
  console.log("  Sinks:");
  for (const s of a.gold.sinks) {
    const tag = s.kind === "oneTime" ? "" : s.kind === "perUse" ? " (per use)" : "";
    console.log(`    - ${s.label}: ${s.gold} g${tag}${s.note ? ` — ${s.note}` : ""}`);
  }
  console.log("");
  console.log(`  Starter kit (tools + first gear + map): ${a.gold.starterKitCost} g`);
  console.log(`  Quest gold available (one-time): ${a.gold.questGoldTotal} g`);
  console.log(`  Time to afford the kit by combat alone: ${hrs(a.gold.hoursToAffordKit)} (or covered ${round1(a.gold.questGoldTotal / Math.max(1, a.gold.starterKitCost))}× by quest gold)`);
  console.log(line);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
