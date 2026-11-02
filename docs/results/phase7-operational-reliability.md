# Phase 7 — 승인 결과·CSV 한도·HTTP 관측 보완

2026-11-02 사용자 요청에 따라 승인 응답 유실, 동시 CSV 조회, HTTP 오류·지연 관측을 보완했다. [작업 화면 계약](../instructions/phase7-workspace.md#승인조회http-관측-보완)을 기준으로 기존 호출부·오류·원본값·권한 경계를 유지했다.

## 변경

- `SimulatorPanel`은 승인·거절 응답이 끊기거나 실패하면 GET으로 서버의 실제 결과를 다시 읽는다. POST는 자동 반복하지 않는다. 결과가 미확인이면 결정 버튼을 막고 명시적 재확인을 제공한다. 수동 재조회에서 pending이 확인돼도 확인 체크를 새로 해야 재시도할 수 있다. POST와 상태 GET에는 각각 15초 제한을 둔다.
- `OperationsAnalysis`는 다중 센서를 순차 조회하며 일부 실패와 취소를 보존한다. API의 메타데이터·기간 조회는 하나의 비차단 세마포어로 합계 2개까지만 실행한다. 포화 시 429·`Retry-After: 1`을 반환하고 실제 파일 읽기가 끝날 때 슬롯을 반납한다.
- `HttpObservability`는 HTTP에 서버 생성 `X-Request-ID`를 붙이고 경로 패턴·메서드·상태·처리 시간을 JSON으로 기록한다. 실제 UUID·쿼리·본문·쿠키·예외 원문은 넣지 않는다. 일반 내부 오류는 안전한 `internal_error` 응답과 요청 ID로 구분한다.
- 운영자 전용 `/api/metrics/http`는 경로별 요청 수·상태 수·4xx/5xx 수·평균/최대 시간을 제공한다. 상태는 단일 프로세스 메모리에 보관한다. 요청 취소·응답 전 연결 종료는 관측용 499로 분류한다.

## 수정 전 확인

- 2개 CSV 읽기가 대기할 때 세 번째 요청도 파일 작업에 들어가 즉시 429 검증에 실패했다.
- 세 센서를 조회하면 브라우저의 최대 동시 요청이 3이었다.
- 승인 실행 후 응답만 유실시키면 서버 값은 바뀌어도 화면은 갱신되지 않았다.
- 요청 ID·안전한 일반 오류·운영자 HTTP 지표가 없어 관련 검증이 실패했다.

## 실제 검증

| 명령 | 결과 |
| --- | --- |
| `.venv/Scripts/python.exe scripts/check-operational-reliability.py artifacts/operational-reliability-green.json` | 종료 0, 20개 항목 통과 |
| `.venv/Scripts/python.exe scripts/check-api-performance.py artifacts/api-reliability-regression.json` | 종료 0, 기존 API·SQL·캐시 23개 항목 통과 |
| `npm --prefix frontend run build` | 종료 0, TypeScript·Vite 통과, 500 kB 청크 경고 없음 |
| `node scripts/check-bundle-performance.mjs --reliability` | 종료 0, 신뢰성·드릴다운·지연 로딩·WebGL·모바일 17개 항목 통과 |
| `.venv/Scripts/python.exe scripts/build-guide.py` | 종료 0, 문서·소스 미리보기 66개 생성 |
| `.venv/Scripts/python.exe scripts/check-pages-seo.py` | 종료 0, HTML 26개·내부 링크 305개 확인 |
| `node scripts/review-ui.mjs` | 종료 0, 문서 브라우저 검수 통과 |

백엔드는 실제 ASGI 앱·세션·역할 검사와 격리된 가짜 CSV 읽기를 사용했다. HTTP를 취소해도 작업 스레드가 끝나기 전에는 슬롯이 재사용되지 않는 것을 확인했다. 실제 Simulator 상태 조회에 SQLite 오류를 주입해 `internal_error`와 요청 ID만 반환되는 것도 확인했다. DB를 열거나 삭제하지 않았다.

브라우저는 실제 빌드에 합성 API를 연결했다. 승인 실행 후 응답 유실, 재조회까지 실패, 서버가 아직 pending인 경우의 수동 확인·재시도, 거절 응답 유실을 주입했다. POST 자동 재전송 없이 상태를 복구하고 거절 시 값이 유지됐다. CSV는 동시에 1개만 요청하며 부분 성공·입력 변경 시 남은 조회 취소를 유지했다.

수정 전 근거는 `artifacts/operational-reliability-red.json`, `artifacts/e2e/operational-reliability/csv-before.json`, `approval-before.json`이다. 수정 후 API 결과와 브라우저 `result.json`, 승인 화면을 같은 아티팩트 경로에 남겼다. 원본 CSV·운영 DB·시크릿·의존성·lock 파일은 변경하지 않았으며 삭제한 추적 파일은 없다.

운영 부하·전체 Kafka/Ollama 통합·분산 운영은 이번 범위가 아니다. 동시 한도와 지표는 프로세스별이며 재시작하면 지표가 초기화된다. 같은 기간의 첫 CSV 조회 비용은 남아 있고 일반적인 멱등성 키·분산 추적·percentile 지표는 추가하지 않았다.
