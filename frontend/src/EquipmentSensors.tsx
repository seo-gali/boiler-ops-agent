import { useEffect, useMemo, useState } from 'react';
import type { Equipment, Registry, Sensor } from './types';
import { formatValue, useTelemetry } from './telemetry';
import { sensorArea, sensorAreas } from './sensor-catalog';
import './equipment-sensors.css';

export function EquipmentSensors({ item, registry, selected, onSelect, onClose, onInspect }: { item: Equipment; registry: Registry; selected: string | null; onSelect: (tag: string) => void; onClose: () => void; onInspect?: (tag: string) => void }) {
  const telemetry = useTelemetry();
  const [area, setArea] = useState('all');
  const sensors = useMemo(() => Object.values(registry.sensors).filter(sensor => sensor.equipment === item.id), [registry, item.id]);
  useEffect(() => setArea('all'), [item.id]);
  const filtered = sensors.filter(sensor => area === 'all' || sensorArea(sensor) === area);
  const areas = sensorAreas(sensors);
  const shownAreas = sensorAreas(filtered);
  const current = sensors.find(sensor => sensor.tag === selected);
  const valid = sensors.filter(sensor => telemetry.current?.sensors[sensor.tag]?.quality === 'valid');
  const missing = sensors.filter(sensor => telemetry.current?.sensors[sensor.tag]?.quality === 'missing').length;
  const parseErrors = sensors.filter(sensor => telemetry.current?.sensors[sensor.tag]?.quality === 'parse_error').length;
  const onlyZeros = valid.length > 0 && valid.every(sensor => telemetry.current?.sensors[sensor.tag]?.value === 0);
  const allFeederValuesZero = item.id === 'feeders' && valid.length === sensors.length && onlyZeros;
  const describeQuality = (sensor: Sensor) => {
    const quality = telemetry.current?.sensors[sensor.tag]?.quality;
    return quality === 'valid' ? '원본 수신' : quality === 'missing' ? '결측' : quality === 'parse_error' ? '읽기 오류' : '수신 대기';
  };
  return <section className="equipment-sensors" aria-label={`${item.name} 센서 목록`} data-testid="equipment-sensors" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header><div><span className="equipment-list-kicker">SENSOR INVENTORY</span><h3>{item.name} <small>{sensors.length}개 센서</small></h3></div><button className="equipment-popup-close" aria-label={`${item.name} 센서 목록 닫기`} onClick={onClose}>×</button></header>
    <p className="equipment-list-description">{item.description}</p>
    <label className="equipment-list-choice"><span>세부 묶음</span><select value={area} onChange={event => setArea(event.target.value)} aria-label={`${item.name} 세부 묶음 선택`}>
      <option value="all">전체 · {sensors.length}개 센서</option>{areas.map(group => <option key={group.name} value={group.name}>{group.name} · {group.sensors.length}개 센서</option>)}
    </select></label>
    <label className="equipment-list-choice"><span>센서 선택</span><select value={filtered.some(sensor => sensor.tag === selected) ? selected ?? '' : ''} onChange={event => { if (event.target.value) onSelect(event.target.value); }} aria-label={`${item.name} 센서 선택`} data-testid="equipment-sensor-select">
      <option value="" disabled>확인할 센서를 선택하세요</option>{shownAreas.map(group => <optgroup key={group.name} label={group.name}>{group.sensors.map(sensor => <option key={sensor.tag} value={sensor.tag}>{sensor.label} · {sensor.unit ?? '단위 미확인'}</option>)}</optgroup>)}
    </select></label>
    <div className="equipment-list-meta"><span>{filtered.length} / {sensors.length}개</span><span>원본 시각 {telemetry.current?.source_time ?? '수신 대기'}</span></div>
    <p className="equipment-list-quality" data-testid="equipment-sensor-quality">수신 {valid.length}개 · 결측 {missing}개 · 파싱 오류 {parseErrors}개{onlyZeros && !allFeederValuesZero && <span>수신한 원본값이 모두 0입니다. 결측이 아닙니다.</span>}</p>
    {allFeederValuesZero && <p className="equipment-list-zero-note" data-testid="feeder-zero-note">값은 수신 중이며 현재 원본값이 모두 0입니다. 결측이 아닙니다. 다른 시각의 값은 기간 조회에서 확인하세요.</p>}
    <div className="equipment-list-scroll">
      {!filtered.length && <p role="status">이 묶음에 표시할 센서가 없습니다.</p>}
      {shownAreas.map(area => <section className="equipment-area" key={area.name}><h4>{area.name} <span>{area.sensors.length}</span></h4><ul>{area.sensors.map(sensor => <li key={sensor.tag}><button className="equipment-sensor-row" aria-label={`설비 센서 ${sensor.tag}`} aria-pressed={selected === sensor.tag} onClick={() => onSelect(sensor.tag)}>
        <span className="equipment-sensor-title">{sensor.label}{selected === sensor.tag && <b>선택됨</b>}</span>
        <span className="equipment-sensor-reading"><strong>{formatValue(telemetry.current?.sensors[sensor.tag])}</strong><span>{sensor.unit ?? '단위 미확인'}</span><small data-quality={telemetry.current?.sensors[sensor.tag]?.quality ?? 'waiting'}>{describeQuality(sensor)}</small></span>
      </button></li>)}</ul></section>)}
    </div>
    <footer><p>원본 센서 이름으로 묶었습니다. 그림의 위치는 논리 배치입니다.</p>{onInspect && <button className="equipment-inspect" onClick={() => onInspect(current?.tag ?? item.primary_tag)}>{current ? '선택 센서 자세히 보기' : '대표 센서 자세히 보기'} →</button>}</footer>
  </section>;
}
