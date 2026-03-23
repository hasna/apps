// economy brains — fine-tuning CLI subcommand for @hasna/economy

import { Command } from 'commander'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import chalk from 'chalk'
import { gatherTrainingData } from '../lib/gatherer.js'
import { getActiveModel, setActiveModel, clearActiveModel, DEFAULT_MODEL } from '../lib/model-config.js'

export function registerBrainsCommand(program: Command): void {
  const brainsCmd = program
    .command('brains')
    .description('Fine-tune an AI model on your economy cost data')

  // ── gather ──────────────────────────────────────────────────────────────────

  brainsCmd
    .command('gather')
    .description('Gather training data from economy cost data and write to ~/.economy/training/')
    .option('--limit <n>', 'Maximum number of training examples', '500')
    .option('--output <path>', 'Output file path (default: ~/.economy/training/training-<timestamp>.jsonl)')
    .action(async (opts: { limit?: string; output?: string }) => {
      const limit = opts.limit ? parseInt(opts.limit, 10) : 500
      console.log(chalk.cyan(`Gathering up to ${limit} training examples from economy data...`))

      try {
        const result = await gatherTrainingData({ limit })

        if (result.count === 0) {
          console.log(chalk.yellow('No training examples found. Make sure you have cost data synced.'))
          console.log(chalk.dim('Run: economy sync'))
          return
        }

        // Determine output path
        const defaultDir = join(homedir(), '.economy', 'training')
        await mkdir(defaultDir, { recursive: true })
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const outputPath = opts.output ?? join(defaultDir, `training-${timestamp}.jsonl`)

        // Write JSONL
        const jsonl = result.examples.map((ex) => JSON.stringify(ex)).join('\n')
        await writeFile(outputPath, jsonl, 'utf-8')

        console.log(chalk.green(`✓ Gathered ${result.count} training examples`))
        console.log(chalk.dim(`  Written to: ${outputPath}`))
        console.log(`\n${chalk.dim('Next step:')} economy brains train --base-model gpt-4o-mini`)
      } catch (e) {
        console.error(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`))
        process.exit(1)
      }
    })

  // ── train ───────────────────────────────────────────────────────────────────

  brainsCmd
    .command('train')
    .description('Start a fine-tuning job using gathered training data')
    .option('--base-model <model>', 'Base model to fine-tune', 'gpt-4o-mini')
    .option('--name <name>', 'Name for the fine-tuned model', 'economy-assistant')
    .option('--dataset <path>', 'Path to JSONL training file (default: latest in ~/.economy/training/)')
    .action(async (opts: { baseModel?: string; name?: string; dataset?: string }) => {
      const baseModel = opts.baseModel ?? 'gpt-4o-mini'
      const name = opts.name ?? 'economy-assistant'

      console.log(chalk.cyan('Starting fine-tuning job...'))
      console.log(chalk.dim(`  Base model: ${baseModel}`))
      console.log(chalk.dim(`  Name: ${name}`))

      // Resolve dataset path
      let datasetPath = opts.dataset
      if (!datasetPath) {
        const { readdirSync } = await import('fs')
        const trainingDir = join(homedir(), '.economy', 'training')
        try {
          const files = readdirSync(trainingDir)
            .filter((f) => f.endsWith('.jsonl'))
            .sort()
            .reverse()
          if (files.length === 0) {
            console.error(chalk.red('No training data found. Run: economy brains gather'))
            process.exit(1)
          }
          datasetPath = join(trainingDir, files[0]!)
          console.log(chalk.dim(`  Dataset: ${datasetPath}`))
        } catch {
          console.error(chalk.red('Training directory not found. Run: economy brains gather'))
          process.exit(1)
        }
      }

      try {
        // @ts-ignore — optional peer dependency
        const brains = await import('@hasna/brains') as Record<string, unknown>
        const startFinetune = brains['startFinetune'] ?? brains['start_finetune']
        if (typeof startFinetune !== 'function') {
          console.error(chalk.red('@hasna/brains not found or startFinetune not exported.'))
          console.error(chalk.dim('Install with: bun add @hasna/brains'))
          process.exit(1)
        }

        const job = await (startFinetune as (opts: Record<string, unknown>) => Promise<Record<string, unknown>>)({
          provider: 'openai',
          baseModel,
          name,
          dataset: datasetPath,
        })

        const jobId = job['id'] ?? job['fine_tune_job_id'] ?? job['jobId']
        console.log(chalk.green(`✓ Fine-tuning job started: ${String(jobId ?? 'unknown')}`))
        console.log(`\n${chalk.dim('Check status:')} economy brains status ${String(jobId ?? '')}`)
        console.log(`${chalk.dim('When complete, set model:')} economy brains model set <model-id>`)
      } catch (e) {
        console.error(chalk.red(`Error starting fine-tune: ${e instanceof Error ? e.message : String(e)}`))
        process.exit(1)
      }
    })

  // ── model ───────────────────────────────────────────────────────────────────

  const modelCmd = brainsCmd
    .command('model')
    .description('View or set the active fine-tuned model')
    .action(() => {
      const active = getActiveModel()
      const isDefault = active === DEFAULT_MODEL
      console.log(`Active model: ${chalk.cyan(active)}${isDefault ? chalk.dim(' (default)') : chalk.green(' (fine-tuned)')}`)
      if (isDefault) {
        console.log(chalk.dim(`\nTo set a fine-tuned model: economy brains model set <model-id>`))
      }
    })

  modelCmd
    .command('set <id>')
    .description('Set the active fine-tuned model ID')
    .action((id: string) => {
      setActiveModel(id)
      console.log(chalk.green(`✓ Active model set to: ${id}`))
      console.log(chalk.dim('  Economy AI analysis will now use this model.'))
    })

  modelCmd
    .command('clear')
    .description(`Reset to default model (${DEFAULT_MODEL})`)
    .action(() => {
      clearActiveModel()
      console.log(chalk.green(`✓ Active model cleared, using default: ${DEFAULT_MODEL}`))
    })

  // ── status ──────────────────────────────────────────────────────────────────

  brainsCmd
    .command('status [job-id]')
    .description('Check the status of a fine-tuning job')
    .option('--provider <provider>', 'Provider: openai|thinker-labs', 'openai')
    .action(async (jobId: string | undefined, opts: { provider?: string }) => {
      if (!jobId) {
        console.error(chalk.red('Usage: economy brains status <job-id>'))
        process.exit(1)
      }

      try {
        // @ts-ignore — optional peer dependency
        const brains = await import('@hasna/brains') as Record<string, unknown>
        const getFinetuneStatus = brains['getFinetuneStatus'] ?? brains['get_finetune_status']
        if (typeof getFinetuneStatus !== 'function') {
          console.error(chalk.red('@hasna/brains not installed. Run: bun add @hasna/brains'))
          process.exit(1)
        }

        const status = await (getFinetuneStatus as (opts: Record<string, unknown>) => Promise<Record<string, unknown>>)({
          jobId,
          provider: opts.provider ?? 'openai',
        })

        console.log(`Job ${chalk.cyan(jobId)}:`)
        console.log(`  Status: ${String(status['status'] ?? 'unknown')}`)
        if (status['fine_tuned_model']) {
          console.log(`  Fine-tuned model: ${chalk.green(String(status['fine_tuned_model']))}`)
          console.log(`\n${chalk.dim('Set it active:')} economy brains model set ${String(status['fine_tuned_model'])}`)
        }
        if (status['error']) {
          console.log(chalk.red(`  Error: ${String(status['error'])}`))
        }
      } catch (e) {
        console.error(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`))
        process.exit(1)
      }
    })
}
