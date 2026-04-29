import { NewsService } from './news';
import { NewsData, NewsArticle, WebSearchResult } from '../types';

export class MockNewsService implements NewsService {
  async fetchNewsData(symbol: string): Promise<NewsData> {
    await new Promise((resolve) => setTimeout(resolve, 10));

    return {
      articles: this.generateMockArticles(symbol),
      searchResults: this.generateMockSearchResults(symbol),
      fetchedAt: new Date().toISOString(),
    };
  }

  private generateMockArticles(symbol: string): NewsArticle[] {
    return [
      {
        headline: `${symbol} shows steady performance amid market volatility`,
        summary: `${symbol} maintained its position as markets experienced moderate fluctuations. Analysts remain cautiously optimistic about near-term outlook.`,
        source: 'MockFinancialNews',
        createdAt: new Date().toISOString(),
        symbols: [symbol],
        url: `https://mock-news.example.com/${symbol.toLowerCase()}-1`,
      },
      {
        headline: `Sector rotation continues to favor ${symbol} holdings`,
        summary: `Institutional investors have been increasing allocations to funds containing ${symbol}, suggesting continued confidence in the sector.`,
        source: 'MockMarketWatch',
        createdAt: new Date().toISOString(),
        symbols: [symbol],
        url: `https://mock-news.example.com/${symbol.toLowerCase()}-2`,
      },
    ];
  }

  private generateMockSearchResults(symbol: string): WebSearchResult[] {
    return [
      {
        title: `${symbol} Market Analysis - Latest Trends`,
        snippet: `Current market conditions show ${symbol} trading within normal ranges. No major catalysts expected in the near term.`,
        url: `https://mock-search.example.com/${symbol.toLowerCase()}-analysis`,
      },
    ];
  }
}

export function createMockNewsService(): NewsService {
  return new MockNewsService();
}
