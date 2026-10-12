import { apiFetch, useSession } from './session';
import { useEffect, useRef, useState } from 'react';
import { TraceDetails } from './RecordsPanel';

type Answer = { trace_id: string; equipment: string; assessment: string; answer: string; explanation: string; limitations: string; status: string; model: string };
type QueryError = { message: string; detail?: string; traceId?: string };

// 서버 모델 호출 2회 × 180초와 응답 전달 여유
const QUERY_TIMEOUT_MS = 390_000;
// backend/app/domain/analysis.py의 LOOPS 실제값·목표값 대응
const targetQuestions: Record<string, { equipment: string; question: string }> = {
  '최종재열기 입구 온도 평균값': { equipment: 'reheater', question: '목표 온도와 얼마나 차이 나나요?' },
  '실제 출력값': { equipment: 'generation', question: '목표 발전량과 얼마나 차이 나나요?' },
};

function responseError(status: number, data: { detail?: unknown } | null): QueryError {
  const detail = data?.detail;
  const record = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail as Record<string, unknown> : null;
  const message = status === 429 ? '조회 요청이 많습니다. 잠시 기다린 뒤 다시 조회하세요.'
    : status === 401 ? '세션이 종료되었습니다. 다시 로그인하세요.'
      : status === 403 ? 'AI 조회 권한을 확인하세요. 운영자 계정이 필요합니다.'
        : status === 422 ? '질문 대상과 입력 내용을 확인한 뒤 다시 조회하세요.'
          : status === 503 ? 'AI 모델이 답변을 완료하지 못했습니다. 모델 실행 상태를 확인한 뒤 다시 조회하세요.'
            : `답변을 받지 못했습니다. 서버 연결을 확인한 뒤 다시 조회하세요. (HTTP ${status})`;
  return { message, detail: typeof detail === 'string' ? detail : typeof record?.error === 'string' ? record.error : undefined,
    traceId: typeof record?.trace_id === 'string' ? record.trace_id : undefined };
}

export function AgentPanel({ equipment, tag, onTrace, onPending }: { equipment: string | null; tag: string | null; onTrace: (trace: string | null) => void; onPending?: (pending: boolean) => void }) {
  const { user } = useSession();
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); }; }, []);
  const [question, setQuestion] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<QueryError | null>(null);
  const [pending, setPending] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => { onPending?.(pending); }, [pending, onPending]);
  const suggestions = ['선택한 센서의 현재값은?', '최근 값은 어떻게 변하고 있나요?'];
  const targetQuestion = tag ? targetQuestions[tag] : undefined;
  if (targetQuestion?.equipment === equipment) suggestions.push(targetQuestion.question);
  if (equipment === 'reheater') suggestions.push('재열기 온도의 5분 예측은 얼마나 믿을 수 있나요?');
  const canAsk = user.role === 'operator' && Boolean(equipment && tag) && !pending && Boolean(question.trim());

  async function ask() {
    if (!canAsk || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const started = Date.now();
    const askedQuestion = question.trim();
    setPending(true); setElapsedSeconds(0); setError(null); setNotice(''); setAnswer(null); setSubmittedQuestion(askedQuestion); onTrace(null);
    const interval = window.setInterval(() => {
      if (active.current && request.current === controller) setElapsedSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    const timeout = window.setTimeout(() => controller.abort('timeout'), QUERY_TIMEOUT_MS);
    try {
      const response = await apiFetch('/api/agent/query', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: askedQuestion, equipment, tag }) });
      const data = await response.json().catch(() => null);
      controller.signal.throwIfAborted();
      if (!active.current || request.current !== controller) return;
      if (!response.ok) { setError(responseError(response.status, data)); return; }
      if (!data || typeof data.answer !== 'string' || typeof data.trace_id !== 'string') throw new Error('서버 응답 형식이 올바르지 않습니다.');
      setAnswer(data);
      if (equipment === 'reheater') onTrace(data.trace_id);
    } catch (caught) {
      if (!active.current || request.current !== controller) return;
      if (controller.signal.reason === 'timeout') {
        setError({ message: '6분 30초 안에 답변을 받지 못해 브라우저 대기를 종료했습니다. 서버의 모델 작업은 계속될 수 있습니다. 잠시 후 다시 조회하세요.' });
      } else if (controller.signal.reason === 'cancelled') {
        setNotice('브라우저에서 답변 기다리기를 취소했습니다. 질문은 보존되며 서버의 모델 작업은 계속될 수 있습니다.');
      } else {
        setError({ message: '답변을 받지 못했습니다. 서버 연결과 모델 실행 상태를 확인한 뒤 다시 조회하세요.', detail: caught instanceof Error ? caught.message : String(caught) });
      }
    } finally {
      window.clearInterval(interval); window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        if (active.current) { setPending(false); setElapsedSeconds(Math.floor((Date.now() - started) / 1000)); }
      }
    }
  }

  return <section id="agent" tabIndex={-1} className="agent panel" aria-label="AI Agent">
    <div className="panel-heading">
      <div><h2>선택 센서에 질문하기</h2><p className="note">관측 근거를 읽어 답합니다. 실제 설비를 조작하지 않습니다.</p></div>
    </div>
    <div className="agent-content">
      <div className="agent-target" data-testid="agent-target"><span className="quiet">질문 대상 센서</span><p><strong>{tag ?? '선택한 센서 없음'}</strong></p></div>
      {(!equipment || !tag) && <p role="status">목록이나 계통도에서 센서를 선택하고 AI 질문을 여세요.</p>}
      {user.role !== 'operator' && <p className="note">AI 조회는 운영자 계정에서 사용할 수 있습니다.</p>}
      <div className="question-suggestions" aria-label="질문 예시">{suggestions.map(text => <button key={text} disabled={pending || !tag} onClick={() => { setQuestion(text); document.getElementById('agent-question')?.focus(); }}>{text}</button>)}</div>
      <label htmlFor="agent-question">질문</label>
      <textarea id="agent-question" spellCheck={false} maxLength={1000} placeholder="질문을 입력하거나 위 예시를 선택하세요." value={question} disabled={pending} onChange={event => setQuestion(event.target.value)} aria-describedby="agent-query-help" />
      <p id="agent-query-help" className="quiet">질문을 작성한 뒤 조회 버튼을 누르면 로컬 AI 모델에 요청합니다.</p>
      <div className="agent-actions">
        <button className="primary-button" disabled={!canAsk} onClick={() => void ask()}>{pending ? '답변 기다리는 중…' : error || notice ? '다시 조회' : 'Agent 조회'}</button>
        {pending && <button onClick={() => request.current?.abort('cancelled')}>기다리기 취소</button>}
      </div>
      <p role="status" data-testid="agent-status">{pending ? '서버에 질문을 보냈습니다. 답변을 기다리고 있습니다.' : answer ? `${elapsedSeconds}초 만에 조회가 완료되었습니다. 아래 답변과 근거를 확인하세요.` : notice}</p>
      {pending && <div className="agent-waiting" data-testid="agent-waiting">
        <p><span data-testid="agent-elapsed">{elapsedSeconds}초 경과</span> · 최대 대기 6분 30초</p>
        <p className="note">로컬 모델은 기기에 따라 몇 분 걸릴 수 있습니다. 다른 센서를 살펴봐도 이 질문은 유지됩니다.</p>
        <p className="quiet">기다리기를 취소해도 서버 작업은 계속될 수 있습니다.</p>
      </div>}
      {error && <div data-testid="agent-error"><p role="alert">{error.message}</p>{error.detail && <details><summary>오류 상세</summary><p className="agent-explanation">{error.detail}</p></details>}{error.traceId && <TraceDetails traceId={error.traceId} />}</div>}
      {answer && <div data-testid="agent-answer">
        <h3>질문에 대한 답변</h3>
        <p className="quiet">질문: {submittedQuestion}</p>
        <p className="agent-answer-text">{answer.answer}</p>
        <p className="agent-explanation">{answer.explanation}</p>
        <p className="note">{answer.limitations}</p>
        <TraceDetails traceId={answer.trace_id} />
        <span className="quiet"> · {answer.model} · {answer.status}</span>
      </div>}
    </div>
  </section>;
}
