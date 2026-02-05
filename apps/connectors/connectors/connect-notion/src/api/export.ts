import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { NotionClient } from './client';
import type { NotionPage, NotionBlock, RichText, NotionDatabase, PaginatedResponse } from '../types';
import { ensureExportsDir } from '../utils/config';

export interface ExportOptions {
  includeMetadata?: boolean;
  includeChildPages?: boolean;
  recursive?: boolean;
  outputDir?: string;
}

export interface ExportResult {
  pageId: string;
  title: string;
  filePath: string;
  childPages?: ExportResult[];
}

export class ExportApi {
  constructor(private readonly client: NotionClient) {}

  // ============================================
  // Main Export Methods
  // ============================================

  /**
   * Export a page to Markdown
   */
  async exportPage(pageId: string, options: ExportOptions = {}): Promise<ExportResult> {
    const page = await this.client.get<NotionPage>(`/pages/${pageId}`);
    const title = this.getPageTitle(page);
    const blocks = await this.getAllBlocks(pageId);

    let markdown = '';

    // Add metadata frontmatter if requested
    if (options.includeMetadata) {
      markdown += this.generateFrontmatter(page);
    }

    // Add title
    markdown += `# ${title}\n\n`;

    // Convert blocks to markdown
    markdown += await this.blocksToMarkdown(blocks, 0, options);

    // Determine output path
    const outputDir = options.outputDir || ensureExportsDir();
    const fileName = this.sanitizeFilename(title) + '.md';
    const filePath = join(outputDir, fileName);

    // Ensure directory exists
    if (!existsSync(dirname(filePath))) {
      mkdirSync(dirname(filePath), { recursive: true });
    }

    // Write file
    writeFileSync(filePath, markdown, 'utf-8');

    const result: ExportResult = {
      pageId,
      title,
      filePath,
    };

    // Export child pages if requested
    if (options.includeChildPages || options.recursive) {
      const childPages = blocks.filter(b => b.type === 'child_page') as NotionBlock[];
      if (childPages.length > 0) {
        result.childPages = [];
        const childDir = join(outputDir, this.sanitizeFilename(title));

        for (const childBlock of childPages) {
          if (childBlock.type === 'child_page') {
            const childResult = await this.exportPage(childBlock.id, {
              ...options,
              outputDir: childDir,
              recursive: options.recursive,
            });
            result.childPages.push(childResult);
          }
        }
      }
    }

    return result;
  }

  /**
   * Export a database to Markdown (exports all pages in the database)
   */
  async exportDatabase(databaseId: string, options: ExportOptions = {}): Promise<ExportResult[]> {
    const database = await this.client.get<NotionDatabase>(`/databases/${databaseId}`);
    const title = database.title.map(t => t.plain_text).join('');

    const outputDir = options.outputDir || ensureExportsDir();
    const dbDir = join(outputDir, this.sanitizeFilename(title));

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Query all pages in the database
    const pages: NotionPage[] = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const response = await this.client.post<PaginatedResponse<NotionPage>>(
        `/databases/${databaseId}/query`,
        body
      );
      pages.push(...response.results);
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    // Export each page
    const results: ExportResult[] = [];
    for (const page of pages) {
      const result = await this.exportPage(page.id, {
        ...options,
        outputDir: dbDir,
      });
      results.push(result);
    }

    return results;
  }

  /**
   * Export workspace (all accessible pages)
   */
  async exportWorkspace(options: ExportOptions = {}): Promise<ExportResult[]> {
    const outputDir = options.outputDir || ensureExportsDir();
    const workspaceDir = join(outputDir, `workspace_${new Date().toISOString().split('T')[0]}`);

    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }

    // Search for all pages
    const pages: NotionPage[] = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = {
        filter: { value: 'page', property: 'object' },
        page_size: 100,
      };
      if (cursor) body.start_cursor = cursor;

      const response = await this.client.post<PaginatedResponse<NotionPage>>('/search', body);
      pages.push(...response.results);
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    // Export each top-level page (pages with workspace parent)
    const results: ExportResult[] = [];
    for (const page of pages) {
      if (page.parent.type === 'workspace') {
        const result = await this.exportPage(page.id, {
          ...options,
          outputDir: workspaceDir,
          recursive: true,
        });
        results.push(result);
      }
    }

    return results;
  }

  // ============================================
  // Block to Markdown Conversion
  // ============================================

  private async blocksToMarkdown(blocks: NotionBlock[], indent: number = 0, options: ExportOptions = {}): Promise<string> {
    let markdown = '';
    const indentStr = '  '.repeat(indent);
    let listCounter = 1;

    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph':
          markdown += `${indentStr}${this.richTextToMarkdown(block.paragraph.rich_text)}\n\n`;
          break;

        case 'heading_1':
          markdown += `${indentStr}# ${this.richTextToMarkdown(block.heading_1.rich_text)}\n\n`;
          break;

        case 'heading_2':
          markdown += `${indentStr}## ${this.richTextToMarkdown(block.heading_2.rich_text)}\n\n`;
          break;

        case 'heading_3':
          markdown += `${indentStr}### ${this.richTextToMarkdown(block.heading_3.rich_text)}\n\n`;
          break;

        case 'bulleted_list_item':
          markdown += `${indentStr}- ${this.richTextToMarkdown(block.bulleted_list_item.rich_text)}\n`;
          if (block.has_children) {
            const children = await this.getAllBlocks(block.id);
            markdown += await this.blocksToMarkdown(children, indent + 1, options);
          }
          break;

        case 'numbered_list_item':
          markdown += `${indentStr}${listCounter}. ${this.richTextToMarkdown(block.numbered_list_item.rich_text)}\n`;
          listCounter++;
          if (block.has_children) {
            const children = await this.getAllBlocks(block.id);
            markdown += await this.blocksToMarkdown(children, indent + 1, options);
          }
          break;

        case 'to_do':
          const checkbox = block.to_do.checked ? '[x]' : '[ ]';
          markdown += `${indentStr}- ${checkbox} ${this.richTextToMarkdown(block.to_do.rich_text)}\n`;
          if (block.has_children) {
            const children = await this.getAllBlocks(block.id);
            markdown += await this.blocksToMarkdown(children, indent + 1, options);
          }
          break;

        case 'toggle':
          markdown += `${indentStr}<details>\n`;
          markdown += `${indentStr}<summary>${this.richTextToMarkdown(block.toggle.rich_text)}</summary>\n\n`;
          if (block.has_children) {
            const children = await this.getAllBlocks(block.id);
            markdown += await this.blocksToMarkdown(children, indent, options);
          }
          markdown += `${indentStr}</details>\n\n`;
          break;

        case 'code':
          const lang = block.code.language || '';
          markdown += `${indentStr}\`\`\`${lang}\n`;
          markdown += `${indentStr}${this.richTextToMarkdown(block.code.rich_text)}\n`;
          markdown += `${indentStr}\`\`\`\n\n`;
          break;

        case 'quote':
          const quoteLines = this.richTextToMarkdown(block.quote.rich_text).split('\n');
          markdown += quoteLines.map(line => `${indentStr}> ${line}`).join('\n') + '\n\n';
          break;

        case 'callout':
          const icon = block.callout.icon?.type === 'emoji' ? block.callout.icon.emoji + ' ' : '';
          markdown += `${indentStr}> ${icon}**Note:** ${this.richTextToMarkdown(block.callout.rich_text)}\n\n`;
          break;

        case 'divider':
          markdown += `${indentStr}---\n\n`;
          break;

        case 'image':
          const imgUrl = block.image.type === 'external'
            ? block.image.external?.url
            : block.image.file?.url;
          const imgCaption = this.richTextToMarkdown(block.image.caption);
          markdown += `${indentStr}![${imgCaption || 'image'}](${imgUrl})\n\n`;
          break;

        case 'video':
          const videoUrl = block.video.type === 'external'
            ? block.video.external?.url
            : block.video.file?.url;
          markdown += `${indentStr}[Video](${videoUrl})\n\n`;
          break;

        case 'file':
          const fileUrl = block.file.type === 'external'
            ? block.file.external?.url
            : block.file.file?.url;
          markdown += `${indentStr}[${block.file.name}](${fileUrl})\n\n`;
          break;

        case 'bookmark':
          markdown += `${indentStr}[${block.bookmark.url}](${block.bookmark.url})\n\n`;
          break;

        case 'embed':
          markdown += `${indentStr}[Embed: ${block.embed.url}](${block.embed.url})\n\n`;
          break;

        case 'equation':
          markdown += `${indentStr}$$${block.equation.expression}$$\n\n`;
          break;

        case 'table':
          if (block.has_children) {
            const rows = await this.getAllBlocks(block.id);
            markdown += await this.tableToMarkdown(rows as NotionBlock[], block.table.has_column_header);
          }
          break;

        case 'child_page':
          if (!options.includeChildPages && !options.recursive) {
            markdown += `${indentStr}📄 [${block.child_page.title}](./${this.sanitizeFilename(block.child_page.title)}.md)\n\n`;
          }
          break;

        case 'child_database':
          markdown += `${indentStr}📊 **Database:** ${block.child_database.title}\n\n`;
          break;

        case 'table_of_contents':
          markdown += `${indentStr}[TOC]\n\n`;
          break;

        case 'breadcrumb':
          // Skip breadcrumbs in export
          break;

        case 'column_list':
          if (block.has_children) {
            const columns = await this.getAllBlocks(block.id);
            for (const column of columns) {
              if (column.has_children) {
                const columnContent = await this.getAllBlocks(column.id);
                markdown += await this.blocksToMarkdown(columnContent, indent, options);
              }
            }
          }
          break;

        case 'synced_block':
          if (block.has_children) {
            const syncedContent = await this.getAllBlocks(block.id);
            markdown += await this.blocksToMarkdown(syncedContent, indent, options);
          }
          break;

        default:
          // Unknown block type - add as comment
          markdown += `${indentStr}<!-- Unsupported block type: ${(block as NotionBlock).type} -->\n\n`;
      }

      // Reset list counter when not in a list
      if (block.type !== 'numbered_list_item') {
        listCounter = 1;
      }
    }

    return markdown;
  }

  private async tableToMarkdown(rows: NotionBlock[], hasHeader: boolean): Promise<string> {
    if (rows.length === 0) return '';

    let markdown = '';
    let isFirst = true;

    for (const row of rows) {
      if (row.type !== 'table_row') continue;

      const cells = row.table_row.cells.map(cell => this.richTextToMarkdown(cell));
      markdown += '| ' + cells.join(' | ') + ' |\n';

      if (isFirst && hasHeader) {
        markdown += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        isFirst = false;
      }
    }

    return markdown + '\n';
  }

  // ============================================
  // Rich Text Conversion
  // ============================================

  private richTextToMarkdown(richTexts: RichText[]): string {
    if (!richTexts || richTexts.length === 0) return '';

    return richTexts.map(rt => {
      let text = rt.plain_text;

      // Apply annotations
      if (rt.annotations) {
        if (rt.annotations.code) {
          text = `\`${text}\``;
        }
        if (rt.annotations.bold) {
          text = `**${text}**`;
        }
        if (rt.annotations.italic) {
          text = `*${text}*`;
        }
        if (rt.annotations.strikethrough) {
          text = `~~${text}~~`;
        }
        if (rt.annotations.underline) {
          text = `<u>${text}</u>`;
        }
      }

      // Handle links
      if (rt.href) {
        text = `[${text}](${rt.href})`;
      } else if (rt.type === 'text' && rt.text?.link?.url) {
        text = `[${text}](${rt.text.link.url})`;
      }

      // Handle mentions
      if (rt.type === 'mention') {
        const mention = rt.mention;
        if (mention.type === 'user') {
          text = `@${text}`;
        } else if (mention.type === 'page') {
          text = `📄 ${text}`;
        } else if (mention.type === 'database') {
          text = `📊 ${text}`;
        } else if (mention.type === 'date') {
          text = `📅 ${text}`;
        }
      }

      // Handle equations
      if (rt.type === 'equation') {
        text = `$${rt.equation.expression}$`;
      }

      return text;
    }).join('');
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async getAllBlocks(blockId: string): Promise<NotionBlock[]> {
    const blocks: NotionBlock[] = [];
    let cursor: string | undefined;

    do {
      const params: Record<string, string | number> = { page_size: 100 };
      if (cursor) params.start_cursor = cursor;

      const response = await this.client.get<PaginatedResponse<NotionBlock>>(
        `/blocks/${blockId}/children`,
        params
      );
      blocks.push(...response.results);
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    return blocks;
  }

  private getPageTitle(page: NotionPage): string {
    for (const prop of Object.values(page.properties)) {
      if (prop.type === 'title') {
        const titleProp = prop as unknown as { title: RichText[] };
        return titleProp.title.map(t => t.plain_text).join('') || 'Untitled';
      }
    }
    return 'Untitled';
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 200);
  }

  private generateFrontmatter(page: NotionPage): string {
    const title = this.getPageTitle(page);
    let frontmatter = '---\n';
    frontmatter += `id: ${page.id}\n`;
    frontmatter += `title: "${title.replace(/"/g, '\\"')}"\n`;
    frontmatter += `created: ${page.created_time}\n`;
    frontmatter += `updated: ${page.last_edited_time}\n`;
    frontmatter += `url: ${page.url}\n`;
    if (page.icon?.type === 'emoji') {
      frontmatter += `icon: ${page.icon.emoji}\n`;
    }
    frontmatter += '---\n\n';
    return frontmatter;
  }
}
