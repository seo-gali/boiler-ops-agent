import { useEffect } from 'react';
import type { Registry } from './types';
import { AgentPanel } from './AgentPanel';
import { SimulatorPanel } from './SimulatorPanel';
import { SensorInspector } from './SensorInspector';
import { AuditPanel } from './RecordsPanel';

export type WorkspaceTab = 'sensor' | 'agent' | 'simulator' | 'audit';
const tabs: { id: WorkspaceTab; label: string }[] = [{ id: 'sensor', label: '센서 상세' }, { id: 'agent', label: 'AI 질문' }, { id: 'simulator', label: '승인 연습' }, { id: 'audit', label: '변경 기록' }];

export function WorkspacePanel({ registry, selected, tab, onTab, onClose, onSelect, agentTrace, onTrace }: { registry: Registry; selected: string | null; tab: WorkspaceTab | null; onTab: (tab: WorkspaceTab) => void; onClose: () => void; onSelect: (tag: string) => void; agentTrace: string | null; onTrace: (id: string | null) => void }) {
  const sensor = registry.sensors[selected ?? ''] ?? null;
  useEffect(() => {
    if (tab) document.getElementById(`tab-${tab}`)?.focus({ preventScroll: true });
  }, [tab]);
  return <aside id="workspace-panel" className="workspace-panel" aria-label="운전 도우미" hidden={!tab} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="workspace-panel-heading"><div><span className="eyebrow">WORKSPACE</span><h2>운전 도우미</h2></div><button aria-label="도우미 닫기" onClick={onClose}>닫기 ×</button></div>
    <div className="workspace-tabs" role="tablist" aria-label="도우미 메뉴">{tabs.map((item, index) => <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`workspace-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => onTab(item.id)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); onTab(tabs[next].id); document.getElementById(`tab-${tabs[next].id}`)?.focus(); }
    }}>{item.label}</button>)}</div>
    <div className="workspace-scroll">
      {tab !== 'audit' && <div className="workspace-context"><label htmlFor="workspace-sensor-select">선택 센서</label><select id="workspace-sensor-select" value={selected ?? ''} onChange={event => onSelect(event.target.value)}><option value="" disabled>센서를 선택하세요</option>{Object.values(registry.sensors).map(sensor => <option key={sensor.tag} value={sensor.tag}>{sensor.label}</option>)}</select><p className="quiet">계통도에서 다른 설비를 눌러도 이곳의 선택이 바뀝니다.</p></div>}
      <div id="workspace-sensor" role="tabpanel" aria-labelledby="tab-sensor" hidden={tab !== 'sensor'}><SensorInspector registry={registry} sensor={sensor} onSelect={onSelect} onAsk={() => onTab('agent')} /></div>
      <div id="workspace-agent" role="tabpanel" aria-labelledby="tab-agent" hidden={tab !== 'agent'}><AgentPanel key={selected ?? 'none'} equipment={sensor?.equipment ?? null} tag={selected} onTrace={onTrace} /></div>
      <div id="workspace-simulator" role="tabpanel" aria-labelledby="tab-simulator" hidden={tab !== 'simulator'}><SimulatorPanel agentTrace={sensor?.equipment === 'reheater' ? agentTrace : null} active={tab === 'simulator'} onAudit={() => onTab('audit')} onPrepare={() => { onSelect(registry.equipment.find(item => item.id === 'reheater')!.primary_tag); onTab('agent'); }} /></div>
      <div id="workspace-audit" role="tabpanel" aria-labelledby="tab-audit" hidden={tab !== 'audit'}><AuditPanel active={tab === 'audit'} /></div>
    </div>
  </aside>;
}
