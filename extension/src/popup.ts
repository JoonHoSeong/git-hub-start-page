import type { AppSettings, RadarItem, TopicRecipe } from "./types.js";
import { loadSettings, loadTopics, saveSettings, saveTopics } from "./storage.js";

interface RunResult {
  items: RadarItem[];
  fromCache: boolean;
  llmApplied: boolean;
}

let topics: TopicRecipe[] = [];
let settings: AppSettings;
let activeTopicId = "";

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function send<T>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res: { ok: boolean; data?: T; error?: string }) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error ?? "Unknown error"));
      resolve(res.data as T);
    });
  });
}

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

function renderTabs(): void {
  const nav = $("#tabs");
  nav.innerHTML = "";
  for (const t of topics) {
    const btn = document.createElement("button");
    btn.className = "tab" + (t.id === activeTopicId ? " active" : "");
    btn.textContent = t.name;
    btn.onclick = () => selectTopic(t.id);
    nav.appendChild(btn);
  }
  // Favorites pseudo-tab (shows the user's GitHub-starred repos).
  const fav = document.createElement("button");
  fav.className = "tab tab-fav" + (activeTopicId === FAVORITES_ID ? " active" : "");
  fav.textContent = "⭐ 즐겨찾기";
  fav.onclick = () => selectTopic(FAVORITES_ID);
  nav.appendChild(fav);
}

function renderSourceChips(): void {
  const box = $("#sourceChips");
  box.innerHTML = "";
  if (activeTopicId === FAVORITES_ID) return;
  const topic = topics.find((t) => t.id === activeTopicId);
  if (!topic) return;
  const defs: [keyof TopicRecipe["sources"], string][] = [
    ["repositories", "Repos"],
    ["issues", "Issues"],
    ["pullRequests", "PRs"],
  ];
  for (const [key, label] of defs) {
    const chip = document.createElement("span");
    chip.className = "chip" + (topic.sources[key] ? " on" : "");
    chip.textContent = label;
    chip.onclick = async () => {
      topic.sources[key] = !topic.sources[key];
      await saveTopics(topics);
      renderSourceChips();
      run(true);
    };
    box.appendChild(chip);
  }
}

function card(item: RadarItem): HTMLElement {
  const el = document.createElement("div");
  el.className = "card";
  const kindLabel = item.kind === "repository" ? "REPO" : item.kind === "issue" ? "ISSUE" : "PR";
  const summary = item.summary
    ? `<div class="card-summary">💡 ${escapeHtml(item.summary)}</div>`
    : "";
  const stars = item.kind === "repository" ? `<span class="meta-item">⭐ ${item.stars.toLocaleString()}</span>` : "";
  const disc =
    item.kind !== "repository"
      ? `<span class="meta-item">💬 ${item.comments}</span><span class="meta-item">👍 ${item.reactions}</span>`
      : "";
  el.innerHTML = `
    <div class="card-head">
      <a class="card-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
      <span class="badge">${kindLabel}</span>
    </div>
    ${item.description ? `<div class="card-desc">${escapeHtml(item.description)}</div>` : ""}
    ${summary}
    <div class="card-meta">
      ${stars}${disc}
      <span class="meta-item" title="마지막 업데이트 시각">업데이트 ${relativeTime(item.updatedAt)}</span>
      <span class="meta-item" title="최근 상승세(momentum) 점수">🔥 ${item.score.toFixed(0)}</span>
      <button class="star-btn" title="즐겨찾기 — GitHub Star로 저장">☆</button>
    </div>`;
  const starBtn = el.querySelector<HTMLButtonElement>(".star-btn")!;
  if (item.kind === "repository") {
    void refreshStarState(item.repoFullName, starBtn);
    starBtn.onclick = () => toggleStar(item.repoFullName, starBtn);
  } else {
    starBtn.style.display = "none";
  }
  return el;
}

async function refreshStarState(repo: string, btn: HTMLButtonElement): Promise<void> {
  try {
    const res = await send<{ starred: boolean; needsAuth?: boolean }>({ type: "isStarred", repoFullName: repo });
    if (res.needsAuth) return;
    btn.textContent = res.starred ? "★" : "☆";
    btn.classList.toggle("starred", res.starred);
  } catch {
    /* ignore */
  }
}

async function toggleStar(repo: string, btn: HTMLButtonElement): Promise<void> {
  const wantStar = !btn.classList.contains("starred");
  try {
    const res = await send<{ needsAuth?: boolean; starred?: boolean }>({
      type: "toggleStar",
      repoFullName: repo,
      star: wantStar,
    });
    if (res.needsAuth) {
      alert("즐겨찾기는 GitHub 로그인이 필요합니다.");
      return;
    }
    btn.textContent = wantStar ? "★" : "☆";
    btn.classList.toggle("starred", wantStar);
  } catch (e) {
    alert("별표 실패: " + (e as Error).message);
  }
}

async function run(forceRefresh = false): Promise<void> {
  const results = $("#results");
  results.innerHTML = `<div class="loading">불러오는 중…</div>`;

  if (activeTopicId === FAVORITES_ID) {
    try {
      const data = await send<{ items: RadarItem[]; needsAuth?: boolean }>({ type: "favorites" });
      results.innerHTML = "";
      if (data.needsAuth) {
        results.innerHTML = `<div class="empty">즐겨찾기는 GitHub 로그인이 필요합니다.<br/>우측 상단 "로그인"을 눌러주세요.</div>`;
        return;
      }
      if (data.items.length === 0) {
        results.innerHTML = `<div class="empty">아직 별표한 저장소가 없습니다.<br/>카드의 ☆를 눌러 즐겨찾기에 추가하세요.</div>`;
        return;
      }
      for (const item of data.items) results.appendChild(card(item));
    } catch (e) {
      results.innerHTML = `<div class="empty">오류: ${escapeHtml((e as Error).message)}</div>`;
    }
    return;
  }

  try {
    const data = await send<RunResult>({ type: "runTopic", topicId: activeTopicId, forceRefresh });
    results.innerHTML = "";
    if (data.items.length === 0) {
      results.innerHTML = `<div class="empty">결과가 없습니다.</div>`;
      return;
    }
    for (const item of data.items) results.appendChild(card(item));
  } catch (e) {
    results.innerHTML = `<div class="empty">오류: ${escapeHtml((e as Error).message)}</div>`;
  }
}

function selectTopic(id: string): void {
  activeTopicId = id;
  renderTabs();
  renderSourceChips();
  run(false);
}

// ---- settings & topic management ----
function openSettings(): void {
  $("#llmBaseUrl").setAttribute("value", settings.llm.baseUrl);
  ($("#llmBaseUrl") as HTMLInputElement).value = settings.llm.baseUrl;
  ($("#llmApiKey") as HTMLInputElement).value = settings.llm.apiKey;
  ($("#llmModel") as HTMLInputElement).value = settings.llm.model;
  ($("#cacheTtl") as HTMLInputElement).value = String(settings.cacheTtlMinutes);
  ($("#llmTopN") as HTMLInputElement).value = String(settings.llmTopN);
  ($("#theme") as HTMLSelectElement).value = settings.theme;
  ($("#density") as HTMLSelectElement).value = settings.density;
  renderTopicManager();
  $("#settingsPanel").classList.remove("hidden");
}

function renderTopicManager(): void {
  const list = $("#topicList");
  list.innerHTML = "";
  for (const t of topics) {
    const row = document.createElement("div");
    row.className = "topic-row";
    row.innerHTML = `<span>${escapeHtml(t.name)}${t.isPreset ? " (기본)" : ""}</span>`;
    const del = document.createElement("button");
    del.textContent = "삭제";
    del.onclick = async () => {
      topics = topics.filter((x) => x.id !== t.id);
      await saveTopics(topics);
      if (activeTopicId === t.id) activeTopicId = topics[0]?.id ?? "";
      renderTopicManager();
      renderTabs();
      if (activeTopicId) run(false);
    };
    row.appendChild(del);
    list.appendChild(row);
  }
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
    recentDays: 30,
    sources: { ...settings.defaultSources },
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
  settings.llm.baseUrl = ($("#llmBaseUrl") as HTMLInputElement).value.trim() || settings.llm.baseUrl;
  settings.llm.apiKey = ($("#llmApiKey") as HTMLInputElement).value.trim();
  settings.llm.model = ($("#llmModel") as HTMLInputElement).value.trim() || settings.llm.model;
  settings.cacheTtlMinutes = Number(($("#cacheTtl") as HTMLInputElement).value) || settings.cacheTtlMinutes;
  settings.llmTopN = Number(($("#llmTopN") as HTMLInputElement).value) || settings.llmTopN;
  settings.theme = ($("#theme") as HTMLSelectElement).value as AppSettings["theme"];
  settings.density = ($("#density") as HTMLSelectElement).value as AppSettings["density"];
  applyTheme(settings.theme);
  applyDensity(settings.density);
  await saveSettings(settings);
  $("#settingsPanel").classList.add("hidden");
  run(true);
}

async function updateAuthButton(): Promise<void> {
  const btn = $("#authBtn") as HTMLButtonElement;
  try {
    const res = await send<{ viewer: { login: string } | null }>({ type: "viewer" });
    if (res.viewer) {
      btn.textContent = `@${res.viewer.login}`;
      btn.onclick = async () => {
        await send({ type: "logout" });
        updateAuthButton();
      };
    } else {
      btn.textContent = "로그인";
      btn.onclick = async () => {
        btn.textContent = "…";
        try {
          await send({ type: "login" });
        } catch (e) {
          alert("로그인 실패: " + (e as Error).message);
        }
        updateAuthButton();
      };
    }
  } catch {
    btn.textContent = "로그인";
  }
}

/** Apply the color theme by toggling a class on <body>. */
function applyTheme(theme: AppSettings["theme"]): void {
  const body = document.body;
  body.classList.remove("theme-auto", "theme-dark", "theme-light");
  body.classList.add(`theme-${theme}`);
}

/** Apply the grid density by toggling a class on <body>. */
function applyDensity(density: AppSettings["density"]): void {
  const body = document.body;
  body.classList.remove("density-comfortable", "density-cozy", "density-compact");
  body.classList.add(`density-${density}`);
}

async function init(): Promise<void> {
  [topics, settings] = await Promise.all([loadTopics(), loadSettings()]);
  applyTheme(settings.theme);
  applyDensity(settings.density);
  activeTopicId = topics[0]?.id ?? "";
  renderTabs();
  renderSourceChips();
  updateAuthButton();
  if (activeTopicId) run(false);

  $("#refreshBtn").onclick = () => run(true);
  $("#settingsBtn").onclick = openSettings;
  $("#closeSettings").onclick = () => $("#settingsPanel").classList.add("hidden");
  $("#saveSettings").onclick = saveSettingsFromForm;
  $("#addTopic").onclick = addTopic;
}

init();
