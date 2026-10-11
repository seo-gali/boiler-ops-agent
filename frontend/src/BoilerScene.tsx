import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrthographicCamera, Vector3 } from 'three';
import type { Equipment, Registry, Sensor } from './types';
import { formatValue, useReading, useTelemetry } from './telemetry';

type Pan = { x: number; y: number };
type Point = { tag: string; x: number; y: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cameraScale = (width: number, height: number) => Math.min(width / 24, height / 15);

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const EquipmentMesh = memo(function EquipmentMesh({ item, selected, onSelect }: { item: Equipment; selected: boolean; onSelect: () => void }) {
  const [x, , z] = item.position;
  const [w, h, d] = item.size;
  return <group position={[x, 0, z]} onClick={event => { event.stopPropagation(); onSelect(); }}>
    <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
      {item.id === 'stack' ? <cylinderGeometry args={[w / 2, w / 2 + .12, h, 24]} /> : <boxGeometry args={[w, h, d]} />}
      <meshStandardMaterial color={selected ? '#dea04f' : item.id === 'furnace' ? '#778d85' : '#a9b7b0'} roughness={.85} />
    </mesh>
    {[.2, .5, .8].map(fraction => <mesh key={fraction} position={[0, h * fraction, 0]}>
      <boxGeometry args={[w + .06, .075, d + .06]} /><meshStandardMaterial color="#4f655d" />
    </mesh>)}
    <mesh position={[0, .06, 0]}><boxGeometry args={[w + .6, .12, d + .6]} /><meshStandardMaterial color="#d1d8d2" /></mesh>
  </group>;
});

function SceneCamera({ zoom, pan, markers, onProject }: { zoom: number; pan: Pan; markers: Sensor[]; onProject: (points: Point[]) => void }) {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    const view = camera as OrthographicCamera;
    view.left = -size.width / 2; view.right = size.width / 2;
    view.top = size.height / 2; view.bottom = -size.height / 2;
    view.position.set(14, 12, 17); view.lookAt(0, 2, 0);
    view.position.add(new Vector3(pan.x, pan.y, 0).applyQuaternion(view.quaternion));
    view.zoom = cameraScale(size.width, size.height) * zoom;
    view.updateProjectionMatrix(); view.updateMatrixWorld();
    onProject(markers.map(sensor => {
      const vector = new Vector3(...sensor.scene_position!).project(view);
      return { tag: sensor.tag, x: (vector.x + 1) * size.width / 2, y: (-vector.y + 1) * size.height / 2 };
    }));
    invalidate();
  }, [camera, size.width, size.height, zoom, pan, markers, onProject, invalidate]);
  return null;
}

function MarkerLabel({ sensor, equipment, selected, onSelect, point }: { sensor: Sensor; equipment: Equipment; selected: boolean; onSelect: () => void; point: Point }) {
  const reading = useReading(sensor.tag);
  return <button className={`scene-marker ${selected ? 'selected' : ''}`} data-testid={`marker-${sensor.tag}`} aria-label={`센서 ${sensor.tag} · ${equipment.name} · ${formatValue(reading)}`} aria-pressed={selected} onClick={onSelect} style={{ left: point.x, top: point.y }}>
    <span>{equipment.name}</span><b>{formatValue(reading)}</b><small>{sensor.label}</small>
  </button>;
}

export function BoilerViewport({ registry, selected, onSelect, onEquipment }: { registry: Registry; selected: string | null; onSelect: (tag: string) => void; onEquipment: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [points, setPoints] = useState<Point[]>([]);
  const [lost, setLost] = useState(false);
  const [moving, setMoving] = useState(false);
  const space = useRef(false), inside = useRef(false), dragged = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const telemetry = useTelemetry();
  const markers = useMemo(() => registry.equipment.flatMap(item => {
    const chosen = registry.sensors[selected ?? ''];
    const sensor = chosen?.equipment === item.id && chosen.scene_position ? chosen : registry.sensors[item.primary_tag];
    return sensor?.scene_position ? [sensor] : [];
  }), [registry, selected]);
  const stop = useCallback(() => {
    space.current = false; setMoving(false);
    if (drag.current && box.current?.hasPointerCapture(drag.current.id)) box.current.releasePointerCapture(drag.current.id);
    drag.current = null;
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, button, a, summary, [contenteditable="true"]')) return;
      if (!inside.current && !box.current?.contains(target)) return;
      event.preventDefault(); space.current = true; setMoving(true);
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') stop(); };
    const focus = (event: FocusEvent) => { if ((event.target as HTMLElement).closest('input, textarea, select, button, [contenteditable="true"]')) stop(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', stop); document.addEventListener('focusin', focus);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stop); document.removeEventListener('focusin', focus); };
  }, [stop]);
  useEffect(() => {
    const element = box.current;
    const wheel = (event: WheelEvent) => {
      if (!space.current || event.ctrlKey || (event.target as HTMLElement).closest('.scene-tools')) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
      setZoom(value => clamp(value * Math.exp(-delta * .0015), .65, 1.7));
    };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, []);
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); stop(); };
  const fallback = <div className="fallback"><b>3D VIEW UNAVAILABLE</b><p>아래 설비 목록에서 센서를 선택할 수 있습니다.</p><span>{telemetry.status} · Kafka {telemetry.kafka}</span></div>;
  const names = Object.fromEntries(registry.equipment.map(item => [item.id, item.name]));
  return <section className="viewport panel" aria-label="보일러 계통도">
    <div className="panel-heading"><div><span className="eyebrow">PLANT OVERVIEW</span><h2>설비를 눌러 살펴보세요</h2></div><span className="quiet">논리 계통도 · 실제 설비 좌표 아님</span></div>
    <p id="scene-help" className="note scene-help"><kbd>Space</kbd>를 누른 채 <b>드래그하면 이동</b>, <b>휠을 돌리면 확대·축소</b>합니다. 아래 설비 버튼은 Tab과 Enter로도 선택할 수 있습니다.</p>
    <div className={`scene ${moving ? 'panning' : ''}`} ref={box} tabIndex={0} aria-label="계통도 화면" aria-describedby="scene-help"
      onPointerEnter={() => { inside.current = true; }} onPointerLeave={() => { inside.current = false; }}
      onPointerDownCapture={event => {
        dragged.current = false;
        if (!space.current || event.button !== 0 || (event.target as HTMLElement).closest('.scene-tools')) return;
        event.preventDefault(); event.stopPropagation(); dragged.current = true;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMoveCapture={event => {
        if (!drag.current) return;
        event.preventDefault(); event.stopPropagation();
        const scale = cameraScale(event.currentTarget.clientWidth, event.currentTarget.clientHeight) * zoom;
        const dx = (event.clientX - drag.current.x) / scale, dy = (event.clientY - drag.current.y) / scale;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setPan(value => ({ x: clamp(value.x - dx, -5, 5), y: clamp(value.y + dy, -4, 4) }));
      }}
      onPointerUpCapture={event => { if (drag.current) { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; } }}
      onPointerCancel={stop} onLostPointerCapture={() => { drag.current = null; }}
      onClickCapture={event => { if (space.current || dragged.current) { event.stopPropagation(); event.preventDefault(); dragged.current = false; } }}>
      {lost ? fallback : <SceneBoundary fallback={fallback}><Canvas orthographic camera={{ position: [14, 12, 17], near: .1, far: 100 }} shadows frameloop="demand" fallback={fallback} onCreated={({ gl }) => { gl.domElement.setAttribute('aria-hidden', 'true'); gl.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); setLost(true); }); }}>
        <SceneCamera zoom={zoom} pan={pan} markers={markers} onProject={setPoints} />
        <color attach="background" args={['#edf0eb']} /><ambientLight intensity={1.5} /><directionalLight position={[5, 12, 6]} intensity={2} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.04, 0]} receiveShadow><planeGeometry args={[24, 15]} /><meshStandardMaterial color="#e5e9e2" /></mesh>
        <gridHelper args={[24, 24, '#c7d1c6', '#d9e0d6']} />
        {registry.equipment.map(item => <EquipmentMesh key={item.id} item={item} selected={registry.sensors[selected ?? '']?.equipment === item.id} onSelect={() => onEquipment(item.id)} />)}
        {markers.map(sensor => <mesh key={sensor.tag} position={sensor.scene_position!} onClick={event => { event.stopPropagation(); onSelect(sensor.tag); }}><sphereGeometry args={[.14, 12, 12]} /><meshBasicMaterial color={selected === sensor.tag ? '#b56519' : '#185d48'} /></mesh>)}
      </Canvas></SceneBoundary>}
      {!lost && <div className="marker-layer">{points.map(point => {
        const sensor = registry.sensors[point.tag];
        return <MarkerLabel key={point.tag} sensor={sensor} equipment={registry.equipment.find(item => item.id === sensor.equipment)!} selected={selected === point.tag} onSelect={() => onSelect(point.tag)} point={point} />;
      })}</div>}
      <div className="scene-tools" aria-label="계통도 보기 조절">
        <button disabled={zoom <= .65} aria-label="축소" onClick={() => setZoom(value => clamp(value - .1, .65, 1.7))}>−</button><output aria-label="계통도 확대 비율">{Math.round(zoom * 100)}%</output><button disabled={zoom >= 1.7} aria-label="확대" onClick={() => setZoom(value => clamp(value + .1, .65, 1.7))}>+</button>
        <button disabled={pan.x <= -5} aria-label="왼쪽 이동" onClick={() => setPan(value => ({ ...value, x: clamp(value.x - .5, -5, 5) }))}>←</button><button disabled={pan.x >= 5} aria-label="오른쪽 이동" onClick={() => setPan(value => ({ ...value, x: clamp(value.x + .5, -5, 5) }))}>→</button>
        <button disabled={pan.y >= 4} aria-label="위로 이동" onClick={() => setPan(value => ({ ...value, y: clamp(value.y + .5, -4, 4) }))}>↑</button><button disabled={pan.y <= -4} aria-label="아래로 이동" onClick={() => setPan(value => ({ ...value, y: clamp(value.y - .5, -4, 4) }))}>↓</button><button onClick={reset}>보기 초기화</button>
      </div>
      <span className="scene-mode" role="status">{moving ? '이동 모드 · 드래그 / 휠 확대·축소' : ''}</span>
    </div>
    <nav className="equipment-nav" aria-label="설비 선택">{registry.equipment.map((item, index) => <button key={item.id} aria-label={`${String(index + 1).padStart(2, '0')} ${item.name}`} aria-pressed={registry.sensors[selected ?? '']?.equipment === item.id} onClick={() => onEquipment(item.id)}><span>{String(index + 1).padStart(2, '0')} · {item.label}</span><b>{item.name}</b><small>{item.description}</small></button>)}</nav>
    <details className="process-flows"><summary>계통 흐름 이해하기</summary>{registry.flows.map(flow => <div key={flow.id}><span>{flow.label}</span><small>{flow.equipment.map(id => names[id] ?? id).join(' → ')}</small></div>)}<p className="note">일반적인 역할과 논리 연결을 설명합니다. 실제 발전소의 배치·운전 상태를 확정하는 설명은 아닙니다.</p></details>
  </section>;
}
