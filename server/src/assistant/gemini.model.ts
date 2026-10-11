import type { AssistantModel, PlanInput } from "./model";
import { PLAN_SCHEMA, systemPrompt, userMessage } from "./prompt";

// Gemini through its REST API with structured output: one call, JSON shaped like
// AssistantPlan. Plain fetch keeps the dependency list as it is and is easy to fake in tests.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiModel implements AssistantModel {
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.name = `gemini:${model}`;
  }

  async plan(input: PlanInput, signal: AbortSignal): Promise<unknown> {
    const contents = [
      ...input.history.map((t) => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text }] })),
      { role: "user", parts: [{ text: userMessage(input) }] },
    ];
    const res = await this.fetchFn(`${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(input.locale) }] },
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: PLAN_SCHEMA,
          temperature: 0.2,
          maxOutputTokens: 1024,
          // a voice turn must be quick; this task needs no long reasoning
          thinkingConfig: this.model.startsWith("gemini-2.5") ? { thinkingBudget: 0 } : { thinkingLevel: "low" },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text; // fails AssistantPlan validation, which triggers the retry
    }
  }
}
