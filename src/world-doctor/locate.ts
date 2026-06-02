import type { Finding } from "../content-graph/index.ts";

// Findings carry only a string `subject` (the shared Finding type), but every
// World Doctor subject encodes its location in one of a few stable shapes:
//
//   floor:6                     floor-wide
//   floor:6@(78,44)             a region sample on a floor
//   portal:1@(55,1)->0          a portal tile (from-floor + from-tile)
//   spawn:bog_wraith@3(81,25)   an entity on a floor at (tx,ty)
//   mining:mine-6-71-49         a node, id-encoded as kind-floor-x-y
//
// We parse the floor here (used by the CLI for grouping/filtering). Precise
// per-finding coords are resolved in the atlas builder, which also has the
// catalog (node *approach* tiles differ from the id-encoded node tile).

/** The floor a finding is about, or undefined if it isn't floor-scoped. */
export function findingFloor(f: Finding): number | undefined {
  const s = f.subject;

  // "floor:N" / "floor:N@(...)"
  let m = /^floor:(\d+)/.exec(s);
  if (m) return Number(m[1]);

  // "portal:N@(...)..." — the source floor.
  m = /^portal:(\d+)@/.exec(s);
  if (m) return Number(m[1]);

  // "spawn:type@N(...)" / "tree:type@N(...)" — floor after the '@'.
  m = /@(\d+)\(/.exec(s);
  if (m) return Number(m[1]);

  // node ids "kind-FLOOR-x-y" (mining/herb/fishing).
  m = /^(?:mining|herb|fishing):[a-z]+-(\d+)-\d+-\d+/.exec(s);
  if (m) return Number(m[1]);

  return undefined;
}
