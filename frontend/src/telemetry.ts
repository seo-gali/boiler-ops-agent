import { useSyncExternalStore } from 'react';
import type { Reading, Snapshot, Telemetry } from './types';

const empty: Snapshot = { type: 'telemetry', current: null, status: 'CONNECTING', stale: true, kafka: 'CONNECTING', error: null, rejected_events: 0, replay_interval_ms: 0, stale_after_ms: 5000 };
let snapshot = empty;
let connection = 'CONNECTING';
let events: Telemetry[] = [];
let paused = false;
let latest = empty;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => listeners.forEach(listener => listener());
export const useTelemetry = () => useSyncExternalStore(subscribe, () => snapshot);
export const useConnection = () => useSyncExternalStore(subscribe, () => connection);
export const useEvents = () => useSyncExternalStore(subscribe, () => events);
export const useReading = (tag: string) => useSyncExternalStore(subscribe, () => snapshot.current?.sensors[tag]);
export const usePaused = () => useSyncExternalStore(subscribe, () => paused);
function equalFields<T extends object>(left: T, right: T) {
  const keys = Object.keys(left) as (keyof T)[];
  return keys.length === Object.keys(right).length && keys.every(key => Object.is(left[key], right[key]));
}
function shareCurrent(current: Telemetry | null, previous: Telemetry | null) {
  if (!current || !previous || current === previous) return current;
  const sensors = { ...current.sensors };
  for (const [tag, reading] of Object.entries(sensors)) {
    const prior = previous.sensors[tag];
    if (prior && equalFields(reading, prior)) sensors[tag] = prior;
  }
  const shared = { ...current, sensors: equalFields(sensors, previous.sensors) ? previous.sensors : sensors };
  return equalFields(shared, previous) ? previous : shared;
}
function applySnapshot(next: Snapshot) {
  const previous = snapshot.current;
  const current = shareCurrent(next.current, previous);
  const shared = { ...next, current };
  if (equalFields(shared, snapshot)) return false;
  if (current && (!previous || previous.run_id !== current.run_id || previous.sequence !== current.sequence)) {
    events = previous?.run_id === current.run_id ? [...events.slice(-119), current] : [current];
  }
  snapshot = shared;
  return true;
}
export function toggleUpdates() {
  paused = !paused;
  if (!paused) applySnapshot(latest);
  notify();
}
export const formatValue = (reading?: Reading) => reading?.quality === 'parse_error' ? '파싱 오류' : reading?.value == null ? '—' : reading.value.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function connectTelemetry() {
  let socket: WebSocket | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout>;
  let attempts = 0;
  let received = 0;
  const connect = () => {
    connection = attempts ? 'RECONNECTING' : 'CONNECTING'; notify();
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`);
    socket.onopen = () => { connection = 'CONNECTED'; attempts = 0; notify(); };
    socket.onmessage = ({ data }) => {
      try {
        const next = JSON.parse(data) as Snapshot;
        if (next.type !== 'telemetry' || !('current' in next)) throw new Error('Invalid telemetry message');
        latest = next;
        const changed = applySnapshot(paused ? { ...next, current: snapshot.current } : next);
        received = Date.now();
        if (changed) notify();
      } catch {
        snapshot = { ...snapshot, status: 'ERROR', stale: true, error: 'WebSocket message parsing failed' }; notify();
      }
    };
    socket.onerror = () => { connection = 'ERROR'; notify(); };
    socket.onclose = () => {
      if (stopped) return;
      connection = 'RECONNECTING'; snapshot = { ...snapshot, stale: true, status: 'DISCONNECTED' }; notify();
      retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000));
    };
  };
  connect();
  const watchdog = setInterval(() => {
    if (received && Date.now() - received > snapshot.stale_after_ms && !snapshot.stale) {
      snapshot = { ...snapshot, stale: true, status: 'STALE' }; notify();
    }
  }, 500);
  return () => { stopped = true; clearTimeout(retry); clearInterval(watchdog); socket?.close(); };
}
