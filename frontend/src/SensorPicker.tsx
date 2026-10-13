import { useEffect, useRef, useState } from 'react';
import type { Registry, Sensor } from './types';
import { formatValue, useReading } from './telemetry';
import { sensorArea, sensorAreas, sensorCategories, sensorCategoryName } from './sensor-catalog';
import './sensor-catalog.css';

function SensorOption({ sensor, selected, onSelect }: { sensor: Sensor; selected: boolean; onSelect: () => void }) {
  const reading = useReading(sensor.tag);
  return <button className="catalog-sensor" type="button" aria-label={`센서 선택 ${sensor.tag}`} aria-pressed={selected}
    data-testid={`sensor-option-${sensor.tag}`} onClick={onSelect}>
    <span className="catalog-sensor-name">{sensor.label}{selected && <small>선택됨</small>}</span>
    <span className="catalog-sensor-value"><b>{formatValue(reading)}</b><span>{sensor.unit ?? '단위 미확인'}</span></span>
    <span className="catalog-sensor-source">{sensor.source_tag ?? '원본 식별자 미확인'}</span>
  </button>;
}

export function SensorPicker({ registry, selected, onSelect }: { registry: Registry; selected: string | null; onSelect: (tag: string) => void }) {
  const sensors = Object.values(registry.sensors);
  const current = registry.sensors[selected ?? ''];
  const categories = sensorCategories(registry);
  const [category, setCategory] = useState(current?.equipment ?? 'all');
  const [area, setArea] = useState('all');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const lastPicked = useRef<string | null>(null);
  useEffect(() => {
    if (lastPicked.current === selected) { lastPicked.current = null; return; }
    setCategory(current?.equipment ?? 'all');
    setArea('all');
    setSearch(''); setKind('all');
  }, [selected, current]);

  const inCategory = category === 'all' ? sensors : sensors.filter(sensor => sensor.equipment === category);
  const areas = sensorAreas(inCategory);
  const query = search.toLocaleLowerCase().trim();
  const filtered = inCategory.filter(sensor => (area === 'all' || sensorArea(sensor) === area)
    && (kind === 'all' || sensor.measurement_type === kind)
    && `${sensor.label} ${sensor.source_tag ?? ''} ${sensorArea(sensor)} ${sensorCategoryName(sensor, registry)}`.toLocaleLowerCase().includes(query));
  const resultGroups = category === 'all'
    ? categories.map(item => ({ name: item.name, sensors: filtered.filter(sensor => sensor.equipment === item.id) })).filter(item => item.sensors.length)
    : sensorAreas(filtered);
  const categoryName = categories.find(item => item.id === category)?.name ?? '전체 설비';
  const pick = (tag: string) => { lastPicked.current = tag; onSelect(tag); };
  const resetFilters = () => { setSearch(''); setArea('all'); setKind('all'); };

  return <section className="sensor-picker catalog-picker" aria-label="센서 찾아보기">
    <div className="catalog-intro"><strong>센서를 찾아보세요</strong><span>{sensors.length}개 센서를 설비와 원본 이름으로 묶었습니다.</span></div>
    <label htmlFor="sensor-group">1. 어떤 설비를 볼까요?</label>
    <select id="sensor-group" value={category} onChange={event => { setCategory(event.target.value); resetFilters(); }}>
      <option value="all">전체 설비 · {sensors.length}개 센서</option>
      {categories.map(item => <option key={item.id} value={item.id}>{item.name} · {item.sensors.length}개 센서</option>)}
    </select>
    <div className="catalog-search"><label htmlFor="sensor-search">센서 찾기</label>
      <input id="sensor-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="센서명 · 세부 묶음 · 원본 식별자" />
      {category !== 'all' && <button type="button" className="catalog-text-button" onClick={() => { setCategory('all'); setArea('all'); }}>전체 {sensors.length}개에서 찾기</button>}
    </div>
    {category !== 'all' && <div className="catalog-areas">
      <span className="catalog-step">2. 세부 묶음을 고르세요</span>
      <div role="group" aria-label={`${categoryName} 세부 묶음`}>
        <button type="button" aria-pressed={area === 'all'} aria-label={`${categoryName} 모든 세부 묶음`} onClick={() => setArea('all')}>전체 <span>{inCategory.length}</span></button>
        {areas.map(item => <button type="button" key={item.name} aria-pressed={area === item.name}
          aria-label={`세부 묶음 ${item.name} · ${item.sensors.length}개 센서`} onClick={() => setArea(item.name)}>{item.name} <span>{item.sensors.length}</span></button>)}
      </div>
    </div>}
    <details className="catalog-extra-filters"><summary>추가 필터 · 센서 종류{kind !== 'all' ? ' 적용 중' : ''}</summary>
      <label htmlFor="sensor-kind">어떤 값을 볼까요?</label><select id="sensor-kind" value={kind} onChange={event => setKind(event.target.value)}>
        <option value="all">모든 값</option><option value="measurement">측정값 · 온도, 압력, 유량 등</option><option value="control">제어 관측값 · 요청값, 밸브 개도 등</option><option value="target">목표값</option>
      </select><p>기록된 값을 확인합니다. 여기서 설비를 조작하지 않습니다.</p>
    </details>
    <div className="catalog-results-heading"><strong>{category === 'all' ? '센서를 눌러 자세히 보세요' : '3. 센서를 눌러 자세히 보세요'}</strong><span role="status">{filtered.length}개 표시</span></div>
    {filtered.length ? <div className="catalog-results">
      {resultGroups.map(group => <section className="catalog-result-group" key={group.name} aria-label={`${group.name} 센서`}>
        <h3>{group.name}<span>{group.sensors.length}</span></h3>
        {group.sensors.map(sensor => <SensorOption key={sensor.tag} sensor={sensor} selected={sensor.tag === selected} onSelect={() => pick(sensor.tag)} />)}
      </section>)}
    </div> : <div className="catalog-empty" role="status"><strong>찾는 센서가 없습니다.</strong><p>검색어를 줄이거나 다른 세부 묶음을 골라보세요.</p>
      <button type="button" onClick={resetFilters}>검색과 필터 지우기</button>{category !== 'all' && <button type="button" onClick={() => { setCategory('all'); setArea('all'); }}>전체 설비에서 검색</button>}
    </div>}
    {current && <p className="catalog-selection" data-testid="sensor-selection-path"><b>현재 선택</b><span>{sensorCategoryName(current, registry)} › {sensorArea(current)} › {current.label}</span></p>}
    <p className="catalog-location-note">이 묶음은 원본 센서명에 따른 탐색 분류입니다. 실제 설치 좌표는 확인되지 않았습니다.</p>
  </section>;
}
