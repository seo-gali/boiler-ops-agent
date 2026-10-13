import type { Registry, Sensor } from './types';

export type SensorCategory = { id: string; name: string; sensors: Sensor[] };

export function sensorCategories(registry: Registry): SensorCategory[] {
  const sensors = Object.values(registry.sensors);
  return [
    ...registry.equipment.map(item => ({ id: item.id, name: item.name })),
    { id: 'main-steam', name: '주증기 지표' },
    { id: 'generation', name: '발전 지표' },
    { id: 'unmapped', name: '위치 미확인' },
  ].map(item => ({ ...item, sensors: sensors.filter(sensor => sensor.equipment === item.id) })).filter(item => item.sensors.length);
}

export function sensorCategoryName(sensor: Sensor, registry: Registry): string {
  return registry.equipment.find(item => item.id === sensor.equipment)?.name
    ?? ({ 'main-steam': '주증기 지표', generation: '발전 지표', unmapped: '위치 미확인' }[sensor.equipment])
    ?? '분류 미확인';
}

export function sensorArea(sensor: Sensor): string {
  const tag = sensor.label;
  switch (sensor.equipment) {
    case 'feeders': {
      const feeder = tag.match(/급탄기\s*([A-F])/);
      return feeder ? `급탄기 ${feeder[1]}` : '석탄 공급';
    }
    case 'furnace': {
      if (/노내|보일러 노/.test(tag)) return '노내 튜브·헤더';
      const separator = tag.match(/기수분리기\s*([AB])/);
      if (separator) return `기수분리기 ${separator[1]}`;
      if (/버너/.test(tag)) return '버너 기울기';
      if (/공기예열기/.test(tag)) return '공기예열기';
      if (/송풍기/.test(tag)) return '송풍기';
      if (/공기/.test(tag)) return '연소공기';
      if (/산소/.test(tag)) return '산소 제어';
      return '기타 화로 지표';
    }
    case 'superheater':
      if (/스프레이|과열저감기/.test(tag)) return '스프레이·과열저감기';
      if (/디비젼/.test(tag)) return '입구 헤더·배관';
      if (/일차/.test(tag)) return '일차과열기';
      if (/판형/.test(tag)) return '판형과열기';
      if (/최종/.test(tag)) return '최종과열기';
      if (/고온/.test(tag)) return '고온과열기';
      if (/제어 루프/.test(tag)) return '과열기 제어';
      return '기타 과열기 지표';
    case 'reheater':
      if (/스프레이|과열저감기/.test(tag)) return '스프레이·과열저감기';
      if (/저온/.test(tag)) return '저온재열기';
      if (/최종/.test(tag)) return '최종재열기';
      if (/목표/.test(tag)) return '목표 온도';
      if (/제어/.test(tag)) return '온도 제어';
      return '재열증기';
    case 'economizer':
      if (/헤더/.test(tag)) return '절탄기 출구 헤더';
      if (/절탄기 입구/.test(tag)) return '절탄기 입구 급수';
      return '급수 지표';
    case 'scr': {
      const catalyst = tag.match(/환원장치\s*([AB])/);
      return catalyst ? `촉매 환원장치 ${catalyst[1]}` : '배기가스 입구';
    }
    case 'stack':
      if (/산소/.test(tag)) return '산소';
      if (/질소산화물/.test(tag)) return '질소산화물';
      if (/불투명도/.test(tag)) return '불투명도';
      return '기타 배기가스 지표';
    case 'main-steam': return /압력/.test(tag) ? '주증기 압력' : /유량/.test(tag) ? '주증기 유량' : '기타 주증기 지표';
    case 'generation': return '발전량';
    default: return '원본 이름만 확인';
  }
}

export function sensorAreas(sensors: Sensor[]): { name: string; sensors: Sensor[] }[] {
  const areas = new Map<string, Sensor[]>();
  for (const sensor of sensors) {
    const name = sensorArea(sensor);
    const items = areas.get(name) ?? [];
    items.push(sensor);
    areas.set(name, items);
  }
  return [...areas].map(([name, items]) => ({ name, sensors: items }));
}
