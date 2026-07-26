import type {
  ScraperCredentials,
  ScraperLoginResult,
  ScraperScrapingResult,
} from '../definitions.js';

/**
 * The contract every fund scraper satisfies, mirroring the bank scrapers' interface.
 *
 * `scrape` is the one-shot path (login + fetch + clean up). `login` / `fetchData` /
 * `terminate` are the long-lived path, which the MCP server uses so a member is not
 * asked for a fresh SMS on every tool call.
 */
export interface Scraper {
  scrape(credentials: ScraperCredentials): Promise<ScraperScrapingResult>;

  login(credentials: ScraperCredentials): Promise<ScraperLoginResult>;
  fetchData(): Promise<ScraperScrapingResult>;
  terminate(success?: boolean): Promise<void>;

  /**
   * Triggers the SMS without completing the login. Lets a caller split the flow across
   * two round-trips — which MCP needs, since a tool call cannot block waiting for a
   * member to read a text message.
   */
  triggerTwoFactorAuth?(credentials: ScraperCredentials): Promise<ScraperLoginResult>;
  /** Redeems a code obtained after `triggerTwoFactorAuth`. */
  getLongTermTwoFactorToken?(otpCode: string): Promise<{ success: boolean; token?: string }>;
}
