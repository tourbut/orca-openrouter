# OpenRouter Usage for Orca

Orca 오른쪽 사이드바에서 OpenRouter Activity 사용량(완료된 UTC 일 기준 비용·요청·토큰)을 보는 플러그인입니다.

이 저장소의 워커·집계·캐시·패널 UI·테스트는 구현되어 있습니다. **설치된 Orca 1.4.198만으로는 사이드바 패널이 워커를 호출할 수 없습니다.** 정적 mock을 완성된 대시보드로 취급하지 마세요.

## 무엇이 실제로 동작하는가

| 기능 | 상태 |
| --- | --- |
| Activity `GET https://openrouter.ai/api/v1/activity` 클라이언트, 응답 검증 | 테스트 + `npm run verify:api` |
| 7/30일 UTC 집계, BYOK·추론 토큰 분리, 모델/공급자 상세 | 단위 테스트 |
| 캐시 TTL, 키 교체 시 이전 응답 폐기, 잘못된 응답 거부 | 단위 테스트 |
| 패널 UI (요약, SVG 그래프, 모델 펼침, 연결/오류/캐시 표시) | 빌드 산출물. 데이터는 호스트 bridge 필요 |
| 워커 명령 `openrouter.status` / `refresh` / `disconnect` | 1.4.198에서 등록 가능. 반환값은 알림으로만 보임 |
| 패널에서 키 저장·새로고침·그래프 라이브 조회 | **호스트 패치 필요** (1.4.198에 없음) |
| 오늘 실시간 비용, 잔액, 일반 키 모드 | 범위 밖 |

확인한 Orca 1.4.198 제약:

- 패널 CSP `connect-src 'none'` → 패널 직접 HTTP 불가
- 패널 공개 action: `workspace.readContext`, `terminal.sendText`, `notifications.show`만
- `secrets` / `storage` / `settings`는 워커 전용
- 워커 환경변수는 allowlist만 상속. `.env`나 `OPENROUTER_MANAGEMENT_KEY`를 자동 상속하지 않음
- `net:fetch` capability는 존재하지 않음. manifest에 넣지 않음

필요한 호스트 변경은 [`host-patch/`](host-patch/README.md)에 별도 산출물로 두었습니다. 사용자 설치 Orca를 이 작업이 몰래 패치하지 않습니다.

## 개발

```bash
npm install
npm test
npm run build
npm run verify:api
npm run preview
```

- `npm test` — 집계, UTC 경계, HTTP 오류, 캐시, 키 교체, host-patch 계약
- `npm run verify:api` — 프로젝트 `.env`의 `OPENROUTER_MANAGEMENT_KEY`로 Activity GET만 호출. 상태 코드와 비밀 없는 요약만 출력
- `npm run preview` — 로컬 부모 페이지가 제안 bridge를 흉내 내는 **미리보기**. Orca 1.4.198이 아닙니다
- 키 값은 로그·테스트 fixture·문서·커밋에 넣지 않습니다. `.env.example`은 빈 값만 둡니다

개발 키 로딩은 `scripts/load-env.ts`가 `.env`를 직접 읽습니다. Orca 워커가 셸 환경을 들고 온다고 가정하지 마세요. 플러그인 런타임은 Orca `secrets`만 사용합니다.

## Orca에 로컬 설치

1. `npm run build`
2. Settings → Plugins → Development에서 이 폴더를 등록
3. 명령 팔레트: `OpenRouter: Connection Status` / `Refresh Usage` / `Disconnect`
4. 사이드바 패널은 1.4.198에서 **Host bridge required** 안내를 보여 줍니다. 그래프 데이터가 채워지면 그건 호스트 패치 또는 `npm run preview`입니다

Management key가 필요합니다. 일반 키는 Activity에서 403입니다. BYOK 금액은 `usage`에 합산하지 않고, `reasoning_tokens`는 출력 토큰에 더하지 않습니다. OpenRouter workspace와 Orca worktree는 다릅니다.

## 레이아웃

```
orca-plugin.json
src/worker/          # Node ESM 워커
src/panel/           # 샌드박스 패널
src/shared/
host-patch/          # 1.4.198에 없는 패널→워커 요청 계약
tests/
dist/main.mjs
dist/panel.html
```
