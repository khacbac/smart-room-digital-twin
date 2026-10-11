import type { AssistantModel, PlanInput } from "./model";
import { PLAN_JSON_SCHEMA, systemPrompt, userMessage } from "./prompt";

// Claude through the Messages API. The plan comes back as the input of a forced tool call,
// so it is always JSON shaped like AssistantPlan. Plain fetch, like GeminiModel.

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const TOOL = "room_plan";

export class AnthropicModel implements AssistantModel {
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.name = `anthropic:${model}`;
  }

  async plan(input: PlanInput, signal: AbortSignal): Promise<unknown> {
    const messages = [
      ...input.history.map((t) => ({ role: t.role === "user" ? "user" : "assistant", content: t.text })),
      { role: "user", content: userMessage(input) },
    ];
    const res = await this.fetchFn(ENDPOINT, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt(input.locale),
        messages,
        tools: [{ name: TOOL, description: "Answer the user: intent, commands to send, spoken reply.", input_schema: PLAN_JSON_SCHEMA }],
        tool_choice: { type: "tool", name: TOOL },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    // a missing tool call fails AssistantPlan validation, which triggers the retry
    return json.content?.find((b) => b.type === "tool_use" && b.name === TOOL)?.input ?? null;
  }
}
