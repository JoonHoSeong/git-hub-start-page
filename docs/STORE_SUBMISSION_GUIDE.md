# Chrome 웹 스토어 등록 가이드

이 문서는 GitHub Topic Radar를 Chrome 웹 스토어에 처음 등록할 때 따라야 할 순서입니다.

## 0. 준비물

- Google 계정 (개발자 등록용)
- 카드 결제 (일회성 등록비 $5, Google이 부과)
- 개인정보처리방침 URL: `https://github.com/JoonHoSeong/git-hub-start-page/blob/main/PRIVACY_POLICY.md`
- 등록용 설명문: `docs/STORE_LISTING.md`
- 패키지 zip: `npm run package` 실행 후 `release/github-topic-radar-v1.0.0.zip`

## 1. 개발자 계정 등록

1. https://chrome.google.com/webstore/devconsole 접속 (Google 계정으로 로그인)
2. 최초 1회 $5 등록비 결제
3. 개발자 이름/연락처 정보 입력 (연락처는 joonho1366@gmail.com 권장)

## 2. 최초 업로드 (비공개로 시작)

1. "새 항목 추가" → `release/github-topic-radar-v1.0.0.zip` 업로드
2. 이 시점에서 **처음으로 실제 extension ID가 발급**됩니다 (로컬 개발용 ID `jlillemjommikolcmnlbnoeegmbcpold`와 다름)
3. 업로드 후 대시보드에 표시되는 **Item ID**를 복사해 두세요.

## 3. OAuth ALLOWED_ORIGIN 갱신 (중요 — 이 단계를 빼먹으면 로그인이 깨집니다)

발급된 실제 extension ID로 Worker 설정을 다시 배포해야 합니다.

```bash
# worker/wrangler.toml 에서 ALLOWED_ORIGIN 값을 실제 ID로 교체
# 예: chrome-extension://<실제발급된ID>
```

`worker/wrangler.toml`:
```toml
[vars]
ALLOWED_ORIGIN = "chrome-extension://<실제 스토어 발급 ID>"
```

교체 후:
```bash
cd worker
npx wrangler deploy
```

GitHub OAuth App 설정(https://github.com/settings/developers)에서도 **Authorization callback URL**이 `chrome.identity.getRedirectURL("github")`로 계산되는 값(`https://<extension-id>.chromiumapp.org/github`)과 일치하는지 확인하고, 필요하면 실제 ID로 갱신하세요.

## 4. 스토어 등록 정보 입력

대시보드의 "Store listing" 탭에서:

- **제품 이름**: GitHub Topic Radar
- **짧은 설명 / 긴 설명**: `docs/STORE_LISTING.md` 내용을 복사
- **카테고리**: Developer Tools
- **언어**: 한국어
- **개인정보처리방침 URL**: 위 링크
- **아이콘**: `extension/icons/icon128.png` (이미 manifest에 포함되어 자동 인식되지만, 별도 업로드란이 있으면 동일 파일 사용)

## 5. 스크린샷 준비 (사용자 작업 필요)

Chrome 웹 스토어는 **최소 1장, 권장 3~5장의 스크린샷**(1280x800 또는 640x400)을 요구합니다. 실제 브라우저 렌더링이 필요해 스크린샷은 직접 캡처해야 합니다.

1. `npm run build` 후 `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드" → `extension/dist` 선택
2. 새 탭에서 확장 프로그램 열기
3. 아래 화면들을 macOS 스크린샷(Cmd+Shift+4)으로 캡처:
   - 기본 다크 모드 트렌드 목록 화면
   - 라이트 모드 화면
   - 주제 관리/설정 패널
   - (선택) 번역된 카드, NEW 배지가 보이는 화면
4. 필요 시 1280x800으로 리사이즈 (스토어가 자동으로 일부 비율은 맞춰줍니다)

## 6. 심사 제출

1. "게시" 탭에서 공개 범위 선택 (전체 공개 추천)
2. 심사 제출 — Google 심사는 통상 며칠~몇 주 소요되며, OAuth/identity 권한을 사용하므로 추가 검토가 있을 수 있습니다.
3. 심사 중 반려되면 Google이 사유를 이메일로 보내줍니다. 대부분 권한 사용 목적 설명 보강 요청입니다 — `PRIVACY_POLICY.md`의 "권한 사용 목적" 섹션을 참고해 답변하면 됩니다.

## 7. 이후 업데이트 배포

버전을 올릴 때마다:
```bash
# manifest.json의 version을 올린 뒤
npm run package
# release/github-topic-radar-vX.Y.Z.zip 을 대시보드에 재업로드
```
