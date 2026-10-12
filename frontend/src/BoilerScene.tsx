import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrthographicCamera, Vector3 } from 'three';
import type { Equipment, Registry, Sensor } from './types';
import { formatValue, useReading, useTelemetry } from './telemetry';
import './scene-layout.css';

type Pan = { x: number; y: number };
type Point = { tag: string; x: number; y: number; equipmentX: number; equipmentY: number };
type LabelSlot = { x: number; y: number; width: number; height: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function labelSlots(count: number, width: number, height: number): LabelSlot[] {
  const compact = width < 650, gap = 10, inset = 14;
  const cardHeight = compact ? 84 : 124;
  const topCount = Math.ceil(count / 2);
  const toolsHeight = width < 420 ? 96 : 64;
  return Array.from({ length: count }, (_, index) => {
    const top = index < topCount;
    const railCount = top ? topCount : count - topCount;
    const columns = compact ? Math.min(2, railCount) : railCount;
    const localIndex = top ? index : index - topCount;
    const rows = Math.ceil(railCount / columns), row = Math.floor(localIndex / columns);
    const cardWidth = Math.min(182, (width - inset * 2 - gap * (columns - 1)) / columns);
    const railWidth = columns * cardWidth + gap * (columns - 1);
    const railTop = top ? inset : height - toolsHeight - inset - rows * cardHeight - (rows - 1) * gap;
    return { x: (width - railWidth) / 2 + (localIndex % columns) * (cardWidth + gap), y: railTop + row * (cardHeight + gap), width: cardWidth, height: cardHeight };
  });
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const EquipmentMesh = memo(function EquipmentMesh({ item, selected, onSelect }: { item: Equipment; selected: boolean; onSelect: () => void }) {
  const [x, , z] = item.position;
  const [w, h, d] = item.size;
  const body = <meshStandardMaterial color={selected ? '#749782' : '#a5b8ae'} roughness={.8} />;
  const frame = <meshStandardMaterial color={selected ? '#315e49' : '#587568'} roughness={.75} />;
  let shape: ReactNode;
  if (item.id === 'feeders') {
    shape = <>
      <mesh position={[0, h * .67, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><cylinderGeometry args={[w * .63, w * .28, h * .66, 4]} />{body}</mesh>
      <mesh position={[0, h * .22, 0]} castShadow><boxGeometry args={[w * 1.28, h * .28, d * .55]} />{frame}</mesh>
    </>;
  } else if (item.id === 'furnace') {
    shape = <>
      <mesh position={[0, h * .45, 0]} castShadow><boxGeometry args={[w, h * .86, d]} />{body}</mesh>
      <mesh position={[0, h * .94, 0]} castShadow><boxGeometry args={[w * .77, h * .12, d * .8]} />{frame}</mesh>
      <mesh position={[0, h * .42, d / 2 + .02]}><boxGeometry args={[w * .6, h * .48, .05]} /><meshStandardMaterial color="#657d70" /></mesh>
    </>;
  } else if (item.id === 'superheater') {
    shape = <>
      <mesh position={[0, h / 2, 0]} castShadow><boxGeometry args={[w, h, d * .62]} />{body}</mesh>
      <mesh position={[0, h / 2, d * .34]} scale={[1, 1.3, 1]}><torusGeometry args={[w * .34, .09, 8, 24]} />{frame}</mesh>
      <mesh position={[0, h * .98, 0]}><boxGeometry args={[w * 1.15, .12, d * .9]} />{frame}</mesh>
    </>;
  } else if (item.id === 'reheater') {
    shape = <>
      <mesh position={[0, h * .5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[h * .43, h * .43, w, 20]} />{body}</mesh>
      <mesh position={[0, h * .5, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[h * .44, .09, 8, 24]} />{frame}</mesh>
    </>;
  } else if (item.id === 'economizer') {
    shape = <>
      <mesh position={[0, h * .38, 0]} castShadow><boxGeometry args={[w, h * .7, d]} />{body}</mesh>
      <mesh position={[0, h * .83, 0]} rotation={[0, 0, -.1]} castShadow><boxGeometry args={[w * 1.1, h * .2, d * 1.05]} />{frame}</mesh>
    </>;
  } else if (item.id === 'scr') {
    shape = <>
      <mesh position={[0, h * .61, 0]} castShadow><boxGeometry args={[w, h * .76, d]} />{body}</mesh>
      <mesh position={[0, h * .2, 0]}><boxGeometry args={[w * .56, h * .38, d * .6]} />{frame}</mesh>
      <mesh position={[0, h * .63, d / 2 + .02]}><boxGeometry args={[w * .74, h * .35, .05]} /><meshStandardMaterial color="#7c9386" wireframe /></mesh>
    </>;
  } else {
    shape = <>
      <mesh position={[0, h / 2, 0]} castShadow><cylinderGeometry args={[w * .4, w * .58, h, 24]} />{body}</mesh>
      <mesh position={[0, h * .95, 0]}><cylinderGeometry args={[w * .44, w * .44, .16, 24]} />{frame}</mesh>
    </>;
  }
  return <group position={[x, 0, z]} onClick={event => { event.stopPropagation(); onSelect(); }}>
    {shape}
    <mesh position={[0, .04, 0]} receiveShadow><boxGeometry args={[w + .65, .1, d + .65]} /><meshStandardMaterial color={selected ? '#b2cdbb' : '#d5ded5'} /></mesh>
  </group>;
});

function SceneCamera({ zoom, pan, markers, equipment, scale, onProject }: { zoom: number; pan: Pan; markers: Sensor[]; equipment: Equipment[]; scale: { current: number }; onProject: (points: Point[]) => void }) {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    const view = camera as OrthographicCamera;
    view.left = -size.width / 2; view.right = size.width / 2;
    view.top = size.height / 2; view.bottom = -size.height / 2;
    view.position.set(14, 12, 17); view.lookAt(0, 2, 0);
    view.updateMatrixWorld();
    const bounds = equipment.flatMap(item => {
      const [x, , z] = item.position, [w, h, d] = item.size;
      return [-1, 1].flatMap(dx => [-1, 1].flatMap(dz => [0, h + .5].map(y =>
        new Vector3(x + dx * (w / 2 + .35), y, z + dz * (d / 2 + .35)).applyMatrix4(view.matrixWorldInverse))));
    });
    const minX = Math.min(...bounds.map(point => point.x)), maxX = Math.max(...bounds.map(point => point.x));
    const minY = Math.min(...bounds.map(point => point.y)), maxY = Math.max(...bounds.map(point => point.y));
    const slots = labelSlots(markers.length, size.width, size.height), split = Math.ceil(markers.length / 2);
    const top = Math.max(...slots.slice(0, split).map(slot => slot.y + slot.height)) + 14;
    const bottom = Math.min(...slots.slice(split).map(slot => slot.y)) - 14;
    scale.current = Math.min((size.width - 50) / (maxX - minX), Math.max(80, bottom - top) / (maxY - minY));
    view.zoom = scale.current * zoom;
    const centerY = (size.height / 2 - (top + bottom) / 2) / view.zoom;
    view.position.add(new Vector3((minX + maxX) / 2 + pan.x, (minY + maxY) / 2 - centerY + pan.y, 0).applyQuaternion(view.quaternion));
    view.updateProjectionMatrix(); view.updateMatrixWorld();
    onProject(markers.map(sensor => {
      const vector = new Vector3(...sensor.scene_position!).project(view);
      const item = equipment.find(item => item.id === sensor.equipment)!;
      const center = new Vector3(item.position[0], item.size[1] * .5, item.position[2]).project(view);
      return { tag: sensor.tag, x: (vector.x + 1) * size.width / 2, y: (-vector.y + 1) * size.height / 2, equipmentX: (center.x + 1) * size.width / 2, equipmentY: (-center.y + 1) * size.height / 2 };
    }));
    invalidate();
  }, [camera, size.width, size.height, zoom, pan, markers, equipment, scale, onProject, invalidate]);
  return null;
}

function MarkerLabel({ sensor, equipment, index, selected, equipmentSelected, onSelect, point, slot, outside }: { sensor: Sensor; equipment: Equipment; index: number; selected: boolean; equipmentSelected: boolean; onSelect: () => void; point: Point; slot: LabelSlot; outside: boolean }) {
  const reading = useReading(sensor.tag);
  const unit = sensor.unit ?? '단위 미확인';
  const state = selected ? '대표 센서 선택됨' : equipmentSelected ? '이 설비의 다른 센서 선택됨' : '대표 센서';
  return <button className={`scene-marker ${selected ? 'selected' : ''} ${equipmentSelected ? 'equipment-selected' : ''}`} data-testid={`marker-${sensor.tag}`} data-anchor-x={point.x} data-anchor-y={point.y} data-equipment-x={point.equipmentX} data-equipment-y={point.equipmentY} data-offscreen={outside} aria-label={`센서 ${sensor.tag} · ${equipment.name} · ${formatValue(reading)} ${unit} · ${state}${outside ? ' · 설비가 화면 밖에 있음' : ''}`} aria-pressed={selected} onClick={onSelect} title={`${sensor.label}\n${state}${outside ? '\n설비가 화면 밖에 있습니다. 보기 초기화로 돌아올 수 있습니다.' : ''}`} style={{ left: slot.x, top: slot.y, width: slot.width, height: slot.height }}>
    <span className="marker-name"><span>{String(index + 1).padStart(2, '0')}</span>{equipment.name}<i aria-hidden="true">{outside ? '↗' : selected ? '●' : equipmentSelected ? '◐' : ''}</i></span>
    <b>{formatValue(reading)} <em>{unit}</em></b><small>{sensor.label}</small><span className="marker-state">{outside ? '화면 밖 · ' : ''}{state}</span>
  </button>;
}

export function BoilerViewport({ registry, selected, onSelect, onEquipment }: { registry: Registry; selected: string | null; onSelect: (tag: string) => void; onEquipment: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [points, setPoints] = useState<Point[]>([]);
  const [lost, setLost] = useState(false);
  const [moving, setMoving] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const cameraScale = useRef(1);
  const space = useRef(false), inside = useRef(false), dragged = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const telemetry = useTelemetry();
  const markers = useMemo(() => registry.equipment.flatMap(item => {
    const sensor = registry.sensors[item.primary_tag];
    return sensor?.scene_position ? [sensor] : [];
  }), [registry]);
  const selectedEquipment = registry.sensors[selected ?? '']?.equipment;
  const equipmentCounts = useMemo(() => Object.values(registry.sensors).reduce<Record<string, number>>((counts, sensor) => {
    counts[sensor.equipment] = (counts[sensor.equipment] ?? 0) + 1; return counts;
  }, {}), [registry]);
  const slots = useMemo(() => labelSlots(markers.length, dimensions.width, dimensions.height), [markers.length, dimensions]);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const resize = () => setDimensions({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(resize);
    resize(); observer.observe(element);
    return () => observer.disconnect();
  }, []);
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
  const fallback = <div className="fallback"><b>3D 화면을 표시할 수 없습니다</b><p>위의 설비 목록에서 모든 그룹을 선택할 수 있습니다.</p><span>{telemetry.status} · Kafka {telemetry.kafka}</span></div>;
  const names = Object.fromEntries(registry.equipment.map(item => [item.id, item.name]));
  const describedEquipment = registry.equipment.find(item => item.id === (hovered ?? selectedEquipment));
  return <section className="viewport panel" aria-label="보일러 계통도">
    <div className="panel-heading"><div><span className="eyebrow">PLANT OVERVIEW</span><h2>설비를 눌러 살펴보세요</h2></div><span className="quiet">{registry.equipment.length}개 논리 그룹 · 실제 배치·설비 대수 아님</span></div>
    <nav className="equipment-nav" aria-label="설비 선택">{registry.equipment.map((item, index) => <button key={item.id} aria-label={`${String(index + 1).padStart(2, '0')} ${item.name}`} aria-pressed={selectedEquipment === item.id} onClick={() => onEquipment(item.id)} onPointerEnter={() => setHovered(item.id)} onPointerLeave={() => setHovered(null)} onFocus={() => setHovered(item.id)} onBlur={() => setHovered(null)} title={item.description}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.name}</b><small>센서 {equipmentCounts[item.id] ?? 0}</small></button>)}</nav>
    <p className="equipment-description">{describedEquipment ? <><b>{describedEquipment.name}</b> {describedEquipment.description}</> : '설비를 선택하면 해당 그룹의 센서를 살펴볼 수 있습니다. 이름표는 각 그룹의 대표 센서입니다.'}</p>
    <p id="scene-help" className="note scene-help"><span><kbd>Space</kbd> + 드래그 이동 · 휠 확대·축소</span><span>설비 버튼은 Tab · Enter로 선택</span></p>
    <div className={`scene ${dimensions.width < 650 ? 'compact-markers' : ''} ${moving ? 'panning' : ''}`} ref={box} tabIndex={0} aria-label="계통도 화면" aria-describedby="scene-help"
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
        const scale = cameraScale.current * zoom;
        const dx = (event.clientX - drag.current.x) / scale, dy = (event.clientY - drag.current.y) / scale;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setPan(value => ({ x: clamp(value.x - dx, -5, 5), y: clamp(value.y + dy, -4, 4) }));
      }}
      onPointerUpCapture={event => { if (drag.current) { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; } }}
      onPointerCancel={stop} onLostPointerCapture={() => { drag.current = null; }}
      onClickCapture={event => { if (space.current || dragged.current) { event.stopPropagation(); event.preventDefault(); dragged.current = false; } }}>
      {lost ? fallback : <SceneBoundary fallback={fallback}><Canvas orthographic camera={{ position: [14, 12, 17], near: .1, far: 100 }} shadows frameloop="demand" fallback={fallback} onCreated={({ gl }) => { gl.domElement.setAttribute('aria-hidden', 'true'); gl.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); setLost(true); }); }}>
        <SceneCamera zoom={zoom} pan={pan} markers={markers} equipment={registry.equipment} scale={cameraScale} onProject={setPoints} />
        <color attach="background" args={['#eef2ec']} /><ambientLight intensity={1.6} /><directionalLight position={[5, 12, 6]} intensity={2} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.04, 0]} receiveShadow><planeGeometry args={[36, 32]} /><meshStandardMaterial color="#edf1e9" /></mesh>
        <gridHelper args={[32, 24, '#d4ded1', '#e0e7dc']} />
        {registry.equipment.map(item => <EquipmentMesh key={item.id} item={item} selected={selectedEquipment === item.id} onSelect={() => onEquipment(item.id)} />)}
        {markers.map(sensor => <mesh key={sensor.tag} position={sensor.scene_position!} onClick={event => { event.stopPropagation(); onSelect(sensor.tag); }}><sphereGeometry args={[.14, 12, 12]} /><meshBasicMaterial color={selected === sensor.tag ? '#b56519' : '#185d48'} /></mesh>)}
      </Canvas></SceneBoundary>}
      {!lost && dimensions.width > 0 && <div className="marker-layer">
        <svg className="marker-leaders" width={dimensions.width} height={dimensions.height} aria-hidden="true">{points.map((point, index) => {
          const slot = slots[index];
          if (!slot) return null;
          const outside = point.x < 0 || point.x > dimensions.width || point.y < 0 || point.y > dimensions.height;
          const bottom = index >= Math.ceil(markers.length / 2);
          return <g key={point.tag} className={selected === point.tag ? 'selected' : selectedEquipment === registry.sensors[point.tag].equipment ? 'equipment-selected' : ''} data-offscreen={outside}><line x1={slot.x + slot.width / 2} y1={bottom ? slot.y : slot.y + slot.height} x2={point.x} y2={point.y} /><circle cx={point.x} cy={point.y} r={3.5} /></g>;
        })}</svg>
        {points.map((point, index) => {
          const sensor = registry.sensors[point.tag], slot = slots[index];
          if (!slot) return null;
          return <MarkerLabel key={point.tag} sensor={sensor} equipment={registry.equipment.find(item => item.id === sensor.equipment)!} index={index} selected={selected === point.tag} equipmentSelected={selectedEquipment === sensor.equipment} onSelect={() => onSelect(point.tag)} point={point} slot={slot} outside={point.x < 0 || point.x > dimensions.width || point.y < 0 || point.y > dimensions.height} />;
        })}
      </div>}
      <div className="scene-tools" aria-label="계통도 보기 조절">
        <button disabled={zoom <= .65} aria-label="축소" onClick={() => setZoom(value => clamp(value - .1, .65, 1.7))}>−</button><output aria-label="계통도 확대 비율">{Math.round(zoom * 100)}%</output><button disabled={zoom >= 1.7} aria-label="확대" onClick={() => setZoom(value => clamp(value + .1, .65, 1.7))}>+</button>
        <button disabled={pan.x <= -5} aria-label="왼쪽 이동" onClick={() => setPan(value => ({ ...value, x: clamp(value.x - .5, -5, 5) }))}>←</button><button disabled={pan.x >= 5} aria-label="오른쪽 이동" onClick={() => setPan(value => ({ ...value, x: clamp(value.x + .5, -5, 5) }))}>→</button>
        <button disabled={pan.y >= 4} aria-label="위로 이동" onClick={() => setPan(value => ({ ...value, y: clamp(value.y + .5, -4, 4) }))}>↑</button><button disabled={pan.y <= -4} aria-label="아래로 이동" onClick={() => setPan(value => ({ ...value, y: clamp(value.y - .5, -4, 4) }))}>↓</button><button onClick={reset}>보기 초기화</button>
      </div>
      <span className="scene-mode" role="status">{moving ? '이동 모드 · 드래그 / 휠 확대·축소' : ''}</span>
    </div>
    <div className="scene-flow-caption" aria-label="논리 계통 흐름">{registry.flows.map(flow => <p key={flow.id}><b>{flow.label}</b><span>{flow.equipment.map(id => names[id] ?? id).join(' → ')}</span></p>)}</div>
  </section>;
}
