import { useEffect, useState } from 'react';
import { apiFetch } from './session';
import { Skeleton } from './Skeleton';

type AuditRow = { id: number; created_at: number; proposal_id: string; event: string; payload: Record<string, unknown> };
type Trace = { trace_id: string; elapsed_ms: number; model: string; request: { question: string; tag: string }; calls: { id: string; tool: string; result: unknown }[]; error?: string };
const events: Record<string, string> = { proposed: '제안 생성', approved: '사용자 승인', executed: '변경 실행', rejected: '제안 거절' };
const toolNames: Record<string, string> = { get_boiler_status: '데이터 수신 상태', get_equipment_status: '설비의 현재 관측', get_sensor_history: '최근 원본 기록', get_operating_targets: '목표값 비교', get_current_controls: '관련 조작값 관측', get_deviation_summary: '최근 변화 분석', get_temperature_forecast: '5분 뒤 온도 예측' };
const fieldNames: Record<string, string> = {
  id: '식별자', source_trace_id: '조회 근거', trace_id: '조회 기록', intent: '요청 내용', model: '사용 모델', recommendation: '제안 방향', action: '변경',
  parameter: '연습 항목', old_value: '변경 전', requested_value: '요청한 값', new_value: '변경 후', expected_revision: '기준 버전', revision: '변경 버전', policy_id: '적용 정책',
  created_at: '생성 시각', expires_at: '만료 시각', status: '처리 상태', actor: '처리자', confirm: '사용자 확인',
  equipment: '설비', tag: '원본 Tag', source_time: '원본 시각', sensors: '센서 관측', units: '단위', unit: '단위', unit_basis: '단위 출처',
  value: '관측값', raw: '원본값', quality: '수신 상태', error: '오류', points: '원본 관측', sequence: '수신 순서',
  current: '현재값', rate_per_source_minute: '분당 변화', baseline_count: '비교 관측 수', baseline_mean: '이전 평균', baseline_stddev: '이전 표준편차', z_score: '평균과의 차이',
  interpretation: '해석 기준', comparison: '실제값·목표값 비교', actual_tag: '실제값 센서', target_tag: '목표값 센서', actual_value: '실제값', target_value: '목표값', actual_quality: '실제값 상태', target_quality: '목표값 상태',
  control_policy: '조작 근거', causality: '제어 인과관계', allowed_range: '허용 범위', target: '예측 대상', input_value: '예측 입력값', prediction: '예측값', predictions: '모델별 예측',
  forecast_time: '예측 시각', horizon_minutes: '예측 간격(분)', selected_model: '선택 모델', validation: '검증 성능', test: '시험 성능',
  naive: '현재값 유지 기준', linear_ar: '선형 모델', mae: '평균 절대 오차', rmse: '제곱평균제곱근 오차', samples: '평가 관측 수',
  training_cutoff: '학습 종료', validation_cutoff: '검증 종료', dataset_sha256: '원본 데이터 지문', beats_naive_on_test: '기준 모델 대비 개선', advisory: '활용 범위', limitations: '한계',
  kafka: '데이터 연결', stale: '수신 지연', rejected_events: '거부된 관측 수', causality_basis: '인과관계 근거',
};
const names: Record<string, string> = { increase: '한 단계 높이기', decrease: '한 단계 낮추기', hold: '유지', pending: '승인 대기', executed: '실행 완료', rejected: '거절', valid: '정상 수신', missing: '결측', parse_error: '읽기 오류', unverified: '미확인', naive: '현재값 유지 기준', linear_ar: '선형 모델' };

function RecordValue({ value, field = '' }: { value: unknown; field?: string }) {
  if (value === null || value === undefined) return <span className="quiet">미확인</span>;
  if (Array.isArray(value)) return value.length ? <ol className="record-items">{value.map((item, index) => <li key={index}><RecordValue value={item} field={field} /></li>)}</ol> : <span className="quiet">관측 없음</span>;
  if (typeof value === 'object') return <dl className="record-fields">{Object.entries(value).map(([key, item]) => <div key={key}>
    <dt>{fieldNames[key] ?? key}</dt><dd>{item !== null && typeof item === 'object' ? <details><summary>{Array.isArray(item) ? `${item.length}개 항목 보기` : '항목 보기'}</summary><RecordValue value={item} field={key} /></details> : <RecordValue value={item} field={key} />}</dd>
  </div>)}</dl>;
  if (typeof value === 'boolean') return <span>{value ? '확인됨' : '아니요'}</span>;
  if ((field === 'created_at' || field === 'expires_at') && typeof value === 'number') return <time dateTime={new Date(value * 1000).toISOString()}>{new Date(value * 1000).toLocaleString('ko-KR')}</time>;
  const translated = ['action', 'status', 'quality', 'actual_quality', 'target_quality', 'selected_model', 'causality'].includes(field);
  return <span>{translated ? names[String(value)] ?? String(value) : value === '' ? '빈 값' : String(value)}</span>;
}

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
    {open && <>{error ? <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>다시 조회</button></p> : !trace ? <div className="trace-loading"><Skeleton /></div> : <>
      <p className="quiet">{trace.model} · {(trace.elapsed_ms / 1000).toFixed(1)}초</p><p>{trace.request.question}</p>
      {trace.error && <p role="alert">조회에 실패한 기록입니다. {trace.error}</p>}
      {trace.calls.map(call => <details className="tool-record" key={call.id}><summary>{toolNames[call.tool] ?? call.tool}</summary><RecordValue value={call.result} /></details>)}
      <p className="note">기록 ID {trace.trace_id}</p>
    </>}</>}
  </details>;
}

export function AuditPanel({ active }: { active: boolean }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState(true);
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
    {pending && <Skeleton />}{error && <p role="alert">{error} <button onClick={() => setVersion(value => value + 1)}>다시 조회</button></p>}
    {!pending && !error && !rows.length && <p role="status">아직 승인·변경 기록이 없습니다. 승인 연습에서 제안을 만들면 이곳에 표시됩니다.</p>}
    <ol className="audit-list">{rows.map(row => <li key={row.id}><div className="record-heading"><h3>{events[row.event] ?? row.event}</h3><time>{new Date(row.created_at * 1000).toLocaleString('ko-KR')}</time></div>
      {typeof row.payload.old_value === 'number' && <p className="record-change"><span>{row.payload.old_value}</span><span aria-label="변경 후">→</span><strong>{String(row.payload.new_value ?? row.payload.requested_value ?? '—')}</strong></p>}
      {typeof row.payload.intent === 'string' && <p className="record-intent">{row.payload.intent}</p>}
      <details className="record-metadata"><summary>요청·처리 정보</summary><RecordValue value={row.payload} /><p className="record-id">제안 {row.proposal_id}</p></details></li>)}</ol>
    {more && <button disabled={pending} onClick={() => setCursor(rows.at(-1)?.id ?? 0)}>다음 기록 불러오기</button>}
  </section>;
}
