# BoilerOps Agent 프로젝트 계획

## 1. 어떤 프로젝트인가

BoilerOps Agent는 보일러의 과거 운전 기록을 다시 재생해 살펴보는 로컬 앱이다. 사용자는 공장 그림에서 설비를 고르고, 센서 값과 기간별 변화를 확인한 뒤 AI에 질문할 수 있다. 재열기의 5분 뒤 온도 예측과 변경 승인 연습도 제공한다.

공장 그림은 많은 센서를 찾기 쉽게 배치한 안내 지도다. 실제 발전소의 배치나 센서 설치 위치를 재현한 것은 아니다. 승인 연습에서는 별도의 연습용 숫자만 바뀌며 실제 보일러·밸브와 연결되지 않는다.

| 항목 | 내용 |
| --- | --- |
| 데이터 | 한국중부발전이 공공데이터포털에 공개한 분 단위 보일러 운전 기록 |
| 사용 화면 | React·TypeScript·Vite·React Three Fiber |
| API 서버 | FastAPI |
| 데이터 전달 | Apache Kafka와 WebSocket |
| 저장 | 원본 CSV, AI 조회 기록 파일, 승인 연습용 SQLite |
| 진행 상태 | Phase 1~7 구현 완료. 검증 범위와 결과는 각 결과 문서에 기록 |

현재 작업은 구현된 기능을 유지하고 개선하는 것이다. 새 기능이나 기술 도입은 사용자가 요청한 범위에서 진행한다. 처음 실행할 때는 [README](../README.md), 개발 서버를 따로 실행할 때는 [수동 개발 안내](../docs/local-development.md)를 읽는다.

## 2. 사용자가 할 수 있는 일

**공장 모니터링**에서는 7개 설비와 118개 센서를 둘러본다. 설비를 누르면 소속 센서 목록이 열리고, 센서를 고르면 현재값·단위·원본 시각을 확인할 수 있다. 화면에 보이는 값은 현재 발전소에서 들어오는 값이 아니라 과거 CSV를 재생한 값이다.

**기간 조회**에서는 여러 센서와 시작·종료 시각을 골라 그래프로 비교한다. 같은 단위의 센서는 한 그래프에, 다른 단위의 센서는 별도 그래프에 표시한다. 센서 상세와 AI 대화에서는 최근 원본 시각 기준 2분의 변화를 볼 수 있다.

**AI 질문**에서는 설비 → 세부 묶음 → 센서 순서로 범위를 좁혀 탐색한다. 질문을 보내면 AI가 읽기 전용 도구로 값을 조회하고 근거와 함께 답한다. 다른 설비를 둘러봐도 이미 보낸 질문의 대상은 바뀌지 않는다. 화면에는 대화가 쌓이지만 모델은 매 질문을 별도로 조회한다.

**5분 예측**은 공장 그림 아래에서 확인한다. 현재 온도를 그대로 유지한다고 가정한 단순 예측과 학습 모델의 시험 결과를 함께 표시한다. 예측을 근거로 실제 설비의 조작량을 권고하지 않는다.

**승인 연습·변경 기록**은 각각 메인 메뉴에서 연다. 운영자는 본인의 재열기 AI 조회 결과를 바탕으로 연습용 변경안을 만들고, 변경값을 확인한 뒤 승인하거나 거절한다. 실제 설비를 조작하는 기능은 없다.

화면의 배치·색상·키보드 조작은 [DESIGN.md](../DESIGN.md), 세부 동작은 [작업 화면 기준](../docs/instructions/phase7-workspace.md)을 따른다.

## 3. 데이터는 어떻게 화면까지 오는가

원본 CSV의 한 행을 재생 프로그램이 Kafka에 보낸다. API 서버는 행의 순서와 센서 값을 검사하고, 최근 상태를 WebSocket으로 브라우저에 전달한다. 공장 그림·주요 수치·센서 상세는 같은 상태를 읽는다.

```text
과거 CSV → 재생 프로그램 → Kafka → API 서버 → WebSocket → 사용 화면
                                      ├─ AI 읽기 전용 조회
                                      └─ 재열기 온도 예측

본인의 AI 조회 기록 → 연습용 변경안 → 사용자 승인 → SQLite에 결과 기록
```

| 역할 | 코드 위치 |
| --- | --- |
| CSV 순서대로 재생 | `backend/app/replay/producer.py` |
| 데이터 수신·순서·값 검사 | `backend/app/streaming/consumer.py`, `backend/app/domain/state.py` |
| 센서 분류·단위 연결 | `backend/app/domain/registry.py`, `backend/app/domain/sensor_definitions.json` |
| API·실시간 전달 | `backend/app/main.py`, `backend/app/websocket/` |
| 화면·공장 그림·채팅 | `frontend/src/` |
| 로컬 실행 준비·종료 | `package.json`, `scripts/start.py` |

AI는 원본 CSV나 Kafka에 직접 접근하지 않는다. 서버가 제공하는 읽기 전용 도구를 통해 질문 시점의 값을 확인한다. 변경 승인 기능은 이 조회 기능과 분리한다.

## 4. 원본 데이터를 다루는 기준

사용한 원본 파일은 다음과 같다. 원본 데이터는 Git에 포함하지 않는다.

```text
한국중부발전(주)_(AI 친화 데이터)분 단위 발전설비(보일러) 운전데이터_20250404.csv
```

파일은 `data/raw/`에 두거나 `BOILER_DATASET_PATH`로 경로를 지정한다. 재생 간격은 `REPLAY_INTERVAL_MS`, Kafka 주소와 토픽은 `KAFKA_BOOTSTRAP_SERVERS`·`KAFKA_TOPIC`으로 설정한다.

센서를 구분하는 원본 열 이름을 **Tag**라고 부른다. Tag 끝의 공백까지 보존하고 화면에서 원본 열을 찾을 수 있게 한다. 현재 118개 센서의 단위와 원본 식별자는 컬럼 정의서에서 확인해 `sensor_definitions.json`에 보관한다. 단위 표시를 바꿔도 숫자를 임의로 환산하지 않는다.

값이 비어 있는 경우와 숫자로 읽을 수 없는 경우를 구분한다. 둘 다 0으로 바꾸지 않는다. 정상적으로 읽은 0·음수·소수는 원본 그대로 보여준다.

실제 설치 좌표, 정상·위험 기준, 제어 허용 범위와 고장 원인은 자료로 확인되지 않았다. 두 값이 함께 변한다는 이유만으로 한 값이 다른 값을 바꿨다고 설명하지 않는다.

## 5. 센서는 어떻게 묶는가

분류는 [Registry 코드](../backend/app/domain/registry.py)의 `classify`와 `make_registry`를 기준으로 한다. 그림에 있는 7개 설비에 110개 센서가 속한다. 나머지 8개는 주증기·발전 지표와 위치 미확인 그룹에서 찾는다.

| 분류 ID | 화면 이름 | 센서 수 | 그림의 설비 |
| --- | --- | --- | --- |
| feeders | 급탄기 | 13 | 있음 |
| furnace | 화로 | 37 | 있음 |
| superheater | 과열기 | 28 | 있음 |
| reheater | 재열기 | 16 | 있음 |
| economizer | 절탄기 | 8 | 있음 |
| scr | 탈질 설비 | 2 | 있음 |
| stack | 굴뚝 | 6 | 있음 |
| main-steam | 주증기 지표 | 5 | 없음 |
| generation | 발전 지표 | 2 | 없음 |
| unmapped | 위치 미확인 | 1 | 없음 |

주증기 압력·유량을 과열기의 대표 온도와 합치지 않는다. 그림 밖 그룹도 센서 선택과 AI 대화에서 탐색할 수 있다. 이 그룹의 `scene_position`은 null이며, `unmapped` 센서의 `mapping_confidence`는 `unverified`로 둔다.

그림의 좌표는 센서를 찾기 위한 배치 정보다. 이름으로 소속 설비를 확인했더라도 실제 설치 좌표를 알아낸 것으로 설명하지 않는다.

흐름 선도 같은 원칙을 따른다. 코드의 `PROCESS_FLOWS`에 있는 연소·배기가스 흐름과 급수·증기 흐름만 표시하고, 확인되지 않은 세부 배관을 추가하지 않는다.

## 6. 개발할 때 확인할 문서

단계 이름의 Phase는 구현 순서를 뜻한다. 이미 끝난 단계를 다시 시작하는 지시가 아니다. 수정할 기능에 해당하는 문서만 읽고, 여러 기능을 바꾸면 관련 기준을 함께 확인한다.

| 작업 | 구현·검증 기준 |
| --- | --- |
| 데이터 재생·수신 | [Phase 1](../docs/instructions/phase1-realtime-monitoring.md) |
| 센서·단위·설비 연결 | [Phase 2](../docs/instructions/phase2-domain-mapping.md) |
| 실제값·목표값 비교와 변화 계산 | [Phase 3](../docs/instructions/phase3-operational-monitoring.md) |
| AI 읽기 도구 | [Phase 4](../docs/instructions/phase4-read-agent.md) |
| 온도 예측 | [Phase 5](../docs/instructions/phase5-temperature-forecast.md) |
| 연습용 변경안·승인 | [Phase 6](../docs/instructions/phase6-controlled-simulator.md) |
| 서비스 전체 연결·실패 상황 | [Phase 7 통합 검증](../docs/instructions/phase7-integrated-validation.md) |
| 로그인·권한·사용자별 기록·요청 한도 | [보안 기준](../docs/instructions/phase7-security-hardening.md) |
| AI 답변·질문별 근거 | [답변 기준](../docs/instructions/phase7-agent-answers.md) |
| 한 명령 실행·키 재발급 | [로컬 실행](../docs/instructions/phase7-local-start.md) |
| 공장·센서 선택·채팅·기간 조회 | [작업 화면](../docs/instructions/phase7-workspace.md) |
| 화면·조회·파일 크기 성능 | [성능 확인](../docs/instructions/phase7-workspace.md#성능-확인), [측정 기록](../docs/results/phase7-performance.md) |
| Pages 문서·검색 설정 | [문서 생성·검증](../docs/local-development.md#github-pages-검색-노출) |

공통 구현·승인·검증 기준은 [CODING_STANDARDS.md](../CODING_STANDARDS.md)에 둔다. 이 문서에 같은 규칙을 반복하지 않는다. 기술이나 모델을 교체하기 전에는 기존 방식에서 확인한 문제와 측정 결과를 먼저 살핀다.

## 7. 재생 데이터의 필드

재생 프로그램은 다음 형태로 한 행을 보낸다. `measurements`에는 숫자로 바꾸기 전의 원본 문자열이 들어간다.

```json
{
  "run_id": "<재생 실행 UUID>",
  "sequence": 1024,
  "source_time": "<CSV 원본 시각>",
  "source_row": 1024,
  "emitted_at": "<재생 프로그램의 발행 시각>",
  "measurements": {
    "<원본 Tag>": "<원본 문자열>"
  }
}
```

`run_id`는 재생을 시작할 때마다 새로 만드는 식별자다. `source_row`는 헤더를 제외한 원본 데이터 행 번호이고, `sequence`는 이번 재생의 순서다. 따라서 `sequence = source_row - REPLAY_START_ROW + 1`이다.

`source_time`은 과거 CSV에 적힌 시각이고, `emitted_at`은 이번 재생에서 행을 보낸 시각이다. 두 시각을 현재 설비의 측정 시각으로 혼동하지 않는다. 서버는 중복·순서 역전·등록되지 않은 Tag를 거부하며, 순서 확인을 위해 Kafka 토픽은 단일 파티션을 사용한다.

## 8. AI·예측·승인에서 지킬 기준

AI 조회는 질문에 고정한 설비와 Tag를 사용한다. 서버는 기본 상태 조회와 모델이 선택한 추가 도구를 호출한다. 사용할 수 있는 도구는 `get_boiler_status`, `get_equipment_status`, `get_sensor_history`, `get_operating_targets`, `get_current_controls`, `get_deviation_summary`, `get_temperature_forecast`다.

서버는 모델이 선택한 근거에서 숫자·시각을 가져와 답변을 만든다. 근거가 부족하면 판단을 보류한다. 조회 도구·근거·답변을 남긴 기록을 **Trace**라고 하며, 답변에서 펼쳐 읽을 수 있다.

온도 예측은 재열기의 원본 시각 5분 뒤를 대상으로 한다. 시간순으로 학습·검증·시험 구간을 나누고, 검증 구간의 오차로 모델을 고른다. 마지막 시험 결과를 모델 선택에 재사용하지 않는다. 목표 온도가 비어 있고 실제 조작 효과도 확인되지 않아 밸브 조작량을 권고하지 않는다.

승인 연습은 차원이 없는 `demo_bias` 숫자만 바꾼다. 데모 정책 `local-demo-v1`은 값 −10~10, 한 번에 −1·0·1 변경이며 산업 안전 기준이 아니다. 변경안 생성만으로 값이 바뀌지 않으며, 운영자가 본인의 유효한 재열기 조회 근거로 만든 변경안을 별도로 확인해야 한다.

승인 시에는 제안 만료·소유자·현재 재생 실행·변경 횟수(`revision`)를 검사한다. 값 변경과 결과 기록은 하나의 SQLite 트랜잭션, 즉 함께 성공하거나 함께 취소되는 저장 작업으로 처리한다. 이 승인·변경 기록을 **Audit**라고 한다. 거절하거나 이미 처리한 제안을 다시 실행하지 않는다.

응답을 받지 못하면 화면은 쓰기 요청을 자동으로 반복하지 않고 서버 결과를 다시 읽는다. 결과가 불명확한 동안에는 추가 결정을 막는다. 세부 동작과 CSV 조회 한도·HTTP 기록은 [보완 기준](../docs/instructions/phase7-workspace.md#승인조회http-관측-보완)을 따른다.

## 9. 무엇을 검증하는가

개별 수정은 영향을 받는 기능부터 확인한다. 전체 연결을 검증할 때는 별도 테스트 환경에서 실제 CSV·Kafka·API·브라우저·로컬 모델·SQLite를 연결한다. 사용자 데이터와 기존 실행 중인 서비스는 보존한다.

입력값 누락·오류, 데이터 순서 위반, 연결 중단·복구, 잘못된 센서 분류, 3D 화면 사용 불가, AI 조회 실패, 승인 우회와 중복 실행을 확인한다. 화면의 센서 값은 원본과 API에서 같은 Tag로 찾을 수 있어야 한다.

승인 검증의 목표는 무자격 쓰기 0건, 확인을 건너뛴 승인 0건, 거절 후 실행 0건이다. 성공한 변경은 모두 조회 근거와 실행 기록으로 연결되어야 한다. 실제 결과는 입력·관측값·실패 상황을 담은 파일과 `docs/results/`에 남긴다. 과거 검증 기록을 새 코드의 검증 결과로 보고하지 않는다.

문서와 소스 미리보기는 `scripts/build-guide.py`로 함께 갱신한다. 기능 동작이나 검증 범위가 바뀌면 담당 문서를 먼저 수정하고 관련 링크와 생성 페이지를 확인한다.

## 10. 참고 자료

- [공공데이터포털](https://www.data.go.kr/)
- [Apache Kafka](https://kafka.apache.org/)
- [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/)
- [React](https://react.dev/)
- [React Three Fiber](https://r3f.docs.pmnd.rs/)
- [보일러 구조 참고 자료](https://www.babcock.com/assets/PDF-Downloads/Steam-Generation/E101-3193-RB-Boiler-Babcock-Wilcox.pdf)
