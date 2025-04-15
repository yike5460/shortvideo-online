// Using require instead of import for modules without type definitions
const chromium = require('chrome-aws-lambda');
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
      // Set up browser options for Lambda environment
      const executablePath = await chromium.executablePath;
      
      console.log(`[CookieManager] Launching headless Chrome at path: ${executablePath}`);
      
      // Set Chrome-specific environment variables to find our libraries
      process.env.LD_LIBRARY_PATH = '/opt/lib:' + (process.env.LD_LIBRARY_PATH || '');
      console.log(`[CookieManager] Using LD_LIBRARY_PATH: ${process.env.LD_LIBRARY_PATH}`);
      
      // List available libraries to help debug
      try {
        const libDir = '/opt/lib';
        const libs = await fs.readdir(libDir);
        console.log(`[CookieManager] Available libraries in ${libDir}: ${libs.join(', ')}`);
      } catch (err) {
        console.warn(`[CookieManager] Could not list libraries: ${err}`);
      }
      
      browser = await chromium.puppeteer.launch({
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
        env: {
          ...process.env,
          LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH
        }
      });
      
      console.log('[CookieManager] Browser launched successfully, creating new page');
      
      // Create a new page
      const page = await browser.newPage();
      
      // Visit YouTube to get cookies
      console.log('[CookieManager] Navigating to YouTube');
      await page.goto('https://www.youtube.com', { waitUntil: 'networkidle2' });
      
      // Wait a bit for cookies to be fully set
      await page.waitForTimeout(2000);
      
      // Extract cookies from the page
      console.log('[CookieManager] Extracting cookies');
      const cookies = await page.cookies();
      
      // Convert cookies to the format required by yt-dlp
      const cookieStr = this.formatCookiesForYtDlp(cookies);
      
      // Write cookies to a temporary file
      const tempPath = path.join('/tmp', `youtube-cookies-${Date.now()}.txt`);
      await fs.writeFile(tempPath, cookieStr);
      console.log(`[CookieManager] Cookies written to ${tempPath}`);
      
      return tempPath;
    } catch (error) {
      console.error('[CookieManager] Error extracting YouTube cookies:', error);
      throw error;
    } finally {
      // Clean up the browser
      if (browser) {
        console.log('[CookieManager] Closing browser');
        await browser.close();
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
        expiration: Math.floor(cookie.expires),
        name: cookie.name,
        value: cookie.value
      };
      
      cookieStr += `${formattedCookie.domain}\t${formattedCookie.includeSubdomains}\t${formattedCookie.path}\t${formattedCookie.secure}\t${formattedCookie.expiration}\t${formattedCookie.name}\t${formattedCookie.value}\n`;
    });
    
    return cookieStr;
  }
}
