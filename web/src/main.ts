import type { AppSettings, RadarItem, TopicRecipe } from "../../extension/src/types.js";
import { getViewer } from "../../extension/src/github.js";
import {
  loadSettings,
  loadTopics,
  saveSettings,
  saveTopics,
  filterNewIds,
  markSeen,
  loadToken,
  saveToken,
  loadBookmarks,
  addBookmark,
  removeBookmark,
  isBookmarked,
} from "./storage.js";
import type { Bookmark } from "./storage.js";
import { runTopic } from "./pipeline.js";
import { login, logout, handleRedirectIfPresent } from "./oauth.js";
import { translateText, isTranslationSupported, TRANSLATE_LANGUAGES } from "../../extension/src/translate.js";
import { verifyWithBuiltinAi, isBuiltinAiSupported } from "../../extension/src/verify.js";

// Web port of extension/src/popup.ts. Same UI/behavior, but talks to the
// pipeline/storage/oauth modules directly instead of going through
// chrome.runtime.sendMessage to a service worker (there is none on the web).

interface RunResult {
  items: RadarItem[];
  fromCache: boolean;
}

let topics: TopicRecipe[] = [];
let settings: AppSettings;
let activeTopicId = "";
let activeSubtopicIds = new Set<string>();
let lastItems: RadarItem[] = [];
let newIds = new Set<string>();
let searchQuery = "";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

const FAVORITES_ID = "__favorites__";

/** Topics shown as tabs (enabled !== false, preserving order). */
function enabledTopics(): TopicRecipe[] {
  return topics.filter((t) => t.enabled !== false);
}

function renderTabs(): void {
  const nav = $("#tabs");
  nav.innerHTML = "";
  for (const t of enabledTopics()) {
    const btn = document.createElement("button");
    btn.className = "tab" + (t.id === activeTopicId ? " active" : "");
    btn.textContent = t.name;
    btn.onclick = () => selectTopic(t.id);
    nav.appendChild(btn);
  }
  const fav = document.createElement("button");
  fav.className = "tab tab-fav" + (activeTopicId === FAVORITES_ID ? " active" : "");
  fav.textContent = "🔖 북마크";
  fav.onclick = () => selectTopic(FAVORITES_ID);
  nav.appendChild(fav);
}

function renderSourceChips(): void {
  const box = $("#sourceChips");
  box.innerHTML = "";
  if (activeTopicId === FAVORITES_ID) return;
  const topic = topics.find((t) => t.id === activeTopicId);
  if (!topic) return;

  if (topic.subtopics && topic.subtopics.length > 0) {
    const allChip = document.createElement("span");
    allChip.className = "chip sub" + (activeSubtopicIds.size === 0 ? " on" : "");
    allChip.textContent = "전체";
    allChip.onclick = () => {
      activeSubtopicIds.clear();
      renderSourceChips();
      run(false);
    };
    box.appendChild(allChip);

    for (const s of topic.subtopics) {
      const chip = document.createElement("span");
      chip.className = "chip sub" + (activeSubtopicIds.has(s.id) ? " on" : "");
      chip.textContent = s.name;
      chip.onclick = () => {
        if (activeSubtopicIds.has(s.id)) activeSubtopicIds.delete(s.id);
        else activeSubtopicIds.add(s.id);
        renderSourceChips();
        run(false);
      };
      box.appendChild(chip);
    }
  }
}

function bookmarkToItem(b: Bookmark): RadarItem {
  return {
    id: b.id,
    title: b.title,
    repoFullName: b.repoFullName,
    url: b.url,
    description: b.description,
    stars: 0,
    forks: 0,
    createdAt: new Date(b.addedAt).toISOString(),
    updatedAt: new Date(b.addedAt).toISOString(),
    topics: [],
    score: 0,
  };
}

function card(item: RadarItem, isNew = false): HTMLElement {
  const el = document.createElement("div");
  el.className = "card" + (isNew ? " is-new" : "");
  el.dataset.id = item.id;
  const summary = item.summary
    ? `<div class="card-summary">💡 ${escapeHtml(item.summary)}</div>`
    : "";
  const translating = Boolean(item.description) && !!settings.translateTo && settings.translateTo !== "off";
  const descHtml = item.description
    ? translating
      ? `<div class="card-desc translating"><span class="tspin"></span>번역 중…</div>`
      : `<div class="card-desc">${escapeHtml(item.description)}</div>`
    : "";
  el.innerHTML = `
    <div class="card-head">
      <a class="card-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
      <span class="badges">${isNew ? `<span class="badge badge-new">NEW</span>` : ""}<span class="badge">REPO</span></span>
    </div>
    ${descHtml}
    ${summary}
    <div class="card-meta">
      <span class="meta-item">⭐ ${item.stars.toLocaleString()}</span>
      <span class="meta-item">🍴 ${item.forks.toLocaleString()}</span>
      ${
        item.trend !== undefined && item.trend >= 1
          ? `<span class="meta-item trend-up" title="지난 방문 이후 측정된 실제 star 증가">📈 +${Math.round(item.trend)}/일</span>`
          : ""
      }
      <span class="meta-item" title="마지막 업데이트 시각">업데이트 ${relativeTime(item.updatedAt)}</span>
      <span class="meta-item" title="최근 상승세(momentum) 점수">🔥 ${item.score.toFixed(0)}</span>
      <button class="star-btn" title="북마크 (이 앱에만 저장)">🔖</button>
    </div>`;
  const bmBtn = el.querySelector<HTMLButtonElement>(".star-btn")!;
  void refreshBookmarkState(item.id, bmBtn);
  bmBtn.onclick = () => toggleBookmark(item, bmBtn);

  if (translating) {
    const descEl = el.querySelector<HTMLDivElement>(".card-desc");
    if (descEl) void translateCardDesc(descEl, item.description, settings.translateTo);
  }
  return el;
}

async function translateCardDesc(el: HTMLDivElement, original: string, target: string): Promise<void> {
  const showOriginal = () => {
    el.classList.remove("translating");
    el.textContent = original;
  };
  if (!isTranslationSupported()) {
    showOriginal();
    return;
  }
  try {
    const translated = await translateText(original, target);
    el.classList.remove("translating");
    if (translated === original) {
      el.textContent = original;
      return;
    }
    let showingTranslated = true;
    const render = () => {
      el.innerHTML = "";
      const text = document.createElement("span");
      text.textContent = showingTranslated ? translated : original;
      const toggle = document.createElement("button");
      toggle.className = "orig-toggle";
      toggle.textContent = showingTranslated ? "원문" : "번역";
      toggle.title = showingTranslated ? "원문 보기" : "번역 보기";
      toggle.onclick = () => {
        showingTranslated = !showingTranslated;
        render();
      };
      el.appendChild(text);
      el.appendChild(document.createTextNode(" "));
      el.appendChild(toggle);
    };
    render();
  } catch {
    showOriginal();
  }
}

async function refreshBookmarkState(id: string, btn: HTMLButtonElement): Promise<void> {
  try {
    const bookmarked = await isBookmarked(id);
    btn.classList.toggle("starred", bookmarked);
    btn.textContent = bookmarked ? "🔖" : "🏷️";
  } catch {
    /* ignore */
  }
}

async function toggleBookmark(item: RadarItem, btn: HTMLButtonElement): Promise<void> {
  const add = !btn.classList.contains("starred");
  try {
    if (add) await addBookmark(item);
    else await removeBookmark(item.id);
    btn.classList.toggle("starred", add);
    btn.textContent = add ? "🔖" : "🏷️";
    if (activeTopicId === FAVORITES_ID && !add) run(false);
  } catch (e) {
    alert("북마크 실패: " + (e as Error).message);
  }
}

async function run(forceRefresh = false): Promise<void> {
  const results = $("#results");
  results.innerHTML = `<div class="loading">불러오는 중…</div>`;

  if (activeTopicId === FAVORITES_ID) {
    try {
      const items = await loadBookmarks();
      results.innerHTML = "";
      if (items.length === 0) {
        results.innerHTML = `<div class="empty">아직 북마크한 항목이 없습니다.<br/>카드의 🏷️를 눌러 북마크에 추가하세요.</div>`;
        return;
      }
      for (const b of items) results.appendChild(card(bookmarkToItem(b)));
    } catch (e) {
      results.innerHTML = `<div class="empty">오류: ${escapeHtml((e as Error).message)}</div>`;
    }
    return;
  }

  try {
    const topic = topics.find((t) => t.id === activeTopicId);
    if (!topic) throw new Error(`Unknown topic: ${activeTopicId}`);
    const token = await loadToken();
    const data: RunResult = await runTopic(topic, settings, token ?? undefined, {
      forceRefresh,
      subtopicIds: [...activeSubtopicIds],
      onAuthFail: () => {
        void saveToken(null);
      },
    });
    if (data.items.length === 0) {
      results.innerHTML = `<div class="empty">결과가 없습니다.</div>`;
      lastItems = [];
      return;
    }
    lastItems = data.items;
    newIds = await filterNewIds(data.items.map((i) => i.id));
    void markSeen(data.items.map((i) => i.id));
    renderItems();
    if (settings.aiVerify && isBuiltinAiSupported()) {
      void verifyResults(data.items);
    }
  } catch (e) {
    results.innerHTML = `<div class="empty">오류: ${escapeHtml((e as Error).message)}</div>`;
  }
}

function renderItems(): void {
  const results = $("#results");
  results.innerHTML = "";
  const q = searchQuery.trim().toLowerCase();
  const items = q
    ? lastItems.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.repoFullName.toLowerCase().includes(q),
      )
    : lastItems;
  if (items.length === 0) {
    results.innerHTML = `<div class="empty">${q ? "검색 결과가 없습니다." : "결과가 없습니다."}</div>`;
    return;
  }
  for (const item of items) results.appendChild(card(item, newIds.has(item.id)));
}

async function verifyResults(items: RadarItem[]): Promise<void> {
  const topic = topics.find((t) => t.id === activeTopicId);
  if (!topic) return;
  await verifyWithBuiltinAi(items, topic, settings.aiVerifyTopN);
  const results = $("#results");
  for (const item of items) {
    const el = results.querySelector<HTMLElement>(`.card[data-id="${CSS.escape(item.id)}"]`);
    if (!el) continue;
    if (item.relevant === false) {
      el.remove();
      continue;
    }
    if (item.summary && !el.querySelector(".card-summary")) {
      const sum = document.createElement("div");
      sum.className = "card-summary";
      sum.textContent = `💡 ${item.summary}`;
      const desc = el.querySelector(".card-desc");
      if (desc) desc.after(sum);
      else el.querySelector(".card-head")?.after(sum);
    }
  }
  if (results.querySelectorAll(".card").length === 0) {
    results.innerHTML = `<div class="empty">관련 결과가 없습니다.</div>`;
  }
}

function selectTopic(id: string): void {
  activeTopicId = id;
  activeSubtopicIds = new Set();
  searchQuery = "";
  const sb = $("#searchBox") as HTMLInputElement;
  sb.value = "";
  $(".search-row").style.display = id === FAVORITES_ID ? "none" : "";
  renderTabs();
  renderSourceChips();
  run(false);
}

function openSettings(): void {
  ($("#aiVerify") as HTMLInputElement).checked = settings.aiVerify;
  ($("#aiVerifyTopN") as HTMLInputElement).value = String(settings.aiVerifyTopN);
  ($("#cacheTtl") as HTMLInputElement).value = String(settings.cacheTtlMinutes);
  ($("#theme") as HTMLSelectElement).value = settings.theme;
  ($("#density") as HTMLSelectElement).value = settings.density;
  populateTranslateSelect();
  ($("#translateTo") as HTMLSelectElement).value = settings.translateTo;
  const aiNote = $("#aiVerifyNote");
  if (aiNote) {
    aiNote.textContent = isBuiltinAiSupported()
      ? "Chrome 내장 AI(Gemini Nano)로 기기에서 검증·요약합니다. 키·비용 없음. 첫 사용 시 모델을 내려받습니다(수 GB, 여유 공간·데스크톱 필요)."
      : "이 브라우저는 내장 AI를 지원하지 않습니다(Chrome 138+ 데스크톱, 저장공간·RAM 요구). topic 필터만 사용합니다.";
  }
  renderTopicManager();
  $("#settingsPanel").classList.remove("hidden");
}

let translateSelectPopulated = false;
function populateTranslateSelect(): void {
  if (translateSelectPopulated) return;
  const sel = $("#translateTo") as HTMLSelectElement;
  sel.innerHTML = "";
  for (const { code, label } of TRANSLATE_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  translateSelectPopulated = true;
  const note = $("#translateNote");
  if (note) {
    note.textContent = isTranslationSupported()
      ? "브라우저 내장 AI로 기기에서 번역합니다 (무료·비공개). 첫 사용 시 언어팩을 내려받습니다."
      : "이 브라우저는 내장 번역을 지원하지 않습니다 (Chrome/Edge 138+ 데스크톱 필요). 원문으로 표시됩니다.";
  }
}

function renderTopicManager(): void {
  const list = $("#topicList");
  list.innerHTML = "";
  topics.forEach((t, idx) => {
    const row = document.createElement("div");
    row.className = "topic-row";

    const label = document.createElement("label");
    label.className = "topic-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = t.enabled !== false;
    cb.onchange = async () => {
      t.enabled = cb.checked;
      await saveTopics(topics);
      renderTabs();
      if (!enabledTopics().some((x) => x.id === activeTopicId)) {
        activeTopicId = enabledTopics()[0]?.id ?? "";
        renderSourceChips();
        if (activeTopicId) run(false);
      }
    };
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${t.name}${t.isPreset ? " (기본)" : ""}`));
    row.appendChild(label);

    const controls = document.createElement("div");
    controls.className = "topic-controls";
    const mkBtn = (text: string, title: string, disabled: boolean, fn: () => void) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.title = title;
      b.disabled = disabled;
      b.onclick = fn;
      controls.appendChild(b);
    };
    mkBtn("↑", "위로", idx === 0, async () => {
      [topics[idx - 1], topics[idx]] = [topics[idx], topics[idx - 1]];
      await saveTopics(topics);
      renderTopicManager();
      renderTabs();
    });
    mkBtn("↓", "아래로", idx === topics.length - 1, async () => {
      [topics[idx + 1], topics[idx]] = [topics[idx], topics[idx + 1]];
      await saveTopics(topics);
      renderTopicManager();
      renderTabs();
    });
    mkBtn("삭제", "삭제", false, async () => {
      topics = topics.filter((x) => x.id !== t.id);
      await saveTopics(topics);
      if (activeTopicId === t.id) activeTopicId = enabledTopics()[0]?.id ?? "";
      renderTopicManager();
      renderTabs();
      renderSourceChips();
      if (activeTopicId) run(false);
    });
    row.appendChild(controls);
    list.appendChild(row);
  });
}

async function addTopic(): Promise<void> {
  const name = ($("#newTopicName") as HTMLInputElement).value.trim();
  const kw = ($("#newTopicKeywords") as HTMLInputElement).value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!name || kw.length === 0) {
    alert("주제 이름과 키워드를 입력하세요.");
    return;
  }
  const topic: TopicRecipe = {
    id: `custom-${Date.now()}`,
    name,
    include: kw,
    exclude: [],
    githubTopics: kw.map((k) => k.toLowerCase().replace(/\s+/g, "-")),
    minStars: 5,
    recentDays: 90,
    enabled: true,
    isPreset: false,
  };
  topics.push(topic);
  await saveTopics(topics);
  ($("#newTopicName") as HTMLInputElement).value = "";
  ($("#newTopicKeywords") as HTMLInputElement).value = "";
  renderTopicManager();
  renderTabs();
}

async function saveSettingsFromForm(): Promise<void> {
  settings.aiVerify = ($("#aiVerify") as HTMLInputElement).checked;
  settings.aiVerifyTopN = Number(($("#aiVerifyTopN") as HTMLInputElement).value) || settings.aiVerifyTopN;
  settings.cacheTtlMinutes = Number(($("#cacheTtl") as HTMLInputElement).value) || settings.cacheTtlMinutes;
  settings.theme = ($("#theme") as HTMLSelectElement).value as AppSettings["theme"];
  settings.density = ($("#density") as HTMLSelectElement).value as AppSettings["density"];
  settings.translateTo = ($("#translateTo") as HTMLSelectElement).value;
  applyTheme(settings.theme);
  applyDensity(settings.density);
  await saveSettings(settings);
  $("#settingsPanel").classList.add("hidden");
  run(true);
}

async function updateAuthButton(): Promise<void> {
  const btn = $("#authBtn") as HTMLButtonElement;
  try {
    const token = await loadToken();
    if (!token) {
      btn.textContent = "로그인";
      btn.onclick = () => login();
      return;
    }
    const viewer = await getViewer(token);
    btn.textContent = `@${viewer.login}`;
    btn.onclick = async () => {
      await logout();
      updateAuthButton();
    };
  } catch {
    await saveToken(null);
    btn.textContent = "로그인";
    btn.onclick = () => login();
  }
}

function applyTheme(theme: AppSettings["theme"]): void {
  const body = document.body;
  body.classList.remove("theme-auto", "theme-dark", "theme-light");
  body.classList.add(`theme-${theme}`);
}

function applyDensity(density: AppSettings["density"]): void {
  const body = document.body;
  body.classList.remove("density-comfortable", "density-cozy", "density-compact");
  body.classList.add(`density-${density}`);
}

async function init(): Promise<void> {
  // Complete any pending GitHub OAuth redirect before anything else so the
  // token is available for the very first run().
  try {
    await handleRedirectIfPresent();
  } catch (e) {
    console.error("OAuth redirect handling failed:", e);
  }

  [topics, settings] = await Promise.all([loadTopics(), loadSettings()]);
  applyTheme(settings.theme);
  applyDensity(settings.density);
  activeTopicId = enabledTopics()[0]?.id ?? "";
  renderTabs();
  renderSourceChips();
  updateAuthButton();

  const sortSel = $("#sortBy") as HTMLSelectElement;
  sortSel.value = settings.sortBy;
  sortSel.onchange = async () => {
    settings.sortBy = sortSel.value as AppSettings["sortBy"];
    await saveSettings(settings);
    run(false);
  };

  if (activeTopicId) run(false);

  $("#refreshBtn").onclick = () => run(true);
  const searchBox = $("#searchBox") as HTMLInputElement;
  searchBox.oninput = () => {
    searchQuery = searchBox.value;
    if (activeTopicId !== FAVORITES_ID) renderItems();
  };
  $("#settingsBtn").onclick = openSettings;
  $("#closeSettings").onclick = () => $("#settingsPanel").classList.add("hidden");
  $("#saveSettings").onclick = saveSettingsFromForm;
  $("#addTopic").onclick = addTopic;
}

init();
