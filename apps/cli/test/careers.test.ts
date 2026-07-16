import { describe, expect, it } from 'vitest'
import { runCli } from '../src/runner.js'
import { EXIT_CODES } from '../src/errors.js'
import { fixture, profileConfig } from './helpers.js'

describe('cweb careers commands', () => {
  it('lists and shows jobs at canonical org endpoints', async () => {
    const f = fixture({ config: profileConfig() })
    await runCli(['--json', 'careers', 'jobs', 'list', '--status', 'ALL', '--limit', '10'], f.runtime)
    await runCli(['--json', 'careers', 'jobs', 'show', 'executive-assistant'], f.runtime)
    expect(f.transport.requests[0]).toMatchObject({ path: '/api/v1/orgs/hasna/careers/jobs', query: { status: 'ALL', limit: 10 } })
    expect(f.transport.requests[1]?.path).toBe('/api/v1/orgs/hasna/careers/jobs/executive-assistant')
  })

  it('validates strict create input and sends idempotency', async () => {
    const missing = fixture({ config: profileConfig() })
    missing.credentials.values.set('prod', 'bearer')
    expect((await runCli(['--json', 'careers', 'jobs', 'create', '--title', 'EA'], missing.runtime)).exitCode).toBe(EXIT_CODES.VALIDATION)
    expect(missing.transport.requests).toHaveLength(0)

    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    await runCli(
      [
        '--json', 'careers', 'jobs', 'create', '--title', 'Executive Assistant', '--department', 'Operations', '--location', 'Remote', '--type', 'Full-time', '--description', 'Description', '--requirements', 'Requirements', '--idempotency-key', 'job-create-1',
      ],
      f.runtime,
    )
    expect(f.transport.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/orgs/hasna/careers/jobs',
      headers: { 'Idempotency-Key': 'job-create-1' },
      body: { title: 'Executive Assistant', department: 'Operations' },
    })
  })

  it('uses expectedVersion for patch and integer If-Match for lifecycle/delete', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    await runCli(['--json', 'careers', 'jobs', 'update', 'ea', '--expected-version', '2', '--title', 'EA II'], f.runtime)
    await runCli(['--json', 'careers', 'jobs', 'publish', 'ea', '--version', '3'], f.runtime)
    await runCli(['--json', 'careers', 'jobs', 'close', 'ea', '--version', '4'], f.runtime)
    await runCli(['--json', 'careers', 'jobs', 'delete', 'ea', '--version', '5'], f.runtime)
    expect(f.transport.requests[0]?.body).toMatchObject({ expectedVersion: 2 })
    expect(f.transport.requests.slice(1).map((request) => request.headers?.['If-Match'])).toEqual(['3', '4', '5'])
  })

  it('submits the exact no-resume application contract and supports dry-run', async () => {
    const f = fixture({ config: profileConfig() })
    await runCli(
      ['--json', 'careers', 'applications', 'submit', '--job', 'ea', '--name', 'Candidate', '--email', 'candidate@example.com', '--cover-letter', 'Hello', '--terms-accepted', '--idempotency-key', 'apply-123'],
      f.runtime,
    )
    expect(f.transport.requests[0]).toMatchObject({
      path: '/api/v1/orgs/hasna/careers/jobs/ea/applications',
      body: { name: 'Candidate', email: 'candidate@example.com', coverLetter: 'Hello', termsAccepted: true },
    })
    expect(JSON.stringify(f.transport.requests[0]?.body)).not.toContain('resume')

    const dry = fixture({ config: profileConfig() })
    await runCli(
      ['--json', 'careers', 'applications', 'submit', '--job', 'ea', '--name', 'Candidate', '--email', 'candidate@example.com', '--terms-accepted', '--dry-run'],
      dry.runtime,
    )
    expect(dry.transport.requests).toHaveLength(0)

    const resume = fixture({
      config: profileConfig(),
      input: JSON.stringify({
        name: 'Candidate',
        email: 'candidate@example.com',
        termsAccepted: true,
        resume: 'not-supported',
      }),
    })
    expect(
      (await runCli(['--json', 'careers', 'applications', 'submit', '--job', 'ea', '--input', '-'], resume.runtime)).exitCode,
    ).toBe(EXIT_CODES.VALIDATION)
    expect(resume.transport.requests).toHaveLength(0)
  })

  it('maps list/show/status/anonymize and paginated CSV export', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    await runCli(['--json', 'careers', 'applications', 'list', '--job', 'ea'], f.runtime)
    await runCli(['--json', 'careers', 'applications', 'show', 'app_1'], f.runtime)
    await runCli(['--json', 'careers', 'applications', 'status', 'app_1', '--status', 'REVIEWING'], f.runtime)
    await runCli(['--json', 'careers', 'applications', 'anonymize', 'app_1'], f.runtime)
    expect(f.transport.requests.map((request) => request.path)).toEqual([
      '/api/v1/orgs/hasna/careers/jobs/ea/applications',
      '/api/v1/orgs/hasna/careers/applications/app_1',
      '/api/v1/orgs/hasna/careers/applications/app_1',
      '/api/v1/orgs/hasna/careers/applications/app_1/anonymize',
    ])

    const exported = fixture({ config: profileConfig() })
    exported.credentials.values.set('prod', 'bearer')
    exported.transport.responses.push(
      { status: 200, headers: { 'x-next-cursor': 'next', 'x-export-complete': 'false' }, body: '', text: 'id,name\n1,A\n' },
      { status: 200, headers: { 'x-export-complete': 'true' }, body: '', text: 'id,name\n2,B\n' },
    )
    await runCli(['--json', 'careers', 'applications', 'export'], exported.runtime)
    expect(JSON.parse(exported.stdout.value).data.csv).toBe('id,name\n1,A\n2,B\n')
  })
})
