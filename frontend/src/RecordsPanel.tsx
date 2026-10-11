import { useEffect, useState } from 'react';
import { apiFetch } from './session';

type AuditRow = { id: number; created_at: number; proposal_id: string; event: string; payload: Record<string, unknown> };
type Trace = { trace_id: string; elapsed_ms: number; model: string; request: { question: string; tag: string }; calls: { id: string; tool: string; result: unknown }[]; error?: string };
const events: Record<string, string> = { proposed: '제안 생성', approved: '사용자 승인', executed: '변경 실행', rejected: '제안 거절' };

export function TraceDetails({ traceId }: { traceId: string }) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(''); setTrace(null);
    apiFetch(`/api/agent/traces/${encodeURIComponent(traceId)}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`조회 근거를 불러오지 못했습니다. HTTP ${response.status}`);
      return response.json();
    }).then(setTrace).catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, [open, traceId, retry]);
  return <details className="trace-reader" onToggle={event => setOpen(event.currentTarget.open)}><summary>조회 근거·도구 기록 보기</summary>
    {open && <>{error ? <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>다시 조회</button></p> : !trace ? <p role="status">근거를 불러오는 중…</p> : <>
      <p className="quiet">{trace.model} · {(trace.elapsed_ms / 1000).toFixed(1)}초</p><p>{trace.request.question}</p>
      {trace.error && <p role="alert">조회에 실패한 기록입니다. {trace.error}</p>}
      {trace.calls.map(call => <details key={call.id}><summary>{call.id} · {call.tool}</summary><pre>{JSON.stringify(call.result, null, 2)}</pre></details>)}
      <p className="note">기록 ID {trace.trace_id}</p>
    </>}</>}
  </details>;
}

export function AuditPanel({ active }: { active: boolean }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setPending(true); setError('');
    apiFetch(`/api/simulator/audit?after_id=${cursor}&limit=20`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`변경 기록을 불러오지 못했습니다. HTTP ${response.status}`);
      return response.json() as Promise<AuditRow[]>;
    }).then(data => { if (!controller.signal.aborted) { setRows(previous => cursor ? [...previous.filter(row => row.id <= cursor), ...data] : data); setMore(data.length === 20); } })
      .catch(error => { if (!controller.signal.aborted) setError(String(error)); }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [active, cursor, version]);
  return <section className="audit-content" aria-label="승인·변경 기록"><h2>내 승인·변경 기록</h2><p className="note">이 계정에서 만든 제안의 기록입니다. 오래된 기록부터 표시합니다.</p>
    <button onClick={() => { setCursor(0); setVersion(value => value + 1); }} disabled={pending}>기록 새로고침</button>
    {pending && <p role="status">기록을 불러오는 중…</p>}{error && <p role="alert">{error} <button onClick={() => setVersion(value => value + 1)}>다시 조회</button></p>}
    {!pending && !error && !rows.length && <p role="status">아직 승인·변경 기록이 없습니다. 승인 연습에서 제안을 만들면 이곳에 표시됩니다.</p>}
    <ol className="audit-list">{rows.map(row => <li key={row.id}><h3>{events[row.event] ?? row.event}</h3><time>{new Date(row.created_at * 1000).toLocaleString('ko-KR')}</time>
      {typeof row.payload.old_value === 'number' && <p>변경값: {row.payload.old_value} → {String(row.payload.new_value ?? row.payload.requested_value ?? '—')}</p>}
      <small>제안 {row.proposal_id}</small><details><summary>원본 기록 상세</summary><pre>{JSON.stringify(row.payload, null, 2)}</pre></details></li>)}</ol>
    {more && <button disabled={pending} onClick={() => setCursor(rows.at(-1)?.id ?? 0)}>다음 기록 불러오기</button>}
  </section>;
}
