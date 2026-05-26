import type { ShadcnClient } from './client';
import type { ShadcnAddOptions, ShadcnDiffOptions, ShadcnInitOptions, CommandResult } from '../types';

/**
 * Shadcn Components API
 * Manages shadcn/ui components through CLI
 */
export class ComponentsApi {
  constructor(private readonly client: ShadcnClient) {}

  /**
   * Add components to your project
   * Equivalent to: npx shadcn@latest add [components...]
   */
  async add(options: ShadcnAddOptions): Promise<CommandResult> {
    const args: string[] = ['add'];

    if (options.all) {
      args.push('--all');
    } else if (options.components.length > 0) {
      args.push(...options.components);
    }

    if (options.overwrite) {
      args.push('--overwrite');
    }

    if (options.path) {
      args.push('--path', options.path);
    }

    // Always use yes flag for non-interactive
    args.push('--yes');

    return this.client.execute(args);
  }

  /**
   * Show diff of component against registry
   * Equivalent to: npx shadcn@latest diff [component]
   */
  async diff(options: ShadcnDiffOptions = {}): Promise<string> {
    const args: string[] = ['diff'];

    if (options.component) {
      args.push(options.component);
    }

    const result = await this.client.execute(args);
    return result.stdout;
  }

  /**
   * Initialize shadcn/ui in your project
   * Equivalent to: npx shadcn@latest init
   */
  async init(options: ShadcnInitOptions = {}): Promise<CommandResult> {
    const args: string[] = ['init'];

    if (options.defaults) {
      args.push('--defaults');
    }

    if (options.force) {
      args.push('--force');
    }

    if (options.srcDir !== undefined) {
      args.push('--src-dir', String(options.srcDir));
    }

    if (options.baseColor) {
      args.push('--base-color', options.baseColor);
    }

    if (options.style) {
      args.push('--style', options.style);
    }

    // Always use yes flag for non-interactive
    args.push('--yes');

    return this.client.execute(args);
  }

  /**
   * List available components from the registry
   * Note: This fetches from the shadcn registry directly
   */
  async list(): Promise<string[]> {
    // Known shadcn components - the CLI doesn't have a list command
    // so we return the known components from the registry
    return [
      'accordion',
      'alert',
      'alert-dialog',
      'aspect-ratio',
      'avatar',
      'badge',
      'breadcrumb',
      'button',
      'calendar',
      'card',
      'carousel',
      'chart',
      'checkbox',
      'collapsible',
      'combobox',
      'command',
      'context-menu',
      'data-table',
      'date-picker',
      'dialog',
      'drawer',
      'dropdown-menu',
      'form',
      'hover-card',
      'input',
      'input-otp',
      'label',
      'menubar',
      'navigation-menu',
      'pagination',
      'popover',
      'progress',
      'radio-group',
      'resizable',
      'scroll-area',
      'select',
      'separator',
      'sheet',
      'sidebar',
      'skeleton',
      'slider',
      'sonner',
      'switch',
      'table',
      'tabs',
      'textarea',
      'toast',
      'toggle',
      'toggle-group',
      'tooltip',
    ];
  }
}
