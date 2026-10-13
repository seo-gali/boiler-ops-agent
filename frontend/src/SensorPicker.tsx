import { useEffect, useRef, useState } from 'react';
import type { Registry } from './types';
import { formatValue, useTelemetry } from './telemetry';
import { sensorArea, sensorAreas, sensorCategories, sensorCategoryName } from './sensor-catalog';
import './sensor-catalog.css';

export function SensorPicker({ registry, selected, onSelect }: { registry: Registry; selected: string | null; onSelect: (tag: string) => void }) {
  const telemetry = useTelemetry();
  const current = registry.sensors[selected ?? ''];
  const categories = sensorCategories(registry);
  const [category, setCategory] = useState(current?.equipment ?? categories[0]?.id ?? '');
  const [area, setArea] = useState('all');
  const lastPicked = useRef<string | null>(null);
  useEffect(() => {
    if (lastPicked.current === selected) { lastPicked.current = null; return; }
    setCategory(current?.equipment ?? categories[0]?.id ?? '');
    setArea('all');
  }, [selected, current, registry]);

  const group = categories.find(item => item.id === category);
  const sensors = group?.sensors ?? [];
  const areas = sensorAreas(sensors);
  const visible = sensors.filter(sensor => area === 'all' || sensorArea(sensor) === area);
  const selectedInGroup = visible.some(sensor => sensor.tag === selected);
  const pick = (tag: string) => { if (!tag) return; lastPicked.current = tag; onSelect(tag); };

  return <section className="sensor-picker catalog-picker" aria-label="센서 찾아보기">
    <label htmlFor="sensor-group">1. 어떤 설비를 볼까요?</label>
    <select id="sensor-group" value={category} onChange={event => { setCategory(event.target.value); setArea('all'); }}>
      {categories.map(item => <option key={item.id} value={item.id}>{item.name} · {item.sensors.length}개 센서</option>)}
    </select>
    <div className="catalog-areas">
      <span className="catalog-step">2. 세부 묶음을 고르세요</span>
      <div role="group" aria-label={`${group?.name ?? '설비'} 세부 묶음`}>
        <button type="button" aria-pressed={area === 'all'} aria-label={`${group?.name ?? '설비'} 모든 세부 묶음`} onClick={() => setArea('all')}>전체 <span>{sensors.length}</span></button>
        {areas.map(item => <button type="button" key={item.name} aria-pressed={area === item.name}
          aria-label={`세부 묶음 ${item.name} · ${item.sensors.length}개 센서`} onClick={() => setArea(item.name)}>{item.name} <span>{item.sensors.length}</span></button>)}
      </div>
    </div>
    <div className="catalog-results-heading"><label htmlFor="sensor-select">3. 센서를 고르세요</label><span role="status">{visible.length}개 센서</span></div>
    <select id="sensor-select" value={selectedInGroup ? selected ?? '' : ''} onChange={event => pick(event.target.value)} aria-describedby="sensor-choice-help" data-testid="sensor-select">
      <option value="" disabled>확인할 센서를 선택하세요</option>
      {sensorAreas(visible).map(item => <optgroup key={item.name} label={item.name}>{item.sensors.map(sensor => {
        const reading = telemetry.current?.sensors[sensor.tag];
        const value = reading?.quality === 'missing' ? '결측' : formatValue(reading);
        return <option key={sensor.tag} value={sensor.tag}>{sensor.label} · {value} {sensor.unit ?? '단위 미확인'}</option>;
      })}</optgroup>)}
    </select>
    <p id="sensor-choice-help" className="catalog-choice-help">센서를 선택하면 아래에서 현재값과 최근 2분의 기록을 확인할 수 있습니다.</p>
    {current && <p className="catalog-selection" data-testid="sensor-selection-path"><b>현재 선택</b><span>{sensorCategoryName(current, registry)} › {sensorArea(current)} › {current.label}</span></p>}
  </section>;
}
