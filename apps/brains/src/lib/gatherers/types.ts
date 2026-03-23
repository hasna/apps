// TrainingExample type for JSONL fine-tuning format
export interface TrainingExample {
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>
}

export interface GatherResult {
  source: string
  examples: TrainingExample[]
  count: number
}

export interface GathererOptions {
  limit?: number
  since?: Date
  outputDir?: string  // where to write JSONL files, default ~/.hasna/brains/datasets/
}
