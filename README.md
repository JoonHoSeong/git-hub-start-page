# GitHub Topic Radar

주제(키워드) 기반으로 GitHub에서 **지금 뜨는 저장소**를 큐레이션하는 앱. Chrome 확장 프로그램과 독립 웹앱(https://github-radar.slothprogrammer.cloud) 두 가지 형태로 제공한다.

GitHub 트렌딩은 언어/기간으로만 필터되지만, Topic Radar는 **자유 키워드 주제**(기본: LLM / MCP / Skills, 커스텀 추가 가능)로 모집단을 먼저 좁힌 뒤 **momentum(측정된 실제 star 증가 기반)** 으로 랭킹한다. 로그인하면 앱 전용 **로컬 북마크**로 관심 저장소를 저장하고(GitHub star가 아님), Chrome/Edge 138+ 데스크톱에서는 **내장 AI**로 카드 설명을 번역하고 상위 결과의 관련성을 검증·요약한다.

## 특징

- 자유 키워드 **주제 탭** — 기본 LLM/MCP/Skills 등 프리셋 + 커스텀 추가/삭제/순서 변경/켜고 끔
- 주제별 **서브토픽 멀티 필터** — 더 세밀한 태그를 여러 개 동시 선택(합집합)
- **정렬**: 트렌드순(momentum) / 급상승순(순수 측정 트렌드) / 스타순 / 포크순 / 최신순
- **공유 트렌드 백엔드** — 기본 프리셋 주제는 Cloudflare Worker Cron이 1시간마다 수집한 서버 공용 트렌드 사용(모든 사용자 동일, 캐시 삭제에 영향받지 않음). 커스텀 주제는 이 브라우저의 로컬 관찰 기록으로 대체
- **GitHub OAuth 로그인** → API rate limit 상향(선택), 앱 전용 로컬 북마크
- **Chrome/Edge 내장 AI**(키 불필요, 온디바이스): 카드 설명 번역, 상위 결과 관련성 검증 + 한 줄 요약
- **NEW 배지** + 결과 내 검색
- 서버 비용 거의 $0 (Cloudflare Worker 하나 + KV)

## 구조

```
extension/          Chrome 확장 (MV3, 전체 페이지 새 탭으로 열림)
  src/
    types.ts          도메인 타입
    presets.ts         기본 주제 프리셋
    query-builder.ts   GitHub 검색 쿼리 빌더
    github.ts          GitHub API 클라이언트 (검색 저장소)
    ranking.ts          momentum 랭킹 + 정렬
    translate.ts        Chrome 내장 Translator API 래퍼
    verify.ts           Chrome 내장 Prompt API(LanguageModel) 래퍼
    oauth.ts            chrome.identity 기반 OAuth
    storage.ts          chrome.storage 래퍼
    pipeline.ts         fetch → rank → trend 파이프라인
    trend-server.ts     공유 트렌드 백엔드 클라이언트
    service-worker.ts / popup.ts
  popup.html / newtab.html / popup.css / manifest.json
web/                독립 웹앱 (github-radar.slothprogrammer.cloud)
  src/
    storage.ts          localStorage 기반 (extension/src/storage.ts와 동일 API)
    oauth.ts             표준 OAuth redirect 방식
    pipeline.ts / trend-server.ts  extension 버전 재사용/포팅
    main.ts              extension/src/popup.ts를 웹 전용으로 포팅 (직접 호출, 메시징 없음)
  public/index.html
  wrangler.toml       Cloudflare Workers Static Assets 배포 설정
worker/             Cloudflare Worker (OAuth 토큰 교환 + 공유 트렌드 수집, extension/web 공용)
tests/              순수 로직 테스트 (쿼리 빌더 / 랭킹)
docs/               운영 문서 (웹 배포 인계/완료 기록, 스토어 등록 가이드 등)
```

extension과 web은 chrome API 의존이 없는 모듈(`types`/`presets`/`query-builder`/`github`/`ranking`/`translate`/`verify`)을 그대로 공유한다. chrome API에 의존하는 부분(storage/oauth)만 각 플랫폼용으로 따로 구현되어 있다.

## 빌드

```bash
npm install
npm run test         # 순수 로직 테스트
npm run typecheck     # 타입 검사 (extension/web/worker 전체)
npm run build         # extension/dist 로 번들 (Chrome 확장)
npm run build:web     # web/dist 로 번들 (웹앱 정적 자산)
```

## Chrome 에 로드

1. `npm run build`
2. Chrome → `chrome://extensions`
3. 우측 상단 **개발자 모드** 켜기
4. **압축해제된 확장 프로그램을 로드** → `extension/dist` 선택
5. 툴바 아이콘 클릭 → 전체 페이지가 새 탭으로 열림 (팝업 없음)

무료 티어(로그인 없이)로 바로 트렌딩 조회가 된다. 단, 미인증은 시간당 60회 제한이 있어 로그인을 권장한다.

## 웹앱 배포 (github-radar.slothprogrammer.cloud)

```bash
npm run build:web
cd web && npx wrangler deploy   # wrangler.toml의 routes로 커스텀 도메인 자동 연결
```

공유 OAuth/트렌드 Worker(`worker/`)를 함께 쓰므로, 새 배포 도메인을 추가할 때는:
1. `worker/wrangler.toml`의 `ALLOWED_ORIGINS`에 새 origin 추가 후 `cd worker && npx wrangler deploy` (**기존 프로덕션 Worker에 영향 — 재배포 전 확인**)
2. GitHub OAuth App(https://github.com/settings/developers)의 Authorization callback URL에 `https://<도메인>/`(슬래시 포함, 정확히 일치) 추가

자세한 배포 경험/트러블슈팅 기록은 [docs/WEB_PORT_HANDOFF.md](./docs/WEB_PORT_HANDOFF.md) 참고 (DNS 캐시 문제, redirect_uri 불일치, 반응형 레이아웃 버그 등 실제로 겪은 문제와 해결책 정리됨).

## GitHub OAuth 설정 (북마크 앱 rate limit 상향용, 선택)

1. GitHub → Settings → Developer settings → **OAuth Apps** → New (또는 기존 앱에 콜백 URL 추가)
   - Authorization callback URL (여러 개 등록 가능):
     - 확장 프로그램: `https://<extension-id>.chromiumapp.org/github`
     - 웹앱: `https://github-radar.slothprogrammer.cloud/`
2. Worker 배포:
   ```bash
   cd worker
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler deploy
   ```
3. `extension/src/oauth.ts`/`web/src/oauth.ts`의 `OAUTH.clientId`와 `tokenExchangeUrl`을 실제 값으로 교체 후 재빌드.

## AI 기능 (Chrome/Edge 내장, 키 불필요)

번역과 정확도 검증·요약을 **브라우저 내장 AI**로 처리한다. 외부 API 키나 서버가 필요 없고, 온디바이스로 동작해 비공개·무료다.

- **번역** (설정 → 번역): 내장 **Translator API**로 카드 설명을 원하는 언어로 번역. 언어팩이 없는 조합(예: 중→한)은 영어를 경유하는 fallback을 사용.
- **정확도 검증 + 요약** (설정 → 정확도 검증): 내장 **Prompt API(Gemini Nano)** 로 상위 N개가 주제에 맞는지 판정(오탐 제거)하고 한 줄 요약.

### 요구사항 (중요)
브라우저 내장 AI는 **API가 브라우저에 이미 포함**되어 있어 별도 설치가 필요 없지만, **모델·언어팩은 최초 1회 다운로드**된다:

- **브라우저**: 데스크톱 **Chrome/Edge 138+** (모바일 미지원)
- **저장공간**: 최소 약 **22GB 여유 공간**(브라우저 프로필 볼륨)
- **하드웨어**: GPU VRAM 4GB 초과, 또는 RAM 16GB + CPU 4코어 이상
- **네트워크**: 최초 모델 다운로드에만 필요(이후 오프라인)

요구사항을 못 갖춘 기기에서는 이 기능들이 자동으로 꺼지고 **원문 표시 + topic 필터**로 동작한다(앱은 정상 작동).

## 설계 근거

자세한 결정 사항은 [DESIGN.md](./DESIGN.md) 참고. 쿼리 전략은 실제 GitHub API 응답으로 검증했으며, 다중 `topic:` AND가 결과를 0으로 만드는 문제를 발견해 **topic별 병렬 쿼리 후 병합** 방식으로 수정했다.

## 개발 규칙 (Governance)

이 프로젝트는 Governance MCP 지침을 따른다. 지침 파일:
- `.governance-policy.json` — 선택된 정책 도메인 (task/implementation, ai/llm-nlp, web/frontend, web/auth-realtime, language-runtime/javascript-typescript)
- `.governance-additions.md` — 프로젝트별 사용자 규칙
- `.governance-instructions.md` — 위 두 개를 합쳐 렌더된 실제 지침 (에이전트가 읽는 파일)

브랜치 전략:
- `main`에 직접 커밋하지 않는다. 작업 단위마다 브랜치를 만든다: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
- `main`으로 PR을 올린다. `main`은 항상 릴리스 가능 상태를 유지한다.
- 커밋 메시지는 Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- PR 전에 `npm run test`, `npm run typecheck`, `npm run build`(및 웹 변경 시 `npm run build:web`)를 실행하고 결과를 PR 설명에 포함한다.
- 빌드 산출물(`extension/dist/`, `web/dist/`), `node_modules/`, 시크릿은 커밋하지 않는다.

## 라이선스

[MIT](./LICENSE)
