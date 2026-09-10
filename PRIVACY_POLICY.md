# 개인정보처리방침 (Privacy Policy) — GitHub Topic Radar

최종 수정일: 2026-09-10

GitHub Topic Radar(이하 "본 확장 프로그램")는 사용자가 지정한 키워드 주제로 GitHub 트렌딩 저장소를 큐레이션하는 Chrome 확장 프로그램입니다. 본 문서는 확장 프로그램이 어떤 데이터를 다루는지, 어디에 저장하는지, 누구와 공유하는지를 설명합니다.

## 수집하지 않는 정보

본 확장 프로그램은 이름, 이메일, 주소 등 사용자를 특정할 수 있는 개인정보를 별도로 수집하지 않습니다. 광고 추적, 사용자 행동 분석(analytics), 서드파티 트래킹 스크립트를 포함하지 않습니다.

## 저장되는 데이터와 저장 위치

모든 데이터는 아래 두 곳에만 저장됩니다.

1. **사용자의 로컬 브라우저 저장소** (`chrome.storage.local`, `chrome.storage.sync`)
   - GitHub OAuth 액세스 토큰 — 로그인 시에만 생성, 사용자가 브라우저에서 로그아웃하거나 확장 프로그램을 삭제하면 함께 삭제됩니다.
   - 북마크한 저장소 목록 (로컬 즐겨찾기 — GitHub Star가 아닌 자체 기능)
   - 사용자 설정(테마, 정렬 방식, 번역 언어 등)
   - 사용자가 추가한 커스텀 주제(키워드) 및 활성화 여부
   - 트렌드 계산을 위한 로컬 관측 기록(저장소별 별표 수 스냅샷) — 브라우저 캐시/데이터를 삭제하면 초기화됩니다.
   - 새로 감지된(NEW) 저장소 id 기록

   이 데이터는 사용자의 Google 계정에 연결된 Chrome Sync를 통해서만 동기���되며(설정된 경우), 개발자를 포함한 어떤 제3자 서버로도 전송되지 않습니다.

2. **Cloudflare Worker (`github-topic-radar-oauth.rag-web.workers.dev`)** — 개발자가 운영하는 백엔드
   - **OAuth 토큰 교환**: GitHub 로그인 시 발급되는 authorization code를 GitHub 서버와 교환하여 access token을 반환하는 중계 역할만 수행합니다. 이 과정에서 토큰이나 사용자 식별 정보를 서버에 저장하지 않습니다.
   - **공용 트렌드 데이터**: 기본 제공 주제(LLM, MCP, Skills 등)에 대해, 시간당 1회 GitHub 공개 API에서 저장소별 별표 수(stargazers count)를 수집하여 Cloudflare KV에 저장합니다. 이 데이터는 **공개된 GitHub 저장소 통계**이며 특정 사용자와 연결되지 않습니다. 확장 프로그램은 이 값을 조회만 하며, 사용자를 식별할 수 있는 어떤 정보도 이 서버로 전송하지 않습니다.

## 외부 API 통신

- **GitHub REST API** (`api.github.com`, `github.com`): 저장소 검색 및 조회를 위해 직접 호출합니다. 로그인한 경우 OAuth 토큰이 요청 헤더에 포함되어 GitHub로 전송되지만, 이는 GitHub API 인증을 위한 표준적인 사용이며 개발자는 이 토큰이나 요청 내용을 별도로 수집하지 않습니다.
- **Chrome 내장 AI (Translator API / Prompt API, Gemini Nano)**: 번역과 관련성 검증은 브라우저에 내장된 온디바이스 AI 모델로 처리됩니다. 이 데이터는 외부 서버로 전송되지 않고 사용자의 기기 내에서만 처리됩니다.

## 데이터 삭제

Chrome 확장 프로그램을 제거하거나 `chrome://extensions`에서 데이터를 초기화하면 로컬에 저장된 모든 데이터(토큰, 북마크, 설정, 관측 기록)가 삭제됩니다. Cloudflare 측에는 사용자 식별 정보가 저장되지 않으므로 별도로 삭제 요청할 개인 데이터가 없습니다.

## 권한 사용 목적

- `storage`: 설정, 북마크, 트렌드 기록을 로컬에 저장하기 위해 사용합니다.
- `identity`: GitHub OAuth 로그인 흐름(`chrome.identity.launchWebAuthFlow`)을 위해 사용합니다.
- `tabs`: 툴바 아이콘 클릭 시 이미 열려 있는 본 확장 프로그램 탭이 있으면 새로 열지 않고 해당 탭으로 전환하기 위해 사용합니다.
- Host permissions (`api.github.com`, `github.com`, Cloudflare Worker 도메인): GitHub 데이터 조회와 OAuth 토큰 교환을 위해 필요한 최소 범위입니다.

## 문의

개인정보 처리와 관련해 문의사항이 있으면 아래로 연락해 주세요.

**joonho1366@gmail.com**

## 변경 사항

본 방침이 변경되는 경우 이 문서의 "최종 수정일"을 갱신하고, 필요한 경우 Chrome 웹 스토어 등록 정보에도 반영합니다.
