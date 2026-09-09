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

## LLM 요약 (선택)

팝업 → ⚙️ 설정 → LLM:
- **OpenAI**: Base URL `https://api.openai.com/v1`, API Key, Model `gpt-4o-mini`
- **로컬(Ollama)**: Base URL `http://localhost:11434/v1`, 키 불필요, Model 예 `llama3.1`
- 상위 N개(기본 15)만 검증·요약하여 비용을 최소화합니다.

## 설계 근거

자세한 결정 사항은 [DESIGN.md](./DESIGN.md) 참고. 쿼리 전략은 실제 GitHub API 응답으로 검증했으며, 다중 `topic:` AND가 결과를 0으로 만드는 문제를 발견해 **topic별 병렬 쿼리 후 병합** 방식으로 수정했습니다.
