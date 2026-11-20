# 문서 맵

현재 동작의 기준, 설계 제안, 과거 실행 결과를 구분해 찾는 진입점이다. Phase 번호는 구현 순서이며 문서의 최신 순서를 뜻하지 않는다.

## 먼저 읽을 문서

| 목적 | 문서 | 담당 범위 |
| --- | --- | --- |
| 앱 실행·로그인·종료 | [README](../README.md) | 사용자 시작 안내 |
| 수동 개발·문제 해결·문서 생성 | [로컬 개발](local-development.md) | 실행 명령과 검증 방법 |
| 기능 범위·데이터 흐름 | [프로젝트 계획](../.project/plan.md) | 현재 제공하는 기능과 데이터 계약 |
| 화면·키보드·접근성 | [화면 설계](../DESIGN.md) | UI 공통 기준 |
| 개발·승인·검증 규칙 | [코딩 기준](../CODING_STANDARDS.md), [작업 진입점](../AGENTS.md) | 공통 작업 규칙 |
| 구조·의존성·테스트 개선과 확장안 | [시스템 설계 검토](system-design-review.md) | 적용한 개선과 남은 단계별 제안 |
| 사용 안내 영상 제작 | [영상 시나리오](user-guide-scenario.md) | 촬영 순서; 제품 요구사항의 기준은 아님 |
| 배포 폰트 출처·라이선스 | [폰트 안내](fonts/README.md) | Pretendard 사용 정보 |

## 기능별 현행 기준

`instructions/`는 기능을 수정할 때 따르는 기준이다. 실제로 실행한 검증 범위는 아래 결과 문서에서 별도로 확인한다.

| 작업 | 기준 문서 |
| --- | --- |
| CSV 재생·Kafka·WebSocket | [Phase 1](instructions/phase1-realtime-monitoring.md) |
| 센서 분류·단위·설비 연결 | [Phase 2](instructions/phase2-domain-mapping.md) |
| 실제값·목표값 비교·변화율 | [Phase 3](instructions/phase3-operational-monitoring.md) |
| AI 읽기 도구·Trace | [Phase 4](instructions/phase4-read-agent.md) |
| 재열기 온도 예측·시간순 평가 | [Phase 5](instructions/phase5-temperature-forecast.md) |
| 연습용 변경안·승인·Audit | [Phase 6](instructions/phase6-controlled-simulator.md) |
| 전체 연결·실패 상황 | [통합 검증](instructions/phase7-integrated-validation.md) |
| 인증·소유권·요청 한도 | [보안 계약](instructions/phase7-security-hardening.md) |
| 질문별 근거·답변 | [AI 답변](instructions/phase7-agent-answers.md) |
| 한 명령 실행·키 재발급 | [로컬 실행](instructions/phase7-local-start.md) |
| 공장·센서 선택·채팅·기간 조회 | [작업 화면](instructions/phase7-workspace.md) |
| 렌더링·조회 성능 | [성능 확인](instructions/phase7-workspace.md#성능-확인) |
| 승인 응답 유실·CSV 동시 한도·HTTP 기록 | [운영 보완](instructions/phase7-workspace.md#승인조회http-관측-보완) |

## 검증 기록과 이전 버전

`results/`는 특정 날짜·코드·환경에서 관측한 결과다. 성공 횟수·수치·화면은 당시 근거이며 현재 버전의 통과를 뜻하지 않는다. 여러 날짜가 있는 문서는 해당 절의 날짜와 검증 범위를 함께 읽는다.

| 확인할 근거 | 결과 문서 | 현재 읽는 방법 |
| --- | --- | --- |
| 초기 기능별 구현 | [Phase 1](results/phase1-realtime-monitoring.md), [Phase 2](results/phase2-domain-mapping.md), [Phase 3](results/phase3-operational-monitoring.md), [Phase 4](results/phase4-read-agent.md), [Phase 5](results/phase5-temperature-forecast.md), [Phase 6](results/phase6-controlled-simulator.md) | 초기 재현 근거; 현재 동작은 기능별 지침 확인 |
| 통합 실패 경로 | [통합 검증 결과](results/phase7-integrated-validation.md) | 당시 CSV·Kafka·모델·브라우저 연결 |
| 보안 취약점 발견·수정 | [최초 감사](results/phase7-security-audit.md), [보안 보완](results/phase7-security-hardening.md) | 최초 감사는 수정 전 상태; 보완 결과와 함께 읽기 |
| 출시 전 보안·시크릿·의존성 | [출시 보안 점검](results/release-security-review.md) | 2026-11-18~21 검증, HTTPS·보안 E2E·의존성·환경 변수 노출 점검 포함 |
| 실제 질문과 답변 | [AI 답변 검수](results/phase7-agent-answers.md) | 해당 질문·모델·원본 근거의 평가 |
| 실행·개인 키 재발급 | [로컬 실행 결과](results/phase7-local-start.md) | 10월 10일 추가 검증 포함 |
| 화면·접근성 | [UI 검수](results/phase7-ui-accessibility-review.md) | 당시 브라우저 검증; 실제 보조기기 미검증 |
| 작업 화면·단위·대화 탐색 | [작업 화면 결과](results/phase7-workspace.md) | 10월 11~12일 기록과 10월 28일 추가 검증 구분 |
| 공장 탐색·대화·기간 조회 | [이전 화면 결과](results/phase7-game-chat-history.md) | 10월 13일 중간 버전; 다음 결과에서 추가 개정 |
| 선택 상자·고정 채팅·다중 센서 | [선택·비교 결과](results/phase7-select-chat-compare.md) | 10월 13일 추가 개정; 이후 탐색 변경은 작업 화면 결과 확인 |
| 초기 성능·청크 분리 | [성능 결과](results/phase7-performance.md) | 10월 19·28일 측정; 당시 캐시·메모화 설명을 현행 요구로 재사용하지 않기 |
| 승인 결과 재확인·조회 한도 | [신뢰성 결과](results/phase7-operational-reliability.md) | 격리 API·브라우저 실패 검사 |
| 캐시 제거·CSV·비동기 경로 | [데이터 처리 결과](results/phase7-data-oriented.md) | 11월 3일 보완; 현재 캐시 없는 구현의 변경 근거 |

과거 결과와 이미지는 삭제하지 않는다. 결과가 가리키는 입력·화면·아티팩트 관계를 보존하고, 대체된 설명을 현행 지침에 중복해 두지 않는다. 현재 작업 기준은 위 기능별 지침에서 찾는다.

## 문서 원본과 생성물

| 파일 | 역할 |
| --- | --- |
| Markdown 문서 | 본문 원본 |
| `docs/feature-data.json` | 기능별 코드 지도 원본 |
| `scripts/build-guide.py`의 `FILES` | 공개 문서·소스 미리보기 허용 목록 |
| `docs/index.html` | 홈 템플릿과 생성된 코드 지도·문서 목록·팝업 본문 |
| `docs/read/*.html`, `docs/sitemap.xml`, `docs/robots.txt` | 빌더가 관리하는 정적 문서·검색 파일 |

본문과 허용 목록을 수정한 뒤 `scripts/build-guide.py`로 재생성한다. 생성 블록을 직접 고치지 않는다. 새 문서의 상대 링크는 저장소·정적 본문·홈 팝업에서 같은 문서로 이어져야 한다. 생성·정적 링크·브라우저 검증 명령은 [로컬 개발 안내](local-development.md#10-변경을-다시-검증하기)에 둔다.
