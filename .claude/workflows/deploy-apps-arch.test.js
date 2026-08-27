// Regression test for O15-04098 — deploy image arch mismatch: the deploy-apps
// lane built EVERY service image with --platform linux/arm64, but emails-prod
// Fargate runs X86_64 (task-def has no runtimePlatform, Fargate default), so
// the arm64 image failed at container start with 'exec format error' and
// blocked emails deploys (measured 2026-08-27, PASS 19: emails@1.4.10,
// task-def emails-prod:81, /ecs/emails-prod 'exec /usr/local/bin/bun: exec
// format error'; service rolled back to 1.4.9). conversations-prod Fargate IS
// ARM64, so the previous one-arch-fits-all build was right there by luck.
//
// Structural layers:
//  1. BUILD ARCH IS PER-SERVICE — the deploy BUILD step must build with the
//     arch measured from THAT service's ECS task-def, never a fixed arch for
//     every service. The unconditional "docker build --platform linux/arm64 -t
//     <ecr-repo>" form is the defect and must be gone.
//  2. SURVEY MEASURES THE ARCH — the survey must read the <name>-prod
//     task-def's runtimePlatform.cpuArchitecture and carry arch (linux/amd64 |
//     linux/arm64) on every deployable record; absent runtimePlatform means
//     Fargate default X86_64 -> linux/amd64.
//  3. NO GUESSING — a deployable whose arch is missing must STOP that service
//     rather than guess an arch.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'deploy-apps-wf.js'), 'utf8')

test('BUILD no longer hardcodes one arch for every service (the O15-04098 defect)', () => {
  // The defect: a single fixed build platform for all services, which produced
  // an exec-format-error deploy for the X86_64 emails-prod Fargate service.
  // The unconditional BUILD form must be absent.
  expect(src).not.toMatch(/docker build --platform linux\/arm64 -t <ecr-repo>/)
  // The corrected BUILD form references the per-service surveyed arch.
  expect(src).toMatch(/docker build --platform <arch> -t <ecr-repo>:<source-sha>/)
  expect(src).toMatch(/PER-SERVICE measured platform from the survey/)
})

test('survey measures each service arch from its own ECS task-def runtimePlatform', () => {
  // The survey must read the deployed task-def's runtimePlatform and map it to
  // the docker build platform, so the deploy step has a measured arch per
  // service instead of an assumed one.
  expect(src).toMatch(/runtimePlatform\.cpuArchitecture/)
  expect(src).toMatch(/X86_64 -> linux\/amd64/)
  expect(src).toMatch(/ARM64 -> linux\/arm64/)
  // Absent runtimePlatform is the Fargate default (X86_64) — exactly the
  // emails-prod case that produced the exec format error.
  expect(src).toMatch(/ABSENT \(Fargate default\) -> linux\/amd64/)
  // The deployable record must carry the measured arch.
  expect(src).toMatch(/route, arch\}/)
  expect(src).toMatch(/arch is the measured docker platform \(linux\/amd64 \| linux\/arm64\), NEVER omitted/)
})

test('deploy stops the service rather than guessing an arch when the survey omitted it', () => {
  expect(src).toMatch(/If deployable\[\]\.arch is missing or empty, STOP that service/)
  expect(src).toMatch(/do not guess an arch/)
})
