import type { ContentModel } from "../content-graph/model.ts";

/**
 * Where a single item can be obtained from. Used both by the "unobtainable
 * items" check and by the reference graph (each source becomes an inbound edge
 * onto the item).
 */
export interface ItemGrant {
  /** The item that is granted. */
  itemId: string;
  /** What grants it, e.g. "shop", "drop", "mining", "herb", "tree", "cook". */
  via: string;
  /** The source entity id (shop key, monster id, ore kind, node id, item id…). */
  sourceId: string;
}

/**
 * SHOP keys that bump an equipment *tier* rather than granting an inventory
 * item. They intentionally have no matching entry in ITEMS, so they must be
 * excluded from the "shop references unknown item" check.
 *
 * Verified against the game server's buyItem(): `weapon` -> player.weaponTier,
 * `armor` -> player.armorTier; every other shop key calls addInventoryItem with
 * an id equal to the shop key.
 */
export const SHOP_TIER_KEYS = new Set(["weapon", "armor"]);

/**
 * Build the full set of item grants derivable from the *catalog* — every way an
 * item legitimately enters a player's inventory that the content data declares:
 *
 *   - shop entry           (SHOP key that names an item)
 *   - monster / quest drop (QUEST_DROPS, keyed by monster type)
 *   - mining               (ORE_TIERS[kind].item)
 *   - herb node            (HERB_NODES[].item, defaulting to "herb")
 *   - tree type            (TREE_TYPES[].itemId)
 *   - cook-on-fire         (item.use.produces and .burns)
 *   - fishing              (raw_fish — fishing nodes carry no item field; the
 *                           server hard-codes raw_fish, so seed it explicitly)
 *
 * This deliberately does NOT model server-only grants (e.g. SPECIAL_QUEST_REWARDS
 * or the smithing/smelting recipe tables hard-coded in server/index.ts). Items
 * that exist only because of those will surface as "unobtainable" — which is the
 * honest signal: nothing in the content data declares a source for them.
 */
export function buildItemGrants(model: ContentModel): ItemGrant[] {
  const grants: ItemGrant[] = [];
  const { catalog, shared } = model;

  for (const key of Object.keys(catalog.SHOP)) {
    if (SHOP_TIER_KEYS.has(key)) continue;
    if (model.itemIds.has(key)) grants.push({ itemId: key, via: "shop", sourceId: key });
  }

  for (const [monsterType, drop] of Object.entries(catalog.QUEST_DROPS)) {
    grants.push({ itemId: drop.itemId, via: "drop", sourceId: monsterType });
  }

  for (const [kind, tier] of Object.entries(shared.ORE_TIERS)) {
    grants.push({ itemId: tier.item, via: "mining", sourceId: kind });
  }

  for (const node of catalog.HERB_NODES) {
    grants.push({ itemId: node.item ?? "herb", via: "herb", sourceId: node.id });
  }

  for (const [treeId, tree] of Object.entries(catalog.TREE_TYPES)) {
    grants.push({ itemId: tree.itemId, via: "tree", sourceId: treeId });
  }

  for (const [itemId, item] of Object.entries(catalog.ITEMS)) {
    if (item.use?.kind === "cook_on_fire") {
      grants.push({ itemId: item.use.produces, via: "cook", sourceId: itemId });
      grants.push({ itemId: item.use.burns, via: "cook_burn", sourceId: itemId });
    }
  }

  // Fishing nodes have no declared item; the server grants raw_fish.
  if (model.itemIds.has("raw_fish") && catalog.FISHING_NODES.length > 0) {
    grants.push({ itemId: "raw_fish", via: "fishing", sourceId: "fishing_nodes" });
  }

  return grants;
}

/** The distinct set of item ids that have at least one declared grant. */
export function grantedItemIds(model: ContentModel): Set<string> {
  return new Set(buildItemGrants(model).map((g) => g.itemId));
}
