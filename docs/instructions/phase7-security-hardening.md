# Phase 7 보안 보완

## 현재 계약

로그인한 사용자가 무엇을 할 수 있고 어떤 기록을 볼 수 있는지 정한다. 로그인 상태를 세션, 로그인한 사용자 정보를 `Principal`이라고 부른다. AI 조회 기록은 Trace, 승인·변경 기록은 Audit다.

```text
Login(user_id, access_key)
  → Session(opaque_id, principal, expires_at)
  → Principal(user_id, role: viewer | operator)

HTTP / WS
  → 접속 주소·서버 주소(Origin·Host), 본문 크기·요청 수 검사
  → 로그인 상태 확인
  → 역할과 기록 소유자 확인

AgentQuery + Principal + 질문 시점의 관측값
  → 동시 모델 작업 수 제한
  → Trace(owner, created_at, context: {run_id, sequence, tag}, snapshot_status)

ProposalRequest(source_trace_id, intent) + Principal
  → 본인의 유효한 근거이며 같은 재생 실행인지 확인
  → 근거는 1회 사용, 제안 값은 승인 요청에서 변경 금지
Decision(confirm, approve, expected_revision) + Principal
  → 소유자·근거 재확인, 값 변경과 Audit를 함께 저장

Kafka 관리자 → 토픽·접근 권한(ACL) 준비
Kafka 생산자 → SASL 인증 + 해당 토픽 쓰기만 허용
Kafka 소비자 → SASL 인증 + 해당 토픽·그룹 읽기만 허용
```

관측은 공통 보일러 데이터이며 인증 사용자가 함께 조회한다. 사용자 질문·Trace·제안·Audit는 사용자별로 분리한다.
operator가 본인의 제안을 직접 승인하는 현재 데모 범위를 유지하며 별도의 2인 승인 절차를 추가하지 않는다.

## 실패 가능성

- 인증 설정 누락, 잘못된 해시/역할/Origin, 빈 자격, 잘못된 로그인, 세션 만료·로그아웃.
- 익명 HTTP/WS, viewer 쓰기, 다른 사용자의 UUID, legacy 소유자 없는 데이터.
- 잘못된 Origin/Host, 쿠키만 있는 교차 출처 변경, 과대 본문과 burst 요청.
- 모델 포화 중 신규 작업·취소 후 남은 작업, WebSocket 전체/사용자별 연결 한도.
- Trace 저장 한도, 제안/Audit 저장 한도, 오류 후 용량 예약 해제, 읽기 페이지 한도.
- Kafka 무자격 연결, 소비자 자격을 이용한 쓰기, 생산자 자격을 이용한 읽기, 오래된 run 시작 이벤트 재전송.
- 오래된/실패한/STALE/다른 사용자/다른 run 근거, 같은 근거의 동시 제안, 생성 도중 run 변경.
- 승인 중 근거 만료/회수/세션 변경, revision 경합·재실행, API 재시작 후 소유권 유지.

## 검증

실제 Kafka·Ollama·FastAPI·브라우저·SQLite를 사용한 E2E로 검증한다. 테스트 자격은 메모리에서 생성하고 결과에 기록하지 않는다.
기존 phase7 아티팩트와 별도로 보안 차단 상태·한도·소유권 관측을 JSON에 남긴다.
새 패키지를 설치하거나 lock을 변경하지 않는다. 실제 `.env`와 자격 파일은 읽거나 덮어쓰지 않는다.
익명·권한 부족·한도 초과는 401/403/429 등의 서버 차단으로 검증한다. 인증 도입 전의 성공 기록을 현재의 접근 허용 계약으로 해석하지 않는다.

## 입력과 오류 경계

- 빈 문자열·공백만 있는 질문과 제안 요청은 모델·쓰기 작업 전에 422로 거부한다. 생략 가능한 필드의 부재와 명시적으로 보낸 빈 값을 구분한다.
- 센서 Tag의 원본 끝 공백은 보존한다. 조회 값이 비어 있다는 이유로 전체 목록으로 바꾸지 않는다.
- 모델·DB 등 내부 실패의 예외 타입·원문을 외부 오류 계약으로 노출하지 않는다. 공개 오류는 안정적인 코드와 짧은 메시지로 구분하며 기존 클라이언트의 detail 계약을 유지한다.
- 동기 저장소 접근은 이벤트 루프를 막지 않게 처리한다. 전체 통합 경계와 개별 입력/오류 검증을 구분하고 DB 삭제·초기화 없이 재현한다.
- HTTP 요청 ID·오류/지연 지표와 CSV 실행 한도, 승인 응답 재확인은 [작업 화면 보완 계약](phase7-workspace.md#승인조회http-관측-보완)을 따른다. 지표 조회도 운영자 권한을 검사한다.
