import { useEffect, useRef, useState } from 'react';
import type { Registry } from './types';
import { AgentPanel } from './AgentPanel';
import { SensorInspector } from './SensorInspector';
import { SensorPicker } from './SensorPicker';

export type WorkspaceTab = 'sensor' | 'agent';
const tabs: { id: WorkspaceTab; label: string }[] = [{ id: 'sensor', label: '센서 상세' }, { id: 'agent', label: 'AI 질문' }];

export function WorkspacePanel({ registry, selected, tab, onTab, onClose, onSelect, onChatState, onEvidence, questionRequest, cancelVersion }: { registry: Registry; selected: string | null; tab: WorkspaceTab | null; onTab: (tab: WorkspaceTab) => boolean; onClose: () => void; onSelect: (tag: string) => void; onChatState: (state: { pending: boolean; draft: boolean }) => void; onEvidence: (trace: string | null) => void; questionRequest: { tag: string; id: number } | null; cancelVersion: number }) {
  const [questionTag, setQuestionTag] = useState<string | null>(null);
  const [agentTrace, setAgentTrace] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState(false);
  const requested = useRef<number | null>(null);
  const sensor = registry.sensors[selected ?? ''] ?? null;
  const questionSensor = registry.sensors[questionTag ?? ''] ?? null;
  useEffect(() => { if (tab) document.getElementById(`tab-${tab}`)?.focus({ preventScroll: true }); }, [tab]);
  useEffect(() => { if (tab === 'agent' && !questionTag && selected) setQuestionTag(selected); }, [tab, questionTag, selected]);
  useEffect(() => { onChatState({ pending, draft }); }, [pending, draft, onChatState]);
  useEffect(() => { onEvidence(questionSensor?.equipment === 'reheater' ? agentTrace : null); }, [agentTrace, questionSensor?.equipment, onEvidence]);
  const askAbout = (tag: string) => {
    if (pending) return false;
    if (questionTag !== tag) {
      if (draft && !window.confirm('작성 중인 질문을 지우고 다른 센서에 질문할까요? 지난 대화는 남아 있습니다.')) return false;
      setAgentTrace(null); setQuestionTag(tag);
    }
    onSelect(tag);
    return onTab('agent');
  };
  useEffect(() => {
    if (questionRequest && requested.current !== questionRequest.id) {
      requested.current = questionRequest.id;
      askAbout(questionRequest.tag);
    }
  }, [questionRequest]);
  return <aside id="workspace-panel" className="workspace-panel" aria-label="운전 도우미" hidden={!tab} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="workspace-panel-heading"><div><span className="eyebrow">WORKSPACE</span><h2>운전 도우미</h2></div><button className="close-icon" aria-label="도우미 닫기" onClick={onClose}>×</button></div>
    <div className="workspace-tabs" role="tablist" aria-label="도우미 메뉴">{tabs.map((item, index) => <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`workspace-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => onTab(item.id)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); if (onTab(tabs[next].id)) document.getElementById(`tab-${tabs[next].id}`)?.focus(); }
    }}>{item.label}{item.id === 'agent' && pending && <span className="pending-dot" aria-label="응답 대기 중"> ·</span>}</button>)}</div>
    <div className={`workspace-scroll ${tab === 'agent' ? 'agent-workspace' : ''}`}>
      {tab === 'sensor' && <div className="workspace-context"><SensorPicker registry={registry} selected={selected} onSelect={onSelect} /></div>}
      <div id="workspace-sensor" role="tabpanel" aria-labelledby="tab-sensor" hidden={tab !== 'sensor'}>{tab === 'sensor' && <SensorInspector registry={registry} sensor={sensor} canAsk={!pending} onAsk={() => { if (selected) askAbout(selected); }} />}</div>
      <div id="workspace-agent" role="tabpanel" aria-labelledby="tab-agent" hidden={tab !== 'agent'}>
        {questionSensor && sensor && selected !== questionTag && <div className="question-context-note"><p>화면에서 살펴보는 센서: <b>{sensor.label}</b></p><p>아래 질문과 답변은 <b>{questionSensor.label}</b>을 유지합니다.</p><button disabled={pending} onClick={() => askAbout(sensor.tag)}>이 센서로 새 질문</button>{pending && <small>답변을 기다리거나 대기를 취소한 뒤 대상을 바꿀 수 있습니다.</small>}</div>}
        <AgentPanel registry={registry} equipment={questionSensor?.equipment ?? null} tag={questionTag} onSelect={askAbout} onTrace={setAgentTrace} onPending={setPending} onDraftChange={setDraft} cancelVersion={cancelVersion} />
      </div>
    </div>
  </aside>;
}
