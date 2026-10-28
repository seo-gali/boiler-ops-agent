import { apiFetch, useSession } from './session';
import { useEffect, useRef, useState } from 'react';
import { TraceDetails } from './RecordsPanel';
import { ChatExplorer } from './ChatExplorer';
import type { Registry } from './types';
import './chat.css';

type Answer = { trace_id: string; equipment: string; assessment: string; answer: string; explanation: string; limitations: string; status: string; model: string };
type QueryError = { message: string; detail?: string; traceId?: string };
type ChatTurn = { id: number; question: string; tag: string; equipment: string; requestedAt: string; status: 'pending' | 'answered' | 'failed' | 'cancelled'; elapsed: number; answer?: Answer; error?: QueryError };
type AgentPanelProps = { registry: Registry; equipment: string | null; tag: string | null; onSelect: (tag: string) => boolean; onTrace: (trace: string | null) => void; onPending?: (pending: boolean) => void; onDraftChange?: (hasDraft: boolean) => void; cancelVersion?: number };

// 서버 모델 호출 2회 × 180초와 응답 전달 여유
const QUERY_TIMEOUT_MS = 390_000;
// 실제값·목표값 대응
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

function querySuggestions(equipment: string | null, tag: string | null) {
  const suggestions = ['선택한 센서의 현재값은?', '최근 값은 어떻게 변하고 있나요?'];
  const targetQuestion = tag ? targetQuestions[tag] : undefined;
  if (targetQuestion?.equipment === equipment) suggestions.push(targetQuestion.question);
  if (equipment === 'reheater') suggestions.push('재열기 온도의 5분 예측은 얼마나 믿을 수 있나요?');
  suggestions.push('이 값은 언제 측정됐고 어떤 원본 근거가 있나요?', '현재값과 최근 변화 추이를 함께 설명해 주세요.', '최근 값은 얼마나 빠르게 변하고 있나요?', '이 값만 보고 밸브를 얼마나 열어야 하나요?', '현재 수치의 단위와 원본 근거는 무엇인가요?');
  return suggestions;
}

function requestTime(value: string) {
  return new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function AgentPanel({ registry, equipment, tag, onSelect, onTrace, onPending, onDraftChange, cancelVersion = 0 }: AgentPanelProps) {
  const { user } = useSession();
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const nextTurn = useRef(0);
  const lastCancelVersion = useRef(cancelVersion);
  const transcript = useRef<HTMLOListElement | null>(null);
  const exploration = useRef<HTMLLIElement | null>(null);
  const [exploreVersion, setExploreVersion] = useState(0);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [moreSuggestions, setMoreSuggestions] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { onPending?.(pending); }, [pending, onPending]);
  useEffect(() => { onDraftChange?.(Boolean(question.trim())); }, [question, onDraftChange]);
  useEffect(() => { setQuestion(''); setMoreSuggestions(false); onTrace(null); }, [equipment, tag, onTrace]);
  useEffect(() => {
    if (lastCancelVersion.current !== cancelVersion) {
      lastCancelVersion.current = cancelVersion;
      request.current?.abort('cancelled');
    }
  }, [cancelVersion]);
  const latest = turns[turns.length - 1];
  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turns.length, latest?.status, moreSuggestions]);
  const suggestions = querySuggestions(equipment, tag);
  const canAsk = user.role === 'operator' && Boolean(equipment && tag) && !pending && Boolean(question.trim());
  const statusText = latest?.status === 'answered' ? `${latest.elapsed}초 만에 답변을 받았습니다.` : latest?.status === 'cancelled' ? '답변 기다리기를 취소했습니다. 지난 질문과 답변은 남아 있습니다.' : latest?.status === 'failed' ? '답변을 받지 못했습니다. 해당 메시지에서 다시 조회할 수 있습니다.' : '';

  function updateTurn(id: number, update: Partial<ChatTurn>) {
    setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, ...update } : turn));
  }

  function explore(tag: string) {
    if (!onSelect(tag)) return;
    setExploreVersion(value => value + 1);
    requestAnimationFrame(() => exploration.current?.focus());
  }

  async function ask(askedQuestion: string, askedEquipment: string, askedTag: string, clearDraft: boolean) {
    if (user.role !== 'operator' || request.current || !askedQuestion.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    const started = Date.now();
    const id = ++nextTurn.current;
    const turn: ChatTurn = { id, question: askedQuestion.trim(), equipment: askedEquipment, tag: askedTag, requestedAt: new Date(started).toISOString(), status: 'pending', elapsed: 0 };
    setTurns(previous => [...previous, turn]);
    if (clearDraft) setQuestion('');
    setPending(true); setElapsedSeconds(0); onTrace(null);
    const interval = window.setInterval(() => {
      if (active.current && request.current === controller) setElapsedSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    const timeout = window.setTimeout(() => controller.abort('timeout'), QUERY_TIMEOUT_MS);
    try {
      const response = await apiFetch('/api/agent/query', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: turn.question, equipment: askedEquipment, tag: askedTag }) });
      const data = await response.json().catch(() => null);
      controller.signal.throwIfAborted();
      if (!active.current || request.current !== controller) return;
      if (!response.ok) { updateTurn(id, { status: 'failed', error: responseError(response.status, data) }); return; }
      if (!data || typeof data.answer !== 'string' || typeof data.trace_id !== 'string') throw new Error('서버 응답 형식이 올바르지 않습니다.');
      updateTurn(id, { status: 'answered', answer: data });
      if (askedEquipment === 'reheater') onTrace(data.trace_id);
    } catch (caught) {
      if (!active.current || request.current !== controller) return;
      if (controller.signal.reason === 'timeout') {
        updateTurn(id, { status: 'failed', error: { message: '6분 30초 안에 답변을 받지 못했습니다. 잠시 후 다시 조회하세요. 서버 작업은 계속될 수 있습니다.' } });
      } else if (controller.signal.reason === 'cancelled') {
        updateTurn(id, { status: 'cancelled' });
      } else {
        updateTurn(id, { status: 'failed', error: { message: '답변을 받지 못했습니다. 서버 연결과 모델 실행 상태를 확인한 뒤 다시 조회하세요.', detail: caught instanceof Error ? caught.message : String(caught) } });
      }
    } finally {
      window.clearInterval(interval); window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        if (active.current) {
          const elapsed = Math.floor((Date.now() - started) / 1000);
          updateTurn(id, { elapsed }); setPending(false); setElapsedSeconds(elapsed);
        }
      }
    }
  }

  function fillQuestion(text: string) {
    setQuestion(text);
    document.getElementById('agent-question')?.focus();
  }

  return <section id="agent" tabIndex={-1} className="agent agent-chat panel" aria-label="AI Agent">
    <div className="panel-heading"><div><h2>AI와 이야기하기</h2><p className="note">센서의 현재값과 변화를 근거와 함께 확인하세요.</p></div></div>
    <div className="agent-content">
      <div className="agent-target" data-testid="agent-target"><span className="quiet">다음 질문의 대상</span><p><strong>{tag ?? '센서를 먼저 선택하세요'}</strong></p></div>
      {user.role !== 'operator' && <p className="note">AI 조회는 운영자 계정에서 사용할 수 있습니다.</p>}
      <ol className="chat-history" ref={transcript} aria-label="AI 대화 기록">
        {!turns.length && <li className="chat-empty"><span aria-hidden="true">✦</span><p>무엇이 궁금한가요?</p><small>{tag ? '직접 질문하거나 센서 데이터를 펼쳐보세요.' : '아래에서 설비부터 차근차근 살펴보세요.'}</small></li>}
        {turns.map(turn => <li className="chat-turn" key={turn.id} data-testid="chat-turn" data-status={turn.status}>
          <div className="chat-message chat-user"><span className="chat-speaker">나</span><p>{turn.question}</p><div className="chat-meta"><span>{turn.tag}</span><time dateTime={turn.requestedAt}>조회 요청 {requestTime(turn.requestedAt)}</time></div></div>
          <div className="chat-message chat-assistant"><span className="chat-speaker">AI</span>
            {turn.status === 'pending' && <div className="agent-waiting" data-testid="agent-waiting"><p>답변을 기다리고 있습니다<span className="chat-loading" aria-hidden="true">…</span></p><p className="chat-meta"><span data-testid="agent-elapsed" aria-live="off">{elapsedSeconds}초 경과</span> · 최대 6분 30초</p><p className="note">로컬 모델은 기기에 따라 몇 분 걸릴 수 있습니다.</p><button className="chat-cancel" onClick={() => request.current?.abort('cancelled')}>기다리기 취소</button></div>}
            {turn.status === 'answered' && turn.answer && <div data-testid="agent-answer"><p className="agent-answer-text">{turn.answer.answer}</p><p className="agent-explanation">{turn.answer.explanation}</p>{turn.answer.limitations && <p className="note">{turn.answer.limitations}</p>}<TraceDetails traceId={turn.answer.trace_id} /><div className="chat-meta"><span>{turn.elapsed}초 · {turn.answer.model}</span><span>{turn.tag}</span></div><div className="explorer-actions"><button disabled={pending} onClick={() => explore(turn.tag)}>이 센서 데이터 탐색</button><button disabled={pending || user.role !== 'operator'} onClick={() => void ask('최근 값은 어떻게 변하고 있나요?', turn.equipment, turn.tag, false)}>추이 이어 묻기</button></div></div>}
            {turn.status === 'failed' && turn.error && <div data-testid="agent-error"><p role="alert">{turn.error.message}</p>{turn.error.detail && <details><summary>오류 상세</summary><p className="agent-explanation">{turn.error.detail}</p></details>}{turn.error.traceId && <TraceDetails traceId={turn.error.traceId} />}</div>}
            {turn.status === 'cancelled' && <p>답변 기다리기를 취소했습니다. 서버 작업은 계속될 수 있습니다.</p>}
            {(turn.status === 'failed' || turn.status === 'cancelled') && <><button className="chat-retry" disabled={pending || user.role !== 'operator'} onClick={() => void ask(turn.question, turn.equipment, turn.tag, false)}>다시 조회</button><p className="chat-meta">{turn.elapsed}초 대기 · {turn.tag}</p></>}
          </div>
        </li>)}
        <li className="chat-exploration" ref={exploration} tabIndex={-1} aria-label="센서 데이터 탐색"><ChatExplorer registry={registry} tag={tag} version={exploreVersion} pending={pending} canAsk={user.role === 'operator'} onSelect={onSelect} onAsk={(question, equipment, tag) => void ask(question, equipment, tag, false)} /></li>
        <li className="chat-suggestions" hidden={!tag}><p className="chat-status" role="status" data-testid="agent-status">{pending ? '답변을 기다리는 중…' : statusText}</p>
          <div className="question-suggestions" aria-label="질문 예시">{suggestions.slice(0, turns.length ? 2 : 4).map(text => <button key={text} disabled={!tag} onClick={() => fillQuestion(text)}>{text}</button>)}</div>
          <details className="chat-more" open={moreSuggestions} onToggle={event => setMoreSuggestions(event.currentTarget.open)}><summary>질문 예시 더 보기</summary><div className="question-suggestions">{suggestions.slice(turns.length ? 2 : 4).map(text => <button key={text} disabled={!tag} onClick={() => fillQuestion(text)}>{text}</button>)}</div></details>
        </li>
      </ol>
      <form className="chat-composer" onSubmit={event => { event.preventDefault(); if (canAsk && equipment && tag) void ask(question, equipment, tag, true); }}>
        <label className="sr-only" htmlFor="agent-question">질문</label>
        <div className="chat-compose-row"><textarea id="agent-question" spellCheck={false} maxLength={1000} rows={2} placeholder="메시지를 입력하세요" aria-describedby="chat-input-hint" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canAsk && equipment && tag) void ask(question, equipment, tag, true); } }} />
        <button type="submit" className="primary-button chat-send" aria-label={pending ? '답변 기다리는 중…' : '질문 보내기'} disabled={!canAsk}><span aria-hidden="true">↑</span></button></div>
        <p className="chat-input-hint" id="chat-input-hint">Enter 전송 · Shift + Enter 줄바꿈</p>
      </form>
    </div>
  </section>;
}
