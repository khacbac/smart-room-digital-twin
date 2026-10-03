import { describe, expect, it } from "vitest";
import { Controller, classify, loadModel } from "../scripts/edge-ai/infer";

// The TS inference must make the same decisions as device/lib/edge_ai (test_edge_ai) on the
// canonical scenarios of ml/policy.md. Both read the weights ml/train.py exported.
const model = loadModel();

const f = (temperature: number, humidity: number, airQuality: number, light: number, presence: boolean) => ({
  temperature,
  humidity,
  airQuality,
  light,
  presence,
});

describe("edge-ai inference (TS twin of lib/edge_ai)", () => {
  it("loads the exported model", () => {
    expect(model.layers).toHaveLength(3);
    expect(model.layers[0]?.in).toBe(5);
    expect(model.outputs.angles).toEqual([0, 20, 30, 45, 60, 70, 90]);
  });

  it.each([
    [f(26, 55, 300, 450, true), "NORMAL", 0, false],
    [f(27, 60, 400, 450, true), "NORMAL", 20, false],
    [f(27, 60, 400, 450, false), "NORMAL", 0, false],
    [f(16, 50, 200, 300, true), "UNCOMFORTABLE", 0, false],
    [f(26, 78, 250, 450, true), "UNCOMFORTABLE", 45, false],
    [f(28.5, 72, 300, 5, true), "UNCOMFORTABLE", 30, false],
    [f(26, 55, 540, 450, false), "UNCOMFORTABLE", 60, false],
    [f(31.5, 50, 300, 450, true), "WARNING", 70, false],
    [f(27, 55, 670, 450, true), "WARNING", 90, false],
    [f(27, 55, 820, 450, true), "WARNING", 90, true],
    [f(27, 55, 820, 450, false), "WARNING", 90, false],
    [f(35, 50, 300, 450, false), "DANGER", 90, true],
    [f(27, 55, 950, 0, false), "DANGER", 90, true],
  ])("%o -> %s %d° buzzer %s", (input, state, angle, buzzer) => {
    const r = classify(model, input);
    expect(r.valid).toBe(true);
    expect(r.state).toBe(state);
    expect(r.windowAngle).toBe(angle);
    expect(r.buzzer).toBe(buzzer);
  });

  it("is invalid without temperature/humidity (DHT fault → rules only)", () => {
    expect(classify(model, { ...f(26, 55, 300, 450, true), temperature: null }).valid).toBe(false);
  });

  it("controller escalates at once and relaxes after two samples", () => {
    const c = new Controller(model);
    expect(c.step(f(26, 55, 300, 450, true)).state).toBe("NORMAL");
    expect(c.step(f(35, 50, 300, 450, false)).state).toBe("DANGER");
    expect(c.step(f(26, 55, 300, 450, true)).state).toBe("DANGER");
    expect(c.step(f(26, 55, 300, 450, true)).state).toBe("NORMAL");
  });
});
