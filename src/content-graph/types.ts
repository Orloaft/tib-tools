export type Severity = "error" | "warn" | "info";

/** A single referential-integrity / content-quality issue. */
export interface Finding {
  /** Stable rule id, e.g. "spawn.monster". */
  rule: string;
  severity: Severity;
  /** Human-readable description of the problem. */
  message: string;
  /** The entity the finding is about, e.g. "quest:badlands_truce". */
  subject: string;
}

export interface GraphCounts {
  monsters: number;
  items: number;
  npcs: number;
  quests: number;
  spawns: number;
  zones: number;
  oreKinds: number;
  miningNodes: number;
  herbNodes: number;
  fishingNodes: number;
  treeNodes: number;
  abilities: number;
}

export interface AnalysisSummary {
  counts: GraphCounts;
  errors: number;
  warnings: number;
  infos: number;
}

export interface Analysis {
  findings: Finding[];
  summary: AnalysisSummary;
}
