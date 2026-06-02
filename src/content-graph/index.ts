import { loadCatalog, loadShared } from "../game/index.ts";
import { buildModel, type ContentModel } from "./model.ts";
import { runChecks } from "./checks.ts";
import type { Analysis, GraphCounts } from "./types.ts";

export type { ContentModel } from "./model.ts";
export type { Analysis, AnalysisSummary, Finding, GraphCounts, Severity } from "./types.ts";
export { buildModel } from "./model.ts";
export { runChecks } from "./checks.ts";

/** Load the game's content and build the cross-file model. */
export async function loadModel(): Promise<ContentModel> {
  const [catalog, shared] = await Promise.all([loadCatalog(), loadShared()]);
  return buildModel(catalog, shared);
}

function countsFor(model: ContentModel): GraphCounts {
  const c = model.catalog;
  return {
    monsters: model.monsterIds.size,
    items: model.itemIds.size,
    npcs: model.npcIds.size,
    quests: Object.keys(c.QUESTS).length,
    spawns: c.MONSTER_SPAWNS.length,
    zones: model.zoneIds.size,
    oreKinds: model.oreKinds.size,
    miningNodes: c.MINING_NODES.length,
    herbNodes: c.HERB_NODES.length,
    fishingNodes: c.FISHING_NODES.length,
    treeNodes: c.COMPOSED_TREE_NODES.length,
    abilities: Object.keys(c.ABILITIES).length
  };
}

/** Load the model and run every integrity check over it. */
export async function analyzeContent(): Promise<Analysis> {
  const model = await loadModel();
  const findings = runChecks(model);
  return {
    findings,
    summary: {
      counts: countsFor(model),
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warn").length,
      infos: findings.filter((f) => f.severity === "info").length
    }
  };
}
