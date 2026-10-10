import type { EdgeState } from "@srdt/contracts";
import type { ColorName } from "./colors";

/** Theme colour token per edge state (the dashboard's STATE_COLOR). */
export const STATE_TOKEN: Record<EdgeState, ColorName> = {
  NORMAL: "state-normal",
  UNCOMFORTABLE: "state-uncomfortable",
  WARNING: "state-warning",
  DANGER: "state-danger",
};
