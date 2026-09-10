# GitHub Topic Radar

주제(키워드) 기반으로 GitHub에서 **지금 뜨는** 프로젝트/이슈/PR을 큐레이션하는 Chrome 확장 프로그램.

GitHub 트렌딩은 언어/기간으로만 필터되지만, Topic Radar는 **자유 키워드 주제**(기본: LLM / MCP / Skills, 커스텀 추가 가능)로 모집단을 먼저 좁힌 뒤 **momentum(최근 star 증가 근사)** 로 랭킹합니다. 로그인하면 관심 repo를 **GitHub Star**로 저장하고, OpenAI 호환 LLM 키를 넣으면 상위 결과를 **검증 + 한국어 요약**합니다.

## 특징

- 자유 키워드 **주제 탭** — 기본 LLM/MCP/Skills 프리셋 + 커스텀 추가/삭제
- 주제별 **소스 토글** — Repos / Issues / PRs 를 켜고 끔
- **품질 2티어**
  - 무료: GitHub 공식 `topic:` 필터 + momentum 랭킹
  - 고품질: 사용자 OpenAI 호환 키로 상위 N개 LLM 검증·요약 (OpenAI / 로컬 Ollama / Groq 등)
- **GitHub OAuth 로그인** → star 기반 즐겨찾기
- 서버 비용 $0 (OAuth 토큰 교환용 Cloudflare Worker 하나만)

## 구조

```
extension/          Chrome 확장 (MV3)
  src/
    types.ts        도메인 타입
    presets.ts      기본 주제 프리셋
    query-builder.ts GitHub 검색 쿼리 빌더
    github.ts       GitHub API 클라이언트 (검색/star)
    ranking.ts      momentum 랭킹
    llm.ts          OpenAI 호환 검증·요약
    oauth.ts        chrome.identity 기반 OAuth
    storage.ts      chrome.storage 래퍼
    pipeline.ts     fetch→rank→LLM 파이프라인
    service-worker.ts / popup.ts
  popup.html / popup.css / manifest.json
worker/             Cloudflare Worker (OAuth 토큰 교환 전용)
tests/              순수 로직 테스트 (쿼리 빌더 / 랭킹)
```

## 빌드

```bash
npm install
npm run test        # 순수 로직 테스트
npm run typecheck   # 타입 검사
npm run build       # extension/dist 로 번들
```

## Chrome 에 로드

1. `npm run build`
2. Chrome → `chrome://extensions`
3. 우측 상단 **개발자 모드** 켜기
4. **압축해제된 확장 프로그램을 로드** → `extension/dist` 선택
5. 툴바 아이콘 클릭 → 팝업에서 LLM/MCP/Skills 탭 확인

무료 티어(로그인·키 없이)로 바로 트렌딩 조회가 됩니다. 단, 미인증은 시간당 60회 제한이 있어 로그인을 권장합니다.

## GitHub OAuth 설정 (즐겨찾기·rate limit 상향)

1. GitHub → Settings → Developer settings → **OAuth Apps** → New
   - Authorization callback URL: `https://<extension-id>.chromiumapp.org/github`
     (extension id는 로드 후 `chrome://extensions`에서 확인)
2. Worker 배포:
   ```bash
   cd worker
   npx wrangler deploy
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```
3. `extension/src/oauth.ts` 의 `OAUTH.clientId` 와 `tokenExchangeUrl` 을 실제 값으로 교체 후 재빌드.

## AI 기능 (Chrome 내장, 키 불필요)

번역과 정확도 검증·요약을 **Chrome 내장 AI**로 처리합니다. 외부 API 키나 서버가 필요 없고, 온디바이스로 동작해 비공개·무료입니다.

- **번역** (설정 → 번역): Chrome 내장 **Translator API**로 카드 설명을 원하는 언어로 번역.
- **정확도 검증 + 요약** (설정 → 정확도 검증): Chrome 내장 **Prompt API(Gemini Nano)** 로 상위 N개가 주제에 맞는지 판정(오탐 제거)하고 한 줄 요약. 상위 N개만 처리합니다.

### 요구사항 (중요)
Chrome 내장 AI는 **API 코드가 브라우저에 이미 포함**되어 별도 설치가 필요 없지만, **모델·언어팩은 최초 1회 다운로드**됩니다:

- **브라우저**: 데스크톱 **Chrome/Edge 138+** (모바일 미지원)
- **저장공간**: 최소 약 **22GB 여유 공간**(Chrome 프로필 볼륨). 모델 실체는 훨씬 작지만 Chrome이 요구하는 조건입니다. 여유가 10GB 미만이 되면 모델이 제거될 수 있습니다.
- **하드웨어**: GPU VRAM 4GB 초과, 또는 RAM 16GB + CPU 4코어 이상
- **네트워크**: 최초 모델 다운로드에만 필요(이후 오프라인). 다운로드된 뒤에는 어떤 데이터도 외부로 전송되지 않습니다.

요구사항을 못 갖춘 기기에서는 이 기능들이 자동으로 꺼지고 **원문 표시 + topic 필터**로 동작합니다(앱은 정상 작동). 대부분의 최신 데스크톱 Chrome 사용자는 추가 설치 없이 최초 다운로드만으로 사용할 수 있습니다.

## 설계 근거

자세한 결정 사항은 [DESIGN.md](./DESIGN.md) 참고. 쿼리 전략은 실제 GitHub API 응답으로 검증했으며, 다중 `topic:` AND가 결과를 0으로 만드는 문제를 발견해 **topic별 병렬 쿼리 후 병합** 방식으로 수정했습니다.

## 개발 규칙 (Governance)

이 프로젝트는 Governance MCP 지침을 따릅니다. 지침 파일:
- `.governance-policy.json` — 선택된 정책 도메인 (task/implementation, ai/llm-nlp, web/frontend, web/auth-realtime, language-runtime/javascript-typescript)
- `.governance-additions.md` — 프로젝트별 사용자 규칙
- `.governance-instructions.md` — 위 두 개를 합쳐 렌더된 실제 지침 (에이전트가 읽는 파일)

브랜치 전략:
- `main`에 직접 커밋하지 않습니다. 작업 단위마다 브랜치를 만듭니다: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
- `main`으로 PR을 올립니다. `main`은 항상 릴리스 가능 상태를 유지합니다.
- 커밋 메시지는 Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- PR 전에 `npm run test`, `npm run typecheck`, `npm run build`를 실행하고 결과를 PR 설명에 포함합니다.
- 빌드 산출물(`extension/dist/`), `node_modules/`, 시크릿은 커밋하지 않습니다.
