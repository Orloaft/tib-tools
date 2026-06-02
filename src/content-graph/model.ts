import type { Catalog, Shared } from "../game/index.ts";

/**
 * A denormalised view of the game's content with the lookup sets the checks
 * need. Built once from the catalog (content/*.yaml -> catalog.ts) and the
 * shared map module (zones, ore tiers).
 */
export interface ContentModel {
  catalog: Catalog;
  shared: Shared;

  // Identity sets for fast existence checks.
  monsterIds: Set<string>;
  itemIds: Set<string>;
  npcIds: Set<string>;
  zoneIds: Set<string>;
  oreKinds: Set<string>;
  treeTypeIds: Set<string>;

  // Derived indices.
  /** monster type -> number of spawn placements. */
  spawnsByMonster: Map<string, number>;
  /** monster types referenced by any kill quest. */
  questTargetMonsters: Set<string>;
}

export function buildModel(catalog: Catalog, shared: Shared): ContentModel {
  const monsterIds = new Set(Object.keys(catalog.MONSTERS));
  const itemIds = new Set(Object.keys(catalog.ITEMS));
  const npcIds = new Set(catalog.NPCS.map((npc) => npc.id));
  const zoneIds = new Set(Object.keys(shared.ZONES));
  const oreKinds = new Set(Object.keys(shared.ORE_TIERS));
  const treeTypeIds = new Set(Object.keys(catalog.TREE_TYPES));

  const spawnsByMonster = new Map<string, number>();
  for (const spawn of catalog.MONSTER_SPAWNS) {
    spawnsByMonster.set(spawn.type, (spawnsByMonster.get(spawn.type) ?? 0) + 1);
  }

  const questTargetMonsters = new Set<string>();
  for (const quest of Object.values(catalog.QUESTS)) {
    if (quest.kind === "kill") {
      for (const type of quest.targetTypes) questTargetMonsters.add(type);
    }
  }

  return {
    catalog,
    shared,
    monsterIds,
    itemIds,
    npcIds,
    zoneIds,
    oreKinds,
    treeTypeIds,
    spawnsByMonster,
    questTargetMonsters
  };
}
