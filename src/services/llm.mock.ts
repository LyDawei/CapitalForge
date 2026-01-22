import { LLMService } from './llm';
import { AgentOutput, TechnicalData, SandboxContext } from '../types';

// Deterministic mock LLM for testing
// Produces consistent outputs based on input data

export class MockLLMService implements LLMService {
  async complete(prompt: string): Promise<{ parsed: AgentOutput; raw: string }> {
    // Simulate slight network delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Parse the prompt to extract key data for deterministic response
    const output = this.generateDeterministicOutput(prompt);

    const raw = JSON.stringify(output, null, 2);
    return { parsed: output, raw };
  }

  private generateDeterministicOutput(prompt: string): AgentOutput {
    // Extract technical data from prompt for deterministic scoring
    const rsi = this.extractNumber(prompt, /RSI\(14\):\s*([\d.]+)/);
    const sma20 = this.extractNumber(prompt, /SMA\(20\):\s*\$?([\d.]+)/);
    const sma50 = this.extractNumber(prompt, /SMA\(50\):\s*\$?([\d.]+)/);
    const close = this.extractNumber(prompt, /Close:\s*\$?([\d.]+)/);
    const macdHistogram = this.extractNumber(prompt, /MACD Histogram:\s*([-\d.]+)/);

    // Determine agent type from prompt
    const agentType = this.detectAgentType(prompt);

    // Generate deterministic score based on agent type and technicals
    const { bullishScore, confidence, rationale } = this.calculateScore(
      agentType,
      rsi,
      sma20,
      sma50,
      close,
      macdHistogram
    );

    return {
      bullishScore,
      confidence,
      rationale,
    };
  }

  private extractNumber(text: string, regex: RegExp): number {
    const match = text.match(regex);
    if (match) {
      return parseFloat(match[1]);
    }
    return 0;
  }

  private detectAgentType(prompt: string): 'momentum' | 'meanReversion' | 'confirmation' {
    if (prompt.toLowerCase().includes('momentum')) {
      return 'momentum';
    } else if (prompt.toLowerCase().includes('mean reversion')) {
      return 'meanReversion';
    } else if (prompt.toLowerCase().includes('confirmation')) {
      return 'confirmation';
    }
    return 'momentum'; // Default
  }

  private calculateScore(
    agentType: 'momentum' | 'meanReversion' | 'confirmation',
    rsi: number,
    sma20: number,
    sma50: number,
    close: number,
    macdHistogram: number
  ): { bullishScore: number; confidence: number; rationale: string[] } {
    let bullishScore = 0;
    let confidence = 0.5;
    const rationale: string[] = [];

    switch (agentType) {
      case 'momentum':
        // Momentum: trend following
        if (close > sma20 && sma20 > sma50) {
          bullishScore += 0.4;
          rationale.push('Price above both SMAs indicates uptrend');
        } else if (close < sma20 && sma20 < sma50) {
          bullishScore -= 0.4;
          rationale.push('Price below both SMAs indicates downtrend');
        }

        if (rsi > 50 && rsi < 70) {
          bullishScore += 0.3;
          confidence += 0.1;
          rationale.push('RSI shows healthy bullish momentum');
        } else if (rsi < 50 && rsi > 30) {
          bullishScore -= 0.3;
          confidence += 0.1;
          rationale.push('RSI shows bearish momentum');
        } else if (rsi >= 70) {
          bullishScore -= 0.1;
          rationale.push('RSI overbought - momentum may be exhausting');
        } else if (rsi <= 30) {
          bullishScore += 0.1;
          rationale.push('RSI oversold - potential momentum reversal');
        }
        break;

      case 'meanReversion':
        // Mean reversion: contrarian
        if (rsi >= 70) {
          bullishScore -= 0.5;
          confidence += 0.2;
          rationale.push('RSI overbought - expecting mean reversion down');
        } else if (rsi <= 30) {
          bullishScore += 0.5;
          confidence += 0.2;
          rationale.push('RSI oversold - expecting mean reversion up');
        }

        // Price deviation from SMA
        const deviation = sma20 > 0 ? (close - sma20) / sma20 : 0;
        if (deviation > 0.03) {
          bullishScore -= 0.3;
          rationale.push('Price extended above SMA20 - reversion likely');
        } else if (deviation < -0.03) {
          bullishScore += 0.3;
          rationale.push('Price extended below SMA20 - reversion likely');
        }
        break;

      case 'confirmation':
        // Confirmation: cross-validation
        if (macdHistogram > 0) {
          bullishScore += 0.3;
          rationale.push('MACD histogram positive - confirms bullish momentum');
        } else if (macdHistogram < 0) {
          bullishScore -= 0.3;
          rationale.push('MACD histogram negative - confirms bearish momentum');
        }

        // SMA crossover state
        if (sma20 > sma50) {
          bullishScore += 0.2;
          rationale.push('Golden cross pattern (SMA20 > SMA50)');
        } else if (sma20 < sma50) {
          bullishScore -= 0.2;
          rationale.push('Death cross pattern (SMA20 < SMA50)');
        }

        confidence += 0.15;
        break;
    }

    // Clamp values to valid ranges
    bullishScore = Math.max(-1, Math.min(1, bullishScore));
    confidence = Math.max(0, Math.min(1, confidence));

    if (rationale.length === 0) {
      rationale.push('No strong signals detected');
    }

    return { bullishScore, confidence, rationale };
  }
}

export function createMockLLMService(): LLMService {
  return new MockLLMService();
}
