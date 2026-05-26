import type { Browser, Page, BrowserContext } from 'playwright';
import type {
  PatentscopeWebSearchParams,
  MadridMonitorSearchParams,
  BrowserSearchOptions,
  BrowserSearchResult,
  WIPOConfig,
} from '../types';

/**
 * Browser Automation API - Playwright-based automation for WIPO websites
 * Used for features not available via API
 */
export class BrowserApi {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private config: WIPOConfig;

  constructor(config: WIPOConfig = {}) {
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
   * Search Patentscope (PCT applications)
   * URL: https://patentscope.wipo.int/search/en/search.jsf
   */
  async searchPatentscope(params: PatentscopeWebSearchParams, options: BrowserSearchOptions = {}): Promise<BrowserSearchResult[]> {
    const page = await this.getPage();
    const results: BrowserSearchResult[] = [];

    try {
      // Navigate to Patentscope search
      const searchUrl = params.searchType === 'advanced'
        ? 'https://patentscope.wipo.int/search/en/structuredSearch.jsf'
        : 'https://patentscope.wipo.int/search/en/search.jsf';

      await page.goto(searchUrl, {
        timeout: options.timeout || 60000,
      });

      await page.waitForLoadState('networkidle');

      // Handle cookie consent if present
      const cookieButton = page.locator('button:has-text("Accept"), button:has-text("I agree")').first();
      if (await cookieButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cookieButton.click();
        await page.waitForTimeout(1000);
      }

      // Enter search query
      const searchInput = page.locator('input[name*="simpleSearchInput"], input[name*="query"], input[type="text"]').first();
      if (await searchInput.isVisible({ timeout: 10000 }).catch(() => false)) {
        await searchInput.fill(params.query);

        // Submit search
        const submitButton = page.locator('button[type="submit"], input[type="submit"], button:has-text("Search")').first();
        if (await submitButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await submitButton.click();
        } else {
          await searchInput.press('Enter');
        }

        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
      }

      // Take screenshot if requested
      if (options.screenshotPath) {
        await page.screenshot({ path: options.screenshotPath });
      }

      // Parse results
      const resultRows = await page.locator('.resultRow, .result-item, tr[data-ri], .search-result').all();

      for (const row of resultRows) {
        const text = await row.textContent().catch(() => '');
        if (!text) continue;

        // Extract application/publication number
        const pctMatch = text.match(/PCT\/[A-Z]{2}\d{4}\/\d+/i) ||
          text.match(/WO\s*\/?\s*\d{4}\/?\d+/i) ||
          text.match(/WO\d{7,}/i);

        if (pctMatch) {
          const titleElement = row.locator('.title, .inventionTitle, h3, h4').first();
          const title = await titleElement.textContent().catch(() => '');

          const dateMatch = text.match(/\d{4}[-/]\d{2}[-/]\d{2}/);
          const applicantMatch = text.match(/Applicant[:\s]+([^\n]+)/i);

          results.push({
            applicationNumber: pctMatch[0].replace(/\s+/g, ''),
            title: title?.trim() || undefined,
            date: dateMatch ? dateMatch[0] : undefined,
            applicant: applicantMatch ? applicantMatch[1].trim() : undefined,
          });
        }
      }

      return results;
    } finally {
      await page.close();
    }
  }

  /**
   * Search Madrid Monitor (International Trademarks)
   * URL: https://www3.wipo.int/madrid/monitor/en/
   */
  async searchMadridMonitor(params: MadridMonitorSearchParams, options: BrowserSearchOptions = {}): Promise<BrowserSearchResult[]> {
    const page = await this.getPage();
    const results: BrowserSearchResult[] = [];

    try {
      // Navigate to Madrid Monitor
      await page.goto('https://www3.wipo.int/madrid/monitor/en/', {
        timeout: options.timeout || 60000,
      });

      await page.waitForLoadState('networkidle');

      // Handle cookie consent if present
      const cookieButton = page.locator('button:has-text("Accept"), button:has-text("I agree")').first();
      if (await cookieButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cookieButton.click();
        await page.waitForTimeout(1000);
      }

      // Enter search criteria
      if (params.markName) {
        const markInput = page.locator('input[name*="brandName"], input[name*="mark"], input[placeholder*="Mark"]').first();
        if (await markInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await markInput.fill(params.markName);
        }
      }

      if (params.holderName) {
        const holderInput = page.locator('input[name*="holder"], input[name*="owner"]').first();
        if (await holderInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await holderInput.fill(params.holderName);
        }
      }

      if (params.registrationNumber) {
        const regInput = page.locator('input[name*="regNumber"], input[name*="irn"]').first();
        if (await regInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await regInput.fill(params.registrationNumber);
        }
      }

      // Submit search
      const searchButton = page.locator('button:has-text("Search"), input[type="submit"]').first();
      if (await searchButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await searchButton.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
      }

      // Take screenshot if requested
      if (options.screenshotPath) {
        await page.screenshot({ path: options.screenshotPath });
      }

      // Parse results
      const resultRows = await page.locator('.result-row, .brandResult, tr[data-irn], .search-result').all();

      for (const row of resultRows) {
        const text = await row.textContent().catch(() => '');
        if (!text) continue;

        // Extract registration number
        const irnMatch = text.match(/\b\d{6,8}\b/) || text.match(/IRN[:\s]*(\d+)/i);

        if (irnMatch) {
          const titleElement = row.locator('.brand-name, .mark-text, .wordMark').first();
          const title = await titleElement.textContent().catch(() => '');

          const dateMatch = text.match(/\d{4}[-/]\d{2}[-/]\d{2}/);
          const holderMatch = text.match(/Holder[:\s]+([^\n]+)/i);

          results.push({
            applicationNumber: irnMatch[1] || irnMatch[0],
            title: title?.trim() || undefined,
            date: dateMatch ? dateMatch[0] : undefined,
            applicant: holderMatch ? holderMatch[1].trim() : undefined,
          });
        }
      }

      return results;
    } finally {
      await page.close();
    }
  }

  /**
   * Search Global Brand Database (trademarks, appellations, emblems)
   * URL: https://www3.wipo.int/branddb/en/
   */
  async searchGlobalBrand(query: string, options: BrowserSearchOptions = {}): Promise<BrowserSearchResult[]> {
    const page = await this.getPage();
    const results: BrowserSearchResult[] = [];

    try {
      await page.goto('https://www3.wipo.int/branddb/en/', {
        timeout: options.timeout || 60000,
      });

      await page.waitForLoadState('networkidle');

      // Handle cookie consent
      const cookieButton = page.locator('button:has-text("Accept")').first();
      if (await cookieButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cookieButton.click();
        await page.waitForTimeout(1000);
      }

      // Enter search query
      const searchInput = page.locator('input[name*="search"], input[type="text"]').first();
      if (await searchInput.isVisible({ timeout: 10000 }).catch(() => false)) {
        await searchInput.fill(query);

        const submitButton = page.locator('button[type="submit"], button:has-text("Search")').first();
        if (await submitButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await submitButton.click();
        } else {
          await searchInput.press('Enter');
        }

        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
      }

      if (options.screenshotPath) {
        await page.screenshot({ path: options.screenshotPath });
      }

      // Parse results
      const resultItems = await page.locator('.result-item, .brand-result, [class*="result"]').all();

      for (const item of resultItems) {
        const text = await item.textContent().catch(() => '');
        if (!text) continue;

        const numberMatch = text.match(/\b\d{6,}\b/);
        if (numberMatch) {
          const titleElement = item.locator('.brand-name, .title, h3').first();
          const title = await titleElement.textContent().catch(() => '');

          results.push({
            applicationNumber: numberMatch[0],
            title: title?.trim() || undefined,
          });
        }
      }

      return results;
    } finally {
      await page.close();
    }
  }

  /**
   * Download PCT document (application, publication, etc.)
   */
  async downloadPCTDocument(applicationNumber: string, outputPath: string): Promise<boolean> {
    const page = await this.getPage();

    try {
      // Normalize PCT number
      let cleanNumber = applicationNumber.toUpperCase().replace(/\s+/g, '');
      if (!cleanNumber.startsWith('PCT')) {
        cleanNumber = 'PCT' + cleanNumber;
      }

      // Navigate to document page
      const encodedNumber = encodeURIComponent(cleanNumber);
      await page.goto(`https://patentscope.wipo.int/search/en/detail.jsf?docId=${encodedNumber}`, {
        timeout: 60000,
      });

      await page.waitForLoadState('networkidle');

      // Look for PDF download link
      const pdfLink = page.locator('a[href*=".pdf"], a:has-text("PDF"), a:has-text("Download")').first();
      if (await pdfLink.isVisible({ timeout: 10000 }).catch(() => false)) {
        // Set up download handling
        const downloadPromise = page.waitForEvent('download');
        await pdfLink.click();

        const download = await downloadPromise;
        await download.saveAs(outputPath);
        return true;
      }

      return false;
    } catch {
      return false;
    } finally {
      await page.close();
    }
  }

  /**
   * Download trademark image from Madrid Monitor
   */
  async downloadTrademarkImage(registrationNumber: string, outputPath: string): Promise<boolean> {
    const page = await this.getPage();

    try {
      const cleanNumber = registrationNumber.replace(/[^0-9]/g, '');

      // Try direct image URL
      const imageUrl = `https://www3.wipo.int/madrid/monitor/media/mark/${cleanNumber}`;

      const response = await page.goto(imageUrl, { timeout: 30000 });

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
   * Check trademark availability using Global Brand Database
   */
  async checkTrademarkAvailability(markName: string): Promise<{
    available: boolean;
    conflicts: BrowserSearchResult[];
  }> {
    const results = await this.searchGlobalBrand(markName);

    // Filter for similar marks
    const normalizedSearch = markName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const conflicts = results.filter(r => {
      const normalizedResult = (r.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return normalizedResult === normalizedSearch ||
        normalizedResult.includes(normalizedSearch) ||
        normalizedSearch.includes(normalizedResult);
    });

    return {
      available: conflicts.length === 0,
      conflicts,
    };
  }

  /**
   * Get PCT application details via browser
   */
  async getPCTApplicationDetails(applicationNumber: string): Promise<{
    applicationNumber: string;
    title?: string;
    abstract?: string;
    applicants?: string[];
    inventors?: string[];
    filingDate?: string;
    publicationDate?: string;
  } | null> {
    const page = await this.getPage();

    try {
      let cleanNumber = applicationNumber.toUpperCase().replace(/\s+/g, '');
      if (!cleanNumber.startsWith('PCT')) {
        cleanNumber = 'PCT' + cleanNumber;
      }

      const encodedNumber = encodeURIComponent(cleanNumber);
      await page.goto(`https://patentscope.wipo.int/search/en/detail.jsf?docId=${encodedNumber}`, {
        timeout: 60000,
      });

      await page.waitForLoadState('networkidle');

      // Extract details
      const title = await page.locator('.title, .inventionTitle, h1').first().textContent().catch(() => '');
      const abstract = await page.locator('.abstract, [class*="abstract"]').first().textContent().catch(() => '');

      const applicantsText = await page.locator('[class*="applicant"]').allTextContents();
      const inventorsText = await page.locator('[class*="inventor"]').allTextContents();

      const pageText = await page.textContent('body') || '';
      const filingDateMatch = pageText.match(/Filing Date[:\s]+(\d{4}[-/]\d{2}[-/]\d{2})/i);
      const pubDateMatch = pageText.match(/Publication Date[:\s]+(\d{4}[-/]\d{2}[-/]\d{2})/i);

      return {
        applicationNumber: cleanNumber,
        title: title?.trim() || undefined,
        abstract: abstract?.trim() || undefined,
        applicants: applicantsText.length > 0 ? applicantsText.map(a => a.trim()) : undefined,
        inventors: inventorsText.length > 0 ? inventorsText.map(i => i.trim()) : undefined,
        filingDate: filingDateMatch ? filingDateMatch[1] : undefined,
        publicationDate: pubDateMatch ? pubDateMatch[1] : undefined,
      };
    } catch {
      return null;
    } finally {
      await page.close();
    }
  }
}
