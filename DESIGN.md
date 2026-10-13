# BoilerOps Agent UI Design

## 1. 적용 범위

이 문서의 기본 Scene·Monitoring 규칙은 **Phase 1 — Realtime Boiler Monitoring**에서 정의했다.
현재 Phase 1~7 구현 화면의 추가 패널은 문서 끝의 현재 구현 범위를 따른다.

현재 화면은 React + TypeScript + Vite와 React Three Fiber를 사용한다.

후속 Phase의 분석·Agent·Forecast·Simulator 승인 패널은 Scene과 분리한다.

---

## 2. 화면 목적

사용자는 한 화면에서 아래 정보를 확인할 수 있어야 한다.

1. 데이터가 실제로 수신 중인지
2. 현재 보일러의 주요 운전값이 무엇인지
3. 값이 어느 설비·계통에 속하는지
4. 어떤 Sensor를 선택했는지
5. 최신 Event가 어느 시점까지 도달했는지

화면은 발전소 제어실 DCS를 복제하지 않는다.

공개 데이터에서 검증 가능한 범위만 표현한다.

---

## 3. 디자인 방향

> **산업 소프트웨어처럼 보이기 위한 UI가 아니라, 산업 상태를 더 빨리 이해하기 위한 UI**

보일러를 카드와 표의 배경으로 두지 않는다.

보일러 자체를 메인 Navigation으로 사용한다.

```text
Plant Overview
→ Equipment
→ Sensor
→ Current Value / Trend
```

3D는 시각 효과가 아니라 **설비 문맥을 제공하는 인터랙티브 맵**이다.

---

## 4. 2.5D Isometric 원칙

완전 자유형 3D Viewer를 만들지 않는다.

고정된 Isometric 시점을 사용한다.

### 허용

- Equipment 선택
- Sensor 선택
- 제한된 Zoom
- 제한된 Pan
- Hover 또는 선택 Highlight
- Sensor Tooltip
- 공정 흐름을 이해하기 위한 제한적 Flow 표현

### 사용하지 않음

- 자유 Rotate
- Orbit 중심의 탐색
- 1인칭 이동
- Fly Camera
- Cinematic Camera
- 과도한 Bloom
- 장식 Particle
- 끊임없이 움직이는 기계 Animation
- 게임 효과음

사용자가 카메라 조작 때문에 설비 위치를 다시 찾아야 하는 상황을 만들지 않는다.

---

## 5. 화면 구조

기본 대상은 Desktop이다.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ BoilerOps Agent          ● LIVE      14:32       Kafka ●   WS ●       │
├────────────────────────────────────────────────────────────────────────┤
│ Output │ Target │ Steam Flow │ Steam Pressure │ O2 │ NOx              │
├─────────────────────────────────────────────────┬──────────────────────┤
│                                                 │ Equipment Inspector  │
│                                                 │                      │
│             ISOMETRIC BOILER VIEW               │ Sensor / Equipment   │
│                                                 │ Current Value        │
│     Feeder → Furnace → SH/RH → Econ → SCR      │ Source Time          │
│       ●         ●        ●       ●       ●       │ Mapping Confidence   │
│                                                 │ Recent Trend         │
│                                                 │ Related Tags         │
├─────────────────────────────────────────────────┴──────────────────────┤
│ LIVE OPERATIONS                                           14:32:01    │
│ ● Superheater   Temperature   ...                                     │
└────────────────────────────────────────────────────────────────────────┘
```

권장 비율:

- Header / KPI: 약 15%
- Boiler View + Inspector: 약 70%
- Live Operations: 약 15%

화면 높이가 부족할 경우 Boiler View를 우선한다.

---

## 6. Component 구조

일반 React UI:

```text
MonitoringPage
├─ StatusBar
├─ KPIBar
├─ BoilerViewport
├─ EquipmentInspector
└─ OperationsFeed
```

3D Scene:

```text
BoilerScene
├─ PlantEnvironment
├─ Feeders
├─ Furnace
├─ Superheater
├─ Reheater
├─ Economizer
├─ SCR
├─ Stack
├─ ProcessFlow
└─ SensorMarkers
```

3D 코드와 Dashboard UI 상태를 하나의 대형 Component에 섞지 않는다.

---

## 7. Boiler Scene

### 7.1 표현 수준

Scene은 실제 중부발전 호기의 정밀 형상을 복제하지 않는다.

목표는 **논리적 설비 관계를 공간적으로 이해시키는 것**이다.

초기 Scene은 단순 Geometry로 구성한다.

- Box
- Cylinder
- Pipe-like Line
- Plane
- Marker

복잡한 외부 GLTF Asset은 Phase 1 기본 범위에 포함하지 않는다.

### 7.2 기본 배치

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

급수·증기 계통은 별도 Flow로 구분할 수 있다.

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

Turbine Return
   ↓
Reheater
   ↓
Reheated Steam
```

근거가 없는 세부 배관은 그리지 않는다.

---

## 8. Camera

기본 Camera는 고정된 Isometric Angle을 사용한다.

초기 요구사항:

- 첫 진입 시 전체 Boiler Scene이 한 화면에 보임
- Equipment가 Inspector와 겹치지 않음
- Label과 Sensor Marker가 화면 경계 밖으로 빠지지 않음
- Zoom 제한 존재
- Pan 제한 존재
- Rotate 비활성화

카메라 상태는 Monitoring UX를 해치지 않는 범위만 허용한다.

---

## 9. Process Flow 표현

Flow는 장식 Animation이 아니다.

공정 관계를 이해시키기 위한 보조 정보다.

표현 대상:

```text
Coal / Fuel
Air
Feedwater / Steam
Flue Gas
```

기본은 정적인 Line이다.

Animation이 필요한 경우 느리고 제한적인 방향 표시만 사용한다.

Scene의 모든 Line을 계속 움직이게 만들지 않는다.

---

## 10. Sensor Marker

Sensor Marker는 전체 Scene에서 가장 중요한 인터랙션 요소다.

기본 상태에서는 작은 Marker만 표시한다.

상태:

```text
LIVE
SELECTED
STALE
ERROR
UNMAPPED
```

`NORMAL`, `WARNING`, `CRITICAL`은 Phase 1에 사용하지 않는다.

색상만으로 상태를 구분하지 않는다.

Shape, Icon, Border, Label 중 최소 하나를 함께 사용한다.

### Hover

```text
Final Superheater Outlet
Value: ...
Source Time: ...
```

### Select

선택 시 Inspector를 갱신한다.

Scene 위에 큰 Detail Panel을 띄우지 않는다.

---

## 11. Sensor Mapping

Metadata 최소 구조:

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

`scene_position`은 실제 센서 설치 좌표가 아니다.

논리 설비 내부의 화면 좌표다.

### `verified-by-tag`

Column Name이 위치를 직접 설명하는 경우.

```text
절탄기 입구 급수 온도 중간값
→ Economizer / Inlet

최종과열기 출구 온도 평균값
→ Final Superheater / Outlet

선택적 촉매 환원장치A 배기가스 입구 온도 평균값
→ SCR A / Inlet

급탄기 A 속도 평균값
→ Feeder A
```

### `logical-group`

계통은 알 수 있지만 실제 계측 지점은 확인할 수 없는 경우.

### `unverified`

공개 정보로 위치를 판단할 수 없는 경우.

`unverified` Tag는 정밀 Sensor Marker로 배치하지 않는다.

---

## 12. Status Bar

표시:

- `BoilerOps Agent`
- Streaming 상태
- Kafka 상태
- WebSocket 상태
- Source Time
- Event Sequence
- Replay Interval

Connection State:

```text
LIVE
RECONNECTING
DISCONNECTED
ERROR
STALE
```

값이 갱신되지 않을 때 `LIVE`처럼 보여서는 안 된다.

---

## 13. KPI Bar

Phase 1 대표 KPI 후보:

- 실제 출력값
- 목표 발전량
- 총 주증기 유량
- 터빈용 주증기 압력
- 최종과열기 출구 온도 평균값
- 배기가스 산소 중간값
- 과열기 스프레이 총 유량
- 굴뚝용 질소산화물 분석기

한 화면에 모두 들어가지 않으면 우선순위를 정해 일부만 표시한다.

Card 구조:

```text
Label
Value
Source Time
```

단위는 원본 정의에서 확인한 값만 표시한다.

증감률과 산업 안전 Badge를 임의 추가하지 않는다.

---

## 14. Equipment Inspector

Equipment 또는 Sensor 선택 시 오른쪽 Panel을 갱신한다.

Sensor 기준:

```text
Sensor Label
Original Tag
Current Value
Unit
Source Time
Equipment
Section
Mapping Confidence
Recent Trend
Related Tags
```

Phase 1 Trend는 현재 세션에서 수신한 최근 데이터만 사용해도 된다.

장기 Historical Query는 Phase 1 범위가 아니다.

선택하지 않은 경우 Boiler 전체 요약을 표시할 수 있다.

---

## 15. Operations Feed

기존의 큰 Raw Telemetry Table 대신 **Operations Event Feed**를 사용한다.

목적:

> Kafka → WebSocket → UI Event가 실제로 진행 중임을 사용자가 눈으로 확인

표시 예:

```text
14:32:00  Generation    Output          ...
14:32:00  Superheater   Temperature     ...
14:32:00  Combustion    O2              ...
14:32:00  Reheater      Temperature     ...
```

내부적으로 Event 단위 Sequence를 확인할 수 있어야 한다.

필수 데이터:

```text
sequence
source_time
emitted_at
representative_measurements
```

UI 표시 행 수는 제한할 수 있다.

E2E Trace 원본을 UI 제한에 맞춰 삭제하지 않는다.

---

## 16. 상태 색상 의미

Phase 1 색상은 안전 상태를 뜻하지 않는다.

색상은 시스템 상태와 선택 상태를 구분하는 데만 사용한다.

예:

- Live
- Selected
- Stale
- Error
- Unmapped

위험·정상 의미를 가진 강한 빨강·초록 구분은 Domain Threshold가 확정된 이후에만 도입한다.

---

## 17. React Three Fiber 상태 구조

WebSocket Event마다 React Tree 전체를 다시 렌더링하지 않는다.

목표 흐름:

```text
WebSocket Message
       ↓
Telemetry Store
       ↓
Changed Tags
       ↓
KPI / Inspector / Sensor Marker
```

Scene의 정적 설비 Geometry와 실시간 Sensor State를 분리한다.

### 금지

- `useFrame` 안에서 매 Frame 전역 `setState`
- Event마다 Geometry 재생성
- Event마다 Material 재생성
- Scene 전체 Key 변경을 이용한 강제 Remount
- UI와 Scene 데이터를 별도 Source of Truth로 중복 관리

### 허용

- 변경된 Sensor Marker만 갱신
- Geometry / Material 재사용
- 필요 시 Instancing
- 필요 시 Demand 기반 렌더링 검토

성능 최적화는 측정 결과를 기준으로 적용한다.

---

## 18. WebGL Fallback

Canvas 생성 실패 또는 WebGL 사용 불가 환경에서 빈 화면만 보여주지 않는다.

Fallback 최소 표시:

```text
3D VIEW UNAVAILABLE

현재 Streaming 상태
대표 KPI
선택 가능한 Equipment 목록
```

Fallback은 Phase 1 E2E에서 검증 대상에 포함한다.

---

## 19. Responsive

### Desktop

기본 환경.

- Boiler View + Inspector 2열
- KPI 가로 배치
- Operations Feed 하단
- Scene 비율 우선

### Narrow Desktop / Tablet

- Inspector를 Overlay 또는 하단 Panel로 이동 가능
- KPI Wrap 허용
- Scene 최소 높이 보장
- Operations Feed 높이 축소 가능

모바일 전용 별도 IA는 Phase 1에서 만들지 않는다.

---

## 20. 접근성

- 색상 하나로 상태를 전달하지 않는다.
- Sensor Marker에 접근 가능한 Label을 제공한다.
- Keyboard Focus 상태를 제거하지 않는다.
- 실시간 갱신 때문에 현재 Focus가 이동하면 안 된다.
- 숫자 변경마다 Screen Reader Live Announcement를 발생시키지 않는다.
- 3D Scene 사용이 불가능한 환경을 위한 Fallback을 제공한다.

---

## 21. 시각 스타일

목표:

> **게임형 공간 이해 방식 + 운영 소프트웨어의 정보 정확성**

사용:

- 밝거나 어두운 중립 배경 중 하나
- 높은 정보 대비
- 명확한 설비 실루엣
- 제한된 상태색
- 단순한 Panel
- 가독성 높은 숫자
- 충분한 여백
- 고정된 Inspector

사용하지 않음:

- Glassmorphism
- 과도한 Gradient
- 무거운 Shadow
- Neon Cyberpunk
- 과도한 Glow
- 의미 없는 Hologram
- 영상 Hero
- 실제 공장처럼 보이기 위한 과도한 Texture

---

## 22. Phase 1에 넣지 않는 요소

- AI Chat
- Agent Avatar
- AI Recommendation Card
- Failure Probability
- Predictive Maintenance Score
- Automatic Control Toggle
- Valve 직접 제어
- Feeder 직접 제어
- Human Approval Modal
- Digital Twin 문구
- 실제 발전소 P&ID처럼 보이는 정밀 배관
- 실제 발전소 Control Room 복제

---

## 23. E2E 디자인 검증

Phase 1 E2E 종료 시 최소 아래 아티팩트를 생성한다.

```text
artifacts/e2e/phase1/
├─ run.json
├─ telemetry.jsonl
├─ dashboard.png
└─ selected-sensor.png
```

`dashboard.png`에서 확인 가능해야 하는 정보:

- Live 상태
- Kafka 상태
- WebSocket 상태
- Source Time
- Sequence
- 대표 KPI
- Isometric Boiler Scene
- Sensor Marker
- Operations Feed

`selected-sensor.png`에서 확인:

- 선택된 Sensor
- Scene Highlight
- Inspector
- Current Value
- Source Time
- Mapping Confidence

---

## 24. 구조 참고

- React Three Fiber: https://r3f.docs.pmnd.rs/
- React Three Fiber Canvas: https://r3f.docs.pmnd.rs/api/canvas
- Babcock & Wilcox Radiant Boiler: https://www.babcock.com/assets/PDF-Downloads/Steam-Generation/E101-3193-RB-Boiler-Babcock-Wilcox.pdf

Babcock & Wilcox 자료는 대상 한국중부발전 설비의 실제 도면이 아니다.

일반적인 Furnace, Superheater, Reheater, Economizer, SCR, Coal Feeder 관계를 이해하기 위한 참고자료로만 사용한다.

## 25. 현재 구현 범위 (Phase 1~7)

- Scene 및 Inspector: 원본 Tag와 논리 좌표, Mapping 근거, 이력·관련 Tag.
- Operational Analysis: 재열기/발전량 Loop의 같은 시각 실제·목표·관련 입력, 변화율, 과거 분포.
- Forecast: 재열기 온도 5분 예측, Naive/학습 모델의 시간순 시험 성능, 단위·목표 결측 제약.
- Read-only Agent: 선택 설비의 질문, 근거 ID가 붙은 응답, 도구 Trace 링크.
- Controlled Simulator: 차원 없는 데모 값과 별도 제안·승인·거절 패널. 실제 설비 연결 없음.
- 오류 상태: Kafka/WS/stale, 잘못된 Registry와 좌표, WebGL 소실, Agent 및 승인 오류 표시.

Phase 1에서 제외한 후속 기능은 해당 Phase의 지침·검증을 거쳐 위 패널로 추가했다. Scene 클릭은 선택만 수행한다.

## 26. 현재 반응형·접근성 기준

- 본문 건너뛰기, 이름 있는 탐색 영역, 모든 조작 요소의 키보드 포커스 표시.
- 좁은 화면은 단일 열 패널, 줄바꿈 가능한 KPI·이벤트·표, 실제 패널로 이동하는 모바일 메뉴.
- Canvas와 동일한 대표 센서를 HTML 버튼으로 선택. 작은 화면은 겹치는 Marker Label을 숨기고 한글 설비 목록 사용.
- 차트는 접근 가능한 이름·요약과 원본값 표 제공. 결측 구간은 연결하지 않음.
- Agent·Simulator 처리 결과는 상태 영역으로 안내. 승인 결과 후 메시지로 포커스 이동.
- 화면 자동 갱신을 일시정지해 관측값을 읽을 수 있음. 서버 수집과 별도 API 조회는 계속되므로 고정된 서버 Snapshot으로 표현하지 않음.
- 검증 기록과 실제 스크린리더 낭독의 잔여 확인 항목은 `docs/results/phase7-ui-accessibility-review.md` 참조.


## 27. 개인 세션과 문서 탐색

- 운영 화면은 개인 사용자 ID·접근 키로 로그인한 뒤 표시한다. 역할과 세션을 서버에서 검증한다.
- 본인 제안의 확인 체크박스를 승인 의도로 사용한다. 공유 승인 토큰 입력을 제거한다.
- 로그아웃 버튼은 모바일 메뉴보다 앞에 배치하여 메뉴 다음 Tab이 실제 메뉴 항목으로 이어지게 한다.
- `docs/index.html`은 전체 흐름도, 기능 선택형 코드 지도, 실제 화면, 보안 경계, 다음 작업으로 구성한다.
- 상세 타입·시그니처는 접고, 코드·README·감사·평가 기록은 native dialog 안에서 읽는다. 원문 파일 다운로드로 안내하지 않는다.
- dialog는 Escape로 닫고 열었던 조작 요소로 포커스를 돌려준다. 내부 문서는 제목·표·코드 블록으로 렌더링하며 원본 HTML을 실행하지 않는다.
- 공개 파일 allowlist의 오프라인 미리보기는 `scripts/build-guide.py`로 갱신한다. 환경 파일·원본 데이터·자격 파일은 포함하지 않는다.
- 실제 E2E 캡처 세 장을 압축 JPEG로 제공하며 장식용 가상 UI를 실제 화면으로 표현하지 않는다.

## 28. 질문별 AI 답변

- 답변은 결론 → 짧은 근거 설명 → 한계 순서의 일반 문단으로 표시한다. 숫자 목록을 코드 블록처럼 표시하지 않는다.
- 선택 센서·원본 시각·근거 ID를 함께 읽을 수 있게 하고, 도구 Trace 링크를 유지한다.
- 필요한 근거가 없으면 판단할 수 없다는 결론을 먼저 표시한다. STALE 응답은 마지막 관측이라는 한계를 명시한다.
- 질문별 실제 검수 기록은 프로젝트 지도의 AI 흐름에서 같은 페이지 안에 표시한다.

## 29. 계통도와 오른쪽 작업 패널

```text
┌ 고정: 모니터링 · 운전 분석 · 온도 예측 · AI 질문 · 승인 연습 ┐
│ 원본값 KPI                       │ 센서 / AI / 승인 / 기록 │
│                                  │ 선택 센서 변경           │
│    계통도 ← Space+드래그          │ 현재값·질문·근거          │
│           Space+휠 확대/축소       │ 명시적 승인·거절          │
│    한글 설비명 + 짧은 설명         │ 읽을 수 있는 변경 기록    │
└──────────────────────────────────┴─────────────────────────┘
```

- Pretendard Variable을 로컬 파일로 제공하며 숫자는 같은 글꼴의 tabular-nums를 사용한다.
- 도형·라벨·목록은 Registry의 primary_tag를 공유한다. 다른 센서를 선택하면 라벨에 해당 센서 이름을 표시한다.
- Marker 위치는 렌더링하는 실제 카메라에서 계산한다. 이동 중 클릭을 차단하고 Space 해제 시 원래 선택 동작을 복원한다.
- 고정 헤더 높이를 기준으로 앵커 이동의 가림을 방지한다. 오른쪽 패널은 화면을 가리지 않도록 데스크톱 본문 공간을 확보한다.
- 패널은 비모달이다. 열린 상태에서 계통도를 조작할 수 있고, 모바일에서는 화면 하단에 배치한다. 탭 키보드 이동과 Escape·닫기 포커스 복귀를 제공한다.
- 컬럼 정의서에서 확인한 단위와 행 번호를 표시하고 숫자는 원본 그대로 유지한다. 정의 없는 값은 `단위 정의 없음`으로 표시한다. 미확인 단위·환산식을 만들어 넣지 않는다.
- AI Trace와 Simulator Audit는 패널 안에서 사람이 읽을 수 있게 표시한다. 원본 JSON은 접힌 상세에서만 확인한다.

### 2026-10-12 개정

위 도식의 전역 AI·승인 메뉴와 선택 연동 방식을 아래로 대체한다.

```text
고정 메뉴: 모니터링 · 운전 분석 · 온도 예측
┌ 설비를 눌러 살펴보세요: [급탄기 N] [화로 N] … ┐  ┌ 운전 도우미 ┐
│ 서로 구분되는 논리 구조물 + 고정 대표 센서     │  │ 센서/AI/기록 │
│ 작은 하단 흐름 설명                          │  │ 그룹 → 센서 │
└─────────────────────────────────────────────┘  │ 질문 대상 고정│
                          [작은 AI 버튼 하나]     │ 승인 연습 접기│
                                                └──────────────┘
```

- 계통도 이름표의 대표 센서는 고정한다. 개별 센서 선택은 상세 패널과 해당 설비 강조로 표시한다.
- 설비 목록을 제목 바로 아래로 옮기고 센서 수를 표시한다. 흐름 설명은 계통도 하단에 작은 글씨로 통합한다.
- 질문 대상과 화면 탐색 대상을 구분한다. 질문 작성·대기·답변은 탐색으로 사라지지 않는다. 명시적인 새 질문만 대상을 바꾼다.
- 선택 목록은 설비 분류와 해당 분류 안의 검색으로 좁힌다. 질문 예시는 선택한 센서에 맞게 제시한다.
- 승인 연습은 AI 탭 내부의 접힌 부가 기능이다. 헤더·푸터·부유 버튼에 같은 행동을 중복 노출하지 않는다.

## 30. 공장 탐색·대화·원본 기간 조회 추가 개정

아래 기준이 29절의 개정 화면 중 탐색·질문·닫기 동작을 대체한다. Phase 1의 제외 목록은 당시 범위이며, 현재 사용자 요청으로 승인된 기능은 이 절을 따른다.

```text
상단: 연결 상태 · LIVE · 사용자                 닫기: X
메뉴: 공장 모니터링 | 기간 조회 | 5분 예측    자동 갱신 일시정지

공장 지도                      설비를 누르면 전체 센서 목록
  7개 논리 설비                설비 → 세부 묶음 → 센서명·값·단위
  대표 센서는 고정             주증기·발전 지표는 그림 밖의 별도 분류
  장식 움직임                  실제 설치 위치는 미확인

AI 도우미: 고정 질문 대상 → 질문 말풍선 → 답변·근거 → 다음 질문
  초안 / 답변 대기 중 닫기 → 확인 → 대기 취소 + 기록 보존
  다른 탭으로 이동 → 확인 → 조회는 계속
  변경 승인 연습은 내부 접기 영역

기간 조회: 센서 + 시작·끝 시각 → 원본 CSV 조회 → 그래프·요약
5분 예측: 재열기 예측값 + 원본 시각 + Naive와 시험 성능 비교
```

- 화면의 게임 표현은 원본 데이터 탐색을 돕는 장식이다. 움직임과 색을 실제 설비 운전·위험도·안전 상태로 설명하지 않는다.
- 설비별 전체 센서 목록과 세부 묶음은 원본 이름 기준이다. 모든 118개 센서에 접근할 수 있고, 이름·세부 묶음·원본 식별자로 전체 검색할 수 있어야 한다.
- 주증기 지표 5개는 과열기 그룹에서 분리한다. 다른 센서를 선택했을 때 대표 온도가 같은 측정값인 듯 보이지 않도록 센서명·단위와 선택 경로를 함께 표시한다.
- 센서 선택은 입력창과 긴 드롭다운 대신 읽을 수 있는 목록으로 제공한다. 목록에 센서명·현재값·단위·선택 상태를 표시하고 추가 종류 필터는 접는다.
- AI는 질문과 답변을 순서대로 표시한다. 처리 시간·원본 시각·근거는 답변과 함께 두며, 다양한 질문 예시는 접어 두고 센서에 맞는 예시를 먼저 보인다.
- 닫기 버튼은 X만 보이고 접근 가능한 이름은 `도우미 닫기`로 제공한다. Escape도 같은 확인 경로를 거친다. 단순 탐색이 대화를 지우거나 새 모델 호출을 만들지 않는다.
- 상단 연결 상태와 자동 갱신 조작은 작은 화면에서도 줄바꿈할 수 있어야 한다. 이력을 보려는 사용자가 현재값의 반복 표를 내려가며 찾지 않도록 별도 기간 조회 화면을 제공한다.
- 기간 그래프는 원본 관측점·원본 시각을 사용한다. 결측 구간은 선으로 연결하지 않고, 표시 점을 줄인 경우 원본 행 수와 표시한 점 수를 구분한다.
