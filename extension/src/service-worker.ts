import { runTopic } from "./pipeline.js";
import { loadSettings, loadToken, loadTopics, saveToken } from "./storage.js";
import { login, logout } from "./oauth.js";
import { getViewer, isStarred, starRepo, unstarRepo } from "./github.js";

type Msg =
  | { type: "runTopic"; topicId: string; forceRefresh?: boolean }
  | { type: "login" }
  | { type: "logout" }
  | { type: "viewer" }
  | { type: "toggleStar"; repoFullName: string; star: boolean }
  | { type: "isStarred"; repoFullName: string };

async function handle(msg: Msg): Promise<unknown> {
  switch (msg.type) {
    case "runTopic": {
      const [topics, settings, token] = await Promise.all([
        loadTopics(),
        loadSettings(),
        loadToken(),
      ]);
      const topic = topics.find((t) => t.id === msg.topicId);
      if (!topic) throw new Error(`Unknown topic: ${msg.topicId}`);
      return runTopic(topic, settings, token ?? undefined, {
        forceRefresh: msg.forceRefresh,
      });
    }
    case "login": {
      const token = await login();
      const viewer = await getViewer(token);
      return { token: true, viewer };
    }
    case "logout":
      await logout();
      return { ok: true };
    case "viewer": {
      const token = await loadToken();
      if (!token) return { viewer: null };
      try {
        return { viewer: await getViewer(token) };
      } catch {
        await saveToken(null);
        return { viewer: null };
      }
    }
    case "isStarred": {
      const token = await loadToken();
      if (!token) return { starred: false, needsAuth: true };
      return { starred: await isStarred(msg.repoFullName, token) };
    }
    case "toggleStar": {
      const token = await loadToken();
      if (!token) return { needsAuth: true };
      if (msg.star) await starRepo(msg.repoFullName, token);
      else await unstarRepo(msg.repoFullName, token);
      return { ok: true, starred: msg.star };
    }
    default:
      throw new Error("Unknown message");
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  handle(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  return true; // keep the message channel open for the async response
});

// ---- Full-page open behavior (popup is removed) ----

const FULL_PAGE_URL = chrome.runtime.getURL("newtab.html");

/**
 * Open the full page. If a Topic Radar tab is already open, focus it instead of
 * opening a duplicate; otherwise create a new tab.
 */
async function openFullPage(): Promise<void> {
  const existing = await chrome.tabs.query({ url: FULL_PAGE_URL });
  if (existing.length > 0 && existing[0].id !== undefined) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId !== undefined) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: FULL_PAGE_URL });
}

// Toolbar icon click -> open the full page in a tab (no popup).
chrome.action.onClicked.addListener(() => {
  void openFullPage();
});

// Open once on first install (first entry), not on every new tab or startup.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void openFullPage();
  }
});
