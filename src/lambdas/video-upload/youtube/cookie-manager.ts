// Using require instead of import for modules without type definitions
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Interface for YouTube cookies in the Netscape format required by yt-dlp
 */
interface CookieFormat {
  domain: string;
  includeSubdomains: string;
  path: string;
  secure: string; // Changed to string since yt-dlp expects 'TRUE' or 'FALSE'
  expiration: number;
  name: string;
  value: string;
}

/**
 * Class to manage YouTube cookies extraction and formatting for yt-dlp
 */
export class YouTubeCookieManager {
  /**
   * Extract YouTube cookies using headless Chrome
   * @returns Path to the temporary cookie file
   */
  public static async extractCookies(): Promise<string> {
    console.log('[CookieManager] Starting YouTube cookie extraction');
    
    let browser: any = null;
    try {
      // Following the @sparticuz/chromium usage pattern
      const executablePath = await chromium.executablePath();
      
      console.log(`[CookieManager] Using Chrome at path: ${executablePath}`);
      
      // Print environment for debugging
      console.log(`[CookieManager] Node.js version: ${process.version}`);
      console.log(`[CookieManager] LD_LIBRARY_PATH: ${process.env.LD_LIBRARY_PATH}`);
      console.log(`[CookieManager] CHROME_PATH: ${process.env.CHROME_PATH}`);
      
      // Try to list the lib directory to verify libraries are available
      try {
        const libDir = '/opt/lib';
        if (await fs.access(libDir).then(() => true).catch(() => false)) {
          const libs = await fs.readdir(libDir);
          console.log(`[CookieManager] Libraries in ${libDir}: ${libs.join(', ')}`);
        } else {
          console.log(`[CookieManager] Directory ${libDir} not accessible`);
        }
      } catch (err) {
        console.warn(`[CookieManager] Could not list libraries: ${err}`);
      }
      
      // Launch browser using puppeteer-core with chromium settings
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: executablePath,
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      });
      
      console.log('[CookieManager] Browser launched successfully, creating new page');
      
      // Create a new page
      const page = await browser.newPage();
      
      // Set a reasonable timeout for operations
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(30000);
      
      // Visit YouTube to get cookies
      console.log('[CookieManager] Navigating to YouTube');
      await page.goto('https://www.youtube.com', { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Wait a bit for cookies to be fully set
      await page.waitForTimeout(2000);
      
      // Extract cookies from the page
      console.log('[CookieManager] Extracting cookies');
      const cookies = await page.cookies();
      
      console.log(`[CookieManager] Extracted ${cookies.length} cookies`);
      
      // Convert cookies to the format required by yt-dlp
      const cookieStr = this.formatCookiesForYtDlp(cookies);
      
      // Write cookies to a temporary file
      const tempPath = path.join('/tmp', `youtube-cookies-${Date.now()}.txt`);
      await fs.writeFile(tempPath, cookieStr);
      console.log(`[CookieManager] Cookies written to ${tempPath}`);
      
      return tempPath;
    } catch (error: any) {
      console.error('[CookieManager] Error extracting YouTube cookies:', error);
      
      // More specific error handling
      if (error.message && error.message.includes('Failed to launch')) {
        console.error('[CookieManager] Chrome launch failed - check if chrome binary and libraries exist.');
        
        // Check if the Chrome executable exists
        try {
          const chromePath = process.env.CHROME_PATH || '/opt/chromium/chrome';
          await fs.access(chromePath);
          console.log(`[CookieManager] Chrome binary exists at ${chromePath}`);
        } catch (accessErr) {
          console.error(`[CookieManager] Chrome binary not found: ${accessErr}`);
        }
      }
      
      throw error;
    } finally {
      // Clean up the browser
      if (browser) {
        console.log('[CookieManager] Closing browser');
        try {
          await browser.close();
        } catch (closeErr) {
          console.warn('[CookieManager] Error closing browser:', closeErr);
        }
      }
    }
  }
  
  /**
   * Format cookies into the Netscape format required by yt-dlp
   * Format: domain includeSubdomains path secure expiration name value
   * @param cookies Cookies from Puppeteer
   * @returns Formatted cookie string
   */
  private static formatCookiesForYtDlp(cookies: any[]): string {
    console.log(`[CookieManager] Formatting ${cookies.length} cookies for yt-dlp`);
    
    // Add the header required by the Netscape cookie format
    let cookieStr = '# Netscape HTTP Cookie File\n';
    
    cookies.forEach(cookie => {
      const formattedCookie: CookieFormat = {
        domain: cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`,
        includeSubdomains: 'TRUE',
        path: cookie.path,
        secure: cookie.secure ? 'TRUE' : 'FALSE',
        expiration: Math.floor(cookie.expires) || Math.floor(Date.now() / 1000) + 86400, // Default to 24h if no expiry
        name: cookie.name,
        value: cookie.value
      };
      
      cookieStr += `${formattedCookie.domain}\t${formattedCookie.includeSubdomains}\t${formattedCookie.path}\t${formattedCookie.secure}\t${formattedCookie.expiration}\t${formattedCookie.name}\t${formattedCookie.value}\n`;
    });
    
    return cookieStr;
  }
}