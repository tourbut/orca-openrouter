# OpenRouter Usage for Orca

Orca 명령 팔레트에서 **OpenRouter: Open Dashboard**를 실행하면, 플러그인 워커가 로컬 대시보드를 시작하고 Orca 내부 브라우저 탭을 엽니다. 별도 `npm run preview`나 설치된 Orca 수정, host-patch는 설치에 필요 없습니다.

사이드바 iframe 안의 라이브 그래프는 Orca 1.4.198에서 제공하지 않습니다. 패널은 대시보드 명령을 안내만 합니다.

## 설치

1. `npm run build` (배포 폴더에는 이미 `dist/`가 포함되어 있으면 생략 가능)
2. Settings → Plugins에서 플러그인 시스템을 켭니다.
3. Settings → Plugins → Development에 이 폴더 경로를 추가하고 권한을 승인합니다.
4. 명령 팔레트에서 `OpenRouter: Open Dashboard`를 실행합니다.
5. 브라우저 탭에서 management key를 등록합니다. 키는 Orca secrets에만 저장됩니다.

다시 실행하면 저장된 연결을 복원하고, 같은 origin 탭이 있으면 재사용합니다.

현재 검증은 자동 테스트와 메모리 저장소를 사용하는 워커 하네스까지입니다. 이 개발 환경에서는 OS 키링을 사용할 수 없어, 실제 Orca 설정 화면에서 설치·권한 승인 후 키를 저장하고 재시작하여 복원하는 과정은 아직 검증하지 못했습니다. Orca secrets 저장이 실패하면 키를 평문 파일에 대신 저장하지 않습니다.

설치 확인 시 위 순서로 직접 권한을 승인하고, 키 저장 → 사용량 조회 → Orca 재시작 후 복원 → 연결 삭제를 확인해야 합니다. Orca 설정 파일이나 권한 동의 기록을 스크립트로 변경하지 마세요.

## 실제로 동작하는 것 / 하지 않는 것

| 기능 | 상태 |
| --- | --- |
| Open Dashboard → 워커 loopback 서버 → Orca 브라우저 탭 | 제품 경로. 1.4.198에서 검증 대상 |
| UI에서 키 등록/삭제, Orca secrets 보관 | 제품 경로 |
| 7/30일 비용·요청·토큰, UTC 그래프, 모델/공급자 | 제품 경로 |
| 사이드바 패널 라이브 데이터 | **1.4.198에 패널→워커 API 없음. 안내만 표시** |
| host-patch를 적용한 사이드바 | 선택 참고 자료. 설치 요구사항 아님 |
| `npm run preview` | 개발 미리보기. 설치형 증거가 아님 |
| 오늘 실시간 비용, 잔액, 일반 키 모드 | 범위 밖 |

## 확인한 Orca 1.4.198 제약

- 패널 CSP `connect-src 'none'`, 패널 공개 action은 workspace/terminal/notification뿐
- 워커 env는 allowlist. 전형적인 Electron PATH에는 `orca-ide`가 없음. 워커는 `~/.local/bin/orca-ide` 등 검증된 절대 경로를 쓰고, Linux에서 `/usr/bin/orca`(GNOME 스크린 리더)는 호출하지 않음
- 워커 cwd는 Electron cwd(이 호스트에서는 `/home/shin`)라 `worktree current`가 실패함. `tab create --worktree path:<워크트리>`는 성공함
- 워커 유휴 회수 5분, 명령 timeout 30초. HTTP 리스너만으로는 유휴 타이머가 갱신되지 않음. 인증된 대시보드 요청마다 `settings.get` host call로 활동을 갱신함. 탭을 5분 동안 쓰지 않으면 워커가 회수될 수 있으며, 그때는 명령을 다시 실행하면 됨
- Chromium은 일부 포트를 차단함. 동적 포트가 unsafe면 다시 bind함
- 분리된 영구 Node 프로세스를 띄워 수명을 숨기지 않음

`host-patch/`는 향후 사이드바 통합 참고용입니다.

## 개발

```bash
npm install
npm test
npm run typecheck
npm run build
npm run secret-scan
npm run verify:api
```

`npm run preview`는 예전 패널 bridge 흉내입니다. 제품 확인은 Open Dashboard 명령으로 합니다.

`scripts/invoke-open-dashboard.ts`와 `scripts/run-orca-plugin-worker.ts`는 secrets/settings를 메모리 저장소로 대체하는 개발 하네스입니다. 설치된 워커 런타임을 호출하더라도 실제 Orca vault 저장이나 GUI 설치 성공의 증거는 아닙니다.

키 값은 로그·테스트 fixture·문서·커밋에 넣지 않습니다. `.env.example`은 빈 값입니다. 개발 검증만 `scripts/load-env.ts`가 `.env`를 직접 읽습니다. 제품 워커는 Orca secrets만 사용합니다.

## 레이아웃

```
orca-plugin.json
src/worker/          # 명령, Activity 클라이언트, loopback 대시보드 서버
src/web/             # 제품 대시보드 페이지 (워커가 serve)
src/panel/           # 사이드바 안내
src/shared/
host-patch/          # 참고 전용
dist/main.mjs
dist/dashboard.html
dist/dashboard.js
dist/panel.html
```
