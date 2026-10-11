import { useSession } from './session';
import { apiFetch } from './session';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BoilerViewport } from './BoilerScene';
import { connectTelemetry, formatValue, toggleUpdates, usePaused, useConnection, useEvents, useReading, useTelemetry } from './telemetry';
import type { Registry, Sensor } from './types';
import { WorkspacePanel } from './WorkspacePanel';
import type { WorkspaceTab } from './WorkspacePanel';
import { OperationsAnalysis } from './OperationsAnalysis';
import { ForecastPanel } from './ForecastPanel';
import { validateRegistry } from './registry';

function KPI({ sensor, onSelect }: { sensor: Sensor; onSelect: () => void }) {
  const value = useReading(sensor.tag);
  return <button className="kpi" onClick={onSelect}><span>{sensor.label}</span><strong data-testid={`kpi-${sensor.tag}`}>{formatValue(value)}</strong><small>{sensor.unit ?? '단위 정의 없음'}</small></button>;
}

export default function App() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const header = useRef<HTMLDivElement>(null);
  const { user, logout } = useSession();
  const [agentTrace, setAgentTrace] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const paused = usePaused();
  const telemetry = useTelemetry();
  const connection = useConnection();
  const events = useEvents();
  useEffect(() => connectTelemetry(), []);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch('/api/registry', { signal: controller.signal }).then(response => { if (!response.ok) throw new Error(`Registry HTTP ${response.status}`); return response.json(); })
      .then(validateRegistry).then(setRegistry).catch(error => { if (error.name !== 'AbortError') setError(String(error)); });
    return () => controller.abort();
  }, []);
  const openPanel = useCallback((next: WorkspaceTab) => {
    returnFocus.current = document.activeElement as HTMLElement;
    setTab(next); setMenuOpen(false);
  }, []);
  const closePanel = () => {
    setTab(null);
    requestAnimationFrame(() => {
      const target = [returnFocus.current, document.getElementById('open-agent'), document.getElementById('menu-toggle')]
        .find(node => node?.isConnected && node.getClientRects().length && !node.closest('[hidden]'));
      target?.focus({ preventScroll: true });
    });
  };
  const onSelect = useCallback((tag: string) => {
    if (!tab) returnFocus.current = document.activeElement as HTMLElement;
    if (selected !== tag) setAgentTrace(null);
    setSelected(tag);
    setTab(previous => previous ?? 'sensor');
  }, [selected, tab]);
  const onEquipment = useCallback((id: string) => {
    const item = registry?.equipment.find(item => item.id === id);
    if (item) onSelect(item.primary_tag);
  }, [registry, onSelect]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => document.documentElement.style.setProperty('--header-height', `${entry.contentRect.height + 12}px`));
    if (header.current) observer.observe(header.current);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--header-height'); };
  }, []);
  const kpis = ['실제 출력값', '목표 발전량', '총 주증기 유량', '터빈용 주증기 압력', '최종과열기 출구 온도 평균값', '배기가스 산소 중간값'].flatMap(tag => registry?.sensors[tag] ? [registry.sensors[tag]] : []);
  const status = connection !== 'CONNECTED' ? connection : telemetry.status;
  return <div className={`app-shell ${tab ? 'drawer-open' : ''}`}>
    <a className="skip-link" href="#main">본문으로 건너뛰기</a>
    <div className="workspace-header" ref={header}><header className="topbar"><a href="/" className="brand" aria-label="BoilerOps Agent 홈"><span className="brand-mark" aria-hidden="true">B</span>BoilerOps <span>AGENT</span></a><div className="workspace-label">OPERATIONS WORKSPACE <b>한국중부발전 · 공개 운전데이터</b></div><span className={`status ${status.toLowerCase()}`} data-testid="stream-status" role="status">● {status}</span><button className="session-logout" onClick={logout}>{user.user_id} · 로그아웃</button><button id="menu-toggle" className="menu-toggle" aria-expanded={menuOpen} aria-controls="page-nav" onClick={() => setMenuOpen(!menuOpen)}>메뉴</button></header>
    <nav id="page-nav" className={`page-nav ${menuOpen ? 'open' : ''}`} aria-label="페이지 메뉴" onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('menu-toggle')?.focus(); } }}>
      {[['monitoring', '모니터링'], ['analysis', '운전 분석'], ['forecast', '온도 예측']].map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => { setMenuOpen(false); document.getElementById(id)?.focus(); }}>{label}</a>)}
      <button id="open-agent" aria-controls="workspace-panel" aria-expanded={tab === 'agent'} onClick={() => openPanel('agent')}><span aria-hidden="true" className="ai-icon">✦</span> AI 질문</button>
      <button aria-controls="workspace-panel" aria-expanded={tab === 'simulator'} onClick={() => openPanel('simulator')}>승인 연습</button>
      <button aria-controls="workspace-panel" aria-expanded={tab === 'audit'} onClick={() => openPanel('audit')}>변경 기록</button>
    </nav></div>
    <main id="main" tabIndex={-1}>
    <div className="page-heading"><div><span className="eyebrow">REALTIME MONITORING</span><h1>운전 현황 <span>Historical replay</span></h1></div><div className="connections"><span>Kafka <b data-testid="kafka-status">{telemetry.kafka}</b></span><span>WebSocket <b data-testid="ws-status">{connection}</b></span><span>Replay <b>{telemetry.replay_interval_ms || '—'} ms</b></span></div></div>
    {(error || telemetry.error) && <div role="alert" className="error-banner">{error || telemetry.error}</div>}
    {telemetry.stale && <div className="stale-banner">STALE · 최신 데이터 수신을 기다리고 있습니다. 마지막 관측값을 표시합니다.</div>}
    <div className="update-controls"><button onClick={toggleUpdates} aria-pressed={paused}>화면 자동 갱신 {paused ? '재개' : '일시정지'}</button><span role="status">{paused ? '표시를 고정했습니다. 연결 상태와 서버 처리는 계속됩니다. 이력·분석·예측·AI 조회는 고정되지 않습니다.' : '화면 자동 갱신 중'}</span></div>
    <details className="unit-guide"><summary>단위는 컬럼 정의서 기준 · 숫자는 원본 그대로</summary><p>출력 MW · 유량 T/H · 온도 °C · 압력 kg/cm2g · 산소 %. 원본 degC는 °C로 표기하며 숫자를 환산하거나 음수를 보정하지 않습니다. 센서 상세에서 정의서 행과 원본 식별자를 확인할 수 있습니다.</p></details>
    <div className="kpi-bar">{kpis.map(sensor => <KPI key={sensor.tag} sensor={sensor} onSelect={() => onSelect(sensor.tag)} />)}</div>
    <section id="monitoring" tabIndex={-1} className="monitor-grid" aria-label="실시간 모니터링">
      {registry ? <BoilerViewport registry={registry} selected={selected} onSelect={onSelect} onEquipment={onEquipment} /> : <div className="panel loading" role="status">{error ? '설비 목록을 불러오지 못했습니다. 연결을 확인하고 페이지를 새로고침하세요.' : '설비 메타데이터 불러오는 중…'}</div>}
    </section>
    <section className="feed panel"><div className="panel-heading"><div><span className="eyebrow">LIVE OPERATIONS</span><h2>Telemetry activity</h2></div><div className="source-stamp"><span data-testid="source-time">{telemetry.current?.source_time ?? '데이터 대기'}</span><b>SEQ <span data-testid="sequence">{telemetry.current?.sequence ?? '—'}</span></b></div></div><div className="feed-rows">{events.slice(-5).reverse().map(event => <div key={`${event.run_id}-${event.sequence}`} className="feed-row"><span>● TELEMETRY</span><time>{event.source_time}</time><span>실제 출력값 <b>{formatValue(event.sensors['실제 출력값'])}</b></span><span>과열기 출구 <b>{formatValue(event.sensors['최종과열기 출구 온도 평균값'])}</b></span><code>#{event.sequence}</code></div>)}{events.length === 0 && <p className="quiet">Kafka에서 첫 이벤트를 기다리고 있습니다.</p>}</div></section>
    <OperationsAnalysis />
    <ForecastPanel />
    </main>
    <footer><span>© {new Date().getFullYear()} BoilerOps Agent · 공개 데이터 재생</span><a href="#main">본문 처음으로</a><button onClick={() => openPanel('simulator')}>승인 연습 열기</button><span>관측 데이터 · 산업 안전 판정 없음</span></footer>
    <div className="workspace-launchers" hidden={!!tab}><button className="primary-button" aria-label="AI 도우미 열기" onClick={() => openPanel('agent')}><span aria-hidden="true">✦</span> AI 질문</button><button onClick={() => openPanel('simulator')}>승인 연습</button></div>
    {registry && <WorkspacePanel registry={registry} selected={selected} tab={tab} onTab={setTab} onClose={closePanel} onSelect={onSelect} agentTrace={agentTrace} onTrace={setAgentTrace} />}
  </div>;
}
