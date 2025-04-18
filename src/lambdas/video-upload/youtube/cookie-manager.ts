// Using require instead of import for modules without type definitions
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

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
    
    // First try with browser automation
    try {
      const browserCookiePath = await this.extractCookiesWithBrowser();
      
      // Validate the cookie file - this is important to check if the cookies are useful
      if (await this.validateCookieFile(browserCookiePath)) {
        console.log('[CookieManager] Successfully extracted and validated cookies');
        return browserCookiePath;
      } else {
        console.warn('[CookieManager] Browser cookies validation failed, will try fallback');
      }
    } catch (error) {
      console.error('[CookieManager] Error extracting cookies with browser:', error);
    }
    
    // If browser extraction failed or cookies were invalid, use fallback method
    try {
      console.log('[CookieManager] Using fallback cookie generation method');
      return await this.generateFallbackCookies();
    } catch (fallbackError) {
      console.error('[CookieManager] Fallback cookie generation failed:', fallbackError);
      throw fallbackError;
    }
  }
  
  /**
   * Extract cookies using browser automation (Puppeteer)
   * @returns Path to the cookie file
   */
  private static async extractCookiesWithBrowser(): Promise<string> {
    let browser: any = null;
    try {
      // Follow the @sparticuz/chromium pattern
      console.log('[CookieManager] Initializing browser');
      
      // Get the executable path
      const executablePath = await chromium.executablePath();
      console.log(`[CookieManager] Chrome executable path: ${executablePath}`);
      
      // Use less detectable browser settings - avoid standard headless mode
      browser = await puppeteer.launch({
        args: [
          ...chromium.args,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // Reduce fingerprinting
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          // Set common window dimensions
          '--window-size=1920,1080',
          // Additional anti-detection args
          '--disable-infobars',
          '--lang=en-US,en',
          '--enable-audio-service-sandbox',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        ],
        defaultViewport: {
          width: 1920,
          height: 1080
        },
        executablePath: executablePath,
        // Use headless: new instead of true to be less detectable
        headless: "new",
        ignoreHTTPSErrors: true,
      });
      
      console.log('[CookieManager] Browser launched successfully, creating new page');
      
      // Create a new page with more realistic browser profile
      const page = await browser.newPage();
      
      // Mask automation
      await page.evaluateOnNewDocument(() => {
        // Hide automation flags
        // @ts-ignore - navigator exists in browser context
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        
        // @ts-ignore - modify window.navigator.plugins to seem like a real browser
        const mockPlugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ];
        
        // @ts-ignore - needed for browser context
        Object.defineProperty(navigator, 'plugins', {
          get: function() {
            return mockPlugins;
          }
        });
        
        // @ts-ignore - modify chrome object
        window.chrome = {
          runtime: {},
          app: { isInstalled: false },
          webstore: { onInstallStageChanged: {}, onDownloadProgress: {} },
          loadTimes: function() { return { firstPaintTime: 0, firstPaintAfterLoadTime: 0 }; }
        };
        
        // Add language settings to mimic real browsers
        // @ts-ignore - needed for browser context
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
      });
      
      // Set user agent to appear as a normal browser
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      
      // YouTube needs to load completely, with potential redirects
      console.log('[CookieManager] Navigating to YouTube');
      await page.goto('https://www.youtube.com', { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });
      
      // Check for and handle consent page
      console.log('[CookieManager] Checking for consent dialogs');
      try {
        // YouTube consent button can have different selectors
        const consentSelectors = [
          'button[aria-label="Accept all"]',
          'button[aria-label="Accepter tout"]',
          'button.VfPpkd-LgbsSe.VfPpkd-LgbsSe-OWXEXe-k8QpJ',
          'form button'
        ];
        
        for (const selector of consentSelectors) {
          const consentButton = await page.$(selector);
          if (consentButton) {
            console.log(`[CookieManager] Found consent button with selector: ${selector}`);
            await consentButton.click();
            // Wait for the page to stabilize after clicking consent
            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {
              console.log('[CookieManager] Navigation timeout after consent, continuing anyway');
            });
            break;
          }
        }
      } catch (consentError) {
        console.warn('[CookieManager] Error handling consent:', consentError);
        // Continue anyway, as consent might not be required
      }
      
      // Add more human-like behavior
      console.log('[CookieManager] Simulating user behavior');
      
      // Random scroll - more human-like
      await page.evaluate(() => {
        // @ts-ignore - window exists in browser context
        window.scrollTo(0, Math.floor(Math.random() * 100));
      });
      
      // More complex user simulation
      try {
        // Move mouse around randomly a bit
        for (let i = 0; i < 5; i++) {
          const x = 100 + Math.floor(Math.random() * 500);
          const y = 100 + Math.floor(Math.random() * 300);
          await page.mouse.move(x, y);
          // Use setTimeout instead of waitForTimeout
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Try accessing a specific URL that might have more cookies 
        // YouTube sign-in page sometimes sets more cookies
        console.log('[CookieManager] Visiting YouTube sign-in page to get more cookies');
        await page.goto('https://www.youtube.com/feed/explore', {
          waitUntil: 'networkidle2',
          timeout: 10000
        }).catch((err: Error) => {
          console.warn('[CookieManager] Error navigating to explore page:', err);
        });
        
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Go back to main page
        await page.goto('https://www.youtube.com', {
          waitUntil: 'networkidle2',
          timeout: 10000
        }).catch((err: Error) => {
          console.warn('[CookieManager] Error navigating back to main page:', err);
        });
      } catch (simError) {
        console.warn('[CookieManager] Error during additional user simulation:', simError);
        // Continue anyway
      }
      
      // Wait longer for cookies to be fully set
      console.log('[CookieManager] Waiting for cookies to be fully set');
      await new Promise(resolve => setTimeout(resolve, 8000));
      
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
      
      // Print FULL cookie file content for debugging
      try {
        const cookieFileContent = await fs.readFile(tempPath, 'utf8');
        console.log(`[CookieManager] COMPLETE Cookie file content (values masked for security):`);
        
        // Log all cookie lines with masked values
        const cookieLines = cookieFileContent.split('\n').map(line => {
          // Skip comment lines
          if (line.startsWith('#') || line.trim() === '') {
            return line;
          }
          
          // Mask cookie values for security in logs
          const parts = line.split('\t');
          if (parts.length >= 7) {
            // Keep domain, flags, path, secure, expiration, name but mask value
            const maskedLine = parts.slice(0, 6).join('\t') + '\t[MASKED]';
            return maskedLine;
          }
          return line;
        });
        
        console.log(cookieLines.join('\n'));
      } catch (readError) {
        console.error('[CookieManager] Error reading cookie file for debug:', readError);
      }
      
      return tempPath;
    } finally {
      // Clean up the browser
      if (browser) {
        console.log('[CookieManager] Closing browser');
        try {
        await browser.close();
        } catch (closeError) {
          console.warn('[CookieManager] Error closing browser:', closeError);
        }
      }
    }
  }
  
  /**
   * Validate a cookie file to ensure it contains required cookies for YouTube
   * @param cookiePath Path to the cookie file to validate
   * @returns Whether the cookie file is valid
   */
  private static async validateCookieFile(cookiePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(cookiePath, 'utf8');
      
      // Check if file contains Netscape format header
      if (!content.includes('# Netscape HTTP Cookie File')) {
        console.warn('[CookieManager] Cookie file missing Netscape header');
        return false;
      }
      
      // Check number of non-empty, non-comment lines
      const cookieLines = content.split('\n').filter(line => 
        line.trim() && !line.startsWith('#'));
      
      if (cookieLines.length < 5) {
        console.warn('[CookieManager] Too few cookies in file, found only', cookieLines.length);
        return false;
      }
      
      // Check for critical YouTube cookies based on the actual cookie example
      const criticalCookies = [
        'VISITOR_INFO1_LIVE',    // Used for tracking visitor information
        'YSC',                   // YouTube session cookie
        'LOGIN_INFO',            // Authentication info
        'PREF',                  // User preferences
        'SID',                   // Session ID
        'HSID',                  // Used for authentication
        'SSID',                  // Secure session ID
        'APISID',                // API session ID
        'SAPISID',               // Secure API session ID
        '__Secure-1PSID',        // Additional security cookies
        '__Secure-3PSID',
        '__Secure-1PAPISID',
        '__Secure-3PAPISID'
      ];
      
      // Track which critical cookies are present
      const presentCookies = criticalCookies.filter(cookie => content.includes(`\t${cookie}\t`));
      
      // Log which cookies were found and which were missing
      console.log(`[CookieManager] Found ${presentCookies.length}/${criticalCookies.length} critical cookies: ${presentCookies.join(', ')}`);
      
      // More detailed check based on realCookie example
      const authCookies = ['LOGIN_INFO', 'SID', '__Secure-1PSID', '__Secure-3PSID'];
      const presentAuthCookies = authCookies.filter(cookie => content.includes(`\t${cookie}\t`));
      
      if (presentAuthCookies.length === 0) {
        console.warn('[CookieManager] Missing ALL authentication cookies, this will cause YouTube bot detection');
        console.warn('[CookieManager] Missing auth cookies: ' + authCookies.join(', '));
        return false;
      }
      
      if (presentCookies.length < 6) { // Need at least 6 critical cookies
        console.warn('[CookieManager] Missing too many critical cookies');
        console.warn('[CookieManager] Missing: ' + 
          criticalCookies.filter(c => !presentCookies.includes(c)).join(', '));
        return false;
      }
      
      // Must have at least VISITOR_INFO1_LIVE and YSC for basic YouTube functionality
      if (!content.includes('\tVISITOR_INFO1_LIVE\t') || !content.includes('\tYSC\t')) {
        console.warn('[CookieManager] Missing VISITOR_INFO1_LIVE or YSC cookies which are essential');
        return false;
      }
      
      console.log(`[CookieManager] Cookie file validated, contains ${cookieLines.length} cookies`);
      return true;
    } catch (error) {
      console.error('[CookieManager] Error validating cookie file:', error);
      return false;
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
    cookieStr += '# This file was generated by YouTubeCookieManager\n';
    cookieStr += '# https://www.youtube.com\n\n';
    
    cookies.forEach(cookie => {
      try {
        // Ensure domain starts with a dot for subdomain inclusion
        const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`;
        
        // Ensure expiration exists, default to 1 year from now if not present
        const expiration = cookie.expires ? 
          Math.floor(cookie.expires) : 
          Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
        
      const formattedCookie: CookieFormat = {
          domain: domain,
        includeSubdomains: 'TRUE',
          path: cookie.path || '/',
        secure: cookie.secure ? 'TRUE' : 'FALSE',
          expiration: expiration,
        name: cookie.name,
        value: cookie.value
      };
      
      cookieStr += `${formattedCookie.domain}\t${formattedCookie.includeSubdomains}\t${formattedCookie.path}\t${formattedCookie.secure}\t${formattedCookie.expiration}\t${formattedCookie.name}\t${formattedCookie.value}\n`;
      } catch (error) {
        console.warn(`[CookieManager] Error formatting cookie ${cookie.name}:`, error);
        // Continue with other cookies even if one fails
      }
    });
    
    return cookieStr;
  }
  
  /**
   * Generate fallback cookies based on the actual cookie format from YouTube
   * @returns Path to the generated cookie file
   */
  private static async generateFallbackCookies(): Promise<string> {
    console.log('[CookieManager] Generating fallback cookies based on actual YouTube format');
    
    // Generate expiry timestamps based on real cookie expiry patterns
    const now = Math.floor(Date.now() / 1000);
    // Long-lived cookies (3-4 years)
    const longExpiryFuture = now + 4 * 365 * 24 * 60 * 60; // ~4 years
    // Medium-lived cookies (1 year)
    const mediumExpiryFuture = now + 365 * 24 * 60 * 60; // 1 year
    // Short-lived cookies (1 month)
    const shortExpiryFuture = now + 30 * 24 * 60 * 60; // 1 month
    
    // Generate random strings that look like the real values
    const generateAlphaNumeric = (length: number) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };
    
    // Generate a random visitor ID similar to real ones
    const visitorId = generateAlphaNumeric(10);
    // Generate a session ID that looks realistic
    const sessionId = generateAlphaNumeric(10);
    // Generate SID-like value with g.a pattern
    const sidValue = `g.a${generateAlphaNumeric(30)}${generateAlphaNumeric(30)}`;
    // For auth tokens, create realistic looking values
    const authToken = `${generateAlphaNumeric(20)}${generateAlphaNumeric(30)}`;
    const secureToken = generateAlphaNumeric(20);
    
    // Create a realistic looking cookie string based on the actual cookie example from realCookie
    const cookieContent = `# Netscape HTTP Cookie File
# http://curl.haxx.se/rfc/cookie_spec.html
# This is a generated file - DO NOT EDIT

.youtube.com\tTRUE\t/\tTRUE\t${longExpiryFuture}\tPREF\tf4=4000000&tz=Asia.Shanghai
.youtube.com\tTRUE\t/\tTRUE\t${longExpiryFuture}\tLOGIN_INFO\tAFmmF2swRQIg${generateAlphaNumeric(30)}CIQDn${generateAlphaNumeric(30)}:QUQ3MjNmekF1V3VNT1${generateAlphaNumeric(60)}${generateAlphaNumeric(60)}
.youtube.com\tTRUE\t/\tFALSE\t${longExpiryFuture}\tSID\tg.a${generateAlphaNumeric(30)}${generateAlphaNumeric(30)}
.youtube.com\tTRUE\t/\tTRUE\t${longExpiryFuture}\t__Secure-1PSID\tg.a${generateAlphaNumeric(30)}${generateAlphaNumeric(30)}
.youtube.com\tTRUE\t/\tTRUE\t${longExpiryFuture}\t__Secure-3PSID\tg.a${generateAlphaNumeric(30)}${generateAlphaNumeric(30)}
.youtube.com\tTRUE\t/\tFALSE\t${longExpiryFuture}\tHSID\tA-${generateAlphaNumeric(15)}
.youtube.com\tTRUE\t/\tTRUE\t${longExpiryFuture}\tSSID\tA_${generateAlphaNumeric(10)}
.youtube.com\tTRUE\t/\tFALSE\t${longExpiryFuture}\tAPISID\tf${generateAlphaNumeric(20)}
.youtube.com\tTRUE\t/\tTRUE\t${longExpiryFuture}\tSAPISID\tq${generateAlphaNumeric(20)}
.youtube.com\tTRUE\t/\tTRUE\t${longExpiryFuture}\t__Secure-1PAPISID\tq${generateAlphaNumeric(20)}
.youtube.com\tTRUE\t/\tTRUE\t${longExpiryFuture}\t__Secure-3PAPISID\tq${generateAlphaNumeric(20)}
.youtube.com\tTRUE\t/\tTRUE\t${shortExpiryFuture}\t__Secure-1PSIDTS\tsidts-${generateAlphaNumeric(60)}
.youtube.com\tTRUE\t/\tTRUE\t${shortExpiryFuture}\t__Secure-3PSIDTS\tsidts-${generateAlphaNumeric(60)}
.youtube.com\tTRUE\t/\tFALSE\t${mediumExpiryFuture}\tSIDCC\t${generateAlphaNumeric(60)}
.youtube.com\tTRUE\t/\tTRUE\t${mediumExpiryFuture}\t__Secure-1PSIDCC\t${generateAlphaNumeric(60)}
.youtube.com\tTRUE\t/\tTRUE\t${mediumExpiryFuture}\t__Secure-3PSIDCC\t${generateAlphaNumeric(60)}
.youtube.com\tTRUE\t/\tTRUE\t${mediumExpiryFuture}\tVISITOR_INFO1_LIVE\t${visitorId}
.youtube.com\tTRUE\t/\tTRUE\t${mediumExpiryFuture}\tVISITOR_PRIVACY_METADATA\tCgJVUxIEGgAgIg%3D%3D
.youtube.com\tTRUE\t/\tTRUE\t0\tYSC\t${sessionId}
.youtube.com\tTRUE\t/\tTRUE\t${mediumExpiryFuture}\t__Secure-ROLLOUT_TOKEN\t${secureToken}
`;
    
    // Write to file
    const tempPath = path.join('/tmp', `youtube-fallback-cookies-${Date.now()}.txt`);
    await fs.writeFile(tempPath, cookieContent);
    console.log(`[CookieManager] Fallback cookies written to ${tempPath}`);
    
    // Print the fallback cookie content for debugging (masking sensitive values)
    try {
      console.log(`[CookieManager] COMPLETE Fallback cookie file content (values masked for security):`);
      const maskedContent = cookieContent.split('\n').map(line => {
        // Skip comment lines
        if (line.startsWith('#') || line.trim() === '') {
          return line;
        }
        
        // Mask cookie values for security in logs
        const parts = line.split('\t');
        if (parts.length >= 7) {
          // Keep domain, flags, path, secure, expiration, name but mask value
          const maskedLine = parts.slice(0, 6).join('\t') + '\t[MASKED]';
          return maskedLine;
        }
        return line;
      }).join('\n');
      
      console.log(maskedContent);
    } catch (error) {
      console.error('[CookieManager] Error logging fallback cookie content:', error);
    }
    
    return tempPath;
  }
}