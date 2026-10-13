import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './session';
import type { Registry } from './types';
import './history.css';

type Metadata = { first_time: string | null; last_time: string | null; row_count: number; time_basis: string; timezone_offset: string | null };
type HistoryPoint = { source_row: number; source_time: string; raw: string; value: number | null; quality: 'valid' | 'missing' | 'parse_error'; gap_before: boolean };
type HistoryRange = { tag: string; unit: string | null; start: string; end: string; original_count: number; sample_count: number; valid_count: number; missing_count: number; parse_error_count: number; min: number | null; max: number | null; downsampled: boolean; points: HistoryPoint[] };
const number = (value: number | null) => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 3 });
const localInput = (value: string) => value.replace(' ', 'T').slice(0, 19);
const wallTime = (value: string) => Date.parse(localInput(value) + 'Z');
const readableTime = (value: string) => localInput(value).replace('T', ' ');

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '조회에 실패했습니다. 입력값과 서버 상태를 확인하세요. (HTTP ' + response.status + ')');
  return data as T;
}

function HistoryChart({ data }: { data: HistoryRange }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(260, element.clientWidth)));
    setWidth(Math.max(260, element.clientWidth)); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = 310, left = width < 440 ? 57 : 72, right = 20, top = 28, bottom = 64;
  const valid = data.points.filter(point => point.value !== null);
  const min = data.min ?? 0, max = data.max ?? 0;
  const padding = min === max ? Math.max(Math.abs(min) * .01, 1) : (max - min) * .08;
  const yMin = min - padding, yMax = max + padding;
  const start = wallTime(data.start), end = wallTime(data.end);
  const x = (point: HistoryPoint) => left + (wallTime(point.source_time) - start) / Math.max(1, end - start) * (width - left - right);
  const y = (value: number) => top + (yMax - value) / (yMax - yMin) * (height - top - bottom);
  let path = '', connected = false;
  for (const point of data.points) {
    if (point.value === null) { connected = false; continue; }
    path += (connected && !point.gap_before ? 'L' : 'M') + x(point).toFixed(2) + ',' + y(point.value).toFixed(2) + ' ';
    connected = true;
  }
  const tickCount = width < 600 ? 2 : 4;
  return <div className="history-chart" ref={container}>
    {valid.length === 0 ? <p className="history-empty" role="status">{data.valid_count === 0 ? '이 기간에는 유효한 숫자 관측이 없습니다. 결측·파싱 실패 수를 확인하세요.' : '선택한 표본에 유효한 숫자 관측이 없습니다. 기간을 줄여 원본 관측을 확인하세요.'}</p> : <>
      <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label={data.tag + ' 기간별 원본 관측 그래프 · ' + (data.unit ?? '단위 미확인') + ' · ' + data.sample_count + '개 표본'} data-testid="history-chart">
        <title>{data.tag} · {readableTime(data.start)}부터 {readableTime(data.end)}까지</title>
        <desc>원본 관측값만 표시합니다. 결측이나 파싱 실패가 있는 구간의 선은 연결하지 않습니다. 표시한 원본 표본은 아래 표에서 확인할 수 있습니다.</desc>
        <text x={left} y={15} className="history-axis-unit">{data.unit ?? '단위 미확인'}</text>
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
        <path d={path} className="history-series" data-testid="history-series" />
        {valid.map(point => <circle key={point.source_row} cx={x(point)} cy={y(point.value!)} r={valid.length < 100 ? 2.5 : 1.5} className="history-observation"><title>{readableTime(point.source_time)} · {point.raw} {data.unit ?? '단위 미확인'} · CSV {point.source_row}행</title></circle>)}
      </svg>
      <p className="history-chart-note">가로축: CSV 원본 시각 · 세로축: {data.unit ?? '단위 미확인'} · 결측 구간은 연결하지 않습니다.</p>
    </>}
  </div>;
}

export function OperationsAnalysis({ registry }: { registry: Registry }) {
  const firstTag = registry.equipment.find(item => item.id === 'reheater')?.primary_tag ?? Object.keys(registry.sensors)[0] ?? '';
  const [tag, setTag] = useState(firstTag);
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [data, setData] = useState<HistoryRange | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  function clearResult() { request.current?.abort(); request.current = null; setBusy(false); setData(null); setError(null); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!metadata || !tag || !start || !end) return;
    clearResult();
    if (start > end) { setError('종료 시각은 시작 시각보다 빠를 수 없습니다.'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true);
    const offset = metadata.timezone_offset ?? '';
    const query = new URLSearchParams({ tag, start: start + offset, end: end + offset, limit: '1000' });
    try {
      const result = await responseData<HistoryRange>(await apiFetch('/api/history/range?' + query, { signal: controller.signal }));
      if (!controller.signal.aborted) setData(result);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '원본 데이터 조회에 실패했습니다.'); }
    finally { if (!controller.signal.aborted) { setBusy(false); request.current = null; } }
  }
  const groups = [...registry.equipment.map(item => ({ id: item.id, name: item.name })), { id: 'main-steam', name: '주증기 지표' }, { id: 'generation', name: '발전 지표' }, { id: 'unmapped', name: '위치 미확인' }];
  return <section tabIndex={-1} className="analysis panel history-panel" aria-label="기간 조회">
    <div className="panel-heading"><div><span className="eyebrow">SOURCE HISTORY</span><h2>원하는 기간의 원본 데이터</h2><p className="note">센서와 시작·종료 시각을 고른 뒤 조회하세요.</p></div><span className="quiet">CSV 원본 관측</span></div>
    <div className="history-content">
      {metadataBusy ? <p role="status">원본 데이터의 조회 가능 기간을 확인하고 있습니다…</p> : metadata?.first_time && metadata.last_time ? <p className="history-availability" data-testid="history-availability">조회 가능 기간 <b>{readableTime(metadata.first_time)} ~ {readableTime(metadata.last_time)}</b><span>{metadata.row_count.toLocaleString()}개 시각 · {metadata.time_basis}{metadata.timezone_offset ? ' (' + metadata.timezone_offset + ')' : ''}</span></p> : metadata && <p role="status">원본 CSV에 관측 행이 없습니다.</p>}
      {!metadata && !metadataBusy && <button className="history-retry" onClick={() => setMetadataAttempt(value => value + 1)}>기간 정보 다시 읽기</button>}
      <form className="history-form" onSubmit={submit}>
        <div className="history-sensor-field"><label htmlFor="history-sensor">조회 센서</label><select id="history-sensor" value={tag} onChange={event => { clearResult(); setTag(event.target.value); }} required>{groups.map(group => <optgroup key={group.id} label={group.name}>{Object.values(registry.sensors).filter(sensor => sensor.equipment === group.id).map(sensor => <option key={sensor.tag} value={sensor.tag}>{sensor.label} · {sensor.unit ?? '단위 미확인'}</option>)}</optgroup>)}</select></div>
        <div><label htmlFor="history-start">시작 시각</label><input id="history-start" type="datetime-local" step="1" value={start} required onChange={event => { clearResult(); setStart(event.target.value); }} /></div>
        <div><label htmlFor="history-end">종료 시각</label><input id="history-end" type="datetime-local" step="1" value={end} required onChange={event => { clearResult(); setEnd(event.target.value); }} /></div>
        <button className="primary-button" type="submit" disabled={busy || metadataBusy || !metadata?.row_count}>{busy ? '원본 조회 중…' : '기간 조회'}</button>
      </form>
      {busy && <p role="status">선택한 기간을 읽고 있습니다. 다른 기간을 입력하면 현재 조회가 취소됩니다.</p>}
      {error && <p className="history-error" role="alert">{error}</p>}
      {!data && !busy && !error && metadata && <p className="history-empty">기본 기간은 처음 하루입니다. 조회 버튼을 누르면 최대 1,000개의 실제 관측을 그래프로 표시합니다.</p>}
      {data && (data.original_count === 0 ? <p className="history-empty" role="status" data-testid="history-empty">선택한 기간에 원본 관측이 없습니다. 조회 가능 기간을 확인하세요.</p> : <div className="history-result" data-testid="history-result">
        <h3>{registry.sensors[data.tag]?.label ?? data.tag}</h3>
        <div className="history-stats"><span>최솟값 <b>{number(data.min)} <small>{data.unit ?? '단위 미확인'}</small></b></span><span>최댓값 <b>{number(data.max)} <small>{data.unit ?? '단위 미확인'}</small></b></span><span>원본 관측 <b>{data.original_count.toLocaleString()}개</b></span><span>유효 / 결측 / 파싱 실패 <b>{data.valid_count.toLocaleString()} / {data.missing_count.toLocaleString()} / {data.parse_error_count.toLocaleString()}</b></span></div>
        <p className="history-sampling" data-testid="history-sampling">그래프 표본 {data.sample_count.toLocaleString()}개 / 원본 {data.original_count.toLocaleString()}개{data.downsampled ? ' · 원본 행에서 균등 선택했습니다. 평균값을 만들지 않습니다.' : ' · 이 기간의 모든 관측을 표시합니다.'} 최솟값·최댓값과 개수는 전체 조회 구간 기준입니다.</p>
        <HistoryChart data={data} />
        <details className="history-table"><summary>그래프에 표시한 원본 표본 {data.sample_count.toLocaleString()}개 보기</summary><div className="table-scroll"><table><caption>CSV 원본 값 · 원본 행 번호로 역추적</caption><thead><tr><th scope="col">원본 시각</th><th scope="col">원본 값 ({data.unit ?? '단위 미확인'})</th><th scope="col">품질</th><th scope="col">CSV 행</th></tr></thead><tbody>{data.points.map(point => <tr key={point.source_row}><td>{readableTime(point.source_time)}</td><td>{point.raw || '빈 값'}</td><td>{point.quality === 'valid' ? '유효' : point.quality === 'missing' ? '결측' : '파싱 실패'}{point.gap_before ? ' · 앞 구간 결측' : ''}</td><td>{point.source_row}</td></tr>)}</tbody></table></div></details>
      </div>)}
    </div>
  </section>;
}
