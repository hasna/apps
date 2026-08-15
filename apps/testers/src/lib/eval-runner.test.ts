process.env["TESTERS_DB_PATH"] = ":memory:";

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import {
  runRagEval,
  type RagTestCase,
  type RagEvalResult,
} from "./eval-runner.js";
import * as judge from "./judge.js";
import { createScenario } from "../db/scenarios.js";
import { createRun } from "../db/runs.js";
import type { Scenario } from "../types/index.js";

let originalFetch: typeof global.fetch;

function makeRagScenario(ragTestCases: RagTestCase[], endpointOverride?: string): Scenario {
  return createScenario({
    name: "RAG eval test",
    description: "Test scenario for RAG eval",
    steps: [],
    tags: ["rag"],
    metadata: {
      rag: {
        endpoint: endpointOverride ?? "/api/chat",
        method: "POST",
        baseUrl: "http://localhost:3000",
        ragTestCases,
      },
    },
  });
}

function makeRun(scenarioId: string) {
  return createRun({
    url: "http://localhost:3000",
    scenarioIds: [scenarioId],
    model: "rag-eval",
  });
}

const FAITHFUL_PASS = { pass: true, score: 1.0, reason: "Faithful", rubricType: "faithful", tokensUsed: 10, provider: "anthropic", model: "claude-haiku", durationMs: 100 };
const FAITHFUL_FAIL = { pass: false, score: 0.1, reason: "Hallucination", rubricType: "faithful", tokensUsed: 15, provider: "anthropic", model: "claude-haiku", durationMs: 100 };

describe("eval-runner — runRagEval", () => {
  beforeEach(() => {
    resetDatabase();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    closeDatabase();
  });

  test("returns error when rag metadata missing", async () => {
    const scenario = createScenario({
      name: "no-rag",
      description: "missing rag config",
      steps: [],
      tags: [],
      metadata: {},
    });
    const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });
    expect(result.status).toBe("error");
    expect(result.error).toContain("missing 'rag' config");
  });

  test("returns error when ragTestCases is empty", async () => {
    const scenario = createScenario({
      name: "empty-rag",
      description: "empty rag test cases",
      steps: [],
      tags: [],
      metadata: { rag: { endpoint: "/api/chat", ragTestCases: [] } },
    });
    const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });
    expect(result.status).toBe("error");
  });

  test("fails case when endpoint returns 500", async () => {
    global.fetch = mock(() => Promise.resolve(new Response("server error", { status: 500 })));

    const tc: RagTestCase = {
      question: "What is the capital of France?",
      sourceDocs: ["Paris is the capital of France."],
    };
    const scenario = makeRagScenario([tc]);
    const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

    expect(result.status).toBe("failed");
    const ragResult = result.metadata as RagEvalResult;
    expect(ragResult.caseResults[0]!.passed).toBe(false);
    expect(ragResult.caseResults[0]!.error).toBeDefined();
  });

  test("fails case when endpoint throws network error", async () => {
    global.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));

    const tc: RagTestCase = {
      question: "What is the capital?",
      sourceDocs: ["Paris is the capital."],
    };
    const scenario = makeRagScenario([tc]);
    const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

    const ragResult = result.metadata as RagEvalResult;
    expect(ragResult.caseResults[0]!.passed).toBe(false);
    expect(ragResult.caseResults[0]!.output).toBeNull();
  });

  test("detects forbidden claim violations using not_contains rubric", async () => {
    const answer = "Paris is in France and also Berlin is awesome";
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: answer }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return FAITHFUL_PASS;
      // not_contains is deterministic — call actual implementation logic
      if (input.rubric.type === "not_contains") {
        const pass = !input.output.includes(input.rubric.value);
        return { pass, score: pass ? 1 : 0, reason: pass ? "Not found" : `Found forbidden: ${input.rubric.value}`, rubricType: "not_contains", tokensUsed: 0, provider: "none", model: "none", durationMs: 0 };
      }
      return FAITHFUL_PASS;
    });

    try {
      const tc: RagTestCase = {
        question: "What is the capital of France?",
        sourceDocs: ["Paris is the capital of France."],
        forbiddenClaims: ["Berlin is awesome"],
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      const ragResult = result.metadata as RagEvalResult;
      expect(ragResult.caseResults[0]!.forbiddenClaimViolations).toContain("Berlin is awesome");
      expect(ragResult.caseResults[0]!.passed).toBe(false);
      expect(ragResult.totalForbiddenViolations).toBe(1);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("passes when no forbidden claims present in answer", async () => {
    const answer = "Paris is the capital of France.";
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: answer }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return FAITHFUL_PASS;
      if (input.rubric.type === "not_contains") {
        const pass = !input.output.includes(input.rubric.value);
        return { pass, score: pass ? 1 : 0, reason: pass ? "Not found" : "Found", rubricType: "not_contains", tokensUsed: 0, provider: "none", model: "none", durationMs: 0 };
      }
      return FAITHFUL_PASS;
    });

    try {
      const tc: RagTestCase = {
        question: "What is the capital of France?",
        sourceDocs: ["Paris is the capital of France."],
        forbiddenClaims: ["Berlin is awesome"],
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      const ragResult = result.metadata as RagEvalResult;
      expect(ragResult.caseResults[0]!.forbiddenClaimViolations).toHaveLength(0);
      expect(ragResult.totalForbiddenViolations).toBe(0);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("scores factual completeness with expectedFacts", async () => {
    const answer = "Paris is the capital of France and has the Eiffel Tower.";
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: answer }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return FAITHFUL_PASS;
      if (input.rubric.type === "factual") {
        // Deterministic: check each fact
        const facts = (input.rubric as { type: "factual"; facts: string[] }).facts;
        const missing = facts.filter(f => !input.output.toLowerCase().includes(f.toLowerCase()));
        const score = facts.length > 0 ? (facts.length - missing.length) / facts.length : 1;
        const pass = missing.length === 0;
        return { pass, score, reason: pass ? "All facts present" : `Missing: ${missing.join(", ")}`, rubricType: "factual", tokensUsed: 0, provider: "none", model: "none", durationMs: 0 };
      }
      return FAITHFUL_PASS;
    });

    try {
      const tc: RagTestCase = {
        question: "Tell me about Paris",
        sourceDocs: ["Paris is the capital of France. It has the Eiffel Tower."],
        expectedFacts: ["Paris is the capital", "Eiffel Tower"],
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      const ragResult = result.metadata as RagEvalResult;
      expect(ragResult.caseResults[0]!.factualCompletenessScore).toBe(1.0);
      expect(ragResult.caseResults[0]!.factualCompletenessPass).toBe(true);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("factual score is 1.0 when no expectedFacts provided", async () => {
    const answer = "Paris is the capital of France.";
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: answer }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return { ...FAITHFUL_PASS, score: 0.95 };
      return FAITHFUL_PASS;
    });

    try {
      const tc: RagTestCase = {
        question: "What is the capital of France?",
        sourceDocs: ["Paris is the capital of France."],
        // No expectedFacts
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      const ragResult = result.metadata as RagEvalResult;
      // factualCompletenessScore defaults to 1.0 when no expectedFacts
      expect(ragResult.caseResults[0]!.factualCompletenessScore).toBe(1.0);
      expect(ragResult.caseResults[0]!.factualCompletenessPass).toBe(true);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("aggregates multiple test cases correctly", async () => {
    let callCount = 0;
    global.fetch = mock(() => {
      callCount++;
      return Promise.resolve(new Response(JSON.stringify({ text: "Some answer" }), { status: 200 }));
    });

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return FAITHFUL_PASS;
      return FAITHFUL_PASS;
    });

    try {
      const testCases: RagTestCase[] = [
        { question: "Question 1", sourceDocs: ["Doc 1"] },
        { question: "Question 2", sourceDocs: ["Doc 2"] },
        { question: "Question 3", sourceDocs: ["Doc 3"] },
      ];
      const scenario = makeRagScenario(testCases);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      const ragResult = result.metadata as RagEvalResult;
      expect(ragResult.totalCases).toBe(3);
      expect(ragResult.caseResults).toHaveLength(3);
      expect(callCount).toBe(3);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("tracks tokens used across all judge calls", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "Some answer" }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return { ...FAITHFUL_PASS, tokensUsed: 25 };
      return FAITHFUL_PASS;
    });

    try {
      const tc: RagTestCase = {
        question: "What is the capital of France?",
        sourceDocs: ["Paris is the capital of France."],
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      const ragResult = result.metadata as RagEvalResult;
      expect(ragResult.tokensUsed).toBe(25);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("result is passed when all cases pass faithful check", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "Paris is the capital of France." }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return FAITHFUL_PASS;
      return FAITHFUL_PASS;
    });

    try {
      const tc: RagTestCase = {
        question: "What is the capital of France?",
        sourceDocs: ["Paris is the capital of France."],
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      expect(result.status).toBe("passed");
      const ragResult = result.metadata as RagEvalResult;
      expect(ragResult.passed).toBe(true);
      expect(ragResult.passedCases).toBe(1);
      expect(ragResult.avgFaithfulnessScore).toBe(1.0);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("result is failed when any case fails faithful check", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "The moon is made of cheese." }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return FAITHFUL_FAIL;
      return FAITHFUL_FAIL;
    });

    try {
      const tc: RagTestCase = {
        question: "What is the moon made of?",
        sourceDocs: ["The moon is a rocky body."],
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      expect(result.status).toBe("failed");
      const ragResult = result.metadata as RagEvalResult;
      expect(ragResult.passed).toBe(false);
      expect(ragResult.passedCases).toBe(0);
      expect(ragResult.avgFaithfulnessScore).toBeCloseTo(0.1);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("includes judgeResults array on each case result", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "Paris" }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return FAITHFUL_PASS;
      if (input.rubric.type === "factual") {
        return { pass: true, score: 1.0, reason: "All facts", rubricType: "factual", tokensUsed: 0, provider: "none", model: "none", durationMs: 0 };
      }
      return FAITHFUL_PASS;
    });

    try {
      const tc: RagTestCase = {
        question: "What is the capital of France?",
        sourceDocs: ["Paris is the capital."],
        expectedFacts: ["Paris"],
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      const ragResult = result.metadata as RagEvalResult;
      const caseResult = ragResult.caseResults[0]!;
      // Should have faithful + factual judge results
      expect(caseResult.judgeResults.length).toBeGreaterThanOrEqual(2);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("reasoning contains faithfulness and factual scores", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "Paris is the capital" }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return { ...FAITHFUL_PASS, score: 0.9 };
      return FAITHFUL_PASS;
    });

    try {
      const tc: RagTestCase = {
        question: "Capital?",
        sourceDocs: ["Paris is the capital."],
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      expect(result.reasoning).toContain("faithfulness");
      expect(result.reasoning).toContain("factual");
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("multiple forbidden claims — counts each violation", async () => {
    const answer = "Paris is awesome and Berlin is awesome too";
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: answer }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async (input) => {
      if (input.rubric.type === "faithful") return FAITHFUL_PASS;
      if (input.rubric.type === "not_contains") {
        const pass = !input.output.includes(input.rubric.value);
        return { pass, score: pass ? 1 : 0, reason: pass ? "Not found" : "Found", rubricType: "not_contains", tokensUsed: 0, provider: "none", model: "none", durationMs: 0 };
      }
      return FAITHFUL_PASS;
    });

    try {
      const tc: RagTestCase = {
        question: "What cities are awesome?",
        sourceDocs: ["Paris is a beautiful city."],
        forbiddenClaims: ["Berlin is awesome", "Paris is awesome"],
      };
      const scenario = makeRagScenario([tc]);
      const result = await runRagEval(scenario, { runId: makeRun(scenario.id).id, baseUrl: "http://localhost:3000" });

      const ragResult = result.metadata as RagEvalResult;
      // Both forbidden claims are present in the answer
      expect(ragResult.caseResults[0]!.forbiddenClaimViolations).toHaveLength(2);
      expect(ragResult.totalForbiddenViolations).toBe(2);
    } finally {
      judgeSpy.mockRestore();
    }
  });
});
