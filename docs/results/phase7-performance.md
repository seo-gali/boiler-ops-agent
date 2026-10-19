# Phase 7 — 렌더링·조회·자산 성능 보완 기록

## 1. 검증 범위

2026년 10월 19일 작업 기록이다. 기존 커밋 `0189d7b`와 변경 코드를 같은 브라우저 시나리오로 비교했다. 브라우저는 실제 React 컴포넌트·WebSocket·WebGL을 실행하고 API 응답만 격리된 자료로 대체한다. API 검증은 실제 HTTP 라우트를 인증 이후 경계에서 실행하며, 모델·Kafka·디스크 DB를 시작하지 않는다. SQL 검증은 새 메모리 DB만 사용한다.

운영 DB 지연이나 전체 서비스 통합 성능을 측정한 기록은 아니다. 실제 원본 CSV 측정은 파일 읽기만 수행했다. 의존성·lock·DB 스키마와 원본값은 바꾸지 않았다. 삭제한 파일은 없다.

## 2. 변경과 측정

| 항목 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 로그인 초기 JS | 1,196.41 kB | 244.34 kB, 약 79.6% 감소 |
| 추이 요청, 최초 관측과 후속 관측 3개 | 5회 | 2회, 이후 관측은 WebSocket에서 병합 |
| 같은 시나리오와 예측 화면 재진입까지 예측 요청 | 6회 | 4회, 새 관측의 예측은 계속 조회 |
| 값이 같은 센서의 React commit, 반복 수신 포함 | 8회 | 2회 |
| 같은 스냅샷 3회 반복 시 추가 전체 구독 commit | 3회 | 0회 |
| 새 관측 10회 수신 시 SceneCanvas render | 기존 갱신 경로 존재 | 0회, HTML 수치 갱신 유지 |
| SQLite 대기 중 health 응답 | 저장소 작업 종료까지 대기 | 저장소 작업이 대기하는 동안 응답 |
| 같은 CSV 기간 재조회 시 추가 순회 | 1회 | 0회 |

- [telemetry.ts](../../frontend/src/telemetry.ts)는 같은 값의 참조를 유지하고 같은 스냅샷의 통지를 생략한다. Tag 구독은 관련 수치가 달라질 때 갱신한다.
- [App.tsx](../../frontend/src/App.tsx)는 3D·기간 조회·승인 연습·변경 기록·오른쪽 패널을 필요한 시점에 불러온다. 한 번 연 화면은 유지해 날짜·작성 글·대화를 보존한다. [BoilerScene.tsx](../../frontend/src/BoilerScene.tsx)는 3D와 수치 표시의 갱신 경계를 분리한다.
- [SensorTrend.tsx](../../frontend/src/SensorTrend.tsx)는 초기 이력을 WebSocket 관측과 병합하고 센서·재생 실행 변경이나 관측 누락 시 이력을 다시 읽는다. 원본 시각 기준 120초, 결측과 파싱 오류를 유지한다. [ForecastPanel.tsx](../../frontend/src/ForecastPanel.tsx)는 관측 전 조회와 같은 관측의 재진입 조회를 생략한다.
- [main.py](../../backend/app/main.py)는 동기 SQLite 조회·승인 처리를 작업 스레드에서 실행한다. 트랜잭션·소유권·revision 검사와 기존 `detail` 응답 형식은 유지한다.
- [history.py](../../backend/app/domain/history.py)는 파일 수정 시각·크기, Tag·단위·기간·표본 수별 성공 결과를 최대 16개 재사용한다. 파일 변경 시 새로 읽으며 실패를 캐시하지 않는다.
- [build-guide.py](../../scripts/build-guide.py)는 JPEG 헤더의 실제 크기를 HTML에 넣어 이미지 로딩 전 공간을 확보한다. 기존 지연 로딩에 비동기 디코딩을 추가했다. [pretendard.css](../fonts/pretendard.css)는 설치된 Pretendard를 우선하고 없으면 기존 WOFF2와 `swap`을 사용한다.

### 실제 CSV 재조회

50,400행, 34,277,673바이트의 공개 원본에서 마지막 24시간을 조회했다. 원본 관측 1,441개 중 실제 표본 1,000개를 반환하며 최초·재조회 결과가 같았다. 메타데이터를 미리 읽은 동일 프로세스에서 최초 조회 **794.914ms**, 캐시 재조회 **0.030ms**였다. API 전송·다중 사용자 부하를 포함한 수치는 아니다. 근거는 `artifacts/source-history-performance.json`이다.

### SQL과 입력 경계

실제 Simulator 메서드에서 목록 크기를 1건에서 20건으로 늘려도 상태 조회는 SELECT 2회, 감사 목록은 SELECT 1회였다. 감사 목록은 `(owner,id)` 인덱스를 사용했다. 점검한 이 경로에는 N+1이 없으며 새로운 인덱스나 스키마 변경은 추가하지 않았다.

공백·탭·줄바꿈·전각 공백만 있는 AI 질문과 Simulator 요청이 모델 작업에 진입하는 결함을 422 응답으로 차단했다. 빈 Tag의 이력 조회는 기존대로 404이며 전체 센서 목록으로 대체되지 않는다. 회원 검색 API는 이 프로젝트에서 확인되지 않았다. 일반 실패 응답의 내부 예외 원문은 공개 문구와 안정된 코드로 대체하고 Agent의 trace ID는 유지했다.

## 3. 실행과 결과

| 명령 | 결과 |
| --- | --- |
| `npm --prefix frontend run build` | 종료 0, TypeScript·Vite 통과 |
| `node scripts/check-telemetry-performance.mjs --ref=0189d7b` | 종료 0, 기존 소스의 기준치 측정 |
| `node scripts/check-telemetry-performance.mjs` | 종료 0, 요청·commit·결측·일시정지·새 재생 실행 검증 |
| `node scripts/check-bundle-performance.mjs` | 종료 0, 9개 브라우저 항목 검증 |
| `.venv/Scripts/python.exe scripts/check-api-performance.py artifacts/api-performance-green.json` | 종료 0, 입력·오류·동시 응답·SQL·CSV 캐시 검증 |
| `.venv/Scripts/python.exe scripts/build-guide.py` | 종료 0, 안내 페이지 재생성 |
| `node scripts/review-ui.mjs` | 종료 0, 문서·이미지·모바일·포커스 검증 |

공백 입력·내부 오류 노출·저장소 대기 문제와 CSV 중복 순회, 이미지 공간 미확보는 수정 전 실패를 확인한 뒤 수정했다. 브라우저는 실제 WebGL 설비 선택, 확대·복원, 화면 이동 후 폼·채팅 상태, 포커스 복귀, reduced motion, WebGL 미지원·컨텍스트 손실 대안을 확인했다.

재현 자료는 `artifacts/e2e/telemetry-performance/`, `artifacts/e2e/bundle-performance/result.json`, `artifacts/api-performance-green.json`, `artifacts/e2e/phase7/ui-review/docs-result.json`에 남긴다. 기존 `artifacts/api-performance-red.json`, `artifacts/api-performance-history-red.json`에는 수정 전 실패가 있다.

## 4. 남은 한계

- 전체 JS 코드량을 줄인 수치가 아니라 초기 엔트리에서 분리한 수치다. 모니터링 진입 시 3D의 904.49 kB가 추가로 필요하며 해당 청크의 Vite 500 kB 경고는 남는다.
- 설치된 글꼴이 없으면 2,057.69 kB WOFF2를 받는다. 한글 표시 범위나 이미지 품질을 줄이지 않았으며 이미지 바이트 수는 그대로다.
- CSV 캐시는 프로세스별로 유지한다. 첫 조회·파일 변경·새 조회 조합은 여전히 원본을 순회하며 여러 센서의 첫 조회를 한 번의 파일 순회로 합치는 작업은 포함하지 않는다.
- 실제 Kafka·Ollama·운영 DB의 부하 시험과 전체 통합 E2E는 이번 검증 범위에 포함하지 않았다.
