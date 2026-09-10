import { saveToken } from "./storage.js";

/**
 * Web port of extension/src/oauth.ts. Uses a plain GitHub OAuth
 * authorization-code redirect instead of chrome.identity.launchWebAuthFlow.
 *
 * Flow:
 *  1. login() redirects the whole page to GitHub's authorize URL, after
 *     stashing a random `state` in sessionStorage.
 *  2. GitHub redirects back to this same page with ?code=...&state=...
 *  3. handleRedirectIfPresent() (called on page load) detects those params,
 *     verifies state, exchanges the code via the Worker, saves the token,
 *     and strips the query string from the URL.
 */
export const OAUTH = {
  clientId: "Ov23liHYtI7Eof0VXlnv",
  workerBaseUrl: "https://github-topic-radar-oauth.rag-web.workers.dev",
  tokenExchangeUrl: "https://github-topic-radar-oauth.rag-web.workers.dev/exchange",
  scopes: ["public_repo"],
};

const STATE_KEY = "gtr.oauth.state";

function redirectUri(): string {
  // Must exactly match a callback URL registered on the GitHub OAuth App.
  return `${location.origin}${location.pathname}`;
}

/** Redirects the page to GitHub's authorize screen. Does not return. */
export function login(): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", OAUTH.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri());
  authUrl.searchParams.set("scope", OAUTH.scopes.join(" "));
  authUrl.searchParams.set("state", state);

  location.assign(authUrl.toString());
}

/**
 * Call once on page load. If the URL carries a GitHub OAuth redirect
 * (?code=&state=), completes the exchange and cleans the URL. Returns true
 * if a login was completed, false if there was nothing to handle.
 */
export async function handleRedirectIfPresent(): Promise<boolean> {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return false;

  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  history.replaceState(null, "", url.toString());

  if (state !== expected) {
    throw new Error("OAuth state mismatch");
  }

  const token = await exchangeCode(code, redirectUri());
  await saveToken(token);
  return true;
}

async function exchangeCode(code: string, redirect_uri: string): Promise<string> {
  const res = await fetch(OAUTH.tokenExchangeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(data.error ?? "No access token");
  return data.access_token;
}

export async function logout(): Promise<void> {
  await saveToken(null);
}
