import Anthropic from '@anthropic-ai/sdk';
import { Config } from '../config';
import { AgentOutput, AgentOutputSchema } from '../types';

export interface LLMService {
  complete(prompt: string): Promise<{ parsed: AgentOutput; raw: string }>;
}

export class RealLLMService implements LLMService {
  private client: Anthropic;
  private model: string;
  private temperature: number;

  constructor(config: Config) {
    this.client = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
    this.model = config.llmModel;
    this.temperature = config.llmTemperature;
  }

  async complete(prompt: string): Promise<{ parsed: AgentOutput; raw: string }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      temperature: this.temperature,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text content from response
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in LLM response');
    }

    const raw = textContent.text;

    // Parse JSON from response
    const parsed = this.parseResponse(raw);

    return { parsed, raw };
  }

  private parseResponse(raw: string): AgentOutput {
    // Try to extract JSON from the response
    // The response might have markdown code blocks or extra text
    let jsonStr = raw;

    // Try to find JSON in code blocks
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      // Try to find raw JSON object
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`Failed to parse LLM response as JSON: ${raw}`);
    }

    // Validate with zod
    const result = AgentOutputSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `LLM response validation failed: ${result.error.message}\nRaw: ${raw}`
      );
    }

    return result.data;
  }
}

export function createLLMService(config: Config): LLMService {
  return new RealLLMService(config);
}
