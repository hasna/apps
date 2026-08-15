import { describe, expect, test } from 'bun:test'
import { getCostCenter, openDatabase } from '../db/database.js'
import { ingestOtelRows, parseOtlpMetrics, parseSimpleIngest } from './otel.js'

describe('otel ingest', () => {
  test('parseSimpleIngest accepts direct JSON events', () => {
    const row = parseSimpleIngest({
      agent: 'pi',
      session_id: 'sess-1',
      model: 'gpt-4',
      cost_usd: 0.05,
      input_tokens: 100,
      output_tokens: 20,
    })
    expect(row?.agent).toBe('pi')
    expect(row?.cost_usd).toBe(0.05)
  })

  test('parseSimpleIngest accepts app/service sources with cost-center attribution', () => {
    const row = parseSimpleIngest({
      source: 'app',
      cost_center: 'alumia',
      cost_center_kind: 'app',
      attribution_tag: 'ai-sdk',
      project_path: '/workspace/platform/alumia',
      repo: 'alumia',
      session_id: 'alumia-session',
      model: 'gpt-5-mini',
      cost_usd: 0.15,
      input_tokens: 1200,
      output_tokens: 300,
      account_key: 'openai:prod',
      account_tool: 'openai',
      account_name: 'prod',
      account_source: 'override',
    })

    expect(row?.agent).toBe('app')
    expect(row?.cost_center).toBe('alumia')
    expect(row?.cost_center_kind).toBe('app')
    expect(row?.attribution_tag).toBe('ai-sdk')
    expect(row?.project_path).toBe('/workspace/platform/alumia')
    expect(row?.repo).toBe('alumia')
    expect(row?.account_key).toBe('openai:prod')
  })

  test('ingestOtelRows persists app cost centers, project paths, and account attribution', async () => {
    const db = openDatabase(':memory:', true)
    const row = parseSimpleIngest({
      source: 'app',
      cost_center: 'alumia',
      cost_center_kind: 'app',
      attribution_tag: 'ai-sdk',
      project_path: '/workspace/platform/alumia',
      session_id: 'alumia-session',
      request_id: 'alumia-req-1',
      model: 'gpt-5-mini',
      cost_usd: 0.15,
      input_tokens: 1200,
      output_tokens: 300,
      account_key: 'openai:prod',
      account_tool: 'openai',
      account_name: 'prod',
      account_source: 'override',
    })

    await ingestOtelRows(db, [row!])

    const req = db.prepare(`
      SELECT agent, cost_center_id, attribution_tag, account_key, cost_usd
      FROM requests WHERE source_request_id = ?
    `).get('alumia-req-1') as Record<string, string | number>
    const session = db.prepare(`
      SELECT agent, project_path, project_name, cost_center_id, account_key, total_cost_usd
      FROM sessions WHERE id = ?
    `).get('alumia-session') as Record<string, string | number>
    const center = getCostCenter(db, 'app:alumia')

    expect(req['agent']).toBe('app')
    expect(req['cost_center_id']).toBe('app:alumia')
    expect(req['attribution_tag']).toBe('ai-sdk')
    expect(req['account_key']).toBe('openai:prod')
    expect(session['agent']).toBe('app')
    expect(session['project_path']).toBe('/workspace/platform/alumia')
    expect(session['project_name']).toBe('alumia')
    expect(session['cost_center_id']).toBe('app:alumia')
    expect(session['account_key']).toBe('openai:prod')
    expect(session['total_cost_usd']).toBe(0.15)
    expect(center?.kind).toBe('app')
    expect(center?.name).toBe('alumia')
  })

  test('ingestOtelRows keeps duplicate request ids distinct across cost centers', async () => {
    const db = openDatabase(':memory:', true)
    const first = parseSimpleIngest({
      source: 'app',
      cost_center: 'alumia',
      cost_center_kind: 'app',
      session_id: 's1',
      request_id: 'shared-req',
      model: 'gpt-5-mini',
      cost_usd: 0.10,
    })
    const second = parseSimpleIngest({
      source: 'app',
      cost_center: 'billing',
      cost_center_kind: 'app',
      session_id: 's2',
      request_id: 'shared-req',
      model: 'gpt-5-mini',
      cost_usd: 0.20,
    })

    await ingestOtelRows(db, [first!, second!])

    const rows = db.prepare(`
      SELECT id, cost_center_id, cost_usd
      FROM requests
      WHERE source_request_id = 'shared-req'
      ORDER BY cost_center_id
    `).all() as Array<Record<string, string | number>>

    expect(rows).toHaveLength(2)
    expect(rows.map(row => row['cost_center_id'])).toEqual(['app:alumia', 'app:billing'])
    expect(rows[0]?.['id']).not.toBe(rows[1]?.['id'])
  })

  test('parseOtlpMetrics extracts cost and token metrics', () => {
    const rows = parseOtlpMetrics({
      resourceMetrics: [{
        resource: { attributes: [{ key: 'agent', value: { stringValue: 'opencode' } }] },
        scopeMetrics: [{
          metrics: [
            {
              name: 'ai.cost.usd',
              sum: {
                dataPoints: [{
                  asDouble: 0.12,
                  attributes: [
                    { key: 'session_id', value: { stringValue: 'abc' } },
                    { key: 'model', value: { stringValue: 'claude-sonnet' } },
                    { key: 'request_id', value: { stringValue: 'req-1' } },
                  ],
                }],
              },
            },
            {
              name: 'ai.token.usage.input',
              sum: {
                dataPoints: [{
                  asInt: '500',
                  attributes: [{ key: 'request_id', value: { stringValue: 'req-1' } }],
                }],
              },
            },
          ],
        }],
      }],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.agent).toBe('opencode')
    expect(rows[0]?.cost_usd).toBe(0.12)
    expect(rows[0]?.input_tokens).toBe(500)
  })

  test('parseOtlpMetrics keeps service cost-center attributes without a coding agent', () => {
    const rows = parseOtlpMetrics({
      resourceMetrics: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'embeddings-api' } },
            { key: 'cost_center', value: { stringValue: 'embeddings-api' } },
            { key: 'cost_center_kind', value: { stringValue: 'service' } },
            { key: 'attribution_tag', value: { stringValue: 'runtime' } },
            { key: 'project_path', value: { stringValue: '/srv/embeddings-api' } },
          ],
        },
        scopeMetrics: [{
          metrics: [{
            name: 'ai.cost.usd',
            sum: {
              dataPoints: [{
                asDouble: 0.03,
                attributes: [
                  { key: 'session_id', value: { stringValue: 'svc-session' } },
                  { key: 'request_id', value: { stringValue: 'svc-req' } },
                ],
              }],
            },
          }],
        }],
      }],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.agent).toBe('service')
    expect(rows[0]?.cost_center_kind).toBe('service')
    expect(rows[0]?.cost_center).toBe('embeddings-api')
    expect(rows[0]?.attribution_tag).toBe('runtime')
    expect(rows[0]?.project_path).toBe('/srv/embeddings-api')
  })
})
