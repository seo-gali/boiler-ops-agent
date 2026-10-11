import { useSession } from './session';
import { apiFetch } from './session';
import { useEffect, useRef, useState } from 'react';
import { TraceDetails } from './RecordsPanel';

type Answer = { trace_id: string; equipment: string; assessment: string; answer: string; explanation: string; limitations: string; status: string; model: string };
export function AgentPanel({ equipment, tag, onTrace }: { equipment: string | null; tag: string | null; onTrace: (trace: string | null) => void }) {
  const { user } = useSession();
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); }; }, []);
  const [question, setQuestion] = useState('선택한 센서의 현재값은?');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function ask() {
    const controller = new AbortController(); request.current = controller;
    setPending(true); setError(null); setAnswer(null); onTrace(null);
    try {
      const response = await apiFetch('/api/agent/query', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, equipment, tag }) });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data.detail));
      if (!active.current) return;
      setAnswer(data);
      if (equipment === 'reheater') onTrace(data.trace_id);
    } catch (error) { if (active.current && !controller.signal.aborted) setError(String(error)); } finally { if (active.current) setPending(false); }
  }
  return <section id="agent" tabIndex={-1} className="agent panel" aria-label="AI Agent">
    <div className="panel-heading">
      <div><h2>선택 센서에 질문하기</h2><p className="note">관측 근거를 읽어 답합니다. 실제 설비를 조작하지 않습니다.</p></div>
    </div>
    <div className="agent-content">
      {!equipment && <p role="status">위 목록이나 계통도에서 센서를 먼저 선택하세요.</p>}
      {user.role !== 'operator' && <p className="note">AI 조회는 운영자 계정에서 사용할 수 있습니다.</p>}
      <div className="question-suggestions" aria-label="질문 예시">{['선택한 센서의 현재값은?', '최근 온도가 상승하고 있나요?', '목표 온도와 얼마나 차이 나나요?', '5분 예측은 얼마나 믿을 수 있나요?'].map(text => <button key={text} disabled={pending} onClick={() => setQuestion(text)}>{text}</button>)}</div>
      <label htmlFor="agent-question">질문</label>
      <textarea id="agent-question" spellCheck={false} maxLength={1000} value={question} onChange={event => setQuestion(event.target.value)} />
      <button className="primary-button" disabled={user.role !== 'operator' || !equipment || pending || !question.trim()} onClick={ask}>
        {pending ? '로컬 모델이 근거를 확인 중…' : 'Agent 조회'}
      </button>
      <p role="status">{pending ? '로컬 모델이 근거를 조회하고 있습니다.' : answer ? '조회가 완료되었습니다. 아래 답변과 근거를 확인하세요.' : ''}</p>
      {error && <p role="alert">{error}</p>}
      {answer && <div data-testid="agent-answer">
        <h3>질문에 대한 답변</h3>
        <p className="agent-answer-text">{answer.answer}</p>
        <p className="agent-explanation">{answer.explanation}</p>
        <p className="note">{answer.limitations}</p>
        <TraceDetails traceId={answer.trace_id} />
        <span className="quiet"> · {answer.model} · {answer.status}</span>
      </div>}
    </div>
  </section>;
}
