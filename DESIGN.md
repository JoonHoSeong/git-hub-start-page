# GitHub Topic Radar — 설계 문서

주제(키워드) 기반으로 GitHub에서 지금 뜨는 프로젝트/이슈/PR을 큐레이션하는 Chrome 확장 프로그램.

## 1. 문제 정의

- GitHub 트렌딩(`github.com/trending`)은 **언어 + 기간**으로만 필터된다. 주제(topic)로 좁힐 수 없다.
- 사용자는 "LLM / MCP / Skills" 같은 **특정 주제에서 지금 뜨는 것**을 매일 놓치지 않고 보고 싶다.
- 기존 도구(Hackertab, vitalets/github-trending-repos, StarDeck 등)는 전부 **고정된 언어/프로필 축**만 제공하고, 사용자가 정의하는 **자유 키워드 주제**를 지원하지 않는다.

## 2. 핵심 차별점

1. **자유 키워드 주제 탭** — 사용자가 원하는 어떤 주제든 탭으로 생성 (기존은 고정 축)
2. **품질 파이프라인** — 단순 검색이 아니라 topic 필터 + momentum 랭킹 + (선택) LLM 검증·요약
3. **GitHub OAuth + star 연동 즐겨찾기**
4. **소스 토글** — 주제별로 Repos / Issues / PR을 켜고 끔

## 3. 아키텍처

```
┌──────────────────────────────────────────────────┐
│              Chrome Extension (MV3)              │
│                                                  │
│  주제 탭: [LLM] [MCP] [Skills] [+커스텀]         │
│  각 주제 = 검색 레시피 (포함/제외/topic/조건)     │
│                                                  │
│  품질 파이프라인:                                 │
│   [1] topic 필터 + 제외어  (무료)                │
│   [2] momentum 랭킹        (무료)                │
│   [4] LLM 검증·요약        (사용자 키 있으면)    │
│         └─ OpenAI 호환: OpenAI/로컬/Groq...      │
│                                                  │
│  즐겨찾기 (로그인 시 GitHub star 연동)            │
│  설정: GitHub 로그인 / LLM 키·Base URL·모델      │
└───────────┬──────────────────────────────────────┘
            │ GitHub API (검색·star): CORS 열림, 직접 호출
            │ LLM API (요약): 사용자 키로 직접 호출
            ▼
┌──────────────────────────────────────────────────┐
│  Cloudflare Worker (OAuth 토큰 교환 전용, 무료)  │
└──────────────────────────────────────────────────┘
```

### 역할 분리
- **Extension**: GitHub 검색/star 호출(직접, CORS 열림), LLM 요약 호출(사용자 키로 직접), UI, 로컬 저장
- **Cloudflare Worker**: GitHub OAuth `code → access_token` 교환만. client_secret 보관. DB 없음.

### 왜 Worker가 필요한가
GitHub의 `https://github.com/login/oauth/access_token`은 CORS 헤더가 없고 client_secret을 요구한다. Device Flow도 GitHub은 secret을 요구한다. 따라서 브라우저 단독 OAuth 토큰 교환이 불가능 → 최소 백엔드 1개 필요.

## 4. 주제(Topic) = 검색 레시피 스키마

```ts
interface TopicRecipe {
  id: string;
  name: string;              // 탭 라벨, 예: "MCP"
  include: string[];         // 포함 키워드 (OR)
  exclude: string[];         // 제외 키워드 (노이즈 제거)
  githubTopics: string[];    // GitHub 공식 topic 태그, 예: ["mcp","model-context-protocol"]
  minStars: number;          // stars:>N
  recentDays: number;        // pushed:>today-N
  sources: {
    repositories: boolean;   // 기본 true
    issues: boolean;         // 기본 false
    pullRequests: boolean;   // 기본 false
  };
  isPreset: boolean;         // 기본 프리셋 여부 (삭제 가능)
}
```

### 기본 프리셋 (튜닝된 레시피로 제공, 사용자가 수정/삭제 가능)
- **LLM**: githubTopics=[llm, large-language-models], include=[llm, "large language model"]
- **MCP**: githubTopics=[mcp, model-context-protocol], include=["model context protocol", mcp-server]
- **Skills**: githubTopics=[agent-skills, ai-agent], include=["agent skills", "ai skills"]

(exclude/minStars/recentDays는 구현 단계에서 실데이터로 튜닝)

## 5. GitHub Search 쿼리 빌더

| 소스 | 엔드포인트 | 쿼리 예시 | 랭킹 신호 |
|------|-----------|----------|----------|
| Repositories | `/search/repositories` | `topic:mcp pushed:>2026-08-01 stars:>10` | momentum (최근 star 증가) |
| Issues | `/search/issues?q=...+type:issue` | `mcp type:issue state:open` | 댓글수 + 반응(reactions) + 최신성 |
| Pull Requests | `/search/issues?q=...+type:pr` | `mcp type:pr` | 댓글수 + 리뷰 활발도 + 최신성 |

## 6. 품질 파이프라인 (2-티어)

### 무료 티어 (API 키 없음)
- **[1] 모집단 정제**: `topic:` 필터 + 제외 키워드 + `stars:>N` + `pushed:>최근`
- **[2] momentum 랭킹**: `score = 최근 star 증가 × w1 + 커밋 활발도 × w2 + topic 정확도 × w3 - 오래됨 감점`
  - 주의: GitHub Search는 절대 star로만 정렬 가능하므로, 최근 star 증가는 클라이언트에서 근사 계산(생성일 대비 star, 최근 push 등) 또는 캐시 diff로 추정.

### 고품질 티어 (사용자 OpenAI 호환 키 입력 시 자동 활성)
- **[4] LLM 검증·요약**: 상위 N개(예: 주제당 15~20개)에만 적용
  - 오탐 제거: "이 repo/이슈가 정말 <주제>와 관련 있는가?" 판정
  - 요약: 한국어 한 줄 요약 생성
- 비용은 사용자 부담. 상위 N개만 처리하므로 저렴.

## 7. LLM 설정 (OpenAI 호환)

```
Base URL:  https://api.openai.com/v1   (기본)
API Key:   sk-...                       (chrome.storage.local, 서버 전송 안 함)
Model:     gpt-4o-mini                  (기본)
```

- Base URL 교체로 다양한 제공자 지원: OpenAI / 로컬(Ollama, LM Studio: `http://localhost:11434/v1`) / Groq / Together / DeepSeek / OpenRouter 등
- 호출은 extension이 직접 `/v1/chat/completions`. OpenAI는 CORS 허용, 로컬은 host_permissions 필요.
- 각 제공자 CORS 동작은 구현 시 개별 확인.

## 8. 인증 & 즐겨찾기

- **비로그인**: 검색 API (시간당 60회, IP 기준). 로컬 즐겨찾기만.
- **GitHub OAuth 로그인**:
  - `chrome.identity.launchWebAuthFlow()` → code 발급
  - code를 Cloudflare Worker로 전달 → Worker가 client_secret과 함께 교환 → access_token 반환
  - token은 `chrome.storage.local` 보관
  - 시간당 5,000회, star 읽기/추가로 **즐겨찾기 = 실제 GitHub Star 연동**

## 9. 저장소 (chrome.storage.local)

- `topics`: TopicRecipe[] (프리셋 + 커스텀)
- `settings`: { llmBaseUrl, llmApiKey, llmModel, defaultSources }
- `githubToken`: OAuth access token
- `cache`: 주제별 최근 결과 + 타임스탬프 (기본 30분 TTL, star 증가 diff 계산용 히스토리)

## 10. 권한 (manifest host_permissions)

- `https://api.github.com/*` — 검색, star
- `https://github.com/*` — OAuth 리다이렉트
- `http://localhost/*` — 로컬 LLM
- 사용자 지정 LLM Base URL — optional_host_permissions로 런타임 요청

## 11. 비용

- 서버: Cloudflare Workers 무료 티어 (OAuth 교환만) → 사실상 $0
- LLM: 사용자 키 부담 또는 로컬(Ollama) 무료

## 12. 기술 스택 (예정)

- Extension: Manifest V3, Vite + React + TypeScript
- Worker: Cloudflare Workers (TypeScript), wrangler
- 저장: chrome.storage.local + GitHub Stars API

## 13. 확정된 결정 요약

| 항목 | 결정 |
|------|------|
| 플랫폼 | Chrome Extension (MV3) + Cloudflare Worker |
| 주제 | 자유 키워드 검색 레시피, 기본 LLM/MCP/Skills 프리셋 |
| 소스 | Repos 기본 ON, Issues/PR 주제별 토글 |
| 랭킹 | momentum (최근 star 증가 우선) |
| 품질 | 2티어: 무료(topic+momentum) / 고품질(사용자 LLM 키) |
| LLM | OpenAI 호환 (base URL + key + model), 로컬 지원 |
| 로그인 | GitHub OAuth, 백엔드는 토큰 교환 전용 |
| 즐겨찾기 | GitHub Star 연동 (로그인 시) + 로컬(비로그인) |
| 비용 | 서버 $0, LLM 사용자 부담/로컬 무료 |
