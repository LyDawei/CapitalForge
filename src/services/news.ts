import OpenAI from 'openai';
import { Config } from '../config';
import { NewsArticle, WebSearchResult, NewsData } from '../types';

export interface NewsService {
  fetchNewsData(symbol: string): Promise<NewsData>;
}

export class RealNewsService implements NewsService {
  private alpacaApiKey: string;
  private alpacaApiSecret: string;
  private openaiClient: OpenAI;

  constructor(config: Config) {
    this.alpacaApiKey = config.alpacaApiKey;
    this.alpacaApiSecret = config.alpacaApiSecret;
    this.openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }

  async fetchNewsData(symbol: string): Promise<NewsData> {
    const [articlesResult, searchResult] = await Promise.allSettled([
      this.getAlpacaNews(symbol),
      this.searchWeb(symbol),
    ]);

    return {
      articles: articlesResult.status === 'fulfilled' ? articlesResult.value : [],
      searchResults: searchResult.status === 'fulfilled' ? searchResult.value : [],
      fetchedAt: new Date().toISOString(),
    };
  }

  private async getAlpacaNews(symbol: string): Promise<NewsArticle[]> {
    const url = `https://data.alpaca.markets/v1beta1/news?symbols=${encodeURIComponent(symbol)}&limit=10&sort=desc`;
    const response = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': this.alpacaApiKey,
        'APCA-API-SECRET-KEY': this.alpacaApiSecret,
      },
    });

    if (!response.ok) {
      console.error(`Alpaca News API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: any = await response.json();
    return (data.news || []).map((item: any) => ({
      headline: item.headline,
      summary: item.summary || '',
      source: item.source,
      createdAt: item.created_at,
      symbols: item.symbols || [],
      url: item.url,
    }));
  }

  private async searchWeb(symbol: string): Promise<WebSearchResult[]> {
    const query = `${symbol} stock market news events today`;
    const response = await (this.openaiClient as any).responses.create({
      model: 'gpt-4o-mini',
      tools: [{ type: 'web_search_preview' }],
      input: query,
    });

    const results: WebSearchResult[] = [];
    for (const item of response.output) {
      if (item.type === 'message') {
        for (const block of item.content) {
          if (block.type === 'output_text') {
            results.push({
              title: 'Web Search Summary',
              snippet: block.text.substring(0, 1000),
              url: '',
            });
          }
        }
      }
    }
    return results;
  }
}

export function createNewsService(config: Config): NewsService {
  return new RealNewsService(config);
}
