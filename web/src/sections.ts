import type { StoryFocus } from "./api";

// The six pages inside a story (plan 5.1).
export const SECTIONS = ["ideate", "cast", "world", "timeline", "plot", "write"] as const;
export type Section = (typeof SECTIONS)[number];

export function isSection(value: unknown): value is Section {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

/** Where a story opens: Shape stories in Ideate, Write stories in Write. */
export function defaultSection(focus: StoryFocus): Section {
  return focus === "write" ? "write" : "ideate";
}

/** The focus only changes emphasis: Write stories list the manuscript first. Nothing is locked. */
export function orderedSections(focus: StoryFocus): Section[] {
  return focus === "write" ? ["write", ...SECTIONS.filter((section) => section !== "write")] : [...SECTIONS];
}

export function workPath(workId: string, section: Section): string {
  return `/works/${encodeURIComponent(workId)}/${section}`;
}

const NUMERALS = ["i", "ii", "iii", "iv", "v", "vi"];
export const numeral = (index: number): string => `${NUMERALS[index] ?? index + 1}.`;
