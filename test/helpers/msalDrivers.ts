import type { Configuration as BrowserConfiguration } from '@azure/msal-browser';
import { ConfidentialClientApplication, type Configuration } from '@azure/msal-node';
import type { Browser, BrowserContext } from 'playwright';

/**
 * Real-MSAL e2e drivers (feature #1 wires these; flow assertions are added by #6/#7/#8/#9).
 *
 * Cert trust: point Node's `NODE_EXTRA_CA_CERTS` at the persisted self-signed cert before the
 * process starts so MSAL's HTTP stack trusts the authority. In #1 the msal-node client is only
 * *instantiated* (no network I/O until discovery lands in #4), so trust is also demonstrated
 * directly via an https CA agent in the e2e test.
 */

export interface MsalNodeClientOptions {
  authority: string;
  clientId?: string;
  clientSecret?: string;
  /** PEM CA bundle to trust the emulator's self-signed cert (informational in #1). */
  caCert?: string;
}

const DEV_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
const DEV_CLIENT_SECRET = 'dev-secret';

/**
 * Instantiate an `@azure/msal-node` confidential client against the emulator authority. Uses
 * default AAD `protocolMode` with `knownAuthorities` so MSAL trusts the local instance without
 * a cloud instance-discovery call.
 */
export function createMsalNodeClient(
  options: MsalNodeClientOptions,
): ConfidentialClientApplication {
  const authorityUrl = new URL(options.authority);
  const config: Configuration = {
    auth: {
      clientId: options.clientId ?? DEV_CLIENT_ID,
      authority: options.authority,
      knownAuthorities: [authorityUrl.host],
      clientSecret: options.clientSecret ?? DEV_CLIENT_SECRET,
    },
  };
  return new ConfidentialClientApplication(config);
}

/**
 * Build a browser MSAL configuration for the emulator authority (used inside a Playwright page
 * once interactive sign-in lands in #6).
 */
export function browserMsalConfig(
  authority: string,
  clientId = DEV_CLIENT_ID,
): BrowserConfiguration {
  return {
    auth: {
      clientId,
      authority,
      knownAuthorities: [new URL(authority).host],
      redirectUri: `${new URL(authority).origin}/`,
    },
  };
}

/**
 * Launch a headless Chromium that accepts the emulator's self-signed cert. WIRED in #1 and now
 * exercised for real by the feature #6 Auth Code + PKCE e2e (`test/e2e/auth-code.e2e.ts`). The
 * `browserFlowsEnabled` gate still guards the #1 informational suite; #6's suite drives the browser
 * directly via {@link launchBrowserContext}.
 */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

/**
 * Launch a headless Chromium and open a browser context that trusts the emulator's self-signed cert
 * (`ignoreHTTPSErrors`). Used by the real-MSAL Auth Code + PKCE e2e to drive `@azure/msal-browser`.
 */
export async function launchBrowserContext(): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  return { browser, context };
}

/** Whether interactive browser e2e flows should run (off until #6). */
export function browserFlowsEnabled(): boolean {
  return process.env.E2E_BROWSER === '1';
}
