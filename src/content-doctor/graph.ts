import type { ContentModel } from "../content-graph/model.ts";
import { buildItemGrants } from "../content-graph/checks-extended.ts";

/** The kinds of entity the graph models. */
export type NodeKind =
  | "monster"
  | "item"
  | "npc"
  | "quest"
  | "zone"
  | "ability"
  | "class"
  | "ore"
  | "tree"
  | "shop";

/** A node is one content entity, addressed by a global key `${kind}:${id}`. */
export interface GraphNode {
  key: string;
  kind: NodeKind;
  id: string;
  /** A short human label for display (falls back to the id). */
  label: string;
}

/** A directed reference: `from` references `to`, with a relationship label. */
export interface GraphEdge {
  from: string;
  to: string;
  /** e.g. "spawns", "giver", "target", "drops", "mines", "grants", "learns". */
  label: string;
}

export interface ReferenceGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** All edges leaving a node key. */
  outbound(key: string): GraphEdge[];
  /** All edges arriving at a node key. */
  inbound(key: string): GraphEdge[];
  /** Resolve a bare id (or `kind:id`) to node keys (may be ambiguous across kinds). */
  resolve(idOrKey: string): GraphNode[];
  /**
   * Loose lookup: substring/fuzzy id+label matches, ranked best-first. Used for
   * "did you mean …" suggestions when an exact `resolve` finds nothing.
   */
  suggest(query: string, limit?: number): GraphNode[];
  /** All nodes of a given kind (sorted by id), for browsing. */
  byKind(kind: NodeKind): GraphNode[];
}

const keyOf = (kind: NodeKind, id: string): string => `${kind}:${id}`;

/**
 * Build a queryable reference graph over the content model. Every entity becomes
 * a node; every cross-entity reference becomes a directed, labelled edge. The
 * edge direction is "subject references object" — e.g. a spawn placement means
 * the zone (or the world) references the monster, modelled here as
 * `zone --spawns--> monster`.
 */
export function buildGraph(model: ContentModel): ReferenceGraph {
  const { catalog, shared } = model;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const add = (kind: NodeKind, id: string, label?: string): string => {
    const key = keyOf(kind, id);
    if (!nodes.has(key)) nodes.set(key, { key, kind, id, label: label ?? id });
    return key;
  };
  // Add an edge; create placeholder endpoints if they don't exist yet so a
  // dangling reference is still navigable (the node simply won't carry a real
  // label — the checks report the danglers separately).
  const edge = (fromKind: NodeKind, fromId: string, label: string, toKind: NodeKind, toId: string): void => {
    const from = add(fromKind, fromId);
    const to = add(toKind, toId);
    edges.push({ from, to, label });
  };

  // ── Nodes from every collection ──────────────────────────────────────────
  for (const [id, m] of Object.entries(catalog.MONSTERS)) add("monster", id, m.name ?? id);
  for (const [id, it] of Object.entries(catalog.ITEMS)) add("item", id, it.label ?? id);
  for (const npc of catalog.NPCS) add("npc", npc.id, npc.name ?? npc.id);
  for (const [id, q] of Object.entries(catalog.QUESTS)) add("quest", id, q.title ?? id);
  for (const [id, z] of Object.entries(shared.ZONES)) add("zone", id, z.label ?? id);
  for (const [id, a] of Object.entries(catalog.ABILITIES)) add("ability", id, a.label ?? id);
  for (const [id, c] of Object.entries(shared.CLASSES)) add("class", id, c.label ?? id);
  for (const [id, o] of Object.entries(shared.ORE_TIERS)) add("ore", id, o.label ?? id);
  for (const [id, t] of Object.entries(catalog.TREE_TYPES)) add("tree", id, t.label ?? id);
  for (const id of Object.keys(catalog.SHOP)) add("shop", id, id);

  // ── Spawns: zone --spawns--> monster ─────────────────────────────────────
  for (const s of catalog.MONSTER_SPAWNS) edge("zone", s.zone, "spawns", "monster", s.type);

  // ── Quests: quest --giver/target/item/zone--> X ──────────────────────────
  for (const q of Object.values(catalog.QUESTS)) {
    edge("quest", q.id, "giver", "npc", q.giverId);
    if (q.zone !== null) edge("quest", q.id, "zone", "zone", q.zone);
    for (const t of q.targetTypes) edge("quest", q.id, "target", "monster", t);
    if (q.itemId !== null) edge("quest", q.id, "item", "item", q.itemId);
  }

  // ── Quest drops: monster --drops--> item ─────────────────────────────────
  for (const [monsterType, drop] of Object.entries(catalog.QUEST_DROPS)) {
    edge("monster", monsterType, "drops", "item", drop.itemId);
  }

  // ── Classes: class --grants--> ability ───────────────────────────────────
  for (const [classKey, c] of Object.entries(shared.CLASSES)) {
    for (const ability of c.abilities) edge("class", classKey, "grants", "ability", ability);
  }
  // ── Class unlocks: class --trainer--> npc ────────────────────────────────
  for (const u of shared.CLASS_UNLOCKS) edge("class", u.key, "trainer", "npc", u.npcId);

  // ── Item grants: source --<via>--> item (mining/herb/tree/shop/cook/…) ────
  for (const g of buildItemGrants(model)) {
    switch (g.via) {
      case "shop":
        edge("shop", g.sourceId, "sells", "item", g.itemId);
        break;
      case "drop":
        // already captured as monster --drops--> item above
        break;
      case "mining":
        edge("ore", g.sourceId, "yields", "item", g.itemId);
        break;
      case "tree":
        edge("tree", g.sourceId, "yields", "item", g.itemId);
        break;
      case "cook":
        edge("item", g.sourceId, "cooks_into", "item", g.itemId);
        break;
      case "cook_burn":
        edge("item", g.sourceId, "burns_into", "item", g.itemId);
        break;
      // herb / fishing are node-bound (no stable per-node entity worth a node);
      // their item obtainability is captured by the checks, not the graph.
      default:
        break;
    }
  }

  // ── Mining nodes: ore --mined_at--> (count) is implicit; link ore->item only.
  // Tree composed nodes reference tree types: tree --placed--> (count) implicit.

  const outIndex = new Map<string, GraphEdge[]>();
  const inIndex = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    (outIndex.get(e.from) ?? outIndex.set(e.from, []).get(e.from)!).push(e);
    (inIndex.get(e.to) ?? inIndex.set(e.to, []).get(e.to)!).push(e);
  }

  return {
    nodes,
    edges,
    outbound: (key) => outIndex.get(key) ?? [],
    inbound: (key) => inIndex.get(key) ?? [],
    resolve(idOrKey) {
      if (idOrKey.includes(":")) {
        const node = nodes.get(idOrKey);
        return node ? [node] : [];
      }
      const matches: GraphNode[] = [];
      for (const node of nodes.values()) if (node.id === idOrKey) matches.push(node);
      return matches;
    },
    suggest(query, limit = 8) {
      const q = query.toLowerCase();
      const scored: Array<{ node: GraphNode; score: number }> = [];
      for (const node of nodes.values()) {
        const id = node.id.toLowerCase();
        const label = node.label.toLowerCase();
        const score = matchScore(q, id, label);
        if (score > 0) scored.push({ node, score });
      }
      scored.sort((a, b) => b.score - a.score || a.node.key.localeCompare(b.node.key));
      return scored.slice(0, limit).map((s) => s.node);
    },
    byKind(kind) {
      const out: GraphNode[] = [];
      for (const node of nodes.values()) if (node.kind === kind) out.push(node);
      out.sort((a, b) => a.id.localeCompare(b.id));
      return out;
    }
  };
}

/**
 * Score a candidate id/label against a lowercase query. Higher is better; 0 means
 * no match. Rewards exact > prefix > word-boundary > substring > subsequence.
 */
function matchScore(q: string, id: string, label: string): number {
  let best = 0;
  for (const hay of [id, label]) {
    if (hay === q) best = Math.max(best, 100);
    else if (hay.startsWith(q)) best = Math.max(best, 80);
    else if (hay.includes("_" + q) || hay.includes(" " + q)) best = Math.max(best, 60);
    else if (hay.includes(q)) best = Math.max(best, 40);
    else if (isSubsequence(q, hay)) best = Math.max(best, 20);
  }
  return best;
}

/** True when every char of `needle` appears in `hay` in order (fuzzy match). */
function isSubsequence(needle: string, hay: string): boolean {
  if (!needle) return false;
  let i = 0;
  for (let h = 0; h < hay.length && i < needle.length; h += 1) {
    if (hay[h] === needle[i]) i += 1;
  }
  return i === needle.length;
}
