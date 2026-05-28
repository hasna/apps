import { z } from 'zod';

export const itemSchema = z.object({
  id: z.string().min(1),
  short_id: z.string().nullable().optional(),
  title: z.string().min(1),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  archived: z.boolean().default(false),
  created_at: z.string(),
  updated_at: z.string(),
});

export const storeSchema = z.object({
  items: z.array(itemSchema.passthrough()).default([]),
});

export function validateItem(data) {
  return itemSchema.parse(data);
}

export function validateStore(data) {
  return storeSchema.parse(data);
}
