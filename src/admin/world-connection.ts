import type { StateSnapshot } from "@game/src/types.ts";
import { connectAdmin, type AdminConnection, type AdminOptions } from "./connect.ts";
import { WorldModel, type MergedWorld } from "./world.ts";

/**
 * An admin connection that additionally maintains a live, delta-merged world
 * model. Every server snapshot is folded into the model, so `getWorld()` always
 * returns the full current state (not a delta). This is the substrate the GM
 * Dashboard server consumes.
 */
export interface AdminWorldConnection extends AdminConnection {
  /** The merged, full world as of the last snapshot. */
  getWorld(): MergedWorld;
}

/**
 * Like {@link connectAdmin}, but the returned connection carries a merged world
 * model and invokes `onWorld` (in addition to the usual `onState`) on every
 * snapshot, after the delta has been folded in.
 */
export async function connectAdminWorld(
  opts: AdminOptions & { onWorld?: (world: MergedWorld) => void } = {}
): Promise<AdminWorldConnection> {
  const world = new WorldModel();
  const { onWorld, onState, ...rest } = opts;

  const conn = await connectAdmin({
    ...rest,
    onState: (state: StateSnapshot) => {
      world.apply(state);
      onState?.(state);
      onWorld?.(world.getWorld());
    }
  });

  // The connector may have already buffered the first snapshot before our
  // onState was wired up in some paths; fold whatever is current to be safe.
  const seeded = conn.latestState();
  if (seeded) world.apply(seeded);

  return {
    ...conn,
    get id() {
      return conn.id;
    },
    getWorld() {
      return world.getWorld();
    }
  };
}
