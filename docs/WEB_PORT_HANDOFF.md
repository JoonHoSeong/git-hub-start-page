# 웹버전(github-radar.slothprogrammer.cloud) 구축 — 완료 보고서

최초 작성: 2026-09-10 13:47 KST (작업 인계용). 최종 갱신: 2026-09-11 (작업 완료 후 결과 기록으로 전환).

이 문서는 원래 세션 간 인계용으로 작성되었으나, 아래 작업이 모두 완료되어 **완료 기록**으로 성격이 바뀌었다. 앞으로 이 기능을 다시 손보게 될 사람(사람 또는 에이전트)이 "무엇을 왜 이렇게 했는지"와 "실제로 겪은 함정"을 빠르게 파악하도록 남겨둔다.

## 목표 (달성됨)

기존 Chrome 확장 프로그램 "GitHub Topic Radar"와 동일한 기능을 하는 독립 웹사이트를 만들어 `https://github-radar.slothprogrammer.cloud`에 배포한다. 확장 프로그램 자체는 별개로 이미 완성되어 `main`에 있다 (Chrome 웹 스토어 등록은 사용자가 결제 후 별도 진행).

Cloudflare 계정(`joonho1366@gmail.com`, account id `4aeb72fb2783a51c29ff6420b8c4ba80`)에 도메인 `slothprogrammer.cloud`가 이미 등록되어 있다 (zone status: active).

## 최종 상태

- **웹앱**: https://github-radar.slothprogrammer.cloud — 정상 서빙 중, 실사용자가 로그인·트렌드 조회 확인 완료.
- **웹 Worker**: `github-topic-radar-web` (Cloudflare Workers Static Assets, `web/wrangler.toml`), 커스텀 도메인 라우트 연결됨.
- **공유 OAuth/트렌드 Worker**: `github-topic-radar-oauth` (`https://github-topic-radar-oauth.rag-web.workers.dev`) — extension과 web 양쪽 origin을 CORS로 허용하도록 재배포됨. 확장 프로그램 로그인은 재배포 후에도 정상 동작 확인.
- **GitHub OAuth App**: 웹 도메인 콜백 URL이 등록되어 로그인 정상 동작 확인됨 (아래 "겪은 문제와 해결" 참고).
- **PR 기록**: #21 (웹 포트 최초 구현), #22 (반응형 레이아웃 버그 수정) — 둘 다 `main`에 머지됨.

## 코드 구조 (재사용 방식)

`web/src/`는 `extension/src/`를 최대한 재사용하고, chrome API에 의존하는 부분만 웹 전용으로 새로 작성했다.

**그대로 import (chrome 의존성 없음, 확인됨):**
- `extension/src/types.ts`, `presets.ts`, `query-builder.ts`, `github.ts`, `ranking.ts`
- `extension/src/translate.ts`, `verify.ts` — Chrome 내장 AI(`self.Translator`, `self.LanguageModel`, `self.LanguageDetector`)는 전역 웹 표준 API라 chrome 전용 의존성이 전혀 없음. 포팅 없이 그대로 import.

**웹 전용으로 새로 작성 (chrome API를 대체):**
- `web/src/storage.ts` — `chrome.storage.local`/`sync` → `localStorage`. 공개 API(loadTopics, saveTopics, loadSettings, saveSettings, loadToken, saveToken, getCache, setCache, loadBookmarks, isBookmarked, addBookmark, removeBookmark, applyAndUpdateTrend, filterNewIds, markSeen)는 extension과 동일하게 유지해 `pipeline.ts` 등에서 시그니처 차이 없이 재사용 가능.
- `web/src/oauth.ts` — `chrome.identity.launchWebAuthFlow` → 표준 OAuth authorization-code redirect.
  - `login()`: `crypto.randomUUID()`로 state 생성 → `sessionStorage`에 저장 → `location.assign()`으로 GitHub authorize URL로 전체 페이지 리다이렉트 (Promise를 반환하지 않고 페이지를 이탈함).
  - `handleRedirectIfPresent()`: 페이지 로드 시 반드시 호출. URL에 `?code=&state=`가 있으면 state 검증 → Worker `/exchange`로 code 교환 → 토큰 저장 → `history.replaceState`로 URL 정리.
  - `redirectUri()` = `location.origin + location.pathname` — **GitHub OAuth App의 Authorization callback URL과 정확히 문자열 일치해야 함** (슬래시 유무까지 정확히). 이 프로젝트에서는 루트 경로(`/`)에서만 로그인하므로 결과값은 `https://github-radar.slothprogrammer.cloud/`.
  - `OAUTH.clientId`는 확장 프로그램과 동일한 `Ov23liHYtI7Eof0VXlnv`를 공유 (같은 GitHub OAuth App, 콜백 URL을 여러 개 등록해서 확장/웹 둘 다 지원).
- `web/src/trend-server.ts` — extension 버전과 로직은 동일, `./oauth.js`(web용)에서 `OAUTH.workerBaseUrl`을 가져오도록만 다름.
- `web/src/pipeline.ts` — extension 버전을 그대로 포팅 (`github.ts`/`ranking.ts`는 공용 그대로 import, storage/trend-server만 web용을 사용).
- `web/src/main.ts` — `extension/src/popup.ts`를 웹 전용으로 포팅. `chrome.runtime.sendMessage`로 service-worker에 위임하던 부분(runTopic, favorites, toggleBookmark, viewer, login/logout)을 pipeline/storage/oauth 모듈을 **직접 호출**하는 방식으로 교체 (웹에는 별도 백그라운드 프로세스가 없으므로).

**정적 자산 / 빌드:**
- `web/public/index.html` — `extension/newtab.html` 기반, `extension/popup.css`를 그대로 공유(별도 CSS 없음).
- `scripts/build-web.mjs` — esbuild로 `web/src/main.ts` → `web/dist/main.js` 번들, `index.html`/`popup.css`/아이콘을 `web/dist`로 복사.
- `web/wrangler.toml` — Cloudflare Workers Static Assets (`[assets] directory = "./dist"`) + 커스텀 도메인 라우트.

## 공유 Worker의 CORS 멀티오리진 지원

기존 `worker/src/index.ts`는 `ALLOWED_ORIGIN`(단일 값)으로 CORS를 처리해 extension origin(`chrome-extension://...`) 하나만 허용했다. 웹 도메인도 같은 Worker(`/exchange`, `/trend`)를 호출해야 하므로 아래처럼 멀티오리진으로 변경했다.

- `Env.ALLOWED_ORIGIN?: string` → `Env.ALLOWED_ORIGINS?: string` (comma-separated).
- `corsHeaders(requestOrigin: string | null, allowed: string[])`: 요청 Origin이 allowlist에 있으면 그 origin을 그대로 echo, 없으면 첫 번째 allowed 값을 사용. `Vary: Origin` 헤더 추가 (오리진별 캐시 분리를 위해 필수).
- `wrangler.toml`의 `[vars]`: `ALLOWED_ORIGINS = "chrome-extension://jlillemjommikolcmnlbnoeegmbcpold,https://github-radar.slothprogrammer.cloud"`.
- 재배포 후 양쪽 origin의 `OPTIONS` 요청에 정확한 `Access-Control-Allow-Origin` 에코가 돌아오는 것을 `curl -X OPTIONS ... -H "Origin: ..."`로 검증함. 확장 프로그램의 기존 로그인 흐름도 회귀 없이 정상 동작.

## 실제로 겪은 문제와 해결 (다음에 참고할 것)

### 1. 배포된 사이트에 "연결할 수 없음"이 뜸 — 원인은 로컬 DNS 캐시
사용자 환경에서 `curl -4`로 확인한 결과, macOS 시스템 리졸버가 A(IPv4) 레코드를 못 가져오고 있었다(`IPv4: (none)`, `Could not resolve host`). 반면 `dig @1.1.1.1`/`dig @8.8.8.8`/`dig @100.100.100.100`(Tailscale MagicDNS)은 모두 정상적으로 A 레코드(`104.21.20.211`, `172.67.194.119`)를 반환했다. 즉 DNS 서버들은 문제없었고, macOS의 DNS 캐시가 문제였다.

**해결**: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder` 실행 후 정상화됨. Tailscale을 쓰는 환경(개발 서버, 사용자 PC 둘 다 Tailscale 사용 중)에서 새로 생성한 Cloudflare 커스텀 도메인 레코드를 열어볼 때는 로컬 DNS 캐시를 의심하고 먼저 flush해볼 것.

### 2. 로그인 시 "The redirect_uri is not associated with this application"
GitHub OAuth App의 Authorization callback URL 목록에 웹 도메인이 등록되어 있지 않아 발생. `redirect_uri`는 정확한 문자열 일치를 요구하므로, **슬래시 유무**(`https://github-radar.slothprogrammer.cloud` vs `https://github-radar.slothprogrammer.cloud/`)까지 정확히 맞아야 한다. 이 프로젝트의 `redirectUri()`는 `location.pathname`을 포함하므로 루트에서 로그인 시 슬래시가 포함된 값(`.../`)이 전달된다.

**해결**: GitHub OAuth App 설정(https://github.com/settings/developers → 해당 OAuth App → Authorization callback URL)에 웹 도메인 콜백 URL을 등록 (Classic OAuth App은 여러 콜백 URL을 줄 단위로 등록 가능하므로 기존 확장 프로그램용 URL을 지우지 않고 추가). 등록 후 정상 로그인 확인됨.

### 3. 반응형 레이아웃 버그 (PR #22)
배포 후 좁은 화면(모바일 폭)에서 확인해보니:
- 상단바의 "로그인" 버튼 텍스트가 세로로 줄바꿈되어 표시됨 — `.auth-btn`/`.sort-select`에 `white-space: nowrap`이 없어서 좁은 flex 행에서 강제로 줄바꿈됨.
- 카드 그리드가 화면 폭을 넘쳐 오른콽 배지(NEW/REPO)가 잘림 — 데스크톱 그리드가 `grid-template-columns: repeat(auto-fill, minmax(400px, 1fr))` 고정값을 써서 400px보다 좁은 화면에서 넘침.

**해결**: `extension/popup.css`(웹/확장 공용)에 `white-space:nowrap; flex:none`을 버튼/셀렉트에 추가하고, `@media (max-width:560px)`에서 상단바를 2행으로 줄바꿈 허용 + 카드 그리드를 1열로 강제. Playwright로 1280px(회귀 없음)/480px/360px 스크린샷 검증 후 배포.

## 배포 절차 (실제로 실행한 순서, 재현 가능)

```bash
# 1) 공유 OAuth/트렌드 Worker 재배포 (CORS 멀티오리진 반영)
cd worker && npx wrangler deploy

# 2) 웹앱 빌드 + 신규 Worker 배포
cd .. && npm run build:web
cd web && npx wrangler deploy   # wrangler.toml의 routes로 커스텀 도메인 자동 연결됨

# 3) GitHub OAuth App 설정에 콜백 URL 추가 (웹 UI에서 수동)
#    https://github-radar.slothprogrammer.cloud/  (슬래시 포함, 정확히 일치해야 함)
```

배포 검증은 `curl --resolve <domain>:443:<cloudflare-ip> https://<domain>/`로 DNS 캐시 문제를 우회해 실제 서버 응답을 먼저 확인한 뒤, 브라우저로 최종 확인하는 순서가 유용했다 (DNS 캐시와 서버 문제를 분리해서 진단 가능).

## 참고 — 확장 프로그램(extension/) 쪽은 이 작업 이전부터 완성 상태

- PR #1~#20까지 전부 `main`에 머지됨 (연락처 문구, Chrome 스토어 등록 준비 문서 포함).
- 공유 Worker는 원래 확장 프로그램 전용으로 배포되어 있었고, TREND KV 바인딩(`76caa0aeeb6747e493f633ec13b5c1d1`)과 1시간 cron이 이미 연결되어 있었다. 이번 작업은 별도 Worker를 새로 만들지 않고 이 **동일한 Worker**의 CORS만 확장했다.
- Chrome 웹 스토어 등록은 사용자가 결제 후 별도 진행 예정 (`docs/STORE_SUBMISSION_GUIDE.md` 참고), 이번 웹 배포 작업과 독립적.
