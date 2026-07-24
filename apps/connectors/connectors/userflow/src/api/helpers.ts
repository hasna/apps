import type { EntityType } from '../types';

export function encodeResourceId(id: string): string {
  return encodeURIComponent(id);
}

export function assertEntity(entity: string | undefined, label = 'entity'): asserts entity is EntityType {
  if (entity === undefined) {
    return;
  }
  if (entity !== 'user' && entity !== 'group') {
    throw new Error(`Userflow: ${label} must be one of user, group`);
  }
}

export function assertNonEmptyEnabledEvents(events: string[] | undefined): string[] {
  if (!events || events.length === 0 || events.some((event) => event.trim().length === 0)) {
    throw new Error('Userflow: enabled_events is required');
  }
  return events;
}

export function toQueryParams(
  params: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean | undefined> {
  return params;
}
