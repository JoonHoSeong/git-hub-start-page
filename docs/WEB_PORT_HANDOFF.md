# 작업 인계 문서 — 웹버전(github-radar.slothprogrammer.cloud) 구축

작성 시각: 2026-09-10 13:47 KST. 이 문서는 진행 중이던 작업을 다른 LLM/세션이 이어받기 위한 것입니다.

## 목표

기존 Chrome 확장 프로그램 "GitHub Topic Radar"와 동일한 기능을 하는 **독립 웹사이트**를 만들어 `github-radar.slothprogrammer.cloud`에 배포한다. (확장 프로그램 자체는 완성되어 `main`에 있고, Chrome 웹 스토어 등록은 사용자가 결제 후 별도로 진행할 예정 — 이 작업과 무관.)

Cloudflare 계정(`joonho1366@gmail.com`, account id `4aeb72fb2783a51c29ff6420b8c4ba80`)에 도메인 `slothprogrammer.cloud`가 이미 등록되어 있음(zone status: active). 이 도메인의 서브도메인으로 웹버전을 올린다.

## 지금까지 한 일 (실제로 디스크에 반영됨, 검증 필요)

레포: `/Users/joonhoseong/Desktop/workspace/Personal/github-topic-radar`, 현재 브랜치는 **`main`에서 새 브랜치를 안 딴 상태로 직접 작업 중** — 아직 `git status`로 확인하지 않았음. **다음 세션은 반드시 먼저 `git status`, `git branch --show-current`로 실제 상태 확인할 것.**

1. `web/` 디렉토리 생성됨 (`web/src/`, `web/public/`)
2. `web/src/storage.ts` 작성 완료 — `extension/src/storage.ts`를 localStorage 기반으로 포팅. `chrome.storage.local`/`chrome.storage.sync` → `localStorage` (동기화 없음, 로컬 전용). 공개 API(loadTopics, saveTopics, loadSettings, saveSettings, loadToken, saveToken, getCache, setCache, loadBookmarks, isBookmarked, addBookmark, removeBookmark, applyAndUpdateTrend, filterNewIds, markSeen)는 확장 프로그램과 동일하게 유지. `extension/src/types.ts`, `extension/src/presets.ts`를 상대경로로 import (`../../extension/src/...`).
3. `web/src/pipeline.ts` 작성 완료 — `extension/src/pipeline.ts`를 그대로 포팅. `extension/src/github.ts`, `extension/src/ranking.ts`를 그대로 import, `./storage.js`(web용), `./trend-server.js`(web용)를 사용하도록 수정됨.
4. `web/src/oauth.ts` 작성 완료 — **핵심 변경점**: `chrome.identity.launchWebAuthFlow` 방식을 버리고 표준 OAuth redirect 방식으로 재작성.
   - `login()`: `crypto.randomUUID()`로 state 생성 → `sessionStorage`에 저장 → `location.assign()`으로 GitHub authorize URL로 전체 페이지 리다이렉트 (더 이상 Promise를 반환하지 않음, 페이지를 떠남)
   - `handleRedirectIfPresent()`: 페이지 로드 시 호출해야 함. URL에 `?code=&state=`가 있으면 state 검증 → Worker `/exchange`로 code 교환 → 토큰 저장 → URL에서 code/state 제거(`history.replaceState`)
   - `redirectUri()` = `location.origin + location.pathname` (반드시 GitHub OAuth App의 Authorization callback URL과 정확히 일치해야 함 — 나중에 실제 배포 도메인으로 GitHub OAuth App 설정에 추가 필요)
   - `OAUTH.clientId`는 기존 확장 프로그램과 동일한 `Ov23liHYtI7Eof0VXlnv`를 그대로 씀 (같은 GitHub OAuth App을 확장 프로그램과 웹이 공유). **주의**: 이게 맞는 선택인지 재검토 필요 — GitHub OAuth App은 callback URL을 여러 개 등록 가능하므로 공유해도 되지만, 웹 배포 전에 GitHub OAuth App 설정에 웹 도메인의 callback URL(`https://github-radar.slothprogrammer.cloud/`)을 추가해야 함.
5. `web/src/trend-server.ts` 작성 완료 — `extension/src/trend-server.ts`를 그대로 포팅, `./oauth.js`(web용)에서 `OAUTH.workerBaseUrl`을 가져오도록 수정.
6. `web/src/pipeline.ts`의 import를 `./trend-server.js`(web용)로 고침 (처음에 extension용을 잘못 참조했던 걸 수정함, 완료).

## 지금 중단된 지점 (미완성, 다음 세션이 이어서 해야 함)

**`worker/src/index.ts`를 멀티 오리진 CORS 지원으로 바꾸는 작업이 절반만 반영됨.**

이유: 기존 Worker는 `ALLOWED_ORIGIN`(단일 값)으로 CORS를 처리해서 extension origin(`chrome-extension://...`) 하나만 허용했다. 웹 도메인도 같은 Worker(`/exchange`, `/trend`)를 호출해야 하므로 여러 origin을 허용해야 한다.

**반영된 것 (확인됨, grep으로 검증):**
- `corsHeaders()` 함수 시그니처가 `corsHeaders(requestOrigin: string | null, allowed: string[])`로 바뀜 — origin이 allowlist에 있으면 그 origin을 그대로 echo, 아니면 첫 번째 allowed 값 사용. `Vary: Origin` 헤더 추가됨.
- `Env` 인터페이스의 `ALLOWED_ORIGIN?: string` → `ALLOWED_ORIGINS?: string`(comma-separated)로 변경됨.

**반영 안 된 것 (다음 세션이 해야 함):**
- `export default { async fetch(...) }` 안에서 여전히 옛 코드 `const cors = corsHeaders(env.ALLOWED_ORIGIN ?? "*");`를 쓰고 있음 (grep 결과 43번째 줄 근처, 정확히는 파일에서 `ALLOWED_ORIGIN ??` 검색). 이걸 아래처럼 바꿔야 함:
  ```ts
  const allowed = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const cors = corsHeaders(request.headers.get("Origin"), allowed);
  ```
- 이 수정이 들어가야 `env.ALLOWED_ORIGIN`(옛 이름)을 참조하는 곳이 완전히 없어지고 타입체크가 통과함. **지금 상태로는 `Env.ALLOWED_ORIGIN`이 삭제되어 있어서 `tsc`/deploy 시 타입 에러가 날 것으로 예상됨 — 확인 필요.**
- `worker/wrangler.toml`의 `[vars]` 섹션도 `ALLOWED_ORIGIN = "chrome-extension://..."` 한 줄에서 `ALLOWED_ORIGINS = "chrome-extension://jlillemjommikolcmnlbnoeegmbcpold,https://github-radar.slothprogrammer.cloud"` 형태로 바꿔야 함 (아직 안 함).
- Worker 재배포(`cd worker && npx wrangler deploy`)도 아직 안 함.

## 남은 작업 목록 (todo_list, 세션 로컬 상태라 다음 세션엔 안 보일 수 있음 — 여기 복사해둠)

1. ~~web/ 디렉토리 구조 설계~~ 완료
2. ~~기존 로직 재사용 방법 정리~~ 완료 (types/presets/query-builder/ranking/github는 그대로 import, storage/pipeline/trend-server/oauth는 web 전용 파일)
3. ~~storage 계층을 localStorage로 재작성~~ 완료
4. ~~OAuth를 웹 redirect 방식으로 재작성~~ 완료 (web/src/oauth.ts)
5. **번역/검증 기능**: 웹에서 Chrome 내장 AI(Translator API, Prompt API/`LanguageModel`) 감지 후 있으면 사용, 없으면 기능 자체를 숨김. `extension/src/translate.ts`, `extension/src/verify.ts`를 web용으로 포팅 필요 (아직 시작 안 함). 두 파일 다 `window.Translator`/`window.LanguageModel` 전역 체크라 chrome 전용 의존성은 거의 없어서 그대로 재사용 가능할 가능성 높음 — 먼저 두 파일을 읽고 chrome API 의존 여부 확인부터 시작.
6. **새 페이지(index.html + css + main.ts) 생성** — 글래스모퍼즘 UI 재활용. `extension/newtab.html`, `extension/popup.css`, `extension/src/popup.ts`를 기반으로 만들되:
   - `popup.ts`의 `chrome.*` 호출 2곳(수정 필요 위치는 `grep chrome\\. extension/src/popup.ts`로 확인) 제거/대체
   - `chrome.identity` 로그인 트리거 부분을 `web/src/oauth.ts`의 `login()`/`handleRedirectIfPresent()`로 교체
   - 페이지 로드 시 `handleRedirectIfPresent()`를 await 해야 함 (OAuth 콜백 처리)
7. **build 스크립트**: `scripts/build.mjs`(esbuild 기반)를 참고해서 `web/` 전용 build 스크립트 작성 (또는 기존 스크립트에 entry point 추가). entry: `web/src/main.ts` → `web/dist/main.js`. `web/public/`의 정적 파일(index.html, css, 아이콘)도 dist로 복사 필요.
8. **Cloudflare 배포 설정**: Cloudflare Workers Static Assets 방식(권장, Pages보다 wrangler.toml 하나로 통합 관리 가능) 또는 Cloudflare Pages 중 택1. Workers Static Assets를 쓴다면 `web/wrangler.toml`(새 파일, OAuth worker와는 별도의 Worker) 필요 — `[assets] directory = "./dist"` 형태. 커스�텀 도메인은 `routes` 또는 대시보드에서 연결.
9. **OAuth Worker의 CORS 멀티오리진 지원** — 위 "지금 중단된 지점" 섹션 참고, 마무리 필요.
10. **`github-radar.slothprogrammer.cloud` 커스텀 도메인 연결**하고 배포 — DNS는 Cloudflare가 이미 관리 중인 zone(`slothprogrammer.cloud`)이라 Worker custom domain 등록만 하면 됨 (`npx wrangler deploy` 후 대시보드에서 Custom Domains 추가, 또는 wrangler.toml에 `routes` 지정).
11. **배포 후 실제 브라우저로 동작 검증** — 로그인 리다이렉트, 트렌드 조회, 번역(가능한 경우), 북마크 localStorage 저장 확인.

## 다음 세션이 시작할 때 먼저 할 일

1. `git status`, `git branch --show-current`로 실제 코드 상태 확인 (커밋 안 된 새 파일들이 워킹 트리에 있을 것으로 예상됨: `web/src/storage.ts`, `web/src/pipeline.ts`, `web/src/oauth.ts`, `web/src/trend-server.ts`, 그리고 `worker/src/index.ts`의 부분 수정)
2. `worker/src/index.ts`에서 `ALLOWED_ORIGIN` 잔존 참조 확인 및 수정 완료 (위 "반영 안 된 것" 섹션의 코드 스니펫 그대로 적용)
3. `worker/wrangler.toml`의 `ALLOWED_ORIGINS` 갱신
4. `cd worker && npx tsc --noEmit`(또는 프로젝트의 typecheck 명령)으로 Worker가 타입 에러 없는지 확인 — **이 Worker 변경은 기존 프로덕션 Worker(OAuth 로그인 담당)에 영향을 주므로, 재배포 전 반드시 로컬에서 검증하고, 배포는 사용자 확인 후 진행할 것** (governance: 프로덕션 영향 있는 배포는 고지 후 진행).
5. 이후 위 남은 작업 목록 5~11번을 순서대로 진행.

## 참고 — 확장 프로그램(extension/) 쪽은 이 작업과 무관하게 이미 완성 상태

- PR #1~#20까지 전부 `main`에 머지됨 (연락처 문구, Chrome 스토어 등록 준비 문서 포함)
- OAuth Worker는 이미 배포되어 있고 정상 동작 중 (`https://github-topic-radar-oauth.rag-web.workers.dev`), TREND KV 바인딩도 연결됨(`76caa0aeeb6747e493f633ec13b5c1d1`), 1시간 cron 등록됨
- 이번 웹버전 작업에서 이 **동일한 Worker**를 확장 프로그램과 공유해서 쓸 계획 (CORS만 멀티오리진으로 확장) — 별도 Worker를 새로 만드는 게 아님
- Chrome 웹 스토어 등록은 사용자가 결제 후 별도 진행 예정 (`docs/STORE_SUBMISSION_GUIDE.md` 참고), 이번 작업과 순서상 독립적

## 알아둘 기존 코드 구조 (재사용 대상)

- `extension/src/types.ts`, `presets.ts`, `query-builder.ts`, `github.ts`, `ranking.ts` — chrome 의존성 없음, 그대로 import 가능 (확인됨: `grep chrome\\. extension/src/*.ts` 결과 storage.ts/service-worker.ts/oauth.ts/popup.ts/verify.ts/translate.ts만 해당)
- `extension/src/verify.ts` — chrome 참조 1곳, `extension/src/translate.ts` — chrome 참조 1곳. 둘 다 아직 안 읽어봄, 웹 포팅 전 반드시 먼저 읽고 chrome 의존 부분이 정확히 뭔지 확인할 것.
- 기존 확장 프로그램의 momentum 랭킹 로직(`ranking.ts`), GitHub 검색 invariant(`topic:` 단일 쿼리만 유효, 텍스트 제외는 클라이언트 사이드)는 웹에서도 동일하게 적용됨 — 이 부분은 코드 재사용이라 별도 재검증 불필요.
