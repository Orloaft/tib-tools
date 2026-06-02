import type { ContentModel } from "./model.ts";
import type { Finding } from "./types.ts";

/**
 * Cross-file referential-integrity checks. These catch the class of bug that
 * per-file schema validation in the game's build-content.ts cannot see: a
 * reference in one content file that points at something defined (or not) in
 * another.
 *
 * Convention:
 *   error — a dangling reference; almost certainly a bug (broken at runtime).
 *   warn  — a structural smell (e.g. content that exists but is unreachable).
 */
export function runChecks(model: ContentModel): Finding[] {
  const findings: Finding[] = [];
  spawnChecks(model, findings);
  questChecks(model, findings);
  resourceNodeChecks(model, findings);
  orphanChecks(model, findings);
  return findings;
}

function spawnChecks(model: ContentModel, out: Finding[]): void {
  for (const spawn of model.catalog.MONSTER_SPAWNS) {
    const at = `floor ${spawn.floor} (${spawn.x}, ${spawn.y})`;
    if (!model.monsterIds.has(spawn.type)) {
      out.push({
        rule: "spawn.monster",
        severity: "error",
        subject: `spawn:${spawn.type}@${at}`,
        message: `Spawn references unknown monster "${spawn.type}".`
      });
    }
    if (!model.zoneIds.has(spawn.zone)) {
      out.push({
        rule: "spawn.zone",
        severity: "error",
        subject: `spawn:${spawn.type}@${at}`,
        message: `Spawn references unknown zone "${spawn.zone}".`
      });
    }
  }
}

function questChecks(model: ContentModel, out: Finding[]): void {
  for (const quest of Object.values(model.catalog.QUESTS)) {
    const subject = `quest:${quest.id}`;

    if (!model.npcIds.has(quest.giverId)) {
      out.push({
        rule: "quest.giver",
        severity: "error",
        subject,
        message: `Quest giver "${quest.giverId}" is not a known NPC.`
      });
    }

    if (quest.zone !== null && !model.zoneIds.has(quest.zone)) {
      out.push({
        rule: "quest.zone",
        severity: "error",
        subject,
        message: `Quest zone "${quest.zone}" is not a known zone.`
      });
    }

    if (quest.kind === "kill") {
      for (const type of quest.targetTypes) {
        if (!model.monsterIds.has(type)) {
          out.push({
            rule: "quest.target",
            severity: "error",
            subject,
            message: `Kill-quest target "${type}" is not a known monster.`
          });
        }
      }
    }

    if ((quest.kind === "fetch" || quest.kind === "gather") && quest.itemId !== null) {
      if (!model.itemIds.has(quest.itemId)) {
        out.push({
          rule: "quest.item",
          severity: "error",
          subject,
          message: `${quest.kind}-quest item "${quest.itemId}" is not a known item.`
        });
      }
    }
  }
}

function resourceNodeChecks(model: ContentModel, out: Finding[]): void {
  for (const node of model.catalog.MINING_NODES) {
    if (!model.oreKinds.has(node.kind)) {
      out.push({
        rule: "mining.ore",
        severity: "error",
        subject: `mining:${node.id}`,
        message: `Mining node references unknown ore kind "${node.kind}".`
      });
    }
  }

  for (const node of model.catalog.HERB_NODES) {
    if (node.item !== undefined && !model.itemIds.has(node.item)) {
      out.push({
        rule: "herb.item",
        severity: "error",
        subject: `herb:${node.id}`,
        message: `Herb node yields unknown item "${node.item}".`
      });
    }
  }

  for (const node of model.catalog.COMPOSED_TREE_NODES) {
    if (!model.treeTypeIds.has(node.type)) {
      out.push({
        rule: "tree.type",
        severity: "error",
        subject: `tree:${node.type}@floor ${node.floor}`,
        message: `Tree node references unknown tree type "${node.type}".`
      });
    }
  }

  for (const [id, tree] of Object.entries(model.catalog.TREE_TYPES)) {
    if (!model.itemIds.has(tree.itemId)) {
      out.push({
        rule: "tree.item",
        severity: "error",
        subject: `treeType:${id}`,
        message: `Tree type "${id}" drops unknown item "${tree.itemId}".`
      });
    }
  }
}

function orphanChecks(model: ContentModel, out: Finding[]): void {
  // A monster defined but never placed in the world and never named by a quest
  // is dead content — it can never be encountered.
  for (const id of model.monsterIds) {
    const spawned = (model.spawnsByMonster.get(id) ?? 0) > 0;
    const questTarget = model.questTargetMonsters.has(id);
    if (!spawned && !questTarget) {
      out.push({
        rule: "monster.orphan",
        severity: "warn",
        subject: `monster:${id}`,
        message: `Monster "${id}" has no spawns and is not a quest target — unreachable.`
      });
    }
  }
}
