import type { Registry, Sensor } from './types';
import { formatValue, useTelemetry } from './telemetry';
import { SensorTrend } from './SensorTrend';
import { sensorArea, sensorCategoryName } from './sensor-catalog';
import './sensor-trend.css';

export function SensorInspector({ registry, sensor, onAsk, canAsk }: { registry: Registry; sensor: Sensor | null; onAsk: () => void; canAsk: boolean }) {
  const telemetry = useTelemetry();
  const reading = sensor ? telemetry.current?.sensors[sensor.tag] : undefined;
  const item = registry.equipment.find(item => item.id === sensor?.equipment);
  return <section className="inspector" aria-label="센서 상세">
    {sensor ? <div className="sensor-detail">
      <span className="tag-kind">{sensor.measurement_type === 'target' ? '목표값' : sensor.measurement_type === 'control' ? '제어 관측값' : '측정값'}</span>
      <header className="sensor-detail-heading"><h2>{sensorCategoryName(sensor, registry)}</h2><button className="primary-button" disabled={!canAsk} onClick={onAsk}>이 센서에 질문</button></header>
      <p className="note">{sensorCategoryName(sensor, registry)} › {sensorArea(sensor)}</p>{item && <p className="note equipment-description">{item.description}</p>}
      {!canAsk && <p className="note">AI 질문이 진행 중입니다. AI 탭에서 답변을 기다리거나 대기를 취소하세요.</p>}
      <h3 data-testid="inspector-tag">{sensor.tag}</h3><div className="value-with-unit"><strong className="current-value" data-testid="inspector-value">{formatValue(reading)}</strong><span>{sensor.unit ?? '단위 정의 없음'}</span></div>
      <p className="quiet">{reading?.quality === 'valid' ? '수신한 원본값' : reading?.quality === 'missing' ? '원본 결측' : reading?.quality === 'parse_error' ? '숫자 해석 오류' : '데이터 대기 중'}</p>
      <dl><dt>원본 시각</dt><dd data-testid="inspector-time">{telemetry.current?.source_time ?? '—'}</dd><dt>원본값</dt><dd>{reading?.raw || '결측'}</dd><dt>단위 근거</dt><dd>{sensor.unit_basis}</dd><dt>원본 식별자</dt><dd>{sensor.source_tag ?? '정의 없음'}</dd><dt>설비 연결</dt><dd>{sensor.mapping_confidence === 'verified-by-tag' ? '원본 센서명 기준' : '논리 그룹 기준'}</dd></dl>
      <p className="note">{sensor.description} 숫자는 환산하지 않았습니다. 화면 위치는 논리 좌표입니다.</p>
      <SensorTrend key={sensor.tag} tag={sensor.tag} unit={sensor.unit} />
    </div> : <div className="empty-inspector"><h2>센서를 선택하세요</h2><p>계통도의 설비 또는 위 분류를 고르면 현재값과 변화 추이를 볼 수 있습니다.</p></div>}
  </section>;
}
