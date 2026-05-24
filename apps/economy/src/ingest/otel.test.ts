import { describe, expect, test } from 'bun:test'
import { parseOtlpMetrics, parseSimpleIngest } from './otel.js'

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
})
