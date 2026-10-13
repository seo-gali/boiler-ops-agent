import { useSession, apiFetch } from './session';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BoilerViewport } from './BoilerScene';
import { connectTelemetry, formatValue, toggleUpdates, usePaused, useConnection, useReading, useTelemetry } from './telemetry';
import type { Registry, Sensor } from './types';
import { WorkspacePanel } from './WorkspacePanel';
import type { WorkspaceTab } from './WorkspacePanel';
import { OperationsAnalysis } from './OperationsAnalysis';
import { ForecastPanel } from './ForecastPanel';
import { SimulatorPanel } from './SimulatorPanel';
import { AuditPanel } from './RecordsPanel';
import { validateRegistry } from './registry';

type MainView = 'monitoring' | 'analysis' | 'simulator' | 'audit';
const views: { id: MainView; label: string }[] = [{ id: 'monitoring', label: '공장 모니터링' }, { id: 'analysis', label: '기간 조회' }, { id: 'simulator', label: '승인 연습' }, { id: 'audit', label: '변경 기록' }];

function KPI({ sensor, selected, onSelect }: { sensor: Sensor; selected: boolean; onSelect: () => void }) {
  const value = useReading(sensor.tag);
  return <button className="kpi" aria-pressed={selected} onClick={onSelect}><span>{sensor.label}</span><strong data-testid={`kpi-${sensor.tag}`}>{formatValue(value)}</strong><small>{sensor.unit ?? '단위 정의 없음'}</small></button>;
}

export default function App() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab | null>(null);
  const [view, setView] = useState<MainView>('monitoring');
  const [chatState, setChatState] = useState({ pending: false, draft: false });
  const [chatCancel, setChatCancel] = useState(0);
  const [agentEvidence, setAgentEvidence] = useState<string | null>(null);
  const [questionRequest, setQuestionRequest] = useState<{ tag: string; id: number } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const header = useRef<HTMLDivElement>(null);
  const { user, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const paused = usePaused();
  const telemetry = useTelemetry();
  const connection = useConnection();
  useEffect(() => connectTelemetry(), []);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch('/api/registry', { signal: controller.signal }).then(response => { if (!response.ok) throw new Error(`Registry HTTP ${response.status}`); return response.json(); })
      .then(validateRegistry).then(setRegistry).catch(error => { if (error.name !== 'AbortError') setError(String(error)); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!chatState.pending && !chatState.draft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [chatState]);

  const canLeave = (cancel: boolean) => {
    if (!chatState.pending && !chatState.draft) return true;
    const message = chatState.pending
      ? cancel ? 'AI 답변을 기다리는 중입니다. 닫으면 기다림을 취소합니다. 대화 기록과 작성한 글은 남습니다. 닫을까요?' : 'AI 답변을 기다리는 중입니다. 다른 화면으로 이동할까요? 조회와 대화 기록은 유지됩니다.'
      : '작성 중인 질문이 있습니다. 글은 보관됩니다. AI 화면에서 나갈까요?';
    return window.confirm(message);
  };
  const restoreFocus = () => requestAnimationFrame(() => {
    const target = [returnFocus.current, document.getElementById('open-agent'), document.getElementById('menu-toggle')]
      .find(node => node?.isConnected && node.getClientRects().length && !node.closest('[hidden]'));
    target?.focus({ preventScroll: true });
  });
  const closePanel = () => {
    if (!canLeave(true)) return;
    if (chatState.pending) setChatCancel(value => value + 1);
    setTab(null); restoreFocus();
  };
  const changeTab = (next: WorkspaceTab) => {
    if (tab === 'agent' && next !== 'agent' && !canLeave(false)) {
      document.getElementById('tab-agent')?.focus({ preventScroll: true });
      return false;
    }
    setTab(next);
    return true;
  };
  const openPanel = (next: WorkspaceTab) => {
    if (tab === 'agent' && next !== 'agent' && !canLeave(false)) return;
    if (!tab) returnFocus.current = document.activeElement as HTMLElement;
    setTab(next); setMenuOpen(false);
  };
  const onSelect = useCallback((tag: string) => setSelected(tag), []);
  const inspectSensor = (tag: string) => { onSelect(tag); openPanel('sensor'); };
  const onEquipment = useCallback((id: string) => {
    const item = registry?.equipment.find(item => item.id === id);
    if (item) onSelect(item.primary_tag);
  }, [registry, onSelect]);
  const prepareAgent = () => {
    const tag = registry?.equipment.find(item => item.id === 'reheater')?.primary_tag;
    if (!tag || chatState.pending) return;
    onSelect(tag); openPanel('agent');
    setQuestionRequest(previous => ({ tag, id: (previous?.id ?? 0) + 1 }));
  };
  const changeView = (next: MainView) => {
    if (next !== view && tab && !canLeave(true)) return;
    if (next !== view) {
      if (chatState.pending) setChatCancel(value => value + 1);
      setTab(null);
    }
    setView(next); setMenuOpen(false);
    requestAnimationFrame(() => { document.getElementById(next)?.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  };
  const logoutSession = () => {
    if ((chatState.pending || chatState.draft) && !window.confirm('로그아웃하면 진행 중인 질문과 이 화면의 대화 기록이 사라집니다. 로그아웃할까요?')) return;
    if (chatState.pending) setChatCancel(value => value + 1);
    void logout();
  };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => document.documentElement.style.setProperty('--header-height', `${entry.contentRect.height + 12}px`));
    if (header.current) observer.observe(header.current);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--header-height'); };
  }, []);
  const kpis = ['실제 출력값', '목표 발전량', '총 주증기 유량', '터빈용 주증기 압력', '최종과열기 출구 온도 평균값', '배기가스 산소 중간값'].flatMap(tag => registry?.sensors[tag] ? [registry.sensors[tag]] : []);
  const status = connection !== 'CONNECTED' ? connection : telemetry.status;
  return <div className={`app-shell ${tab ? 'drawer-open' : ''}`}>
    <a className="skip-link" href="#main">본문으로 건너뛰기</a>
    <div className="workspace-header" ref={header}>
      <header className="topbar">
        <a href="/" className="brand" aria-label="BoilerOps Agent 홈"><span className="brand-mark" aria-hidden="true">B</span>BoilerOps <span>AGENT</span></a>
        <div className="workspace-label">OPERATIONS WORKSPACE <b>한국중부발전 · 공개 운전데이터</b></div>
        <div className="header-runtime">
          <div className="connections"><span>Kafka <b data-testid="kafka-status">{telemetry.kafka}</b></span><span>WebSocket <b data-testid="ws-status">{connection}</b></span><span>Replay <b>{telemetry.replay_interval_ms || '—'} ms</b></span></div>
          <span className={`status ${status.toLowerCase()}`} data-testid="stream-status" role="status">● {status}</span>
          <button className="session-logout" onClick={logoutSession}>{user.user_id} · 로그아웃</button>
        </div>
        <button id="menu-toggle" className="menu-toggle" aria-expanded={menuOpen} aria-controls="page-nav" onClick={() => setMenuOpen(!menuOpen)}>메뉴</button>
      </header>
      <div className="navigation-row">
        <nav id="page-nav" className={`page-nav ${menuOpen ? 'open' : ''}`} aria-label="페이지 메뉴" onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('menu-toggle')?.focus(); } }}>
          {views.map(item => <a key={item.id} href={`#${item.id}`} aria-current={view === item.id ? 'page' : undefined} onClick={event => { event.preventDefault(); changeView(item.id); }}>{item.label}</a>)}
        </nav>
        <div className="update-controls"><button onClick={toggleUpdates} aria-pressed={paused}>화면 자동 갱신 {paused ? '재개' : '일시정지'}</button><span role="status">{paused ? '화면만 멈춤' : '갱신 중'}</span></div>
      </div>
    </div>
    <main id="main" tabIndex={-1}>
      {(error || telemetry.error) && <div role="alert" className="error-banner">{error || telemetry.error}</div>}
      <section id="monitoring" tabIndex={-1} hidden={view !== 'monitoring'} aria-label="실시간 모니터링">
        <div className="page-heading"><div><span className="eyebrow">PLANT EXPLORER</span><h1>공장 모니터링 <span>과거 데이터 재생</span></h1></div><div className="source-stamp"><span data-testid="source-time">{telemetry.current?.source_time ?? '데이터 대기'}</span><b>SEQ <span data-testid="sequence">{telemetry.current?.sequence ?? '—'}</span></b></div></div>
        {telemetry.stale && <div className="stale-banner">최신 데이터 수신을 기다리고 있습니다. 마지막 관측값을 표시합니다.</div>}
        <div className="kpi-bar">{kpis.map(sensor => <KPI key={sensor.tag} sensor={sensor} selected={selected === sensor.tag} onSelect={() => { onSelect(sensor.tag); if (!tab) openPanel('sensor'); }} />)}</div>
        <div className="monitor-grid">{registry ? <BoilerViewport registry={registry} selected={selected} onSelect={onSelect} onEquipment={onEquipment} onInspect={inspectSensor} active={view === 'monitoring'} /> : <div className="panel loading" role="status">{error ? '설비 목록을 불러오지 못했습니다. 연결을 확인하고 다시 열어주세요.' : '설비 목록 불러오는 중…'}</div>}</div>
        <ForecastPanel active={view === 'monitoring'} />
      </section>
      <section id="analysis" tabIndex={-1} hidden={view !== 'analysis'} aria-label="기간 데이터 조회">{registry && <OperationsAnalysis registry={registry} />}</section>
      <section id="simulator" tabIndex={-1} hidden={view !== 'simulator'} aria-label="변경 승인 연습"><SimulatorPanel agentTrace={agentEvidence} canPrepare={!chatState.pending} active={view === 'simulator'} onAudit={() => changeView('audit')} onPrepare={prepareAgent} /></section>
      <section id="audit" tabIndex={-1} hidden={view !== 'audit'} aria-label="승인·변경 기록"><AuditPanel active={view === 'audit'} /></section>
      <details className="unit-guide page-unit-guide"><summary>단위는 컬럼 정의서 기준 · 숫자는 원본 그대로</summary><p>출력 MW · 유량 T/H · 온도 °C · 압력 kg/cm2g · 산소 %. 센서 상세에서 원본 식별자와 단위의 출처를 확인할 수 있습니다. 화면 자동 갱신을 멈춰도 서버의 데이터 수집과 별도 조회는 계속됩니다.</p></details>
    </main>
    <footer><span>© {new Date().getFullYear()} BoilerOps Agent · 공개 데이터 재생</span><span>관측 데이터 · 산업 안전 판정 없음</span></footer>
    <div className="workspace-launchers" hidden={!!tab}><button id="open-agent" className="primary-button" aria-label="AI 도우미 열기" aria-controls="workspace-panel" aria-expanded={false} onClick={() => openPanel('agent')}><span aria-hidden="true">✦</span><span>AI</span></button></div>
    {registry && <WorkspacePanel registry={registry} selected={selected} tab={tab} onTab={changeTab} onClose={closePanel} onSelect={onSelect} onChatState={setChatState} onEvidence={setAgentEvidence} questionRequest={questionRequest} cancelVersion={chatCancel} />}
  </div>;
}
