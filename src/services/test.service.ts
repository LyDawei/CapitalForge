import { LLMService } from './llm';
import { MockLLMService } from './llm.mock';
import { AgentOutput } from '../types';

// Test service that depends on MockLLMService
// Used for testing the Zan VS Code extension integration

export interface TestServiceResult {
  input: string;
  output: AgentOutput;
  processingTimeMs: number;
}

export class TestService {
  private llmService: LLMService;

  constructor(llmService?: LLMService) {
    this.llmService = llmService ?? new MockLLMService();
  }

  async analyze(prompt: string): Promise<TestServiceResult> {
    const startTime = Date.now();

    const { parsed } = await this.llmService.complete(prompt);

    return {
      input: prompt,
      output: parsed,
      processingTimeMs: Date.now() - startTime,
    };
  }

  async batchAnalyze(prompts: string[]): Promise<TestServiceResult[]> {
    const results: TestServiceResult[] = [];

    for (const prompt of prompts) {
      const result = await this.analyze(prompt);
      results.push(result);
    }

    return results;
  }

  async healthCheck(): Promise<{ status: 'ok' | 'error'; message: string }> {
    try {
      const testPrompt = 'RSI(14): 50\nSMA(20): $100\nSMA(50): $95\nClose: $105';
      await this.llmService.complete(testPrompt);
      return { status: 'ok', message: 'MockLLMService is functioning correctly' };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async echo(message: string): Promise<string> {
    return message;
  }

  async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async generateRandomNumber(min: number, max: number): Promise<number> {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async reverseString(input: string): Promise<string> {
    return input.split('').reverse().join('');
  }

  async countWords(text: string): Promise<number> {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  async toUpperCase(input: string): Promise<string> {
    return input.toUpperCase();
  }

  async toLowerCase(input: string): Promise<string> {
    return input.toLowerCase();
  }

  async concatenate(...strings: string[]): Promise<string> {
    return strings.join('');
  }

  async sum(numbers: number[]): Promise<number> {
    return numbers.reduce((acc, num) => acc + num, 0);
  }

  async average(numbers: number[]): Promise<number> {
    if (numbers.length === 0) return 0;
    const total = await this.sum(numbers);
    return total / numbers.length;
  }

  async findMax(numbers: number[]): Promise<number | null> {
    if (numbers.length === 0) return null;
    return Math.max(...numbers);
  }

  async findMin(numbers: number[]): Promise<number | null> {
    if (numbers.length === 0) return null;
    return Math.min(...numbers);
  }

  async isPalindrome(input: string): Promise<boolean> {
    const cleaned = input.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleaned === cleaned.split('').reverse().join('');
  }

  async factorial(n: number): Promise<number> {
    if (n < 0) throw new Error('Factorial not defined for negative numbers');
    if (n <= 1) return 1;
    return n * (await this.factorial(n - 1));
  }

  async fibonacci(n: number): Promise<number> {
    if (n <= 0) return 0;
    if (n === 1) return 1;
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
      const temp = a + b;
      a = b;
      b = temp;
    }
    return b;
  }

  async isPrime(num: number): Promise<boolean> {
    if (num < 2) return false;
    for (let i = 2; i <= Math.sqrt(num); i++) {
      if (num % i === 0) return false;
    }
    return true;
  }

  async filterEven(numbers: number[]): Promise<number[]> {
    return numbers.filter((n) => n % 2 === 0);
  }

  async filterOdd(numbers: number[]): Promise<number[]> {
    return numbers.filter((n) => n % 2 !== 0);
  }

  async sortAscending(numbers: number[]): Promise<number[]> {
    return [...numbers].sort((a, b) => a - b);
  }

  async sortDescending(numbers: number[]): Promise<number[]> {
    return [...numbers].sort((a, b) => b - a);
  }

  async removeDuplicates<T>(items: T[]): Promise<T[]> {
    return [...new Set(items)];
  }

  async flattenArray<T>(nested: T[][]): Promise<T[]> {
    return nested.flat();
  }

  async chunkArray<T>(array: T[], size: number): Promise<T[][]> {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async getTimestamp(): Promise<number> {
    return Date.now();
  }

  async formatDate(date: Date): Promise<string> {
    return date.toISOString();
  }

  async parseJson<T>(json: string): Promise<T> {
    return JSON.parse(json);
  }

  async stringifyJson(obj: unknown): Promise<string> {
    return JSON.stringify(obj, null, 2);
  }
}

export function createTestService(llmService?: LLMService): TestService {
  return new TestService(llmService);
}
