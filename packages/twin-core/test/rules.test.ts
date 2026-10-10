import { describe, expect, it } from "vitest";
import {
  AQ_LINES,
  HUMIDITY_LINES,
  TEMP_LINES,
  actionGroup,
  ago,
  apiErrorText,
  clockTime,
  conflicts,
  countdown,
  isBusy,
  levelFor,
  resultText,
  windowLabel,
} from "../src";
import { T0, command, iso } from "./fixtures";

describe("levelFor", () => {
  it("returns the highest threshold reached", () => {
    expect(levelFor(null, TEMP_LINES)).toBeNull();
    expect(levelFor(28.9, TEMP_LINES)).toBeNull();
    expect(levelFor(29, TEMP_LINES)).toBe("UNCOMFORTABLE");
    expect(levelFor(33, TEMP_LINES)).toBe("WARNING");
    expect(levelFor(34, TEMP_LINES)).toBe("DANGER");
    expect(levelFor(80, HUMIDITY_LINES)).toBe("UNCOMFORTABLE");
    expect(levelFor(950, AQ_LINES)).toBe("DANGER");
  });
});

describe("command rules", () => {
  it("groups actions and finds conflicts", () => {
    expect(conflicts(actionGroup("OPEN_WINDOW"), actionGroup("CLOSE_WINDOW"))).toBe(true);
    expect(conflicts(actionGroup("OPEN_WINDOW"), actionGroup("BUZZER_ON"))).toBe(false);
    expect(conflicts(actionGroup("CLEAR_OVERRIDE"), actionGroup("BUZZER_OFF"))).toBe(true);
    expect(conflicts(actionGroup("PING"), actionGroup("CLEAR_OVERRIDE"))).toBe(false);
  });

  it("is busy while a conflicting request or open command exists", () => {
    expect(isBusy("CLOSE_WINDOW", ["OPEN_WINDOW"], [])).toBe(true);
    expect(isBusy("BUZZER_ON", ["OPEN_WINDOW"], [])).toBe(false);
    expect(isBusy("BUZZER_ON", [], [command("c1", T0, { status: "sent" })])).toBe(false);
    expect(isBusy("CLEAR_OVERRIDE", [], [command("c1", T0, { status: "sent" })])).toBe(true);
    expect(isBusy("CLOSE_WINDOW", [], [command("c1", T0, { status: "executed" })])).toBe(false);
  });

  it("describes results", () => {
    expect(resultText(command("c1", T0, { status: "executed", ackedAt: iso(T0 + 800) }))).toBe(
      "Open window completed in 0.8 s",
    );
    expect(resultText(command("c1", T0, { status: "rejected", reason: "VALUE_OUT_OF_RANGE" }))).toBe(
      "Open window rejected by the device (VALUE_OUT_OF_RANGE)",
    );
    expect(resultText(command("c1", T0, { action: "BUZZER_OFF", status: "timeout" }))).toBe(
      "Silence alarm: device did not respond in time",
    );
    expect(apiErrorText("RATE_LIMITED", "x")).toBe("Too many commands, wait a moment");
    expect(apiErrorText("NOT_FOUND", "device not found")).toBe("device not found");
  });
});

describe("format", () => {
  it("formats relative and countdown times", () => {
    expect(ago(null, T0)).toBe("never");
    expect(ago(T0 - 3000, T0)).toBe("3 s ago");
    expect(ago(T0 - 4 * 60_000, T0)).toBe("4 min ago");
    expect(ago(T0 - 3 * 86_400_000, T0)).toBe("3 d ago");
    expect(countdown(125)).toBe("2:05");
    expect(countdown(-3)).toBe("0:00");
  });

  it("formats clock time and window labels", () => {
    expect(clockTime(new Date(2026, 9, 10, 9, 5, 7).getTime())).toBe("09:05:07");
    expect(windowLabel(0)).toBe("0° (closed)");
    expect(windowLabel(45)).toBe("45° (partly open)");
    expect(windowLabel(90)).toBe("90° (open)");
    expect(windowLabel(null)).toBe("—");
  });
});
