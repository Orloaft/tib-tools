// Shared terminal formatting for the tib-tools CLIs. Zero deps — raw ANSI, with
// automatic no-color when output is piped or NO_COLOR is set. Keep CLI styling
// consistent across tools by using these helpers.

import type { Severity } from "../content-graph/index.ts";

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function wrap(code: number, close: number): (s: string | number) => string {
  return (s) => (COLOR_ENABLED ? `[${code}m${s}[${close}m` : String(s));
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

export const SEVERITY_SYMBOL: Record<Severity, string> = { error: "✗", warn: "!", info: "·" };

export function severityColor(sev: Severity): (s: string | number) => string {
  return sev === "error" ? red : sev === "warn" ? yellow : gray;
}

/** A bold title with an underline rule the width of the title (min 24). */
export function heading(title: string): string {
  const width = Math.max(24, title.length);
  return `${bold(title)}\n${gray("─".repeat(width))}`;
}

export function rule(width = 60): string {
  return gray("─".repeat(width));
}

/** Strip ANSI for width math so coloured cells still align. */
function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "").length;
}

function padEndVisible(s: string, width: number): string {
  const pad = width - visibleLength(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

function padStartVisible(s: string, width: number): string {
  const pad = width - visibleLength(s);
  return pad > 0 ? " ".repeat(pad) + s : s;
}

export interface TableOptions {
  /** Column indices to right-align (e.g. numbers). */
  alignRight?: number[];
  /** Indent applied to every line. */
  indent?: number;
}

/**
 * Render an aligned table. Cells may contain ANSI colour; alignment accounts for
 * it. Headers are dimmed; pass [] to omit the header row.
 */
export function table(headers: string[], rows: string[][], opts: TableOptions = {}): string {
  const right = new Set(opts.alignRight ?? []);
  const indent = " ".repeat(opts.indent ?? 0);
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < colCount; c += 1) {
    widths[c] = Math.max(visibleLength(headers[c] ?? ""), ...rows.map((r) => visibleLength(r[c] ?? "")));
  }
  const renderRow = (cells: string[]): string =>
    indent +
    cells
      .map((cell, c) => (right.has(c) ? padStartVisible(cell, widths[c]!) : padEndVisible(cell, widths[c]!)))
      .join("  ")
      .trimEnd();

  const lines: string[] = [];
  if (headers.length > 0) lines.push(renderRow(headers.map((h) => dim(h))));
  for (const row of rows) lines.push(renderRow(row));
  return lines.join("\n");
}

/** True when a --help/-h flag is present in argv. */
export function wantsHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}
