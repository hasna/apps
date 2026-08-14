import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getExportsDir } from './config';

export type ExportFormat = 'json' | 'csv';

/**
 * Export data to a file in the specified format
 */
export function exportData(
  data: unknown[],
  filename: string,
  format: ExportFormat = 'csv'
): string {
  const exportsDir = getExportsDir();

  // Ensure exports directory exists
  if (!existsSync(exportsDir)) {
    mkdirSync(exportsDir, { recursive: true });
  }

  // Add extension if not present
  const extension = format === 'csv' ? '.csv' : '.json';
  const finalFilename = filename.endsWith(extension) ? filename : `${filename}${extension}`;
  const filepath = join(exportsDir, finalFilename);

  let content: string;
  if (format === 'csv') {
    content = convertToCSV(data);
  } else {
    content = JSON.stringify(data, null, 2);
  }

  writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

/**
 * Convert array of objects to CSV format
 */
export function convertToCSV(data: unknown[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return '';
  }

  // Get all unique headers from all objects
  const headers = new Set<string>();
  for (const item of data) {
    if (typeof item === 'object' && item !== null) {
      Object.keys(item).forEach(key => headers.add(key));
    }
  }

  const headerArray = Array.from(headers);

  // Create header row
  const headerRow = headerArray.map(escapeCSVField).join(',');

  // Create data rows
  const dataRows = data.map(item => {
    if (typeof item !== 'object' || item === null) {
      return '';
    }
    return headerArray
      .map(header => {
        const value = (item as Record<string, unknown>)[header];
        return escapeCSVField(formatValue(value));
      })
      .join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Format a value for CSV export
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map(v => formatValue(v)).join('; ');
  }

  if (typeof value === 'object') {
    // Handle common Zendesk object patterns
    const obj = value as Record<string, unknown>;

    // Handle nested objects with common patterns
    if ('name' in obj) return String(obj.name);
    if ('value' in obj) return String(obj.value);
    if ('title' in obj) return String(obj.title);
    if ('body' in obj) return String(obj.body);

    // Fallback to JSON for complex objects
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Escape a field for CSV (handles quotes and commas)
 */
function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    // Escape quotes by doubling them and wrap in quotes
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export tickets to CSV with common fields
 */
export function exportTicketsToCSV(tickets: unknown[]): string {
  const formattedTickets = tickets.map(ticket => {
    const t = ticket as Record<string, unknown>;
    return {
      id: t.id,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      requester_id: t.requester_id,
      assignee_id: t.assignee_id,
      group_id: t.group_id,
      organization_id: t.organization_id,
      tags: Array.isArray(t.tags) ? t.tags.join('; ') : t.tags,
      created_at: t.created_at,
      updated_at: t.updated_at,
      due_at: t.due_at,
      url: t.url,
    };
  });
  return convertToCSV(formattedTickets);
}

/**
 * Export users to CSV with common fields
 */
export function exportUsersToCSV(users: unknown[]): string {
  const formattedUsers = users.map(user => {
    const u = user as Record<string, unknown>;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      organization_id: u.organization_id,
      phone: u.phone,
      time_zone: u.time_zone,
      locale: u.locale,
      active: u.active,
      verified: u.verified,
      suspended: u.suspended,
      tags: Array.isArray(u.tags) ? u.tags.join('; ') : u.tags,
      created_at: u.created_at,
      updated_at: u.updated_at,
      last_login_at: u.last_login_at,
      url: u.url,
    };
  });
  return convertToCSV(formattedUsers);
}

/**
 * Export organizations to CSV with common fields
 */
export function exportOrganizationsToCSV(organizations: unknown[]): string {
  const formattedOrgs = organizations.map(org => {
    const o = org as Record<string, unknown>;
    return {
      id: o.id,
      name: o.name,
      external_id: o.external_id,
      domain_names: Array.isArray(o.domain_names) ? o.domain_names.join('; ') : o.domain_names,
      details: o.details,
      notes: o.notes,
      group_id: o.group_id,
      shared_tickets: o.shared_tickets,
      shared_comments: o.shared_comments,
      tags: Array.isArray(o.tags) ? o.tags.join('; ') : o.tags,
      created_at: o.created_at,
      updated_at: o.updated_at,
      url: o.url,
    };
  });
  return convertToCSV(formattedOrgs);
}

/**
 * Export groups to CSV
 */
export function exportGroupsToCSV(groups: unknown[]): string {
  const formattedGroups = groups.map(group => {
    const g = group as Record<string, unknown>;
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      default: g.default,
      deleted: g.deleted,
      is_public: g.is_public,
      created_at: g.created_at,
      updated_at: g.updated_at,
      url: g.url,
    };
  });
  return convertToCSV(formattedGroups);
}

/**
 * Export views to CSV
 */
export function exportViewsToCSV(views: unknown[]): string {
  const formattedViews = views.map(view => {
    const v = view as Record<string, unknown>;
    return {
      id: v.id,
      title: v.title,
      active: v.active,
      position: v.position,
      description: v.description,
      created_at: v.created_at,
      updated_at: v.updated_at,
      url: v.url,
    };
  });
  return convertToCSV(formattedViews);
}

/**
 * Export triggers to CSV
 */
export function exportTriggersToCSV(triggers: unknown[]): string {
  const formattedTriggers = triggers.map(trigger => {
    const t = trigger as Record<string, unknown>;
    return {
      id: t.id,
      title: t.title,
      active: t.active,
      position: t.position,
      description: t.description,
      category_id: t.category_id,
      created_at: t.created_at,
      updated_at: t.updated_at,
      url: t.url,
    };
  });
  return convertToCSV(formattedTriggers);
}

/**
 * Export automations to CSV
 */
export function exportAutomationsToCSV(automations: unknown[]): string {
  const formattedAutomations = automations.map(automation => {
    const a = automation as Record<string, unknown>;
    return {
      id: a.id,
      title: a.title,
      active: a.active,
      position: a.position,
      description: a.description,
      created_at: a.created_at,
      updated_at: a.updated_at,
      url: a.url,
    };
  });
  return convertToCSV(formattedAutomations);
}

/**
 * Export macros to CSV
 */
export function exportMacrosToCSV(macros: unknown[]): string {
  const formattedMacros = macros.map(macro => {
    const m = macro as Record<string, unknown>;
    return {
      id: m.id,
      title: m.title,
      active: m.active,
      position: m.position,
      description: m.description,
      created_at: m.created_at,
      updated_at: m.updated_at,
      url: m.url,
    };
  });
  return convertToCSV(formattedMacros);
}

/**
 * Export webhooks to CSV
 */
export function exportWebhooksToCSV(webhooks: unknown[]): string {
  const formattedWebhooks = webhooks.map(webhook => {
    const w = webhook as Record<string, unknown>;
    return {
      id: w.id,
      name: w.name,
      status: w.status,
      endpoint: w.endpoint,
      http_method: w.http_method,
      request_format: w.request_format,
      created_at: w.created_at,
      updated_at: w.updated_at,
    };
  });
  return convertToCSV(formattedWebhooks);
}

/**
 * Export brands to CSV
 */
export function exportBrandsToCSV(brands: unknown[]): string {
  const formattedBrands = brands.map(brand => {
    const b = brand as Record<string, unknown>;
    return {
      id: b.id,
      name: b.name,
      subdomain: b.subdomain,
      brand_url: b.brand_url,
      active: b.active,
      default: b.default,
      has_help_center: b.has_help_center,
      host_mapping: b.host_mapping,
      created_at: b.created_at,
      updated_at: b.updated_at,
      url: b.url,
    };
  });
  return convertToCSV(formattedBrands);
}
