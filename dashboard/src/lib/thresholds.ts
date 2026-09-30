import type { EdgeState } from "@srdt/contracts";

// ENTER thresholds of spec §7.4 (device/include/config.h is the authority; these only
// colour the value cards and draw guide lines, they never decide the state).

export const AQ_LINES = [
  { value: 500, state: "UNCOMFORTABLE" },
  { value: 700, state: "WARNING" },
  { value: 900, state: "DANGER" },
] as const satisfies readonly { value: number; state: EdgeState }[];

export const TEMP_LINES = [
  { value: 29, state: "UNCOMFORTABLE" },
  { value: 31, state: "WARNING" },
  { value: 34, state: "DANGER" },
] as const satisfies readonly { value: number; state: EdgeState }[];

export const HUMIDITY_LINES = [{ value: 75, state: "UNCOMFORTABLE" }] as const satisfies readonly {
  value: number;
  state: EdgeState;
}[];

/** Highest state whose ENTER threshold `value` reaches, or null below all of them. */
export function levelFor(value: number | null, lines: readonly { value: number; state: EdgeState }[]): EdgeState | null {
  if (value === null) return null;
  let level: EdgeState | null = null;
  for (const line of lines) if (value >= line.value) level = line.state;
  return level;
}
