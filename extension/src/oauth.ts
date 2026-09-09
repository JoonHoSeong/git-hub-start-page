import { saveToken } from "./storage.js";

/**
 * OAuth config. CLIENT_ID is public and safe to ship. The client_secret lives
 * only in the Cloudflare Worker at TOKEN_EXCHANGE_URL (injected via
 * `wrangler secret put`, never committed).
 *
 * `clientId` is set. After deploying the worker, replace `tokenExchangeUrl`
 * with the deployed URL (`https://<name>.<subdomain>.workers.dev/exchange`).
 * See worker/README.md.
 */
export const OAUTH = {
  clientId: "Ov23liHYtI7Eof0VXlnv",
  tokenExchangeUrl: "https://github-topic-radar-oauth.YOUR-SUBDOMAIN.workers.dev/exchange",
  scopes: ["public_repo"], // enough to read/write stars on public repos
};

/**
 * Launch the interactive GitHub OAuth flow.
 * 1. chrome.identity opens GitHub's authorize page and captures the redirect.
 * 2. We extract the `code` from the redirect URL.
 * 3. The worker exchanges code+secret for an access token (GitHub blocks this
 *    from the browser via CORS and requires the secret).
 */
export async function login(): Promise<string> {
  const redirectUri = chrome.identity.getRedirectURL("github");
  const state = crypto.randomUUID();

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", OAUTH.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", OAUTH.scopes.join(" "));
  authUrl.searchParams.set("state", state);

  const redirect = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });
  if (!redirect) throw new Error("OAuth flow was cancelled");

  const returned = new URL(redirect);
  if (returned.searchParams.get("state") !== state) {
    throw new Error("OAuth state mismatch");
  }
  const code = returned.searchParams.get("code");
  if (!code) throw new Error("No authorization code returned");

  const token = await exchangeCode(code, redirectUri);
  await saveToken(token);
  return token;
}

async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const res = await fetch(OAUTH.tokenExchangeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(data.error ?? "No access token");
  return data.access_token;
}

export async function logout(): Promise<void> {
  await saveToken(null);
}
