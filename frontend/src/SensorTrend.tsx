import { apiFetch } from './session';
import { memo, useEffect, useId, useMemo, useState } from 'react';
import { useEvents } from './telemetry';
import type { Reading } from './types';
import './sensor-trend.css';

type Point = Reading & { sequence: number; source_time: string };

function sourceTimeMilliseconds(value: string) {
  const wallTime = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/);
  if (!wallTime) return Date.parse(value);
  // 원본 벽시계 간격 계산
  return Date.UTC(Number(wallTime[1]), Number(wallTime[2]) - 1, Number(wallTime[3]), Number(wallTime[4]), Number(wallTime[5]), Number(wallTime[6] ?? 0), Number((wallTime[7] ?? '').padEnd(3, '0').slice(0, 3)));
}

export const SensorTrend = memo(function SensorTrend({ tag, unit }: { tag: string; unit?: string | null }) {
  const descriptionId = useId();
  const events = useEvents();
  const runId = events.at(-1)?.run_id;
  const gapSequence = events.reduce<number | undefined>((gap, event, index) => index > 0 && event.sequence !== events[index - 1].sequence + 1 ? event.sequence : gap, undefined);
  const [history, setHistory] = useState<{ tag: string; runId?: string; points: Point[]; error: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/sensors/history?tag=${encodeURIComponent(tag)}&limit=120`, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error(`History HTTP ${response.status}`); return response.json(); })
      .then(data => { if (!controller.signal.aborted) setHistory({ tag, runId, points: data.points, error: null }); }).catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setHistory({ tag, runId, points: [], error: String(error) }); });
    return () => controller.abort();
  }, [tag, runId, gapSequence]);
  const received = useMemo(() => {
    const points = new Map<number, Point>();
    if (history?.tag === tag && history.runId === runId) history.points.forEach(point => points.set(point.sequence, point));
    events.forEach(event => {
      if (event.sensors[tag]) points.set(event.sequence, { sequence: event.sequence, source_time: event.source_time, ...event.sensors[tag] });
    });
    return [...points.values()].sort((left, right) => left.sequence - right.sequence).slice(-120);
  }, [events, history, runId, tag]);
  const error = history?.tag === tag && history.runId === runId ? history.error : null;

  const latestTime = sourceTimeMilliseconds(received.at(-1)?.source_time ?? '');
  const points = received.filter(point => {
    const age = latestTime - sourceTimeMilliseconds(point.source_time);
    return age >= 0 && age <= 120_000;
  });
  const valid = points.filter(point => point.quality === 'valid' && point.value !== null && Number.isFinite(point.value));
  const values = valid.map(point => point.value!);
  const min = Math.min(...values), max = Math.max(...values);
  const start = latestTime - 120_000;
  const position = (point: Point) => ({
    x: 5 + (sourceTimeMilliseconds(point.source_time) - start) / 120_000 * 250,
    y: 65 - (point.value! - min) / Math.max(.001, max - min) * 50,
  });
  const paths: string[] = []; let active = '';
  points.forEach(point => {
    if (point.quality !== 'valid' || point.value === null || !Number.isFinite(point.value)) { if (active) paths.push(active); active = ''; return; }
    const { x, y } = position(point);
    active += `${active ? ' L' : 'M'} ${x} ${y}`;
  });
  if (active) paths.push(active);

  return <div className="trend" data-testid="sensor-trend" data-window-seconds="120">
    <span className="eyebrow">최근 2분 · {points.length}개 관측</span>
    {error ? <p role="alert">{error}</p> : valid.length ? <>
      <svg viewBox="0 0 260 80" role="img" aria-label={`${tag} 최근 2분 추이`} aria-describedby={descriptionId}><path d="M5 70H255" stroke="var(--border)" />{paths.map((path, i) => <path key={i} d={path} fill="none" stroke="var(--chart-1)" strokeWidth="2" />)}{valid.map(point => { const { x, y } = position(point); return <circle key={point.sequence} cx={x} cy={y} r="2.4" fill="var(--chart-1)" />; })}</svg>
      <p id={descriptionId} className="note">유효 관측 {valid.length}개, 최솟값 {min}, 최댓값 {max}. 결측·파싱 오류 구간은 연결하지 않습니다.</p>
    </> : <p className="quiet">최근 2분에 유효한 관측값이 없습니다. 결측값을 보간하지 않습니다.</p>}
    <p className="trend-window-note">최신 원본 시각 기준 120초만 표시합니다. 분 단위 자료는 경계값을 포함해 최대 3개 관측이 보입니다.</p>
    {points.length > 0 && <>
      <div className="trend-labels" data-testid="sensor-trend-range"><span>{points[0].source_time}</span><span>{points.at(-1)?.source_time}</span></div>
      <details><summary>추이 원본값 표로 보기</summary><table data-testid="sensor-trend-source-table"><caption>{tag} · 최근 2분 원본 기록</caption><thead><tr><th scope="col">원본 시각</th><th scope="col">원본값 · {unit ?? '단위 정의 없음'}</th><th scope="col">상태</th></tr></thead><tbody>{points.map(point => <tr key={point.sequence} data-testid="sensor-trend-source-row"><td>{point.source_time}</td><td>{point.raw || '결측'}</td><td>{point.quality === 'valid' ? '원본 수신' : point.quality === 'parse_error' ? '파싱 오류' : '결측'}</td></tr>)}</tbody></table></details>
    </>}
  </div>;
});
