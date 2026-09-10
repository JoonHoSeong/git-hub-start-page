import { runTopic } from "./pipeline.js";
import {
  loadSettings,
  loadToken,
  loadTopics,
  saveToken,
  loadBookmarks,
  addBookmark,
  removeBookmark,
  isBookmarked,
} from "./storage.js";
import { login, logout } from "./oauth.js";
import { getViewer } from "./github.js";
import type { RadarItem } from "./types.js";

type Msg =
  | { type: "runTopic"; topicId: string; forceRefresh?: boolean; subtopicId?: string }
  | { type: "login" }
  | { type: "logout" }
  | { type: "viewer" }
  | { type: "favorites" }
  | { type: "toggleBookmark"; item: RadarItem; add: boolean }
  | { type: "isBookmarked"; id: string };

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
        subtopicId: msg.subtopicId,
        onAuthFail: () => {
          // Token is invalid (expired/revoked). Drop it so future calls are
          // anonymous instead of failing with 401.
          void saveToken(null);
        },
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
    case "isBookmarked": {
      return { bookmarked: await isBookmarked(msg.id) };
    }
    case "favorites": {
      // Local bookmarks only (app-only; not GitHub stars).
      return { items: await loadBookmarks() };
    }
    case "toggleBookmark": {
      if (msg.add) await addBookmark(msg.item);
      else await removeBookmark(msg.item.id);
      return { ok: true, bookmarked: msg.add };
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
