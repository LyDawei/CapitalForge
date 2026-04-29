import { zodToJsonSchema } from 'zod-to-json-schema';
import { Tool, ToolContext, ToolInvocationResult } from './types';

/**
 * OpenAI tool-calling JSON shape (subset we actually use).
 */
export interface OpenAIToolDescriptor {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register<A, R>(tool: Tool<A, R>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as Tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Convert all registered tools into OpenAI tool descriptors. The terminal
   * tool (e.g. submit_decision) is included — the head trader is supposed to
   * call it to end the loop.
   */
  toOpenAITools(): OpenAIToolDescriptor[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ztjs = zodToJsonSchema as unknown as (s: any, opts?: any) => Record<string, unknown>;
    return this.list().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: ztjs(t.paramsSchema, { target: 'openApi3' }),
      },
    }));
  }

  /**
   * Invoke a tool by name. Errors are caught and surfaced via `errored` so a
   * single bad tool call can't crash the whole deliberation.
   */
  async invoke(name: string, args: unknown, ctx: ToolContext): Promise<ToolInvocationResult> {
    const tool = this.tools.get(name);
    const start = Date.now();
    if (!tool) {
      return {
        result: null,
        latencyMs: Date.now() - start,
        errored: true,
        errorMessage: `Unknown tool: ${name}`,
      };
    }
    try {
      const parsed = tool.paramsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          result: null,
          latencyMs: Date.now() - start,
          errored: true,
          errorMessage: `Args validation failed: ${parsed.error.message}`,
        };
      }
      const result = await tool.execute(parsed.data, ctx);
      return {
        result,
        latencyMs: Date.now() - start,
        errored: false,
        errorMessage: null,
      };
    } catch (err) {
      return {
        result: null,
        latencyMs: Date.now() - start,
        errored: true,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
