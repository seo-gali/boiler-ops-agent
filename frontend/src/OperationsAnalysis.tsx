import { useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from './session';
import { sensorAreas, sensorCategories } from './sensor-catalog';
import type { Registry } from './types';
import './history.css';

type Metadata = { first_time: string | null; last_time: string | null; row_count: number; time_basis: string; timezone_offset: string | null };
type HistoryPoint = { source_row: number; source_time: string; raw: string; value: number | null; quality: 'valid' | 'missing' | 'parse_error'; gap_before: boolean };
type HistoryRange = { tag: string; unit: string | null; start: string; end: string; original_count: number; sample_count: number; valid_count: number; missing_count: number; parse_error_count: number; min: number | null; max: number | null; downsampled: boolean; points: HistoryPoint[] };
type ChartSeries = { data: HistoryRange; label: string; color: string };
const colors = ['#356b49', '#245f93', '#9b4425', '#75519b', '#926318', '#24777a', '#9e426c'];
const number = (value: number | null) => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 3 });
const localInput = (value: string) => value.replace(' ', 'T').slice(0, 19);
const wallTime = (value: string) => Date.parse(localInput(value) + 'Z');
const readableTime = (value: string) => localInput(value).replace('T', ' ');
const qualityName = (point: HistoryPoint) => point.quality === 'valid' ? '유효' : point.quality === 'missing' ? '결측' : '파싱 실패';

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '조회에 실패했습니다. 입력값과 서버 상태를 확인하세요. (HTTP ' + response.status + ')');
  return data as T;
}

function nearestPoint(points: HistoryPoint[], at: number): number {
  let low = 0, high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (wallTime(points[middle].source_time) < at) low = middle + 1;
    else high = middle;
  }
  return low > 0 && at - wallTime(points[low - 1].source_time) <= wallTime(points[low].source_time) - at ? low - 1 : low;
}

function HistoryChart({ series }: { series: ChartSeries[] }) {
  const container = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  const [pointIndex, setPointIndex] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const descriptionId = useId(), detailId = useId();
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(260, element.clientWidth)));
    setWidth(Math.max(260, element.clientWidth)); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = 310, left = width < 440 ? 57 : 72, right = 20, top = 28, bottom = 64;
  const reference = series.find(item => item.data.points.length)?.data;
  const points = reference?.points ?? [];
  const hasValidSample = series.some(item => item.data.points.some(point => point.value !== null));
  const minima = series.flatMap(item => item.data.min === null ? [] : [item.data.min]);
  const maxima = series.flatMap(item => item.data.max === null ? [] : [item.data.max]);
  const min = minima.length ? Math.min(...minima) : 0, max = maxima.length ? Math.max(...maxima) : 0;
  const padding = min === max ? Math.max(Math.abs(min) * .01, 1) : (max - min) * .08;
  const yMin = min - padding, yMax = max + padding;
  const start = reference ? wallTime(reference.start) : 0, end = reference ? wallTime(reference.end) : 0;
  const xAt = (time: number) => left + (time - start) / Math.max(1, end - start) * (width - left - right);
  const x = (point: HistoryPoint) => xAt(wallTime(point.source_time));
  const y = (value: number) => top + (yMax - value) / (yMax - yMin) * (height - top - bottom);
  const tickCount = width < 600 ? 2 : 4;
  const point = pointIndex === null ? null : points[pointIndex] ?? null;
  const selectedTime = point ? wallTime(point.source_time) : null;
  const details = selectedTime === null ? [] : series.flatMap(item => {
    if (!item.data.points.length) return [];
    const observation = item.data.points[nearestPoint(item.data.points, selectedTime)];
    return [{ ...item, observation }];
  });
  const unit = reference?.unit ?? '단위 미확인';
  function selectAt(clientX: number) {
    const rectangle = svg.current?.getBoundingClientRect();
    if (!rectangle || !rectangle.width || !points.length) return;
    const position = Math.min(width - right, Math.max(left, (clientX - rectangle.left) / rectangle.width * width));
    const time = start + (position - left) / (width - left - right) * (end - start);
    setKeyboard(false); setPointIndex(nearestPoint(points, time));
  }
  return <div className="history-chart" ref={container}>
    {hasValidSample ? <>
      <ul className="history-legend" aria-label="그래프 센서">{series.map(item => <li key={item.data.tag}><span className="history-color" style={{ background: item.color }} />{item.label}</li>)}</ul>
      <div className="history-plot" onPointerLeave={event => { if (event.pointerType === 'mouse' && document.activeElement !== svg.current) setPointIndex(null); }}>
        <svg ref={svg} viewBox={'0 0 ' + width + ' ' + height} role="img" tabIndex={0}
          aria-label={series.map(item => item.label).join(', ') + ' 기간별 원본 관측 그래프 · ' + unit}
          aria-describedby={descriptionId + (point ? ' ' + detailId : '')} data-testid="history-chart" data-unit={reference?.unit ?? ''}
          onPointerMove={event => selectAt(event.clientX)}
          onPointerDown={event => { svg.current?.focus({ preventScroll: true }); selectAt(event.clientX); }}
          onFocus={() => { setKeyboard(true); setPointIndex(index => index ?? 0); }}
          onBlur={() => setPointIndex(null)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
            event.preventDefault(); setKeyboard(true);
            if (event.key === 'Escape') { setPointIndex(null); return; }
            setPointIndex(index => event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.min(points.length - 1, Math.max(0, (index ?? 0) + (event.key === 'ArrowLeft' ? -1 : 1))));
          }}>
          <desc>같은 단위의 원본 관측값을 비교합니다. 결측이나 파싱 실패가 있는 구간의 선은 연결하지 않습니다.</desc>
          <text x={left} y={15} className="history-axis-unit">{unit}</text>
          {Array.from({ length: 5 }, (_, index) => {
            const value = yMin + (yMax - yMin) * index / 4;
            return <g key={index}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="history-gridline" /><text x={left - 9} y={y(value) + 4} textAnchor="end" className="history-axis-label">{number(value)}</text></g>;
          })}
          {Array.from({ length: tickCount }, (_, index) => {
            const at = start + (end - start) * index / (tickCount - 1);
            const label = new Date(at).toISOString();
            const position = left + (width - left - right) * index / (tickCount - 1);
            return <g key={index}><line x1={position} x2={position} y1={height - bottom} y2={height - bottom + 5} className="history-gridline" /><text x={position} y={height - bottom + 21} textAnchor={index === 0 ? 'start' : index === tickCount - 1 ? 'end' : 'middle'} className="history-axis-label"><tspan x={position}>{label.slice(0, 10)}</tspan><tspan x={position} dy={16}>{label.slice(11, 19)}</tspan></text></g>;
          })}
          {series.map(item => {
            let path = '', connected = false;
            for (const observation of item.data.points) {
              if (observation.value === null) { connected = false; continue; }
              path += (connected && !observation.gap_before ? 'L' : 'M') + x(observation).toFixed(2) + ',' + y(observation.value).toFixed(2) + ' ';
              connected = true;
            }
            return <g key={item.data.tag}>
              {path && <path d={path} className="history-series" style={{ stroke: item.color }} data-testid="history-series" data-tag={item.data.tag} />}
              {item.data.points.filter(observation => observation.value !== null).map(observation => <circle key={observation.source_row} cx={x(observation)} cy={y(observation.value!)} r={item.data.sample_count < 100 ? 2.5 : 1.25} className="history-observation" style={{ fill: item.color }} />)}
            </g>;
          })}
          {point && <g className="history-crosshair" aria-hidden="true">
            <line x1={x(point)} x2={x(point)} y1={top} y2={height - bottom} />
            {details.filter(item => item.observation.value !== null).map(item => <circle key={item.data.tag} cx={x(item.observation)} cy={y(item.observation.value!)} r={4.5} style={{ fill: item.color }} />)}
          </g>}
        </svg>
        {point && <div className="history-tooltip" id={detailId} data-testid="history-tooltip" aria-live={keyboard ? 'polite' : 'off'}
          style={{ left: Math.min(Math.max(0, x(point) + 12), Math.max(0, width - 330)) / width * 100 + '%' }}>
          <strong>{readableTime(point.source_time)}</strong>
          {details.map(item => <div className="history-tooltip-reading" key={item.data.tag}>
            <span className="history-tooltip-name"><span className="history-color" style={{ background: item.color }} />{item.label}</span>
            <b data-testid="history-tooltip-value" data-tag={item.data.tag} data-source-row={item.observation.source_row} data-quality={item.observation.quality}>{item.observation.raw || '빈 값'} <small>{item.data.unit ?? '단위 미확인'}</small></b>
            <span className="history-tooltip-source">{qualityName(item.observation)} · CSV {item.observation.source_row}행{item.observation.gap_before ? ' · 앞 구간 결측' : ''}{item.observation.source_time !== point.source_time ? ' · ' + readableTime(item.observation.source_time) : ''}</span>
          </div>)}
        </div>}
      </div>
      <p className="history-chart-note" id={descriptionId}>그래프에 마우스를 올리거나 터치하면 원본 값을 볼 수 있습니다. 키보드는 그래프에서 ←·→, Home·End를 사용하세요. 가로축은 CSV 원본 시각, 세로축은 {unit}입니다.</p>
    </> : <p className="history-empty" role="status">{series.every(item => item.data.valid_count === 0) ? '이 기간에는 유효한 숫자 관측이 없습니다. 결측·파싱 실패 수를 확인하세요.' : '선택한 표본에 유효한 숫자 관측이 없습니다. 기간을 줄여 원본 관측을 확인하세요.'}</p>}
  </div>;
}

export function OperationsAnalysis({ registry }: { registry: Registry }) {
  const firstTag = registry.equipment.find(item => item.id === 'reheater')?.primary_tag ?? Object.keys(registry.sensors)[0] ?? '';
  const groups = sensorCategories(registry);
  const [equipment, setEquipment] = useState(registry.sensors[firstTag]?.equipment ?? groups[0]?.id ?? '');
  const [candidate, setCandidate] = useState(firstTag);
  const [tags, setTags] = useState<string[]>(firstTag ? [firstTag] : []);
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [data, setData] = useState<HistoryRange[] | null>(null);
  const [error, setError] = useState<string | null>(null), [failures, setFailures] = useState<{ tag: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false), [metadataBusy, setMetadataBusy] = useState(true);
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setMetadataBusy(true); setError(null);
    apiFetch('/api/history/metadata', { signal: controller.signal }).then(responseData<Metadata>).then(source => {
      if (controller.signal.aborted) return;
      setMetadata(source);
      if (source.first_time && source.last_time) {
        setStart(localInput(source.first_time));
        setEnd(new Date(Math.min(wallTime(source.first_time) + 24 * 60 * 60 * 1000, wallTime(source.last_time))).toISOString().slice(0, 19));
      }
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '기간 정보를 읽지 못했습니다.'); }).finally(() => { if (!controller.signal.aborted) setMetadataBusy(false); });
    return () => controller.abort();
  }, [metadataAttempt]);
  useEffect(() => () => request.current?.abort(), []);
  function clearResult() { request.current?.abort(); request.current = null; setBusy(false); setData(null); setError(null); setFailures([]); }
  function addSensor() {
    if (!candidate || tags.includes(candidate)) return;
    clearResult(); setTags(current => [...current, candidate]);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!metadata || !tags.length || !start || !end) return;
    clearResult();
    if (start > end) { setError('종료 시각은 시작 시각보다 빠를 수 없습니다.'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true);
    const offset = metadata.timezone_offset ?? '';
    const results = await Promise.allSettled(tags.map(async tag => {
      const query = new URLSearchParams({ tag, start: start + offset, end: end + offset, limit: '1000' });
      return responseData<HistoryRange>(await apiFetch('/api/history/range?' + query, { signal: controller.signal }));
    }));
    if (controller.signal.aborted) return;
    const ranges: HistoryRange[] = [], errors: { tag: string; message: string }[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') ranges.push(result.value);
      else errors.push({ tag: tags[index], message: result.reason instanceof Error ? result.reason.message : '원본 데이터 조회에 실패했습니다.' });
    });
    setData(ranges); setFailures(errors); setBusy(false); request.current = null;
  }
  const candidates = groups.find(group => group.id === equipment)?.sensors ?? [];
  const unitGroups = new Map<string, ChartSeries[]>();
  for (const range of data ?? []) {
    const key = range.unit ?? 'unconfirmed:' + range.tag;
    const items = unitGroups.get(key) ?? [];
    items.push({ data: range, label: registry.sensors[range.tag]?.label ?? range.tag, color: colors[tags.indexOf(range.tag) % colors.length] });
    unitGroups.set(key, items);
  }
  return <section tabIndex={-1} className="analysis panel history-panel" aria-label="기간 조회">
    <div className="panel-heading"><div><span className="eyebrow">SOURCE HISTORY</span><h2>원하는 기간의 원본 데이터</h2><p className="note">비교할 센서를 추가하고 시작·종료 시각을 고르세요.</p></div><span className="quiet">CSV 원본 관측</span></div>
    <div className="history-content">
      {metadataBusy ? <p role="status">원본 데이터의 조회 가능 기간을 확인하고 있습니다…</p> : metadata?.first_time && metadata.last_time ? <p className="history-availability" data-testid="history-availability">조회 가능 기간 <b>{readableTime(metadata.first_time)} ~ {readableTime(metadata.last_time)}</b><span>{metadata.row_count.toLocaleString()}개 시각 · {metadata.time_basis}{metadata.timezone_offset ? ' (' + metadata.timezone_offset + ')' : ''}</span></p> : metadata && <p role="status">원본 CSV에 관측 행이 없습니다.</p>}
      {!metadata && !metadataBusy && <button className="history-retry" onClick={() => setMetadataAttempt(value => value + 1)}>기간 정보 다시 읽기</button>}
      <form className="history-form" onSubmit={submit}>
        <fieldset className="history-sensor-field"><legend>비교할 센서</legend>
          <div className="history-sensor-controls">
            <div><label htmlFor="history-equipment">조회 설비</label><select id="history-equipment" value={equipment} onChange={event => { const group = groups.find(item => item.id === event.target.value); setEquipment(event.target.value); setCandidate(group?.sensors[0]?.tag ?? ''); }}>{groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.sensors.length}개 센서</option>)}</select></div>
            <div><label htmlFor="history-sensor">조회 센서</label><select id="history-sensor" value={candidate} onChange={event => setCandidate(event.target.value)}>{sensorAreas(candidates).map(area => <optgroup key={area.name} label={area.name}>{area.sensors.map(sensor => <option key={sensor.tag} value={sensor.tag}>{sensor.label} · {sensor.unit ?? '단위 미확인'}</option>)}</optgroup>)}</select></div>
            <button className="history-add" type="button" onClick={addSensor} disabled={!candidate || tags.includes(candidate)}>센서 추가 <span aria-hidden="true">＋</span></button>
          </div>
          <div className="history-selection-heading"><span data-testid="history-selection-count">선택한 센서 {tags.length}개</span><span>같은 단위끼리 한 그래프에서 비교합니다.</span></div>
          <ul className="history-selected-sensors" aria-label="조회할 센서" data-testid="history-selected-sensors">{tags.map((tag, index) => <li key={tag} data-tag={tag}><span className="history-color" style={{ background: colors[index % colors.length] }} /><span>{registry.sensors[tag]?.label ?? tag}<small>{registry.sensors[tag]?.unit ?? '단위 미확인'}</small></span><button type="button" aria-label={(registry.sensors[tag]?.label ?? tag) + ' 조회에서 제외'} onClick={() => { clearResult(); setTags(current => current.filter(item => item !== tag)); }}>×</button></li>)}</ul>
          {!tags.length && <p className="history-no-selection">위에서 센서를 골라 추가하세요. 서로 다른 설비의 센서도 함께 조회할 수 있습니다.</p>}
        </fieldset>
        <div><label htmlFor="history-start">시작 시각</label><input id="history-start" type="datetime-local" step="1" value={start} required onChange={event => { clearResult(); setStart(event.target.value); }} /></div>
        <div><label htmlFor="history-end">종료 시각</label><input id="history-end" type="datetime-local" step="1" value={end} required onChange={event => { clearResult(); setEnd(event.target.value); }} /></div>
        <button className="primary-button" type="submit" disabled={busy || metadataBusy || !metadata?.row_count || !tags.length}>{busy ? '원본 조회 중…' : '기간 조회'}</button>
      </form>
      {busy && <p role="status">선택한 {tags.length}개 센서의 기간 데이터를 읽고 있습니다. 센서나 기간을 바꾸면 현재 조회가 취소됩니다.</p>}
      {error && <p className="history-error" role="alert">{error}</p>}
      {failures.map(failure => <p className="history-error" role="alert" key={failure.tag}>{registry.sensors[failure.tag]?.label ?? failure.tag}: {failure.message}</p>)}
      {!data && !busy && !error && metadata && <p className="history-empty">기본 기간은 처음 하루입니다. 조회 버튼을 누르면 센서마다 최대 1,000개의 실제 관측을 표시합니다.</p>}
      {!!data?.length && <div className="history-result" data-testid="history-result">
        <h3>{data.length === 1 ? registry.sensors[data[0].tag]?.label ?? data[0].tag : data.length + '개 센서의 원본 데이터'}</h3>
        {[...unitGroups].map(([key, series]) => <section className="history-unit-group" key={key} aria-label={(series[0].data.unit ?? '단위 미확인') + ' 원본 그래프'}>
          {data.length > 1 && <h4 className="history-unit-heading">{series[0].data.unit ?? '단위 미확인'} <span>{series.length}개 센서{series[0].data.unit === null ? ' · 단위가 확인되지 않아 별도로 표시합니다.' : ''}</span></h4>}
          <div className="history-stat-grid">{series.map(item => <div className="history-sensor-stats" key={item.data.tag} data-tag={item.data.tag}>
            {data.length > 1 && <h4><span className="history-color" style={{ background: item.color }} />{item.label}</h4>}
            <div className="history-stats"><span>최솟값 <b>{number(item.data.min)} <small>{item.data.unit ?? '단위 미확인'}</small></b></span><span>최댓값 <b>{number(item.data.max)} <small>{item.data.unit ?? '단위 미확인'}</small></b></span><span>원본 관측 <b>{item.data.original_count.toLocaleString()}개</b></span><span>유효 / 결측 / 파싱 실패 <b>{item.data.valid_count.toLocaleString()} / {item.data.missing_count.toLocaleString()} / {item.data.parse_error_count.toLocaleString()}</b></span></div>
            <p className="history-sampling" data-testid="history-sampling">그래프 표본 {item.data.sample_count.toLocaleString()}개 / 원본 {item.data.original_count.toLocaleString()}개{item.data.downsampled ? ' · 원본 행에서 균등 선택했습니다. 평균값을 만들지 않습니다.' : ' · 이 기간의 모든 관측을 표시합니다.'} 최솟값·최댓값과 개수는 전체 조회 구간 기준입니다.</p>
          </div>)}</div>
          {series.every(item => item.data.original_count === 0) ? <p className="history-empty" role="status" data-testid="history-empty">선택한 기간에 원본 관측이 없습니다. 조회 가능 기간을 확인하세요.</p> : <HistoryChart series={series} />}
          {series.filter(item => item.data.sample_count > 0).map(item => <details className="history-table" key={item.data.tag}><summary>{data.length > 1 ? item.label + ' · ' : ''}그래프에 표시한 원본 표본 {item.data.sample_count.toLocaleString()}개 보기</summary><div className="table-scroll"><table><caption>{item.label} · CSV 원본 값 · 원본 행 번호로 역추적</caption><thead><tr><th scope="col">원본 시각</th><th scope="col">원본 값 ({item.data.unit ?? '단위 미확인'})</th><th scope="col">품질</th><th scope="col">CSV 행</th></tr></thead><tbody>{item.data.points.map(point => <tr key={point.source_row}><td>{readableTime(point.source_time)}</td><td>{point.raw || '빈 값'}</td><td>{qualityName(point)}{point.gap_before ? ' · 앞 구간 결측' : ''}</td><td>{point.source_row}</td></tr>)}</tbody></table></div></details>)}
        </section>)}
      </div>}
    </div>
  </section>;
}
