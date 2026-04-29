import { z } from 'zod';

export const NewsArticleSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  source: z.string(),
  createdAt: z.string(),
  symbols: z.array(z.string()),
  url: z.string(),
});
export type NewsArticle = z.infer<typeof NewsArticleSchema>;

export const WebSearchResultSchema = z.object({
  title: z.string(),
  snippet: z.string(),
  url: z.string(),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export const NewsDataSchema = z.object({
  articles: z.array(NewsArticleSchema),
  searchResults: z.array(WebSearchResultSchema),
  fetchedAt: z.string(),
});
export type NewsData = z.infer<typeof NewsDataSchema>;
