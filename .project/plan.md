# BoilerOps Agent 프로젝트 계획

## 1. 프로젝트 식별 정보

| 항목 | 값 |
| --- | --- |
| 프로젝트명 | BoilerOps Agent |
| 한줄 설명 | 한국중부발전 보일러 운전데이터를 실시간 스트림으로 재현하고, 2.5D 보일러 모니터링·운전 분석·AI Agent·승인 기반 제어까지 단계적으로 검증하는 산업 운영 시스템 |
| 디렉토리명 | `boiler-ops-agent` |
| GitHub Repository | `boiler-ops-agent` |
| Frontend | React + TypeScript + Vite + React Three Fiber |
| Backend | FastAPI |
| Event Streaming | Apache Kafka |
| Browser Streaming | WebSocket |
| 원본 데이터 | `한국중부발전(주)_(AI 친화 데이터)분 단위 발전설비(보일러) 운전데이터_20250404.csv` |
| 데이터 제공기관 | 한국중부발전(주) |
| 데이터 출처 | 공공데이터포털 |
| 현재 진행 상태 | Phase 1~7 구현 및 로컬 통합 E2E 검증 완료 |

## 2. 프로젝트 목표와 현재 작업

현재 범위는 Phase 1~7의 유지·보완이다. 새 기능과 스택 변경은 사용자의 현재 요청에 포함된 범위에서만 진행한다.

### 작업별 지침

아래에서 작업에 해당하는 문서만 확인한다. 여러 주제를 바꾸면 해당 계약을 함께 적용한다.

| 작업 | 구현·완료 기준 |
| --- | --- |
| 데이터 재생·수신 | [Phase 1](../docs/instructions/phase1-realtime-monitoring.md) |
| 센서·단위·설비 연결 | [Phase 2](../docs/instructions/phase2-domain-mapping.md) |
| 운전값 비교·이력 | [Phase 3](../docs/instructions/phase3-operational-monitoring.md) |
| AI 읽기 도구 | [Phase 4](../docs/instructions/phase4-read-agent.md) |
| 온도 예측 | [Phase 5](../docs/instructions/phase5-temperature-forecast.md) |
| Simulator 제안·승인 | [Phase 6](../docs/instructions/phase6-controlled-simulator.md) |
| 전체 통합 경계 | [Phase 7 통합 검증](../docs/instructions/phase7-integrated-validation.md) |
| 인증·소유권·자원 한도 | [보안 계약](../docs/instructions/phase7-security-hardening.md) |
| AI 답변·질문별 근거 | [답변 계약](../docs/instructions/phase7-agent-answers.md) |
| 한 명령 실행·키 재발급 | [로컬 실행](../docs/instructions/phase7-local-start.md) |
| 공장·센서 선택·채팅·기간 조회 | [작업 화면](../docs/instructions/phase7-workspace.md) |
| 렌더링·조회·자산 성능 | [성능 확인](../docs/instructions/phase7-workspace.md#성능-확인), [측정 기록](../docs/results/phase7-performance.md) |
| 지침·문서 정리 | [코딩 기준](../CODING_STANDARDS.md) |

### 현재 화면 범위

- 공장 모니터링에서 7개 논리 설비와 전체 118개 센서를 탐색한다. 주증기·발전 지표와 위치 미확인 센서는 그림의 설비와 구분한다.
- 메인 메뉴는 공장 모니터링·기간 조회·승인 연습·변경 기록이다. 재열기 5분 예측은 공장 아래에 함께 표시한다.
- 설비·묶음·센서 선택으로 범위를 좁힌다. 오른쪽 도우미는 센서 상세·AI 질문 두 탭이며 질문 대상과 화면 탐색 대상을 분리한다.
- 다중 센서 기간 비교, 최근 원본 시각 기준 120초 추이, 고정 채팅·초안·취소의 상세 동작은 작업 화면 지침을 따른다.
- 게임 표현과 흐름은 논리 탐색용이다. 단위·실제 설치 위치·위험·제어 효과를 추정하지 않는다.

### 2026-10-18 지침 재구조화

- AGENTS.md를 최소 진입점으로 줄이고 공통 구현·검증·정리 기준은 CODING_STANDARDS.md로 이동한다.
- 작업별 문서만 읽도록 연결하고 중복 규칙·대체된 UI 요구·불필요한 일괄 검증 의무를 제거한다.
- 문서 정합성 → 영향받는 동작의 실패 확인 → 최소 구현 → 불용 항목 정리 순서를 적용한다.
- 이번 변경은 문서와 오프라인 문서 탐색만 다룬다. 제품 동작·의존성·원본 데이터·DB는 변경하지 않는다.

### 2026-10-19 입력 경계와 성능 보완

- 빈 문자열·공백만 있는 입력이 전체 조회나 모델 작업으로 이어지지 않게 실제 API 경계를 확인한다. 현재 앱에 없는 회원 검색 기능을 가정해 추가하지 않는다.
- API 버전·쓰기 재시도·오류 공개·목록 한도·인증/소유권·타임아웃·일관성·관찰 가능성을 점검하고, 재현된 결함부터 수정한다. 기존 경로를 일괄 변경하거나 미래 API를 선반영하지 않는다.
- 불필요한 렌더·요청, 초기 JavaScript, 이력/DB 조회, 이미지·폰트·스크립트를 측정한다. 실제 낭비에 최소 변경을 적용하고 화면 선택·채팅·원본 데이터 의미를 보존한다.
- 새 의존성과 DB 스키마 변경·DB 삭제·데이터 초기화는 이번 범위에 포함하지 않는다. 격리된 메모리/브라우저 검증으로 실패와 수정 결과를 남긴다.

BoilerOps Agent는 정적인 분 단위 발전설비 데이터를 시간 순서대로 재생해 실시간 보일러 운전 환경을 구성한다.

첫 목표는 AI 기능이 아니다. CSV 한 행이 Event로 발행되고, Kafka와 FastAPI를 거쳐 WebSocket으로 React 화면에 전달되며, 사용자가 보일러 계통·설비·Sensor 값을 시간 순서대로 확인할 수 있는 상태를 먼저 만든다.

Phase 1의 화면은 일반적인 카드·테이블 중심 산업 Dashboard가 아니라 **고정형 2.5D Isometric Boiler Operations View**를 중심으로 구성한다.

```text
Plant Overview
        ↓
Equipment
        ↓
Sensor
        ↓
Current Value / Trend
```

3D는 장식이 아니다.

> 이 값이 보일러 어느 계통에서 발생하는지 빠르게 이해하기 위한 Monitoring Navigation Layer

로 사용한다.

실시간 데이터 흐름과 보일러 도메인 모델이 검증된 뒤 운전 분석, Read-only AI Agent, 온도 예측·제어 권고, 승인 기반 Simulator 제어를 단계적으로 추가한다.

```text
Historical Boiler CSV
        ↓
Realtime Replay Producer
        ↓
Apache Kafka
        ↓
FastAPI Operations Backend
        ↓
WebSocket
        ↓
React Monitoring UI
        ↓
React Three Fiber Boiler View
        ↓
Operational Analysis
        ↓
AI Operations Agent
        ↓
Control Recommendation
        ↓
Human Approval
        ↓
Simulator Control
        ↓
Trace / Validation
```

## 3. 문제 정의

발전 보일러 운전데이터에는 출력, 급탄, 공기, 급수, 증기, 과열기, 재열기, 배기가스 등 많은 Tag가 동시에 존재한다.

Raw CSV 또는 일반 Table만으로는 값이 어느 계통에 속하는지, 목표값과 실제값이 어떻게 변하는지, 관련 제어값이 함께 어떻게 변했는지 파악하기 어렵다.

설비의 공간적·계통적 관계가 없는 숫자 나열은 사용자가 특정 Sensor와 운전 상태의 관계를 이해하는 데 한계가 있다.

프로젝트는 네 문제를 순서대로 해결한다.

1. 정적 CSV를 검증 가능한 실시간 Event 흐름으로 변환한다.
2. Raw Tag를 보일러 설비·계통·Sensor 문맥으로 구조화한다.
3. 설비와 Sensor Context를 2.5D Operations View에서 탐색할 수 있게 한다.
4. 검증된 운영 데이터를 AI Agent가 Tool을 통해 조회하고, 쓰기 작업에는 승인 경계를 적용한다.

## 4. 데이터 사용 원칙

### 4.1 원본 파일

```text
한국중부발전(주)_(AI 친화 데이터)분 단위 발전설비(보일러) 운전데이터_20250404.csv
```

원본 파일은 저장소에 커밋하지 않는다.

```text
data/raw/*.csv
```

실행 환경에서는 환경 변수로 경로를 주입한다.

```text
BOILER_DATASET_PATH=
REPLAY_INTERVAL_MS=
KAFKA_BOOTSTRAP_SERVERS=
KAFKA_TOPIC=
```

### 4.2 검증 전 확정 금지 항목

원본 파일과 공식 메타데이터를 확인하기 전에는 값을 임의로 확정하지 않는다.

- 측정 단위
- 정상·주의·위험 임계값
- 실제 Sensor 장착 좌표
- DCS/PLC Tag ID
- 설비별 제어 허용 범위
- 고장 Label
- 온도 제어 인과관계

컬럼명으로 확인 가능한 위치는 논리 계통 위치로 사용한다.

실제 발전소 P&ID 또는 Instrument Index가 필요한 위치는 `unverified` 상태로 관리한다.

### 4.3 3D 위치 원칙

React Three Fiber Scene의 `scene_position`은 실제 계측기 설치 좌표가 아니다.

```text
actual physical position
≠
scene_position
```

`scene_position`은 사용자가 보일러 계통을 이해하기 위한 논리적 화면 좌표다.

실제 좌표처럼 보이는 정밀한 위치를 근거 없이 생성하지 않는다.

## 5. Phase 1 이벤트 계약

Phase 1에서는 CSV 원본 행을 그대로 브라우저로 전송하지 않는다.

Replay Producer가 식별 가능한 Event Envelope를 생성한다.

```json
{
  "sequence": 1024,
  "source_time": "<CSV 원본 시각>",
  "emitted_at": "<Replay 발행 시각>",
  "measurements": {
    "<tag>": "<value>"
  }
}
```

필수 규칙:

- `sequence`는 Replay 시작점부터 단조 증가한다.
- `source_time`은 원본 데이터의 시간축을 보존한다.
- `emitted_at`은 Replay 시스템의 발행 시각이다.
- 결측값은 임의 숫자로 대체하지 않는다.
- 숫자 파싱 실패는 원본 값과 오류 정보를 추적 가능하게 남긴다.
- Phase 1 Kafka Topic은 순서 검증을 위해 단일 Partition으로 시작한다.

초기 Topic 이름:

```text
boiler.telemetry.raw
```

## 6. Phase 1 시스템 구조

```mermaid
flowchart LR
    CSV["Boiler CSV"] --> Replay["Replay Producer"]
    Replay --> Kafka["Kafka: boiler.telemetry.raw"]
    Kafka --> API["FastAPI Consumer"]
    API --> State["Current Boiler State"]
    State --> WS["WebSocket"]
    WS --> UI["React Monitoring UI"]
    UI --> Scene["R3F Boiler Scene"]
```

책임 경계:

| 구성 | 책임 |
| --- | --- |
| Replay Producer | CSV 순차 읽기, Event Envelope 생성, 재생 속도 적용, Kafka 발행 |
| Kafka | Backend 내부 Event 전달, Producer와 Consumer 분리 |
| FastAPI Consumer | Kafka Event 수신, 파싱, 최신 Boiler State 관리 |
| WebSocket | 브라우저 실시간 상태 전달, 연결·재연결 처리 |
| React | KPI, Inspector, Operations Feed, 연결 상태 관리 |
| React Three Fiber | 2.5D Boiler Scene, Equipment, Sensor Marker, 선택 상태 표현 |

Raw Kafka Message를 React에 그대로 전달하지 않는다.

FastAPI가 Parsing과 Domain Mapping을 담당한다.

Frontend는 원본 CSV Column 의미를 독립적으로 재해석하지 않는다.

## 7. 보일러 도메인 초기 분류

현재 제공된 Column Name을 기준으로 논리 계통을 분류한다.

실제 설비의 물리 배치와 동일하다고 주장하지 않는다.

### Generation

- 실제 출력값
- 목표 발전량
- 총 주증기 유량
- 주증기 유량
- 터빈용 주증기 압력

### Fuel / Combustion

- 석탄 유량 제어
- 급탄기 A~F 요구값
- 급탄기 A~F 속도 평균값
- 산소 제어
- 산소농도 기반 보정 제어
- 총 공기 유량
- 2차공기 주제어
- 버너 기울기 관련 값

### Furnace / Waterwall

- 노내 상부 좌측부 튜브 헤더 출구 온도 평균값
- 노내 상부 우측부 튜브 헤더 출구 온도 평균값
- 노내 상부 전면부 튜브 헤더 출구 온도 평균값
- 노내 상부 루프 튜브 헤더 출구 온도 평균값
- 보일러 노 루프 튜브 금속 온도

### Feedwater / Economizer

- 절탄기 입구 급수 보정 유량
- 절탄기 입구 급수 압력 중간값
- 절탄기 입구 급수 온도 중간값
- 절탄기 헤더 출구 링크 온도 01/02
- 총 급수 보정 유량
- 급수 압력 중간값
- 급수 온도 중간값

### Superheater / Main Steam

- 과열기 계통 입·출구 온도
- 최종과열기 헤더 온도 평균값 A/B
- 최종과열기 출구 온도 평균값
- 주증기 압력 관련 값
- 과열기 스프레이 총 유량
- 과열저감기 스프레이 유량·밸브 개도

### Reheater

- 저온 재열기 압력
- 재열증기 과열저감기 입·출구 온도 A/B
- 최종재열기 입구 온도 관련 값
- 재열기 스프레이 유량
- 재열기 과열저감기 스프레이 밸브 개도
- 목표 재열기 온도

### Flue Gas / Environment

- 배기가스 산소 중간값 A/B
- 덕트용 불투명도 분석기 A/B
- 선택적 촉매 환원장치 A/B 배기가스 입구 온도
- 굴뚝용 질소산화물 분석기

## 8. Phase 계획

### Phase 1 — Realtime Boiler Monitoring

**목표**

CSV 한 행이 실시간 Event Pipeline을 통과해 React 화면과 2.5D Boiler Scene에서 순서대로 갱신되는 전체 흐름을 완성한다.

**구현 범위**

- CSV 스키마 확인
- Replay Producer
- 재생 속도 환경 변수
- Kafka 단일 Topic·단일 Partition
- FastAPI Kafka Consumer
- 현재 Boiler State 관리
- WebSocket Endpoint
- React WebSocket 연결·재연결
- React Three Fiber 기본 Scene
- 고정형 Isometric Camera
- 제한된 Zoom / Pan
- 대표 Equipment Geometry
- 대표 KPI
- 검증 가능한 Sensor Marker
- Sensor 선택
- Equipment / Sensor Inspector
- Live Operations Feed
- 연결 상태 표시
- Stale / Error 상태 표시
- WebGL Fallback

**2.5D Boiler Scene 초기 구성**

```text
Feeders
   ↓
Furnace
   ↓
Superheater / Reheater
   ↓
Economizer
   ↓
SCR
   ↓
Stack
```

급수·증기 Flow는 필요 범위에서 별도 Line으로 표현한다.

```text
Feedwater
   ↓
Economizer
   ↓
Furnace / Waterwall
   ↓
Superheater
   ↓
Main Steam
```

근거가 없는 세부 배관은 그리지 않는다.

**대표 KPI 초기 후보**

- 실제 출력값
- 목표 발전량
- 총 주증기 유량
- 터빈용 주증기 압력
- 최종과열기 출구 온도 평균값
- 배기가스 산소 중간값
- 과열기 스프레이 총 유량
- 굴뚝용 질소산화물 분석기

단위는 데이터 정의 확인 후 표시한다.

**완료 기준**

- CSV Row 순서와 Kafka Event `sequence`가 일치한다.
- FastAPI가 Kafka Event를 순서대로 소비한다.
- React가 WebSocket Message 수신 시 현재값을 갱신한다.
- R3F Sensor Marker에 대표 Sensor 값이 반영된다.
- Sensor를 선택하면 Inspector가 동일한 Tag의 최신값을 표시한다.
- Source Time과 Sequence를 화면에서 확인할 수 있다.
- Live Operations Feed에서 최근 Event 진행을 확인할 수 있다.
- Kafka·WebSocket 연결 상태를 화면에서 확인할 수 있다.
- 갱신 중단 시 Stale 상태를 확인할 수 있다.
- WebSocket 연결 종료 후 재연결이 가능하다.
- WebGL 사용 불가 상태에서 Fallback이 표시된다.
- E2E 실행 결과로 재현 가능한 검증 아티팩트가 생성된다.

**Phase 1 제외 범위**

- AI Agent
- 온도 예측 모델
- 이상 탐지 모델
- 자동제어
- Write Tool
- Human Approval
- 실제 발전설비 연결
- 임의 정상·위험 임계값
- 자유 Camera Rotate
- 1인칭 이동
- Cinematic Camera
- 장식 목적 Particle / Glow / Bloom
- 3D 객체 클릭 기반 제어
- 실제 발전소 P&ID 복제
- Digital Twin 표현

---

### Phase 2 — Boiler Domain & Sensor Mapping

**목표**

Raw CSV Column을 설비·계통·측정값 문맥으로 구조화하고 2.5D Scene의 논리 위치와 연결한다.

**구현 범위**

- Tag Registry
- Equipment Hierarchy
- Sensor → Equipment Mapping
- Sensor → Scene Position Mapping
- 공식 근거가 확인된 Unit 반영
- Measurement / Control / Target 구분
- Mapping Confidence 관리
- 센서 선택 시 최근 Trend 표시
- Process Flow 정리
- Related Tag 연결

**Sensor Metadata 최소 구조**

```text
tag
label
equipment
section
measurement_type
unit
mapping_confidence
scene_position
```

**완료 기준**

- 화면에 표시하는 모든 Tag가 Registry에 등록된다.
- Sensor 위치마다 위치 근거 또는 `unverified` 상태가 존재한다.
- 원본 CSV Column과 화면 Sensor 간 역추적이 가능하다.
- Scene에서 선택한 Sensor와 Inspector의 Tag가 일치한다.
- `unverified` Tag가 정밀 Sensor 위치로 표현되지 않는다.

---

### Phase 3 — Operational Monitoring

**목표**

실시간 값 표시를 운전 상태 비교와 변화 추적이 가능한 Monitoring으로 확장한다.

**구현 범위**

- Actual vs Target
- 최근 Trend
- 변화율
- Historical Distribution 기반 Deviation
- 관련 제어값 비교
- 과열기 또는 재열기 중 첫 분석 Loop 선택

**완료 기준**

- 선택한 Loop의 목표값·실제값·관련 입력값을 동일 시간축에서 비교할 수 있다.
- Scene에서 선택한 설비의 관련 운전값을 Inspector에서 확인할 수 있다.
- 공식 기준 없는 임계값을 안전 기준으로 표현하지 않는다.

---

### Phase 4 — Read-only AI Operations Agent

**목표**

AI Agent가 Raw CSV를 직접 읽지 않고 FastAPI의 검증된 Read Tool만 사용해 운전 상태를 설명하도록 구성한다.

**Tool 후보**

```text
get_boiler_status
get_equipment_status
get_sensor_history
get_operating_targets
get_current_controls
get_deviation_summary
```

**완료 기준**

- Agent의 모든 수치 근거가 Tool Result로 추적된다.
- 존재하지 않는 Tag를 근거로 사용하지 않는다.
- Scene에서 선택한 Equipment Context와 Agent 조회 대상이 일치한다.
- Write 기능이 존재하지 않는다.
- Tool 호출과 응답 Trace를 검증할 수 있다.

---

### Phase 5 — Temperature Forecast & Control Advisory

**목표**

선택한 온도 Loop의 미래 상태를 예측하고 운전 권고의 근거로 사용한다.

**진행 순서**

1. 예측 대상과 Forecast Horizon 확정
2. Naive Baseline 측정
3. 학습 모델 적용
4. MAE·RMSE 비교
5. Agent가 예측 결과를 Read Tool로 조회
6. 자동제어가 아닌 Control Advisory 제공

**제약**

관측 데이터에서 확인된 상관관계를 제어 인과관계로 단정하지 않는다.

3D Scene은 예측값을 이해하기 위한 Context를 제공할 수 있지만 제어 실행 UI로 사용하지 않는다.

---

### Phase 6 — Controlled Simulator Write

**목표**

Agent의 제어 제안을 승인된 Simulator 환경에서만 실행한다.

```text
Agent Recommendation
        ↓
Constraint Validation
        ↓
Human Approval
        ↓
Simulator Write
        ↓
Result / Trace
```

**원칙**

- Read Tool은 정책 범위 안에서 자동 실행 가능
- Write Tool은 Human Approval 필수
- 실제 발전설비 제어 연결 금지
- 요청값·기존값·승인 판단·실행 결과·Trace 기록
- 승인 거절 후 실행 금지
- 3D Equipment 클릭만으로 Write 실행 금지

제어 UI는 Scene과 분리한다.

```text
3D Scene
= Monitoring / Selection

Control Panel
= Requested Change / Constraint / Approval
```

---

### Phase 7 — Integrated E2E Validation

**목표**

전체 시스템의 실패 경로와 운영 경계를 E2E로 검증한다.

**검증 범위**

- Kafka 중단·복구
- WebSocket 중단·재연결
- CSV 결측·파싱 실패
- Event 순서 위반 감지
- Tag Mapping 오류
- Sensor Scene Position 오류
- Scene Sensor 값과 Inspector 값 불일치
- WebGL 초기화 실패
- Agent Tool 실패
- 승인 없는 Write 차단
- 승인 거절 후 미실행
- Write Trace 기록

**완료 기준**

```text
Unauthorized Write = 0
Approval Bypass = 0
Rejected Write Execution = 0
Successful Write Trace Coverage = 100%
```

핵심 E2E 시나리오는 검증 가능한 아티팩트를 남긴다.

## 9. 화면 설계

현재 UI의 단일 기준은 [DESIGN.md](../DESIGN.md)다. 센서 선택·채팅·기간 조회의 세부 계약은 작업 화면 지침을 따른다.

## 10. 구현 기준

공통 코드·데이터·환경 기준은 [CODING_STANDARDS.md](../CODING_STANDARDS.md)의 해당 절을 따른다. 구현 세부 구조와 API 계약은 작업별 지침에서 확인한다.

## 11. 테스트 및 검증 전략

변경 순서와 검증 범위는 [코딩 기준](../CODING_STANDARDS.md)의 작업 순서·검증 절을 따른다. 각 Phase의 시나리오는 해당 기능이나 통합 경계를 검증할 때 적용하며 모든 변경의 필수 실행 목록으로 사용하지 않는다.

## 12. 문서 체계

| 문서 | 역할 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | 최소 작업 진입점과 보호 경계 |
| [CODING_STANDARDS.md](../CODING_STANDARDS.md) | 구현·데이터·환경·검증·정리·Git 기준 |
| 이 문서 | 프로젝트 범위와 작업별 지침 연결 |
| [DESIGN.md](../DESIGN.md) | 현재 UI 기준 |
| `docs/instructions/` | 작업별 계약과 완료 기준 |
| `docs/results/` | 실제 실행·검증 결과 |
| [README.md](../README.md) | 사용자 실행 방법과 현재 기능 |

## 13. 코드 위치

실행 진입점은 루트 `package.json`, 로컬 실행은 `scripts/start.py`, API는 `backend/app/`, 화면은 `frontend/src/`다. 필요한 실제 파일만 확인하며 미래 기능의 빈 구조를 미리 만들지 않는다.

## 14. 품질 기준

원본 데이터의 시각·수치·품질과 AI 근거가 추적 가능해야 한다. 화면의 논리 위치를 실제 설치 위치로 설명하지 않으며, 실제 설비와 승인된 로컬 Simulator의 경계를 유지한다. 실행 결과는 `docs/results/`에 기록된 해당 버전의 검증 범위를 따른다.

## 15. 프로젝트 경계

BoilerOps Agent가 증명하려는 것은 3D Dashboard 제작 능력이 아니다.

```text
실제 산업 데이터
        ↓
Realtime Event Pipeline
        ↓
Industrial Domain Modeling
        ↓
2.5D Operations Monitoring
        ↓
Operations Backend
        ↓
Prediction
        ↓
AI Agent
        ↓
Human Approval
        ↓
Controlled Operation
        ↓
Trace / Regression
```

Phase 1의 2.5D 화면은 이후 AI Agent가 판단할 산업 Context를 사용자가 같은 구조에서 확인할 수 있게 만드는 기반이다.

## 16. 참고 자료

- 공공데이터포털: https://www.data.go.kr/
- Apache Kafka: https://kafka.apache.org/
- FastAPI WebSockets: https://fastapi.tiangolo.com/advanced/websockets/
- React: https://react.dev/
- React Three Fiber: https://r3f.docs.pmnd.rs/
- React Three Fiber Canvas: https://r3f.docs.pmnd.rs/api/canvas
- Babcock & Wilcox Radiant Boiler 구조 참고: https://www.babcock.com/assets/PDF-Downloads/Steam-Generation/E101-3193-RB-Boiler-Babcock-Wilcox.pdf

Babcock & Wilcox 자료는 실제 한국중부발전 대상 설비의 설계도 또는 P&ID가 아니다.

Furnace, Superheater, Reheater, Economizer, SCR, Coal Feeder 등 일반적인 논리 계통 구성 참고에만 사용한다.
