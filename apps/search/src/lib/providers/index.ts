import type { SearchProviderName } from "../../types/index.js";
import type { SearchProvider } from "./types.js";
import { GoogleProvider } from "./google.js";
import { SerpApiProvider } from "./serpapi.js";
import { ExaProvider } from "./exa.js";
import { PerplexityProvider } from "./perplexity.js";
import { BraveProvider } from "./brave.js";
import { BingProvider } from "./bing.js";
import { TwitterProvider } from "./twitter.js";
import { RedditProvider } from "./reddit.js";
import { YouTubeProvider } from "./youtube.js";
import { HackerNewsProvider } from "./hackernews.js";
import { GitHubProvider } from "./github.js";
import { ArxivProvider } from "./arxiv.js";

const providerFactories: Record<SearchProviderName, () => SearchProvider> = {
  google: () => new GoogleProvider(),
  serpapi: () => new SerpApiProvider(),
  exa: () => new ExaProvider(),
  perplexity: () => new PerplexityProvider(),
  brave: () => new BraveProvider(),
  bing: () => new BingProvider(),
  twitter: () => new TwitterProvider(),
  reddit: () => new RedditProvider(),
  youtube: () => new YouTubeProvider(),
  hackernews: () => new HackerNewsProvider(),
  github: () => new GitHubProvider(),
  arxiv: () => new ArxivProvider(),
};

const instanceCache = new Map<SearchProviderName, SearchProvider>();

export function getProvider(name: SearchProviderName): SearchProvider {
  let provider = instanceCache.get(name);
  if (!provider) {
    const factory = providerFactories[name];
    if (!factory) throw new Error(`Unknown provider: ${name}`);
    provider = factory();
    instanceCache.set(name, provider);
  }
  return provider;
}

export function getAllProviders(): SearchProvider[] {
  return Object.keys(providerFactories).map((name) =>
    getProvider(name as SearchProviderName),
  );
}

export function getConfiguredProviders(): SearchProvider[] {
  return getAllProviders().filter((p) => p.isConfigured());
}

export function getProviderNames(): SearchProviderName[] {
  return Object.keys(providerFactories) as SearchProviderName[];
}

export type { SearchProvider, RawSearchResult } from "./types.js";
