# Phase 7 — 앱 리소스 자동 무결성 검사

검증일: 2026-11-21. 공개 배포나 기존 DB·시크릿 변경 없이 로컬 코드·격리된 시험 자원에서 확인했다.

## 변경

- `infra/resource-integrity.json`에 공식 Pretendard v1.3.9, Ollama qwen2.5-coder:7b manifest, Kafka 3.9.1 이미지 digest, 공식 체크섬을 검증한 Caddy·Gitleaks 실행 파일 해시를 고정했다. 패키지 버전과 두 lock 파일은 변경하지 않았다.
- 사용자가 기존 CSV·예측 파일의 검사 후 기준 등록을 명시적으로 승인했다. CSV 50,400행·118개 센서의 구조·시간 순서·기존 원본 지문을 확인하고, 컬럼 정의서와 예측 보고서의 원본 일치를 대조했다. 최초 등록으로 원배포자의 진위를 보장하는 것은 아니다.
- CSV·컬럼 정의서·센서 메타데이터·예측 파일의 실제 읽기 경로에 검증을 연결했다. 누락·불일치를 자동 기준 갱신이나 재학습으로 숨기지 않는다. 검증한 CSV를 사용한 명시적 학습만 새 예측 출력과 `.sha256`을 생성한다.
- Ollama는 시작·모델 호출 시 manifest와 모든 blob의 SHA-256·크기를 검사하고 호출 전 서버의 모델 digest도 대조한다. 잘못된 모델은 추론 전에 중단한다.
- Node 부트스트랩은 실행 중인 앱의 포트를 확인한 뒤 Python frozen 복원을 시작한다. 프런트 pre hook은 lock 기준 npm ci를 사용하고 설치 스크립트와 감사 전송을 끈다.
- 프런트 빌드 결과 전체의 별도 해시 기록과 preview의 시작·요청 검사를 추가했다. 진입 JS·단일 CSS에 SRI를, 지연 JS에는 import map integrity를 적용했다. CSP는 정확한 import map 해시만 추가로 허용한다. Caddy 실행 도구와 HTTPS 검사도 검증된 빌드·실행 파일을 사용한다.

새 버전을 설치하거나 실제 CSV·기존 학습 결과·DB·Trace·계정·비밀값을 삭제한 항목은 없다. 무검증 설치본 재사용과 손상된 예측 파일의 자동 재학습 경로를 제거했다.

## 실제 검증

| 실행 | 결과 |
| --- | --- |
| `scripts/check-resource-integrity.py` | 11개 통과. 같은 크기·수정 시각을 가진 CSV 변조, 해시·파일 누락, 모델 blob·manifest 변조, 추론 전 차단, 서버 digest 불일치, 예측 변조, 재설치 전 포트 차단 |
| `scripts/check-frontend-integrity.mjs` | 5개 통과. 실제 preview의 변조·삭제·미등록 파일 503, 전체 빌드 목록 검사, SRI 대조, Chrome에서 전송 중 바뀐 지연 JS의 실행 차단과 정상 모듈 로드 |
| `scripts/verify-resources.py --tools --frontend` | 실제 폰트·메타데이터·CSV·정의서·예측·전체 모델 blob·Caddy·Gitleaks·화면 빌드 검증 통과 |
| `scripts/check-api-performance.py` | 65개 통과. 변경된 CSV는 새 기준을 명시적으로 등록하기 전 거부되며, 원본 값·결측·품질·행·단위·예측 계약 유지 |
| `scripts/check-security.py` / `scripts/check-operational-reliability.py` | 70개 / 20개 통과 |
| `scripts/check-bundle-performance.mjs --reliability --brand` | 설치된 Chrome으로 22개 통과. 로그인 JS 약 245 kB, 나머지는 지연 로딩 유지. 실제 WebGL·키보드·접근성·화면 상태 보존 |
| `scripts/check-https-security.mjs` | 실제 Caddy·Uvicorn·Chrome·WSS의 9개 통과. 임시 CA·자격·SQLite와 합성 관측 사용, 시스템 신뢰 저장소는 변경하지 않음 |
| `scripts/check-client-env.mjs` | 환경 변수 노출 방지 4개 통과 |
| TypeScript·Vite 생산 빌드 | 통과. npm ci로 동일 lock의 91개 패키지를 검증 복원했고 설치 스크립트는 실행하지 않음 |
| 문서 생성·내부 링크·변경 소스 시크릿 검사 | 미리보기 98개·색인 본문 42개·내부 링크 490개 통과. 검증한 Gitleaks로 검사한 텍스트 소스 197개에서 검출 0개 |

검사에서 Vite가 최종 JS를 바꾸기 전 SRI를 계산한 불일치와 모든 JS를 미리 받는 회귀를 발견했다. 최종 출력 파일에서 해시를 계산하고 import map integrity로 지연 로딩을 유지하도록 수정한 뒤 재검증했다. 화면·HTTPS 검증은 수정 후 결과다.

검사 기록은 `artifacts/security/resource-integrity/`, `artifacts/security/frontend-integrity/result.json`, `artifacts/security/integrity-api.json`, `artifacts/security/integrity-security-output.json`, `artifacts/security/integrity-reliability-output.json`, `artifacts/e2e/operational-reliability/result.json`, `artifacts/security/https-verification/result.json`에 남겼다. 생성되는 기준 파일은 공개 정적 루트 밖에 보관한다.

## 미검증과 한계

- `uv run --frozen --reinstall --no-cache --no-build`의 실제 재설치 실행은 자동 승인 검토의 사용량 한도로 실행되지 않았다. 설치된 uv 도움말에서 옵션 지원만 확인했다. 기존 Python 환경으로 실행한 검사를 새 복원의 성공으로 간주하지 않는다.
- Kafka digest는 공식 레지스트리 manifest 바이트와 응답 digest를 대조했지만 이번 변경에서 실제 Kafka 시작·전체 앱 시작 E2E를 다시 실행하지 않았다. 기존 실행 결과를 이번 성공으로 재사용하지 않는다.
- 브라우저의 import map integrity 검증은 설치된 Chrome에서 확인했다. Firefox·Safari와 구형 브라우저는 실행 검증하지 않았다. 직접 Caddy를 시작할 때도 고정 import map의 CSP 해시가 필요하므로 검증 실행기를 사용해야 한다.
- 모든 모델 blob을 읽어 검사하므로 수 GB 모델에서 지연이 늘어난다. 신뢰 기준과 코드·정적 파일을 함께 바꿀 수 있는 호스트 권한의 공격자는 이 해시 검사만으로 막을 수 없다. 공개 배포에서는 신뢰한 릴리스와 읽기 전용 파일 보호가 필요하다.
- OS와 사전 설치한 Python·uv·Node·npm·Docker·Ollama 자체, Docker daemon·디스크·호스트 침해는 이 검사의 신뢰 기반이다. DB·Trace·로그·시크릿은 고정 해시 대상이 아니다. 공개 배포·인증서 운영은 수행하지 않았다.
