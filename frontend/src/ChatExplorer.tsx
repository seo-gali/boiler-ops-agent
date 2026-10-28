import { useEffect, useRef, useState } from 'react';
import type { Registry, Reading } from './types';
import { sensorArea, sensorAreas, sensorCategories } from './sensor-catalog';
import { formatValue, useTelemetry } from './telemetry';
import { SensorTrend } from './SensorTrend';
import './sensor-trend.css';

type Path = { equipment: string | null; area: string | null; tag: string | null };
const qualityName = (reading?: Reading) => !reading ? '데이터 대기' : reading.quality === 'valid' ? '원본 수신' : reading.quality === 'missing' ? '원본 결측' : '파싱 오류';

export function ChatExplorer({ registry, tag, version, pending, canAsk, onSelect, onAsk }: {
  registry: Registry; tag: string | null; version: number; pending: boolean; canAsk: boolean;
  onSelect: (tag: string) => boolean; onAsk: (question: string, equipment: string, tag: string) => void;
}) {
  const [path, setPath] = useState<Path>({ equipment: null, area: null, tag: null });
  const [trendTag, setTrendTag] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const telemetry = useTelemetry();
  useEffect(() => {
    const sensor = registry.sensors[tag ?? ''];
    setPath({ equipment: sensor?.equipment ?? null, area: sensor ? sensorArea(sensor) : null, tag: sensor?.tag ?? null });
    setTrendTag(null);
  }, [registry, tag, version]);
  const categories = sensorCategories(registry);
  const group = categories.find(item => item.id === path.equipment);
  const areas = sensorAreas(group?.sensors ?? []);
  const area = areas.find(item => item.name === path.area);
  const sensor = registry.sensors[path.tag ?? ''];
  const reading = sensor ? telemetry.current?.sensors[sensor.tag] : undefined;
  function browse(next: Path) {
    setPath(next); setTrendTag(null);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function pick(next: string) {
    if (pending || !onSelect(next)) return;
    const sensor = registry.sensors[next];
    browse({ equipment: sensor.equipment, area: sensorArea(sensor), tag: next });
  }
  return <section className="chat-explorer chat-message chat-assistant" aria-label="대화 안 데이터 탐색">
    <span className="chat-speaker">데이터 탐색</span>
    <nav className="explorer-path" aria-label="데이터 탐색 경로">
      <button onClick={() => browse({ equipment: null, area: null, tag: null })} aria-current={!group ? 'step' : undefined}>전체 설비</button>
      {group && <><span aria-hidden="true">›</span><button onClick={() => browse({ equipment: group.id, area: null, tag: null })} aria-current={!area ? 'step' : undefined}>{group.name}</button></>}
      {group && area && <><span aria-hidden="true">›</span><button onClick={() => browse({ equipment: group.id, area: area.name, tag: null })} aria-current={!sensor ? 'step' : undefined}>{area.name}</button></>}
    </nav>
    <h3 ref={heading} tabIndex={-1}>{sensor ? sensor.label : area ? '어떤 센서를 볼까요?' : group ? '어느 부분을 살펴볼까요?' : '어떤 설비가 궁금한가요?'}</h3>
    {!sensor && <div className="explorer-choices">
      {!group ? categories.map(item => <button key={item.id} aria-label={`${item.name} · ${item.sensors.length}개 센서`} onClick={() => browse({ equipment: item.id, area: null, tag: null })}><span>{item.name}</span><small>{item.sensors.length}개 센서 <span aria-hidden="true">→</span></small></button>)
        : !area ? areas.map(item => <button key={item.name} aria-label={`${item.name} · ${item.sensors.length}개 센서`} onClick={() => browse({ equipment: group.id, area: item.name, tag: null })}><span>{item.name}</span><small>{item.sensors.length}개 센서 <span aria-hidden="true">→</span></small></button>)
          : area.sensors.map(item => {
            const value = telemetry.current?.sensors[item.tag];
            return <button key={item.tag} disabled={pending} aria-label={`${item.label} 선택`} onClick={() => pick(item.tag)}><span>{item.label}<small>{qualityName(value)}</small></span><b>{formatValue(value)} <small>{item.unit ?? '단위 미확인'}</small></b></button>;
          })}
    </div>}
    {sensor && <div key={sensor.tag} className="explorer-sensor">
      <span className="chat-meta">현재 수신값</span>
      <p className="explorer-value"><strong>{formatValue(reading)}</strong> {sensor.unit ?? '단위 미확인'}<span>{qualityName(reading)}</span></p>
      <p className="chat-meta">원본 시각 {telemetry.current?.source_time ?? '데이터 대기'} · {telemetry.status}</p>
      <details><summary>원본 근거</summary><dl><dt>센서 Tag</dt><dd>{sensor.tag}</dd><dt>원본값</dt><dd>{reading ? reading.raw || '결측' : '데이터 대기'}</dd><dt>원본 식별자</dt><dd>{sensor.source_tag ?? '정의 없음'}</dd><dt>단위 근거</dt><dd>{sensor.unit_basis}</dd></dl></details>
      <details open={trendTag === sensor.tag} onToggle={event => setTrendTag(event.currentTarget.open ? sensor.tag : null)}><summary>최근 2분 추이·원본값</summary>{trendTag === sensor.tag && <SensorTrend key={sensor.tag} tag={sensor.tag} unit={sensor.unit} />}</details>
      <div className="explorer-actions"><button disabled={!canAsk || pending} onClick={() => onAsk('선택한 센서의 현재값은?', sensor.equipment, sensor.tag)}>AI로 현재값 설명</button><button disabled={!canAsk || pending} onClick={() => onAsk('최근 값은 어떻게 변하고 있나요?', sensor.equipment, sensor.tag)}>AI로 변화 설명</button></div>
    </div>}
    {pending && <p className="note">답변을 기다리는 동안 둘러볼 수 있습니다. 센서 변경은 답변이 끝나거나 대기를 취소한 뒤 가능합니다.</p>}
  </section>;
}
