import type {
  StateSnapshot,
  PlayerView,
  MonsterView,
  NpcView,
  CorpseView,
  TreeView,
  FishingNodeView,
  MiningNodeView,
  HerbNodeView,
  FireView
} from "@game/src/types.ts";

/**
 * A live, merged view of the world. The game server sends state as **deltas**:
 * each snapshot carries only the collections that changed, with a `<coll>Full`
 * flag (replace vs. upsert) and `removed<Coll>Ids` (deletions). The connector
 * surfaces those raw deltas; this model folds them into a single coherent world
 * so consumers (the GM Dashboard) get the full current state every time.
 */
export interface MergedWorld {
  players: PlayerView[];
  monsters: MonsterView[];
  npcs: NpcView[];
  corpses: CorpseView[];
  trees: TreeView[];
  fishingNodes: FishingNodeView[];
  miningNodes: MiningNodeView[];
  herbNodes: HerbNodeView[];
  fires: FireView[];
  /** Total entity counts per collection. */
  counts: {
    players: number;
    monsters: number;
    npcs: number;
    corpses: number;
    trees: number;
    fishingNodes: number;
    miningNodes: number;
    herbNodes: number;
    fires: number;
  };
  /** Sorted list of floors that currently hold any entity. */
  floors: number[];
}

/** A delta slice of a snapshot for one collection. */
interface CollSpec<T> {
  items: T[] | undefined;
  full: boolean | undefined;
  removed: string[] | undefined;
}

/** Anything with an `id`; every view in a collection has one. */
interface HasId {
  id: string;
}

/** Anything placed in the world; used for floor grouping. */
interface HasFloor {
  floor: number;
}

export class WorldModel {
  private readonly players = new Map<string, PlayerView>();
  private readonly monsters = new Map<string, MonsterView>();
  private readonly npcs = new Map<string, NpcView>();
  private readonly corpses = new Map<string, CorpseView>();
  private readonly trees = new Map<string, TreeView>();
  private readonly fishingNodes = new Map<string, FishingNodeView>();
  private readonly miningNodes = new Map<string, MiningNodeView>();
  private readonly herbNodes = new Map<string, HerbNodeView>();
  private readonly fires = new Map<string, FireView>();

  /** Fold one delta snapshot into the model. */
  apply(snap: StateSnapshot): void {
    merge(this.players, { items: snap.players, full: snap.playersFull, removed: snap.removedPlayerIds });
    merge(this.monsters, { items: snap.monsters, full: snap.monstersFull, removed: snap.removedMonsterIds });
    merge(this.npcs, { items: snap.npcs, full: snap.npcsFull, removed: snap.removedNpcIds });
    merge(this.corpses, { items: snap.corpses, full: snap.corpsesFull, removed: snap.removedCorpseIds });
    merge(this.trees, { items: snap.trees, full: snap.treesFull, removed: snap.removedTreeIds });
    merge(this.fishingNodes, { items: snap.fishingNodes, full: snap.fishingNodesFull, removed: snap.removedFishingNodeIds });
    merge(this.miningNodes, { items: snap.miningNodes, full: snap.miningNodesFull, removed: snap.removedMiningNodeIds });
    merge(this.herbNodes, { items: snap.herbNodes, full: snap.herbNodesFull, removed: snap.removedHerbNodeIds });
    merge(this.fires, { items: snap.fires, full: snap.firesFull, removed: snap.removedFireIds });
  }

  /** Snapshot the merged world as plain arrays plus derived data. */
  getWorld(): MergedWorld {
    const players = [...this.players.values()];
    const monsters = [...this.monsters.values()];
    const npcs = [...this.npcs.values()];
    const corpses = [...this.corpses.values()];
    const trees = [...this.trees.values()];
    const fishingNodes = [...this.fishingNodes.values()];
    const miningNodes = [...this.miningNodes.values()];
    const herbNodes = [...this.herbNodes.values()];
    const fires = [...this.fires.values()];

    const floorSet = new Set<number>();
    for (const list of [players, monsters, npcs, corpses, trees, fishingNodes, miningNodes, herbNodes, fires] as HasFloor[][]) {
      for (const e of list) floorSet.add(e.floor);
    }

    return {
      players,
      monsters,
      npcs,
      corpses,
      trees,
      fishingNodes,
      miningNodes,
      herbNodes,
      fires,
      counts: {
        players: players.length,
        monsters: monsters.length,
        npcs: npcs.length,
        corpses: corpses.length,
        trees: trees.length,
        fishingNodes: fishingNodes.length,
        miningNodes: miningNodes.length,
        herbNodes: herbNodes.length,
        fires: fires.length
      },
      floors: [...floorSet].sort((a, b) => a - b)
    };
  }

  /** Forget everything (e.g. on reconnect). */
  reset(): void {
    this.players.clear();
    this.monsters.clear();
    this.npcs.clear();
    this.corpses.clear();
    this.trees.clear();
    this.fishingNodes.clear();
    this.miningNodes.clear();
    this.herbNodes.clear();
    this.fires.clear();
  }
}

/** Apply one collection's delta to its Map: replace-if-full, then upsert, then delete. */
function merge<T extends HasId>(store: Map<string, T>, spec: CollSpec<T>): void {
  if (spec.full) store.clear();
  if (spec.items) {
    for (const item of spec.items) store.set(item.id, item);
  }
  if (spec.removed) {
    for (const id of spec.removed) store.delete(id);
  }
}
