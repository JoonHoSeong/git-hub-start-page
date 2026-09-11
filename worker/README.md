# OAuth Token Exchange Worker

GitHub OAuth의 `code → access_token` 교환 + 공유 트렌드 수집(Cron)을 담당하는 백엔드입니다.
GitHub 토큰 엔드포인트는 CORS를 막고 `client_secret`을 요구하기 때문에, 이 교환만
서버에서 처리합니다. DB는 없고, 트렌드 스냅샷만 KV에 저장합니다.

Chrome 확장 프로그램과 웹앱(`web/`)이 이 **동일한 Worker**를 공유합니다.

## 현재 배포 상태 (실제 운영 중)

- URL: `https://github-topic-radar-oauth.rag-web.workers.dev`
- OAuth App **Client ID**: `Ov23liHYtI7Eof0VXlnv` (공개값, extension/web 공유)
- OAuth App Authorization callback URL (둘 다 등록됨):
  - `https://jlillemjommikolcmnlbnoeegmbcpold.chromiumapp.org/github` (확장 프로그램)
  - `https://github-radar.slothprogrammer.cloud/` (웹앱, **슬래시 포함 정확히 일치해야 함**)
- Client secret: **여기(코드/깃)에 절대 넣지 않음.** `wrangler secret`으로만 주입되어 있음.
- KV 네임스페이스 `TREND`: `76caa0aeeb6747e493f633ec13b5c1d1` (`wrangler.toml`에 반영됨)
- Cron: 매시 정각(`0 * * * *`)마다 프리셋 주제의 상위 저장소 star 스냅샷 수집
- CORS: `wrangler.toml`의 `ALLOWED_ORIGINS`(comma-separated)로 확장 프로그램과 웹 origin 둘 다 허용

## 재배포가 필요한 경우

`worker/src/index.ts` 또는 `wrangler.toml`을 수정했다면:

```bash
cd worker
npx tsc --noEmit          # 먼저 타입 에러 없는지 확인
npx wrangler deploy
```

**주의**: 이 Worker는 확장 프로그램과 웹앱 양쪽의 로그인이 실제로 의존하는 프로덕션 백엔드입니다. 재배포 전 diff를 확인하고, 배포 후 아래 "동작 확인"으로 양쪽 origin이 모두 정상인지 검증하세요.

새 배포 도메인(웹앱을 다른 도메인에 추가로 올리는 경우)을 추가하려면:
1. `wrangler.toml`의 `ALLOWED_ORIGINS`에 새 origin 추가
2. GitHub OAuth App 설정에 새 도메인의 콜백 URL 추가 (슬래시 유무까지 정확히)
3. `npx wrangler deploy`

## 최초 셋업 (이미 완료됨, 참고용)

```bash
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_PAT   # 선택, 트렌드 수집기 rate limit 상향
npx wrangler kv namespace create TREND   # 출력된 id를 wrangler.toml에 반영
npx wrangler deploy
```

## 동작 확인

```bash
# CORS 확인 — 등록된 각 origin에 대해 정확히 echo되어야 함
curl -i -X OPTIONS https://github-topic-radar-oauth.rag-web.workers.dev/exchange \
  -H "Origin: chrome-extension://jlillemjommikolcmnlbnoeegmbcpold"
curl -i -X OPTIONS https://github-topic-radar-oauth.rag-web.workers.dev/exchange \
  -H "Origin: https://github-radar.slothprogrammer.cloud"

# 트렌드 엔드포인트 헬스 체크
curl -i https://github-topic-radar-oauth.rag-web.workers.dev/trend?ids=repo:1
```

실제 토큰 교환은 확장 프로그램/웹앱의 로그인 버튼으로 검증합니다.

## 보안 메모

- `wrangler.toml`의 `ALLOWED_ORIGINS`는 확장 프로그램(`chrome-extension://jlillemjommikolcmnlbnoeegmbcpold`)과 웹(`https://github-radar.slothprogrammer.cloud`)만 허용하도록 잠겨 있습니다.
- 이 Worker는 `access_token`만 반환하며 secret은 절대 노출하지 않습니다.
