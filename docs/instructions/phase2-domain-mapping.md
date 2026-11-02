# Phase 2 — 센서 분류와 단위 연결

원본의 모든 센서 열을 Registry라는 목록에 등록한다. 원본 열 이름(Tag)을 보존하고 소속 설비·구간·역할·분류 근거·그림 좌표를 연결한다. 선택한 센서에서는 최근 기록과 같은 설비의 다른 센서를 찾을 수 있게 한다.

분류는 [registry.py](../../backend/app/domain/registry.py), 단위와 원본 식별자는 [sensor_definitions.json](../../backend/app/domain/sensor_definitions.json)을 기준으로 한다. 현재 118개 센서의 단위가 모두 정의되어 있다. 정의가 없는 새 센서만 단위 미확인으로 둔다. 그림의 좌표는 실제 설치 좌표와 구분한다.

현재 분류는 그림의 7개 설비 110개, 주증기 지표 5개, 발전 지표 2개, 위치 미확인 1개다. `unmapped` 센서의 `mapping_confidence`는 `unverified`, `scene_position`은 null로 유지한다. 주증기·발전 지표도 그림의 설비 좌표를 갖지 않는다.

검사에서는 화면의 센서를 원본 열로 다시 찾을 수 있는지 확인한다. 미확인 위치가 그대로 남는지, 선택한 Tag와 센서 상세가 같은 대상을 가리키는지, 기록의 시각·값이 일치하는지도 확인한다. 전체 Kafka 연결 검사와 개별 수정 검사는 구분한다.

결과 파일은 `artifacts/e2e/phase2/`에 저장한다.
