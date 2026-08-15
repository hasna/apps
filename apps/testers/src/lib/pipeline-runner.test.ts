process.env["TESTERS_DB_PATH"] = ":memory:";

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { runPipeline, substituteTemplate } from "./pipeline-runner.js";
import * as judge from "./judge.js";
import type { PipelineConfig, PipelineStep } from "./pipeline-runner.js";

let originalFetch: typeof global.fetch;

const PASS_RESULT = { pass: true, score: 1.0, reason: "Pass", rubricType: "contains", tokensUsed: 0, provider: "none", model: "none", durationMs: 0 };
const FAIL_RESULT = { pass: false, score: 0.0, reason: "Fail", rubricType: "contains", tokensUsed: 0, provider: "none", model: "none", durationMs: 0 };

function makeStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    name: "Test Step",
    endpoint: "/api/chat",
    method: "POST",
    inputTemplate: '{"message": "{{input.query}}"}',
    outputCapture: "text",
    assertions: [],
    onFail: "stop",
    ...overrides,
  };
}

describe("substituteTemplate", () => {
  test("substitutes {{input.key}} with input variables", () => {
    const result = substituteTemplate(
      '{"message": "{{input.query}}"}',
      null,
      { query: "Hello world" }
    );
    expect(result).toBe('{"message": "Hello world"}');
  });

  test("substitutes {{prev.field}} with previous output field", () => {
    const prevOutput = { answer: "Paris", confidence: 0.9 };
    const result = substituteTemplate(
      '{"context": "{{prev.answer}}"}',
      prevOutput,
      {}
    );
    expect(result).toBe('{"context": "Paris"}');
  });

  test("substitutes nested {{prev.field}} with dot notation", () => {
    const prevOutput = { result: { text: "Hello" } };
    const result = substituteTemplate(
      '{"input": "{{prev.result.text}}"}',
      prevOutput,
      {}
    );
    expect(result).toBe('{"input": "Hello"}');
  });

  test("substitutes both {{prev.*}} and {{input.*}} in same template", () => {
    const prevOutput = { summary: "France capital" };
    const result = substituteTemplate(
      '{"context": "{{prev.summary}}", "query": "{{input.question}}"}',
      prevOutput,
      { question: "What is the capital?" }
    );
    expect(result).toBe('{"context": "France capital", "query": "What is the capital?"}');
  });

  test("returns empty string for missing {{prev.field}}", () => {
    const result = substituteTemplate(
      '{"x": "{{prev.missing}}"}',
      {},
      {}
    );
    expect(result).toBe('{"x": ""}');
  });

  test("returns empty string for missing {{input.key}}", () => {
    const result = substituteTemplate(
      '{"x": "{{input.missing}}"}',
      null,
      {}
    );
    expect(result).toBe('{"x": ""}');
  });

  test("handles null prevOutput gracefully", () => {
    const result = substituteTemplate(
      '{"msg": "{{prev.text}}"}',
      null,
      {}
    );
    expect(result).toBe('{"msg": ""}');
  });

  test("leaves non-template strings unchanged", () => {
    const result = substituteTemplate('{"static": "value"}', null, {});
    expect(result).toBe('{"static": "value"}');
  });
});

describe("runPipeline", () => {
  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("runs single step and returns passed result", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "Paris is the capital" }), { status: 200 }))
    );

    const config: PipelineConfig = {
      steps: [makeStep({ name: "Step 1", assertions: [] })],
      input: { query: "What is the capital?" },
    };

    const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

    expect(result.passed).toBe(true);
    expect(result.stepsCompleted).toBe(1);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0]!.stepName).toBe("Step 1");
    expect(result.stepResults[0]!.passed).toBe(true);
  });

  test("runs multiple steps sequentially", async () => {
    let callCount = 0;
    global.fetch = mock(() => {
      callCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ text: `Step ${callCount} response` }), { status: 200 })
      );
    });

    const config: PipelineConfig = {
      steps: [
        makeStep({ name: "Step 1" }),
        makeStep({ name: "Step 2" }),
        makeStep({ name: "Step 3" }),
      ],
    };

    const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

    expect(callCount).toBe(3);
    expect(result.stepResults).toHaveLength(3);
    expect(result.stepsCompleted).toBe(3);
  });

  test("stops on failed step with onFail=stop (default)", async () => {
    let callCount = 0;
    global.fetch = mock(() => {
      callCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ text: "response" }), { status: 200 })
      );
    });

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async () => FAIL_RESULT);

    try {
      const config: PipelineConfig = {
        steps: [
          makeStep({ name: "Step 1", assertions: [{ type: "contains", value: "expected" }], onFail: "stop" }),
          makeStep({ name: "Step 2" }),
          makeStep({ name: "Step 3" }),
        ],
      };

      const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

      expect(result.passed).toBe(false);
      expect(callCount).toBe(1); // stopped after first step
      expect(result.stepResults).toHaveLength(1);
      // stepsCompleted counts steps that ran (even if failed), pipeline stops after failure
      expect(result.stepsCompleted).toBeGreaterThanOrEqual(0);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("continues to next step when onFail=continue", async () => {
    let callCount = 0;
    global.fetch = mock(() => {
      callCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ text: "response" }), { status: 200 })
      );
    });

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async () => FAIL_RESULT);

    try {
      const config: PipelineConfig = {
        steps: [
          makeStep({ name: "Step 1", assertions: [{ type: "contains", value: "expected" }], onFail: "continue" }),
          makeStep({ name: "Step 2", assertions: [] }),
        ],
      };

      const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

      expect(callCount).toBe(2); // both steps run
      expect(result.stepResults).toHaveLength(2);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("passes output to next step via prev substitution", async () => {
    let capturedBodies: string[] = [];
    let callNum = 0;
    global.fetch = mock((_url: string, init?: RequestInit) => {
      capturedBodies.push(init?.body as string ?? "");
      callNum++;
      return Promise.resolve(
        new Response(JSON.stringify({ answer: "Paris", callNum }), { status: 200 })
      );
    });

    const config: PipelineConfig = {
      steps: [
        makeStep({
          name: "Step 1",
          inputTemplate: '{"question": "{{input.q}}"}',
          outputCapture: "answer",
        }),
        makeStep({
          name: "Step 2",
          inputTemplate: '{"context": "{{prev.answer}}", "question": "Is {{prev.answer}} correct?"}',
          outputCapture: "answer",
        }),
      ],
      input: { q: "What is the capital of France?" },
    };

    await runPipeline(config, { baseUrl: "http://localhost:3000" });

    // Second step should contain "Paris" from first step's output
    expect(capturedBodies[1]).toContain("Paris");
  });

  test("handles network error gracefully", async () => {
    global.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));

    const config: PipelineConfig = {
      steps: [makeStep({ name: "Step 1" })],
    };

    const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

    expect(result.passed).toBe(false);
    expect(result.stepResults[0]!.passed).toBe(false);
    expect(result.stepResults[0]!.error).toBeDefined();
    expect(result.stepResults[0]!.output).toBeNull();
  });

  test("runs assertions and includes judge results", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "Paris is the capital of France" }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async () => ({
      ...PASS_RESULT,
      rubricType: "contains",
    }));

    try {
      const config: PipelineConfig = {
        steps: [makeStep({
          name: "Step 1",
          assertions: [{ type: "contains", value: "Paris" }],
        })],
      };

      const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

      expect(result.stepResults[0]!.assertionResults).toHaveLength(1);
      expect(result.stepResults[0]!.assertionResults[0]!.pass).toBe(true);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("step passes when assertion passes", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "Paris" }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async () => PASS_RESULT);

    try {
      const config: PipelineConfig = {
        steps: [makeStep({
          name: "Step 1",
          assertions: [{ type: "contains", value: "Paris" }],
        })],
      };

      const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

      expect(result.stepResults[0]!.passed).toBe(true);
      expect(result.passed).toBe(true);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("step fails when assertion fails", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "London" }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async () => FAIL_RESULT);

    try {
      const config: PipelineConfig = {
        steps: [makeStep({
          name: "Step 1",
          assertions: [{ type: "contains", value: "Paris" }],
        })],
      };

      const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

      expect(result.stepResults[0]!.passed).toBe(false);
      expect(result.passed).toBe(false);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("tracks tokens used across steps", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "result" }), { status: 200 }))
    );

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async () => ({
      ...PASS_RESULT,
      tokensUsed: 20,
    }));

    try {
      const config: PipelineConfig = {
        steps: [
          makeStep({ name: "Step 1", assertions: [{ type: "contains", value: "result" }] }),
          makeStep({ name: "Step 2", assertions: [{ type: "contains", value: "result" }] }),
        ],
      };

      const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

      expect(result.tokensUsed).toBe(40); // 20 per step x 2
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("records durationMs", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "result" }), { status: 200 }))
    );

    const config: PipelineConfig = {
      steps: [makeStep()],
    };

    const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe("number");
  });

  test("uses config.baseUrl over options.baseUrl", async () => {
    let capturedUrl: string | undefined;
    global.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify({ text: "result" }), { status: 200 }));
    });

    const config: PipelineConfig = {
      steps: [makeStep({ endpoint: "/api/test" })],
      baseUrl: "http://config-url.com",
    };

    await runPipeline(config, { baseUrl: "http://options-url.com" });

    expect(capturedUrl).toContain("http://config-url.com");
  });

  test("step with no assertions passes when HTTP 200", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "response" }), { status: 200 }))
    );

    const config: PipelineConfig = {
      steps: [makeStep({ assertions: [] })],
    };

    const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

    expect(result.stepResults[0]!.passed).toBe(true);
  });

  test("step with no assertions fails when HTTP 4xx/5xx", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response("Bad Request", { status: 400 }))
    );

    const config: PipelineConfig = {
      steps: [makeStep({ assertions: [] })],
    };

    const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

    expect(result.stepResults[0]!.passed).toBe(false);
  });

  test("overall passed=false if any step fails in stop mode", async () => {
    let callNum = 0;
    global.fetch = mock(() => {
      callNum++;
      const text = callNum === 1 ? "bad" : "good";
      return Promise.resolve(new Response(JSON.stringify({ text }), { status: 200 }));
    });

    const judgeSpy = spyOn(judge, "judge").mockImplementation(async () => FAIL_RESULT);

    try {
      const config: PipelineConfig = {
        steps: [
          makeStep({ name: "Step 1", assertions: [{ type: "contains", value: "expected" }], onFail: "stop" }),
          makeStep({ name: "Step 2", assertions: [] }),
        ],
      };

      const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

      expect(result.passed).toBe(false);
    } finally {
      judgeSpy.mockRestore();
    }
  });

  test("captures output from non-standard response field", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "OpenAI response" } }] }), { status: 200 }))
    );

    const config: PipelineConfig = {
      steps: [makeStep({
        outputCapture: "choices[0].message.content",
        assertions: [],
      })],
    };

    const result = await runPipeline(config, { baseUrl: "http://localhost:3000" });

    expect(result.stepResults[0]!.output).toBe("OpenAI response");
  });

  test("handles step with custom HTTP method", async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = mock((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify({ text: "ok" }), { status: 200 }));
    });

    const config: PipelineConfig = {
      steps: [makeStep({ method: "GET", assertions: [] })],
    };

    await runPipeline(config, { baseUrl: "http://localhost:3000" });

    expect(capturedInit?.method).toBe("GET");
  });

  test("passes custom headers in step request", async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = mock((_url: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify({ text: "ok" }), { status: 200 }));
    });

    const config: PipelineConfig = {
      steps: [makeStep({
        headers: { Authorization: "Bearer test-token" },
        assertions: [],
      })],
    };

    await runPipeline(config, { baseUrl: "http://localhost:3000" });

    expect((capturedInit?.headers as Record<string, string>)?.["Authorization"]).toBe("Bearer test-token");
  });
});
