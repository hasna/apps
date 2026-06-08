import { randomUUID } from 'node:crypto';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { languageModelFor, normalizeAiSdkUsage, parseModelRef, recordProviderUsage, resolveModelRef } from './providers';
import { retrieveKnowledgeContext, type KnowledgeContextPack, type RetrievalOptions } from './retrieval';
import type { KnowledgeConfig } from './workspace';

export interface KnowledgePromptOptions extends Omit<RetrievalOptions, 'query'> {
  prompt: string;
  generate?: boolean;
  approveWrite?: boolean;
  now?: Date;
}

export interface KnowledgePromptResult {
  run_id: string;
  prompt: string;
  generated: boolean;
  provider: string;
  model: string;
  answer: string;
  context: KnowledgeContextPack;
  citations: KnowledgeContextPack['citations'];
  proposed_wiki_updates: Array<{
    kind: 'answer_note';
    title: string;
    citations: string[];
    requires_approval: boolean;
  }>;
  write_policy: {
    approved: boolean;
    durable_writes_performed: false;
    reason: string;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
  warnings: string[];
}

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.25));
}

function citationLabel(index: number): string {
  return `C${index + 1}`;
}

function localAnswer(prompt: string, context: KnowledgeContextPack): string {
  if (context.excerpts.length === 0) {
    return `No indexed knowledge matched the prompt: ${prompt}`;
  }
  const lines = [
    `Found ${context.excerpts.length} relevant knowledge excerpt(s) for: ${prompt}`,
    '',
    ...context.excerpts.slice(0, 5).map((excerpt, index) => {
      const citation = context.citations.find((entry) => entry.id === excerpt.citation_id);
      const ref = citation?.source_ref ?? citation?.source_uri ?? citation?.artifact_path ?? citation?.artifact_uri ?? 'unknown source';
      return `[${citationLabel(index)}] ${excerpt.text} (${ref})`;
    }),
  ];
  return lines.join('\n');
}

function promptForModel(prompt: string, context: KnowledgeContextPack): string {
  const citations = context.citations.map((citation, index) => ({
    id: citationLabel(index),
    source_ref: citation.source_ref,
    source_uri: citation.source_uri,
    artifact_path: citation.artifact_path,
    revision: citation.revision,
    hash: citation.hash,
    quote: citation.quote,
  }));
  const excerpts = context.excerpts.map((excerpt, index) => ({
    id: citationLabel(index),
    kind: excerpt.kind,
    text: excerpt.text,
    score: excerpt.score,
  }));
  return [
    `Prompt: ${prompt}`,
    '',
    'Use only the provided context. Cite claims with citation ids like [C1]. If context is insufficient, say what is missing.',
    '',
    `Context excerpts:\n${JSON.stringify(excerpts, null, 2)}`,
    '',
    `Citations:\n${JSON.stringify(citations, null, 2)}`,
  ].join('\n');
}

function proposedUpdates(prompt: string, context: KnowledgeContextPack): KnowledgePromptResult['proposed_wiki_updates'] {
  if (context.citations.length === 0) return [];
  return [{
    kind: 'answer_note',
    title: prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt,
    citations: context.citations.map((citation) => citation.id),
    requires_approval: true,
  }];
}

function insertRun(dbPath: string, input: {
  runId: string;
  prompt: string;
  status: string;
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
  now: string;
}): void {
  const db = openKnowledgeDb(dbPath);
  try {
    db.run(
      `INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.runId,
        'knowledge-prompt',
        input.prompt,
        input.status,
        input.provider,
        input.model,
        JSON.stringify(input.metadata),
        input.now,
        input.now,
      ],
    );
  } finally {
    db.close();
  }
}

function addRunEvent(dbPath: string, input: {
  runId: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  metadata: Record<string, unknown>;
  now: string;
}): void {
  const db = openKnowledgeDb(dbPath);
  try {
    db.run(
      `INSERT INTO run_events (id, run_id, level, event, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `evt_${randomUUID()}`,
        input.runId,
        input.level,
        input.event,
        JSON.stringify(input.metadata),
        input.now,
      ],
    );
  } finally {
    db.close();
  }
}

function updateRun(dbPath: string, input: {
  runId: string;
  status: string;
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
  now: string;
}): void {
  const db = openKnowledgeDb(dbPath);
  try {
    db.run(
      `UPDATE runs
       SET status = ?, provider = ?, model = ?, metadata_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.status,
        input.provider,
        input.model,
        JSON.stringify(input.metadata),
        input.now,
        input.runId,
      ],
    );
  } finally {
    db.close();
  }
}

function recordUsage(dbPath: string, runId: string, usage: KnowledgePromptResult['usage'], provider: string, model: string, now: string, metadata: Record<string, unknown> = {}): void {
  const db = openKnowledgeDb(dbPath);
  try {
    recordProviderUsage(db, {
      run_id: runId,
      provider,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: usage.cost_usd,
      metadata,
      created_at: now,
    });
  } finally {
    db.close();
  }
}

export async function runKnowledgePrompt(options: KnowledgePromptOptions): Promise<KnowledgePromptResult> {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error('Knowledge prompt is required.');
  const now = (options.now ?? new Date()).toISOString();
  const runId = `run_${randomUUID()}`;
  const modelRef = resolveModelRef(options.modelRef ?? 'default', options.config);
  const parsed = parseModelRef(modelRef);

  migrateKnowledgeDb(options.dbPath);
  insertRun(options.dbPath, {
    runId,
    prompt,
    status: options.generate ? 'running' : 'dry_run',
    provider: options.generate ? parsed.provider : 'local',
    model: options.generate ? parsed.model : 'context-draft',
    metadata: {
      semantic: options.semantic === true || options.fake === true || Boolean(options.modelRef),
      approve_write: options.approveWrite === true,
      generated: options.generate === true,
    },
    now,
  });

  const { prompt: _prompt, generate: _generate, approveWrite: _approveWrite, now: _now, ...retrievalOptions } = options;
  const context = await retrieveKnowledgeContext({
    ...retrievalOptions,
    query: prompt,
  });
  addRunEvent(options.dbPath, {
    runId,
    level: 'info',
    event: 'context_retrieved',
    metadata: {
      results: context.results.length,
      citations: context.citations.length,
      warnings: context.warnings,
    },
    now,
  });

  let answer = localAnswer(prompt, context);
  let generated = false;
  let provider = 'local';
  let model = 'context-draft';
  let usage = {
    input_tokens: estimateTokens(prompt) + context.excerpts.reduce((sum, excerpt) => sum + estimateTokens(excerpt.text), 0),
    output_tokens: estimateTokens(answer),
    cost_usd: 0,
  };
  const warnings = [...context.warnings];

  if (options.generate) {
    try {
      if (options.fake) {
        generated = true;
        provider = parsed.provider;
        model = parsed.model;
        answer = `Fake generated answer for: ${prompt}\n\n${answer}`;
      } else {
        const { generateText } = await import('ai');
        const languageModel = await languageModelFor(modelRef, {
          config: options.config,
          env: options.env,
        });
        const result = await generateText({
          model: languageModel as never,
          system: 'You answer company knowledge-base prompts using only provided context and citation ids.',
          prompt: promptForModel(prompt, context),
        });
        generated = true;
        provider = parsed.provider;
        model = parsed.model;
        answer = result.text;
        const normalized = normalizeAiSdkUsage({
          provider,
          model,
          usage: result.usage as Record<string, unknown> | undefined,
          providerMetadata: result.providerMetadata as Record<string, unknown> | undefined,
        });
        usage = {
          input_tokens: normalized.input_tokens,
          output_tokens: normalized.output_tokens,
          cost_usd: normalized.cost_usd,
        };
      }
    } catch (error) {
      addRunEvent(options.dbPath, {
        runId,
        level: 'error',
        event: 'answer_generation_failed',
        metadata: { message: error instanceof Error ? error.message : String(error) },
        now,
      });
      updateRun(options.dbPath, {
        runId,
        status: 'failed',
        provider: parsed.provider,
        model: parsed.model,
        metadata: {
          generated: false,
          error: error instanceof Error ? error.message : String(error),
        },
        now,
      });
      throw error;
    }
  }

  const updates = proposedUpdates(prompt, context);
  const writePolicy = {
    approved: options.approveWrite === true,
    durable_writes_performed: false as const,
    reason: options.approveWrite
      ? 'Approval flag recorded; durable wiki writing is deferred to the wiki compile task.'
      : 'Dry-run mode: proposed wiki updates require approval before durable writes.',
  };
  addRunEvent(options.dbPath, {
    runId,
    level: 'info',
    event: generated ? 'answer_generated' : 'answer_drafted',
    metadata: {
      provider,
      model,
      proposed_updates: updates.length,
      durable_writes_performed: false,
    },
    now,
  });
  recordUsage(options.dbPath, runId, usage, provider, model, now, {
    generated,
    citations: context.citations.length,
  });
  updateRun(options.dbPath, {
    runId,
    status: generated ? 'completed' : 'dry_run',
    provider,
    model,
    metadata: {
      generated,
      citations: context.citations.length,
      proposed_updates: updates.length,
      approve_write: options.approveWrite === true,
    },
    now,
  });

  return {
    run_id: runId,
    prompt,
    generated,
    provider,
    model,
    answer,
    context,
    citations: context.citations,
    proposed_wiki_updates: updates,
    write_policy: writePolicy,
    usage,
    warnings,
  };
}
