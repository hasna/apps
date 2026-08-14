/**
 * Optional open-mementos integration.
 * Saves a memory when a prompt is used/rendered, if PROMPTS_SAVE_MEMENTOS=1
 * and @hasna/mementos is installed. Gracefully no-ops if not available.
 */

export interface MementoSaveOptions {
  slug: string
  body: string
  rendered?: string
  agentId?: string
}

export async function maybeSaveMemento(opts: MementoSaveOptions): Promise<void> {
  if (process.env["PROMPTS_SAVE_MEMENTOS"] !== "1") return

  try {
    // Dynamic import — won't crash if @hasna/mementos isn't installed
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional peer dependency
    const mod = await import("@hasna/mementos").catch(() => null) as Record<string, unknown> | null
    if (!mod) return

    const key = `prompts/used/${opts.slug}`
    const value = opts.rendered ?? opts.body

    const save = mod["createMemory"] ?? mod["saveMemory"]
    if (typeof save !== "function") return

    await (save as (opts: Record<string, unknown>) => Promise<void>)({
      key,
      value,
      scope: "private",
      agent_id: opts.agentId,
      tags: ["prompts", opts.slug],
      summary: `Used prompt: ${opts.slug}`,
    })
  } catch {
    // Silently ignore — mementos integration is best-effort
  }
}
