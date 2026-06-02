export const TOKEN_RE = /\{([^}]+)\}/g;

export interface DialogueContextInput {
  targetCount: number;
  rewardGold: number;
  rewardXp: number;
  hasItem: boolean;
  itemId?: string | null;
  itemLabel?: string | null;
  npcName: string;
  playerName: string;
  progress: number;
}

/**
 * The context a quest dialogue line is rendered against, mirroring the server's
 * `questDialogue` (server/index.ts). `target.item` is null for quests with no
 * itemId (e.g. kill quests), so `{target.item.label}` there renders literally.
 */
export function buildContext(i: DialogueContextInput): Record<string, unknown> {
  return {
    progress: i.progress,
    target: {
      count: i.targetCount,
      remaining: Math.max(0, i.targetCount - i.progress),
      item: i.hasItem ? { id: i.itemId ?? "item", label: i.itemLabel ?? i.itemId ?? "the item" } : null
    },
    reward: { gold: i.rewardGold, xp: i.rewardXp },
    player: { name: i.playerName },
    npc: { name: i.npcName }
  };
}

/** Exactly the server's `renderQuestLine`: unknown/null paths stay as literal braces. */
export function renderLine(text: string, ctx: Record<string, unknown>): string {
  return text.replace(TOKEN_RE, (_m, key: string) => {
    const parts = key.split(".");
    let value: unknown = ctx;
    for (const part of parts) {
      if (value == null) return `{${key}}`;
      value = (value as Record<string, unknown>)[part];
    }
    return value == null ? `{${key}}` : String(value);
  });
}

/** The token paths that resolve to a usable (primitive) value for a given quest. */
export function validLeaves(hasItem: boolean): Set<string> {
  const leaves = ["progress", "target.count", "target.remaining", "reward.gold", "reward.xp", "player.name", "npc.name"];
  if (hasItem) leaves.push("target.item.id", "target.item.label");
  return new Set(leaves);
}

export function extractTokens(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[1]!);
}

/** Why a token won't render — used for lint messages. null means it's fine. */
export function tokenProblem(token: string, hasItem: boolean): string | null {
  if (validLeaves(hasItem).has(token)) return null;
  if (!hasItem && token.startsWith("target.item")) {
    return `this quest has no reward item, so "{${token}}" renders literally in-game`;
  }
  if (token === "target" || token === "target.item" || token === "reward" || token === "player" || token === "npc") {
    return `"{${token}}" is an object, not a value — it renders as "[object Object]" or literal braces`;
  }
  return `unknown token "{${token}}" — it renders as literal text in-game`;
}
