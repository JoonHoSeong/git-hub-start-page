# OAuth Token Exchange Worker

GitHub OAuth의 `code → access_token` 교환만 담당하는 최소 백엔드입니다.
GitHub 토큰 엔드포인트는 CORS를 막고 `client_secret`을 요구하기 때문에, 이 교환만
서버에서 처리합니다. DB도 없고 상태도 저장하지 않습니다.

## 사전 정보 (이미 확정됨)

- OAuth App **Client ID**: `Ov23liHYtI7Eof0VXlnv` (공개값)
- OAuth App **Redirect URI**: `https://jlillemjommikolcmnlbnoeegmbcpold.chromiumapp.org/github`
- Client secret: **여기(코드/깃)에 절대 넣지 않음.** 아래 `wrangler secret`으로만 주입.

## 배포 절차 (프로젝트 소유자가 직접 실행)

`worker/` 디렉토리에서:

```bash
# 1) Cloudflare 계정 로그인 (브라우저 열림)
npx wrangler login

# 2) 시크릿 주입 — client_id/secret은 여기서만 입력 (깃에 안 남음)
npx wrangler secret put GITHUB_CLIENT_ID
#   → 프롬프트에 Ov23liHYtI7Eof0VXlnv 입력
npx wrangler secret put GITHUB_CLIENT_SECRET
#   → 프롬프트에 GitHub에서 발급받은 client secret 입력
npx wrangler secret put GITHUB_PAT
#   → (선택) 트렌드 수집기가 쓸 PAT. 없으면 시간당 60회 제한

# 3) 트렌드 저장용 KV 네임스페이스 생성
npx wrangler kv namespace create TREND
#   → 출력된 id를 wrangler.toml 의 [[kv_namespaces]] id 에 붙여넣기

# 4) 배포 (Cron Trigger가 6시간마다 트렌드 수집)
npx wrangler deploy
```

배포가 끝나면 다음과 같은 URL이 출력됩니다:
```
https://github-topic-radar-oauth.<your-subdomain>.workers.dev
```

## 배포 후 (extension 반영)

출력된 URL을 `extension/src/oauth.ts`의 `OAUTH.tokenExchangeUrl`에 반영하세요
(경로 뒤에 `/exchange` 유지):

```ts
tokenExchangeUrl: "https://github-topic-radar-oauth.<your-subdomain>.workers.dev/exchange",
```

그다음 프로젝트 루트에서 재빌드:
```bash
npm run build
```

## 동작 확인

```bash
# CORS/헬스 체크 (405 또는 not_found면 살아있는 것)
curl -i https://github-topic-radar-oauth.<your-subdomain>.workers.dev/exchange
```

실제 토큰 교환은 extension의 로그인 버튼으로 검증합니다.

## 보안 메모

- `wrangler.toml`의 `ALLOWED_ORIGINS`(comma-separated)는 extension(`chrome-extension://jlillemjommikolcmnlbnoeegmbcpold`)과 웹(`https://github-radar.slothprogrammer.cloud`)만 허용하도록 잠겨 있습니다.
- 이 Worker는 `access_token`만 반환하며 secret은 절대 노출하지 않습니다.
