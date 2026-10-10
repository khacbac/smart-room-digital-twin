import type { EdgeState } from "@srdt/contracts";

// Labels and formatters are shared with the app (@srdt/twin-core); colours are not, the
// dashboard takes them from CSS variables.

/** CSS variable per edge state (defined in globals.css). */
export const STATE_COLOR: Record<EdgeState, string> = {
  NORMAL: "var(--state-normal)",
  UNCOMFORTABLE: "var(--state-uncomfortable)",
  WARNING: "var(--state-warning)",
  DANGER: "var(--state-danger)",
};
