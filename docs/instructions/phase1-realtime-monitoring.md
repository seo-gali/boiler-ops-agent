# Phase 1 — 데이터 재생과 실시간 화면

`data/raw/`의 CSV를 한 행씩 재생하고 Kafka → API 서버 → 브라우저까지 전달되는지 확인한다. Kafka 토픽은 데이터 순서를 확인할 수 있도록 단일 파티션을 사용한다.

센서를 구분하는 원본 열 이름(Tag)은 끝의 공백까지 보존한다. 단위는 센서 목록인 Registry가 원본 정의서에서 읽은 값을 사용한다. 정의가 없는 단위만 미확인으로 두고 숫자를 임의로 환산하지 않는다. 값이 비어 있는 경우와 숫자로 읽지 못한 경우도 구분한다.

## 구현과 검증

- Python: FastAPI, Uvicorn, aiokafka, python-dotenv. `uv.lock`으로 고정한다.
- Frontend: React, TypeScript, Vite, Three.js, React Three Fiber. `frontend/package-lock.json`으로 고정한다.
- 전체 연결 검사(E2E)는 Playwright Chromium, 별도 Kafka Docker 컨테이너와 실제 CSV를 사용한다. 개별 수정의 검사 범위와 패키지 변경 승인은 [코딩 기준](../../CODING_STANDARDS.md)을 따른다.
- `artifacts/e2e/phase1/`에 입력 파일의 해시, 받은 데이터, 검사 결과와 화면을 저장한다. 해시는 같은 파일로 검사했는지 확인하는 식별값이다.
- 주요 수치·설비 이름표·센서 상세가 같은 값을 보여주는지 확인한다. 순서·원본 시각·연결 상태·수신 중단 표시·재연결도 확인하며, 3D를 사용할 수 없을 때 HTML 목록으로 센서를 고를 수 있어야 한다.

## 실패 경로

설정 누락, CSV의 중복 열 이름·열 개수 오류·시각 누락과 값 읽기 실패를 숨기지 않는다. Kafka·WebSocket이 끊기거나 수신 순서가 중복·역전됐을 때도 상태를 표시한다.

느린 수신자, 잘못된 센서 이름·그림 좌표, 3D 생성 실패와 선택 값 불일치도 검사한다.

Phase 1~7은 구현되어 있다. 초기 단계의 검증 기록과 현재 기능의 유지·보완 검증을 구분한다.
