import {
  PROVIDER_NAMES,
  type SearchProviderName,
  type SearchRouting,
} from "../types/index.js";
import { routeSearchProvidersHeuristic } from "./router.js";

export interface RouterEvalCase {
  name: string;
  query: string;
  candidates?: SearchProviderName[];
  maxProviders?: number;
  expectedFirst?: SearchProviderName;
  expectedAny?: SearchProviderName[];
  expectedAll?: SearchProviderName[];
  disallowed?: SearchProviderName[];
}

export interface RouterEvalResult {
  case: RouterEvalCase;
  route: SearchRouting;
  passed: boolean;
  failures: string[];
}

export interface RouterEvalReport {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  results: RouterEvalResult[];
}

export const DEFAULT_ROUTER_EVAL_CASES: RouterEvalCase[] = [
  {
    name: "local code symbol",
    query: "find export function buildServer in src/mcp/server.ts",
    maxProviders: 3,
    expectedFirst: "content",
    expectedAll: ["content", "files"],
    disallowed: ["arxiv", "youtube"],
  },
  {
    name: "research papers",
    query: "latest papers on query routing for federated RAG",
    maxProviders: 3,
    expectedFirst: "arxiv",
    expectedAny: ["exa", "perplexity"],
  },
  {
    name: "github implementation",
    query: "github repo implementing sqlite fts trigram code search",
    maxProviders: 3,
    expectedFirst: "github",
  },
  {
    name: "video tutorial",
    query: "youtube tutorial building an MCP server",
    maxProviders: 2,
    expectedFirst: "youtube",
  },
  {
    name: "community recommendation",
    query: "reddit recommendations for local semantic code search",
    maxProviders: 2,
    expectedFirst: "reddit",
  },
  {
    name: "hacker news launch",
    query: "Show HN code search engine launch",
    maxProviders: 2,
    expectedFirst: "hackernews",
  },
  {
    name: "social update",
    query: "twitter reaction to Cerebras gpt oss model release",
    maxProviders: 2,
    expectedFirst: "twitter",
  },
  {
    name: "current web",
    query: "latest MCP SDK release notes 2026",
    maxProviders: 3,
    expectedAny: ["brave", "bing", "google", "serpapi"],
  },
  {
    name: "general semantic research",
    query: "best architecture for agent context retrieval",
    maxProviders: 3,
    expectedAny: ["exa", "perplexity"],
  },
];

function checkCase(testCase: RouterEvalCase, route: SearchRouting): string[] {
  const failures: string[] = [];
  if (testCase.expectedFirst && route.selectedProviders[0] !== testCase.expectedFirst) {
    failures.push(`expected first provider ${testCase.expectedFirst}, got ${route.selectedProviders[0] ?? "none"}`);
  }
  for (const provider of testCase.expectedAll ?? []) {
    if (!route.selectedProviders.includes(provider)) failures.push(`expected selected provider ${provider}`);
  }
  if (testCase.expectedAny && !testCase.expectedAny.some((provider) => route.selectedProviders.includes(provider))) {
    failures.push(`expected any provider: ${testCase.expectedAny.join(", ")}`);
  }
  for (const provider of testCase.disallowed ?? []) {
    if (route.selectedProviders.includes(provider)) failures.push(`did not expect provider ${provider}`);
  }
  return failures;
}

export function evaluateRouterHeuristic(
  cases: RouterEvalCase[] = DEFAULT_ROUTER_EVAL_CASES,
): RouterEvalReport {
  const results = cases.map((testCase) => {
    const route = routeSearchProvidersHeuristic(
      testCase.query,
      testCase.candidates ?? [...PROVIDER_NAMES],
      { maxProviders: testCase.maxProviders },
    );
    const failures = checkCase(testCase, route);
    return {
      case: testCase,
      route,
      passed: failures.length === 0,
      failures,
    };
  });
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 1 : passed / results.length,
    results,
  };
}
