import { apiFetch } from './session';
import { useEffect, useState } from 'react';
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

export function SensorTrend({ tag, unit }: { tag: string; unit?: string | null }) {
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
  const initial = history?.tag === tag && history.runId === runId ? history.points : [];
  const merged: Point[] = [];
  let left = 0, right = 0;
  while (left < initial.length || right < events.length) {
    const stored = initial[left], event = events[right];
    if (!event || stored && stored.sequence < event.sequence) {
      merged.push(initial[left++]);
    } else {
      if (stored?.sequence === event.sequence) left++;
      right++;
      const reading = event.sensors[tag];
      if (reading) merged.push({ sequence: event.sequence, source_time: event.source_time, ...reading });
      else if (stored?.sequence === event.sequence) merged.push(stored);
    }
  }
  const received = merged.slice(-120);
  const error = history?.tag === tag && history.runId === runId ? history.error : null;

  const latestTime = sourceTimeMilliseconds(received.at(-1)?.source_time ?? '');
  const points = received.filter(point => {
    const age = latestTime - sourceTimeMilliseconds(point.source_time);
    return age >= 0 && age <= 120_000;
  });
  const valid = points.filter(point => point.quality === 'valid' && point.value !== null && Number.isFinite(point.value));
  const change = points.length > 1 && valid.length === points.length ? points.at(-1)!.value! - points[0].value! : null;
  return <div className="trend" data-testid="sensor-trend" data-window-seconds="120">
    <div className="trend-heading"><strong>최근 2분 관측</strong><span>{points.length}개 관측</span></div>
    {error && <p role="alert">{error}</p>}
    {change !== null && <p className="trend-change">{change === 0 ? '관측값 변화 없음' : <>첫 관측 대비 <strong>{change.toLocaleString('ko-KR', { maximumSignificantDigits: 4, signDisplay: 'exceptZero' })} {unit ?? ''}</strong></>}</p>}
    {points.length ? <table data-testid="sensor-trend-source-table"><caption className="sr-only">{tag} · 최근 2분 원본 기록</caption><thead><tr><th scope="col">원본 시각</th><th scope="col">원본값 · {unit ?? '단위 미확인'}</th><th scope="col">상태</th></tr></thead><tbody>{points.map(point => <tr key={point.sequence} data-testid="sensor-trend-source-row"><td><time dateTime={point.source_time}>{point.source_time.replace('T', ' ')}</time></td><td>{point.raw || '결측'}</td><td>{point.quality === 'valid' ? '수신' : point.quality === 'parse_error' ? '읽기 오류' : '결측'}</td></tr>)}</tbody></table> : !error && <p className="quiet">관측을 기다리고 있습니다.</p>}
    {valid.length !== points.length && <p className="trend-window-note">결측·읽기 오류가 포함돼 변화량을 계산하지 않았습니다.</p>}
  </div>;
}
