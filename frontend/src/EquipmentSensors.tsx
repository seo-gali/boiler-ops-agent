import { useEffect, useMemo, useState } from 'react';
import type { Equipment, Registry, Sensor } from './types';
import { formatValue, useTelemetry } from './telemetry';
import { sensorArea, sensorAreas } from './sensor-catalog';
import './equipment-sensors.css';

export function EquipmentSensors({ item, registry, selected, onSelect, onClose, onInspect }: { item: Equipment; registry: Registry; selected: string | null; onSelect: (tag: string) => void; onClose: () => void; onInspect?: (tag: string) => void }) {
  const telemetry = useTelemetry();
  const [query, setQuery] = useState('');
  const sensors = useMemo(() => Object.values(registry.sensors).filter(sensor => sensor.equipment === item.id), [registry, item.id]);
  useEffect(() => setQuery(''), [item.id]);
  const search = query.trim().toLocaleLowerCase();
  const filtered = sensors.filter(sensor => `${sensor.label} ${sensor.source_tag ?? ''} ${sensorArea(sensor)}`.toLocaleLowerCase().includes(search));
  const areas = sensorAreas(filtered);
  const current = sensors.find(sensor => sensor.tag === selected);
  const describeQuality = (sensor: Sensor) => {
    const quality = telemetry.current?.sensors[sensor.tag]?.quality;
    return quality === 'valid' ? '원본 수신' : quality === 'missing' ? '결측' : quality === 'parse_error' ? '읽기 오류' : '수신 대기';
  };
  return <section className="equipment-sensors" aria-label={`${item.name} 센서 목록`} data-testid="equipment-sensors" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header><div><span className="equipment-list-kicker">SENSOR INVENTORY</span><h3>{item.name} <small>{sensors.length}개 센서</small></h3></div><button className="equipment-popup-close" aria-label={`${item.name} 센서 목록 닫기`} onClick={onClose}>×</button></header>
    <p className="equipment-list-description">{item.description}</p>
    <label className="equipment-list-search"><span>이 설비에서 찾기</span><input type="search" value={query} placeholder="센서명·부위·원본 식별자" onChange={event => setQuery(event.target.value)} /></label>
    <div className="equipment-list-meta"><span>{filtered.length} / {sensors.length}개</span><span>원본 시각 {telemetry.current?.source_time ?? '수신 대기'}</span></div>
    <div className="equipment-list-scroll">
      {!filtered.length && <p role="status">찾는 센서가 없습니다. 다른 이름이나 부위로 검색해 보세요.</p>}
      {areas.map(area => <section className="equipment-area" key={area.name}><h4>{area.name} <span>{area.sensors.length}</span></h4><ul>{area.sensors.map(sensor => <li key={sensor.tag}><button className="equipment-sensor-row" aria-label={`설비 센서 ${sensor.tag}`} aria-pressed={selected === sensor.tag} onClick={() => onSelect(sensor.tag)}>
        <span className="equipment-sensor-title">{sensor.label}{selected === sensor.tag && <b>선택됨</b>}</span>
        <span className="equipment-sensor-reading"><strong>{formatValue(telemetry.current?.sensors[sensor.tag])}</strong><span>{sensor.unit ?? '단위 미확인'}</span><small data-quality={telemetry.current?.sensors[sensor.tag]?.quality ?? 'waiting'}>{describeQuality(sensor)}</small></span>
      </button></li>)}</ul></section>)}
    </div>
    <footer><p>원본 센서 이름으로 묶었습니다. 그림의 위치는 논리 배치입니다.</p>{onInspect && <button className="equipment-inspect" onClick={() => onInspect(current?.tag ?? item.primary_tag)}>{current ? '선택 센서 자세히 보기' : '대표 센서 자세히 보기'} →</button>}</footer>
  </section>;
}
