import type { ContentModel } from "./model.ts";
import type { Finding } from "./types.ts";
import { buildItemGrants, grantedItemIds, SHOP_TIER_KEYS } from "../content-doctor/grants.ts";

/**
 * Higher-value cross-file checks layered on top of the base referential-integrity
 * checks in checks.ts. These look at *reachability* and *obtainability* — the
 * class of problem where every individual reference resolves, yet the content
 * still has a hole (an item nothing grants, an ability no one can learn, a shop
 * slot pointing at a non-existent item, a zone with nothing in it).
 *
 * Convention (same as checks.ts):
 *   error — a dangling reference; broken at runtime.
 *   warn  — a structural smell (exists but unreachable/unobtainable).
 *   info  — coverage observation, not necessarily a bug.
 */
export function runExtendedChecks(model: ContentModel): Finding[] {
  const out: Finding[] = [];
  unobtainableItemChecks(model, out);
  shopItemChecks(model, out);
  questItemChecks(model, out);
  orphanAbilityChecks(model, out);
  zoneCoverageChecks(model, out);
  duplicateIdChecks(model, out);
  return out;
}

/** Items in ITEMS that no declared content source grants. */
function unobtainableItemChecks(model: ContentModel, out: Finding[]): void {
  const granted = grantedItemIds(model);
  for (const id of model.itemIds) {
    if (granted.has(id)) continue;
    out.push({
      rule: "item.unobtainable",
      severity: "warn",
      subject: `item:${id}`,
      message:
        `Item "${id}" is granted by no declared source — not sold, dropped, ` +
        `mined, foraged, chopped, cooked, or fished. It may be reachable only ` +
        `via hard-coded server logic, or it is dead content.`
    });
  }
}

/** Shop entries naming an item that does not exist (excludes gear-tier slots). */
function shopItemChecks(model: ContentModel, out: Finding[]): void {
  for (const key of Object.keys(model.catalog.SHOP)) {
    if (SHOP_TIER_KEYS.has(key)) continue;
    if (!model.itemIds.has(key)) {
      out.push({
        rule: "shop.item",
        severity: "error",
        subject: `shop:${key}`,
        message: `Shop entry "${key}" is neither a gear-tier slot nor a known item.`
      });
    }
  }
}

/**
 * Quest item references that don't resolve. The base questChecks already covers
 * fetch/gather itemId; this additionally validates that any item *named in a
 * quest's QUEST_DROP* (keyed by a kill target) resolves, and that kill-quest
 * targets that carry a quest drop actually point at an existing item.
 */
function questItemChecks(model: ContentModel, out: Finding[]): void {
  for (const [monsterType, drop] of Object.entries(model.catalog.QUEST_DROPS)) {
    if (!model.itemIds.has(drop.itemId)) {
      out.push({
        rule: "drop.item",
        severity: "error",
        subject: `drop:${monsterType}`,
        message: `Quest drop from "${monsterType}" yields unknown item "${drop.itemId}".`
      });
    }
    if (!model.monsterIds.has(monsterType)) {
      out.push({
        rule: "drop.monster",
        severity: "error",
        subject: `drop:${monsterType}`,
        message: `Quest drop is keyed to unknown monster "${monsterType}".`
      });
    }
  }
}

/**
 * Abilities defined in ABILITIES that nothing can ever surface:
 *   - class abilities (category undefined / "class") must be listed by some class;
 *   - spells/miracles are learnable by magic/faith level, so they are always
 *     reachable and never orphaned.
 */
function orphanAbilityChecks(model: ContentModel, out: Finding[]): void {
  const classReferenced = new Set<string>();
  for (const cls of Object.values(model.shared.CLASSES)) {
    for (const ability of cls.abilities) classReferenced.add(ability);
  }

  for (const [id, ability] of Object.entries(model.catalog.ABILITIES)) {
    const learnable = ability.category === "spell" || ability.category === "miracle";
    if (learnable || classReferenced.has(id)) continue;
    out.push({
      rule: "ability.orphan",
      severity: "warn",
      subject: `ability:${id}`,
      message: `Ability "${id}" is not granted by any class and is not a learnable spell/miracle — unreachable.`
    });
  }

  // The inverse dangling case: a class lists an ability that doesn't exist.
  for (const [classKey, cls] of Object.entries(model.shared.CLASSES)) {
    for (const ability of cls.abilities) {
      if (!model.catalog.ABILITIES[ability]) {
        out.push({
          rule: "class.ability",
          severity: "error",
          subject: `class:${classKey}`,
          message: `Class "${classKey}" grants unknown ability "${ability}".`
        });
      }
    }
  }
}

/** Zones with no spawns and no resource/NPC content of any kind. */
function zoneCoverageChecks(model: ContentModel, out: Finding[]): void {
  const { catalog } = model;
  const floorsWithContent = (zoneFloor: number): boolean => {
    const has = (arr: ReadonlyArray<{ floor: number }>): boolean => arr.some((e) => e.floor === zoneFloor);
    return (
      has(catalog.MONSTER_SPAWNS) ||
      has(catalog.NPCS) ||
      has(catalog.MINING_NODES) ||
      has(catalog.HERB_NODES) ||
      has(catalog.FISHING_NODES) ||
      has(catalog.COMPOSED_TREE_NODES)
    );
  };

  for (const [zoneId, zone] of Object.entries(model.shared.ZONES)) {
    const spawns = catalog.MONSTER_SPAWNS.filter((s) => s.zone === zoneId).length;
    if (spawns > 0) continue;
    if (floorsWithContent(zone.floor)) {
      // Town/hub zones: no monsters but plenty of NPCs/resources. Worth noting,
      // not alarming.
      out.push({
        rule: "zone.noSpawns",
        severity: "info",
        subject: `zone:${zoneId}`,
        message: `Zone "${zoneId}" (floor ${zone.floor}) has no monster spawns (has other content).`
      });
    } else {
      out.push({
        rule: "zone.empty",
        severity: "warn",
        subject: `zone:${zoneId}`,
        message: `Zone "${zoneId}" (floor ${zone.floor}) has no spawns and no resource/NPC content — empty.`
      });
    }
  }
}

/** Duplicate ids within a single entity collection. */
function duplicateIdChecks(model: ContentModel, out: Finding[]): void {
  const flagDupes = (label: string, rule: string, ids: Iterable<string>): void => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) dupes.add(id);
      seen.add(id);
    }
    for (const id of dupes) {
      out.push({
        rule,
        severity: "error",
        subject: `${label}:${id}`,
        message: `Duplicate ${label} id "${id}".`
      });
    }
  };

  flagDupes("npc", "npc.duplicate", model.catalog.NPCS.map((n) => n.id));
  flagDupes("treeNode", "tree.duplicateNode", model.catalog.COMPOSED_TREE_NODES.map((n) => `${n.type}@${n.floor},${n.x},${n.y}`));
  flagDupes("miningNode", "mining.duplicateNode", model.catalog.MINING_NODES.map((n) => n.id));
  flagDupes("fishingNode", "fishing.duplicateNode", model.catalog.FISHING_NODES.map((n) => n.id));
  flagDupes("herbNode", "herb.duplicateNode", model.catalog.HERB_NODES.map((n) => n.id));
}

/** Re-export so the doctor's graph builder can reuse the grant derivation. */
export { buildItemGrants };
