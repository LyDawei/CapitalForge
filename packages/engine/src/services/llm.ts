import OpenAI from 'openai';
import { Config } from '../config';
import { AgentOutput, AgentOutputSchema } from '../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Present when role === 'assistant' and the LLM emitted tool calls. */
  toolCalls?: ToolCallRequest[];
  /** Present when role === 'tool'. */
  toolCallId?: string;
  /** Optional name on tool messages. */
  name?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolDescriptor {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatWithToolsResult {
  message: {
    role: 'assistant';
    content: string | null;
    toolCalls: ToolCallRequest[];
  };
  /** Total tokens this round (best-effort, may be undefined for some providers). */
  totalTokens?: number;
  /** Raw provider response (stringified) for audit/debug. */
  raw: string;
}

export interface LLMService {
  /** V1 path: returns AgentOutput-validated response. */
  complete(prompt: string): Promise<{ parsed: AgentOutput; raw: string }>;
  /** V2 path: raw text completion. Caller validates. */
  completeRaw(prompt: string): Promise<string>;
  /**
   * V2 / M4 path: tool-calling chat. Returns the assistant's reply plus any
   * tool-call requests it emitted. The caller dispatches tools, appends
   * tool-result messages, and calls again until a terminal tool fires (or a
   * max-rounds cap is hit).
   */
  chatWithTools(input: {
    messages: ChatMessage[];
    tools: ToolDescriptor[];
    toolChoice?: 'auto' | 'required' | { name: string };
  }): Promise<ChatWithToolsResult>;
}

export class RealLLMService implements LLMService {
  private client: OpenAI;
  private model: string;
  private temperature: number;

  constructor(config: Config) {
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.llmModel;
    this.temperature = config.llmTemperature;
  }

  async completeRaw(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 1024,
      temperature: this.temperature,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No content in LLM response');
    return content;
  }

  async complete(prompt: string): Promise<{ parsed: AgentOutput; raw: string }> {
    const raw = await this.completeRaw(prompt);
    const parsed = parseAgentOutput(raw);
    return { parsed, raw };
  }

  async chatWithTools(input: {
    messages: ChatMessage[];
    tools: ToolDescriptor[];
    toolChoice?: 'auto' | 'required' | { name: string };
  }): Promise<ChatWithToolsResult> {
    const openaiMessages = input.messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: m.toolCallId ?? '',
          content: m.content ?? '',
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: m.content ?? '',
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      }
      return { role: m.role as 'system' | 'user' | 'assistant', content: m.content ?? '' };
    });

    const tool_choice =
      input.toolChoice === 'required'
        ? 'required'
        : typeof input.toolChoice === 'object'
          ? { type: 'function' as const, function: { name: input.toolChoice.name } }
          : 'auto';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 1024,
      temperature: this.temperature,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: openaiMessages as any,
      tools: input.tools,
      tool_choice,
    });

    const choice = response.choices?.[0];
    const msg = choice?.message ?? {};
    const toolCalls: ToolCallRequest[] = (msg.tool_calls ?? []).map((tc: {
      id: string;
      function: { name: string; arguments: string };
    }) => {
      let parsed: unknown = {};
      try {
        parsed = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        parsed = { __raw_args: tc.function?.arguments };
      }
      return { id: tc.id, name: tc.function.name, args: parsed };
    });

    return {
      message: {
        role: 'assistant',
        content: msg.content ?? null,
        toolCalls,
      },
      totalTokens: response.usage?.total_tokens,
      raw: JSON.stringify(response),
    };
  }
}

/** Extract JSON from an LLM text response, handling markdown code fences. */
export function extractJson(raw: string): unknown {
  let jsonStr = raw;
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  } else {
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) jsonStr = objectMatch[0];
  }
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse LLM response as JSON: ${raw}`);
  }
}

function parseAgentOutput(raw: string): AgentOutput {
  const parsed = extractJson(raw);
  const result = AgentOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`LLM response validation failed: ${result.error.message}\nRaw: ${raw}`);
  }
  return result.data;
}

export function createLLMService(config: Config): LLMService {
  return new RealLLMService(config);
}
