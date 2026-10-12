import { useEffect, useState } from 'react';
import type { Registry } from './types';

export function SensorPicker({ registry, selected, onSelect }: { registry: Registry; selected: string | null; onSelect: (tag: string) => void }) {
  const sensors = Object.values(registry.sensors);
  const current = registry.sensors[selected ?? ''];
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const group = current?.equipment ?? '';
  const groups = [...registry.equipment.map(item => ({ id: item.id, name: item.name })), { id: 'generation', name: '발전 지표' }, { id: 'unmapped', name: '미분류' }]
    .map(item => ({ ...item, sensors: sensors.filter(sensor => sensor.equipment === item.id) })).filter(item => item.sensors.length);
  useEffect(() => { setSearch(''); setKind('all'); }, [group]);
  const inGroup = sensors.filter(sensor => sensor.equipment === group);
  const filtered = inGroup.filter(sensor => (kind === 'all' || sensor.measurement_type === kind) && `${sensor.label} ${sensor.source_tag ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
  return <div className="sensor-picker">
    <label htmlFor="sensor-group">설비 분류</label>
    <select id="sensor-group" value={group} onChange={event => {
      const id = event.target.value;
      const primary = registry.equipment.find(item => item.id === id)?.primary_tag;
      const tag = primary ?? sensors.find(sensor => sensor.equipment === id)?.tag;
      if (tag) onSelect(tag);
    }}><option value="" disabled>분류를 선택하세요</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name} · {item.sensors.length}개 센서</option>)}</select>
    {group && <>
      <div className="sensor-filters"><div><label htmlFor="sensor-kind">센서 종류</label><select id="sensor-kind" value={kind} onChange={event => setKind(event.target.value)}><option value="all">전체 종류</option><option value="measurement">측정값</option><option value="control">제어 관측값</option><option value="target">목표값</option></select></div>
        <div><label htmlFor="sensor-search">이 분류에서 검색</label><input id="sensor-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="센서명 또는 원본 식별자" /></div></div>
      <label htmlFor="workspace-sensor-select">선택 센서</label><select id="workspace-sensor-select" value={selected ?? ''} onChange={event => onSelect(event.target.value)}>
        {current && !filtered.some(sensor => sensor.tag === current.tag) && <option value={current.tag} disabled>{current.label} (현재 선택 · 검색 결과 밖)</option>}
        {filtered.map(sensor => <option key={sensor.tag} value={sensor.tag}>{sensor.label} · {sensor.unit ?? '단위 정의 없음'}</option>)}
      </select><p className="note" role="status">{filtered.length ? `${inGroup.length}개 중 ${filtered.length}개 표시` : '검색 결과가 없습니다. 검색어나 종류를 바꿔보세요.'}</p>
    </>}
  </div>;
}
