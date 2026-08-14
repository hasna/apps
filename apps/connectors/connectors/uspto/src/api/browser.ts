import type { Browser, Page, BrowserContext } from 'playwright';
import type {
  TESSSearchParams,
  TESSResult,
  BrowserSearchOptions,
  USPTOConfig,
} from '../types';

/**
 * Browser Automation API - Playwright-based automation for USPTO websites
 * Used for features not available via API (TESS, patent search, etc.)
 */
export class BrowserApi {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private config: USPTOConfig;

  constructor(config: USPTOConfig = {}) {
    this.config = config;
  }

  /**
   * Initialize browser
   */
  async init(): Promise<void> {
    if (this.browser) return;

    const { chromium, firefox, webkit } = await import('playwright');

    const browserType = this.config.browser || 'chromium';
    const launcher = browserType === 'firefox' ? firefox : browserType === 'webkit' ? webkit : chromium;

    this.browser = await launcher.launch({
      headless: this.config.headless !== false,
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Get a new page
   */
  private async getPage(): Promise<Page> {
    await this.init();
    if (!this.context) {
      throw new Error('Browser not initialized');
    }
    return this.context.newPage();
  }

  /**
   * Search TESS (Trademark Electronic Search System)
   * URL: https://tmsearch.uspto.gov/
   */
  async searchTESS(params: TESSSearchParams, options: BrowserSearchOptions = {}): Promise<TESSResult[]> {
    const page = await this.getPage();
    const results: TESSResult[] = [];

    try {
      // Navigate to TESS
      await page.goto('https://tmsearch.uspto.gov/bin/gate.exe?f=login&p_lang=english&p_d=trmk', {
        timeout: options.timeout || 60000,
      });

      // Accept terms if needed
      const acceptButton = page.locator('input[value="Submit"]').first();
      if (await acceptButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await acceptButton.click();
        await page.waitForLoadState('networkidle');
      }

      // Select search type
      const searchType = params.searchType || 'basic';
      if (searchType === 'basic') {
        await page.click('text=Basic Word Mark Search (New User)');
      } else if (searchType === 'word-and-or') {
        await page.click('text=Word and/or Design Mark Search (Structured)');
      } else if (searchType === 'structured') {
        await page.click('text=Word and/or Design Mark Search (Structured)');
      } else {
        await page.click('text=Free Form Search (Advanced)');
      }

      await page.waitForLoadState('networkidle');

      // Enter search term
      const searchInput = page.locator('input[name="p_s_PARA1"]').first();
      if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await searchInput.fill(params.searchTerm);
      } else {
        // Try alternative input
        const altInput = page.locator('input[type="text"]').first();
        await altInput.fill(params.searchTerm);
      }

      // Set options
      if (params.plurals) {
        const pluralCheck = page.locator('input[name="p_s_Plurals"]');
        if (await pluralCheck.isVisible({ timeout: 2000 }).catch(() => false)) {
          await pluralCheck.check();
        }
      }

      // Submit search
      await page.click('input[type="submit"][value*="Submit"]');
      await page.waitForLoadState('networkidle');

      // Take screenshot if requested
      if (options.screenshotPath) {
        await page.screenshot({ path: options.screenshotPath });
      }

      // Parse results
      const rows = await page.locator('table tr').all();

      for (const row of rows) {
        const cells = await row.locator('td').all();
        if (cells.length >= 3) {
          const serialText = await cells[0].textContent().catch(() => '');
          const markText = await cells[1].textContent().catch(() => '');
          const statusText = await cells[2].textContent().catch(() => '');

          if (serialText && serialText.match(/^\d+$/)) {
            results.push({
              serialNumber: serialText.trim(),
              wordMark: markText?.trim(),
              status: statusText?.trim() || '',
            });
          }
        }
      }

      // If we got a single result page (detail view), parse it differently
      if (results.length === 0) {
        const serialNumber = await page.locator('text=/Serial Number:?/i').first().textContent().catch(() => '');
        const wordMark = await page.locator('text=/Word Mark:?/i').first().textContent().catch(() => '');

        if (serialNumber) {
          const match = serialNumber.match(/(\d+)/);
          if (match) {
            results.push({
              serialNumber: match[1],
              wordMark: wordMark?.replace(/Word Mark:?\s*/i, '').trim(),
              status: 'See details',
            });
          }
        }
      }

      return results;
    } finally {
      await page.close();
    }
  }

  /**
   * Search patents on USPTO website
   * URL: https://ppubs.uspto.gov/pubwebapp/
   */
  async searchPatents(query: string, options: BrowserSearchOptions = {}): Promise<Array<{
    patentNumber: string;
    title: string;
    date?: string;
    inventors?: string;
  }>> {
    const page = await this.getPage();
    const results: Array<{
      patentNumber: string;
      title: string;
      date?: string;
      inventors?: string;
    }> = [];

    try {
      // Navigate to Patent Public Search
      await page.goto('https://ppubs.uspto.gov/pubwebapp/', {
        timeout: options.timeout || 60000,
      });

      await page.waitForLoadState('networkidle');

      // Enter search query
      const searchInput = page.locator('input[placeholder*="Search"]').first();
      if (await searchInput.isVisible({ timeout: 10000 }).catch(() => false)) {
        await searchInput.fill(query);
        await searchInput.press('Enter');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000); // Wait for results to load
      }

      // Take screenshot if requested
      if (options.screenshotPath) {
        await page.screenshot({ path: options.screenshotPath });
      }

      // Parse results (structure depends on the actual page)
      const resultItems = await page.locator('.search-result, .result-item, [class*="result"]').all();

      for (const item of resultItems) {
        const text = await item.textContent().catch(() => '');
        if (text) {
          // Try to extract patent number and title
          const patentMatch = text.match(/US\s*(\d{7,})/i) || text.match(/(\d{7,})/);
          const titleMatch = text.match(/Title:\s*(.+?)(?:\n|$)/i);

          if (patentMatch) {
            results.push({
              patentNumber: patentMatch[1],
              title: titleMatch ? titleMatch[1].trim() : text.substring(0, 100),
            });
          }
        }
      }

      return results;
    } finally {
      await page.close();
    }
  }

  /**
   * Download a patent document as PDF
   */
  async downloadPatentPDF(patentNumber: string, outputPath: string): Promise<boolean> {
    const page = await this.getPage();

    try {
      const cleanNumber = patentNumber.replace(/[^0-9]/g, '');

      // Navigate to patent page
      await page.goto(`https://patft.uspto.gov/netacgi/nph-Parser?Sect1=PTO2&Sect2=HITOFF&p=1&u=%2Fnetahtml%2FPTO%2Fsearch-bool.html&r=1&f=G&l=50&co1=AND&d=PTXT&s1=${cleanNumber}.PN.`, {
        timeout: 60000,
      });

      await page.waitForLoadState('networkidle');

      // Look for images/PDF link
      const pdfLink = page.locator('a[href*="PDF"], a:has-text("Images")').first();
      if (await pdfLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        const href = await pdfLink.getAttribute('href');
        if (href) {
          // Download the PDF
          const response = await page.goto(href);
          if (response) {
            const buffer = await response.body();
            const fs = await import('fs');
            fs.writeFileSync(outputPath, buffer);
            return true;
          }
        }
      }

      return false;
    } finally {
      await page.close();
    }
  }

  /**
   * Get trademark image from USPTO
   */
  async getTrademarkImage(serialNumber: string, outputPath: string): Promise<boolean> {
    const page = await this.getPage();

    try {
      const cleanNumber = serialNumber.replace(/[^0-9]/g, '');

      // Try the TSDR image URL
      const imageUrl = `https://tsdr.uspto.gov/img/${cleanNumber}/large`;

      await page.goto(imageUrl, { timeout: 30000 });

      const response = await page.goto(imageUrl);
      if (response && response.status() === 200) {
        const buffer = await response.body();
        const contentType = response.headers()['content-type'] || '';

        if (contentType.includes('image')) {
          const fs = await import('fs');
          fs.writeFileSync(outputPath, buffer);
          return true;
        }
      }

      return false;
    } catch {
      return false;
    } finally {
      await page.close();
    }
  }

  /**
   * Check trademark availability using TESS
   */
  async checkTrademarkAvailability(markText: string): Promise<{
    available: boolean;
    conflicts: TESSResult[];
    screenshot?: string;
  }> {
    const results = await this.searchTESS({
      searchTerm: markText,
      searchType: 'basic',
      liveOnly: true,
    });

    // Filter for exact or similar matches
    const conflicts = results.filter(r => {
      const mark = (r.wordMark || '').toLowerCase();
      const search = markText.toLowerCase();
      return mark === search || mark.includes(search) || search.includes(mark);
    });

    return {
      available: conflicts.length === 0,
      conflicts,
    };
  }
}
