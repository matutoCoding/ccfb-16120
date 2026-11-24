import type {
  LineData,
  Span,
  TensionSection,
  Tower,
  TerrainSample,
  Crossing,
  WorkCondition,
} from '../types';
import { CONDUCTOR_LIBRARY, everydayStress } from './conductors';
import { DEFAULT_CLEARANCE } from '../physics/constants';

/**
 * 生成测试线路: 8 基塔、2 个耐张段的山区 220kV 线路
 * N1(耐张) — N2..N4(直线) — N5(耐张) — N6..N7(直线) — N8(耐张)
 * 含一处跨公路(第3档)和一处跨 10kV 线(第6档)
 */

const TOWER_HEIGHTS = [36, 42, 48, 45, 39, 44, 50, 40];
// 档距 m
const SPAN_L = [320, 380, 420, 360, 340, 400, 350];
// 各塔位地面高程 m (山区起伏, 山脊不过高以保证档中对地净距)
const GROUND_Z = [88, 92, 98, 100, 92, 90, 96, 94];
const MILEAGES = (() => {
  const m = [0];
  for (let i = 0; i < SPAN_L.length; i++) m.push(m[i] + SPAN_L[i]);
  return m;
})();

function makeTowers(): Tower[] {
  const strainIdx = new Set([0, 4, 7]); // N1, N5, N8
  return TOWER_HEIGHTS.map((h, i) => {
    const isStrain = strainIdx.has(i);
    return {
      id: `tower-${i + 1}`,
      no: `N${i + 1}`,
      kind: isStrain ? 'strain' : 'suspension',
      form: isStrain ? 'strain' : i % 2 === 0 ? 'cathead' : 'cup',
      height: h,
      mileage: MILEAGES[i],
      groundZ: GROUND_Z[i],
      stringLength: isStrain ? 4.5 : 5.2,
      remark: isStrain ? '耐张塔' : '直线塔',
    } satisfies Tower;
  });
}

function makeSpans(towers: Tower[]): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < towers.length - 1; i++) {
    spans.push({
      id: `span-${i + 1}`,
      fromTowerId: towers[i].id,
      toTowerId: towers[i + 1].id,
      spanLength: SPAN_L[i],
      elevationDiff:
        GROUND_Z[i + 1] + TOWER_HEIGHTS[i + 1] - (GROUND_Z[i] + TOWER_HEIGHTS[i]),
    });
  }
  return spans;
}

function makeSections(towers: Tower[], spans: Span[]): TensionSection[] {
  const phase = CONDUCTOR_LIBRARY.find((c) => c.id === 'lgj-400-35')!;
  const ground = CONDUCTOR_LIBRARY.find((c) => c.id === 'opgw-100')!;
  const base = {
    conductorId: phase.id,
    groundId: ground.id,
    bundle: { mode: 2 as const, spacing: 400 },
    installTemp: 15,
    installStress: everydayStress(phase),
  };
  const sec1: TensionSection = {
    ...base,
    id: 'section-1',
    name: 'N1–N5 耐张段',
    towerIds: towers.slice(0, 5).map((t) => t.id),
    spanIds: spans.slice(0, 4).map((s) => s.id),
    galloping: {
      freq: 0.42,
      amplitude: 12,
      loops: 1,
      verticalRatio: 2,
      phaseAngle: 90,
    },
  };
  const sec2: TensionSection = {
    ...base,
    id: 'section-2',
    name: 'N5–N8 耐张段',
    towerIds: towers.slice(4).map((t) => t.id),
    spanIds: spans.slice(4).map((s) => s.id),
    galloping: {
      freq: 0.5,
      amplitude: 11,
      loops: 2,
      verticalRatio: 2,
      phaseAngle: 90,
    },
  };
  return [sec1, sec2];
}

function makeTerrain(): TerrainSample[] {
  // 中线纵断面 + 左右边线(边线做横向微起伏), 每 50m 一个点
  const total = MILEAGES[MILEAGES.length - 1];
  const samples: TerrainSample[] = [];
  const keyPoints = GROUND_Z.map((z, i) => ({ m: MILEAGES[i], z }));
  const zAt = (m: number) => {
    if (m <= keyPoints[0].m) return keyPoints[0].z;
    for (let i = 0; i < keyPoints.length - 1; i++) {
      const a = keyPoints[i];
      const b = keyPoints[i + 1];
      if (m >= a.m && m <= b.m) {
        const t = (m - a.m) / (b.m - a.m);
        // 塔腿处保持塔位高程, 档中下沉为山谷(余弦凹陷), 模拟山区走线并保证对地净距
        const dip = 14 * (1 - Math.cos(2 * Math.PI * t)) * 0.5;
        return a.z + (b.z - a.z) * t - dip;
      }
    }
    return keyPoints[keyPoints.length - 1].z;
  };
  for (let m = 0; m <= total; m += 50) {
    const z = zAt(m);
    samples.push({
      mileage: m,
      centerZ: z,
      leftZ: z - 3 - 2 * Math.sin(m / 130),
      rightZ: z - 2 + 2.5 * Math.cos(m / 110),
    });
  }
  samples.push({
    mileage: total,
    centerZ: GROUND_Z[GROUND_Z.length - 1],
    leftZ: GROUND_Z[GROUND_Z.length - 1] - 4,
    rightZ: GROUND_Z[GROUND_Z.length - 1] - 3,
  });
  return samples;
}

function makeCrossings(): Crossing[] {
  // 公路在第 3 档中部: N2→N3, 里程 = 320+380/2 = 510
  const roadM = MILEAGES[1] + SPAN_L[1] / 2;
  const road: Crossing = {
    id: 'cross-road',
    kind: 'road',
    name: 'X208 县道',
    mileage: roadM,
    width: 12,
    z: 116,
    lateralWidth: 14,
    requiredClearance: DEFAULT_CLEARANCE.road,
  };
  // 10kV 在第 6 档中部: N6→N7
  const lineM = MILEAGES[5] + SPAN_L[5] / 2;
  const line10: Crossing = {
    id: 'cross-10kv',
    kind: 'line10kv',
    name: '10kV 石坪线',
    mileage: lineM,
    width: 6,
    z: 114,
    lateralWidth: 8,
    poleHeight: 12,
    requiredClearance: DEFAULT_CLEARANCE.line10kv,
  };
  // 民房一处(第4档)
  const houseM = MILEAGES[3] + SPAN_L[3] * 0.4;
  const house: Crossing = {
    id: 'cross-house',
    kind: 'house',
    name: '山脚民房',
    mileage: houseM,
    width: 10,
    z: 122,
    lateralWidth: 12,
    requiredClearance: DEFAULT_CLEARANCE.house,
  };
  return [road, line10, house];
}

function makeConditions(): WorkCondition[] {
  return [
    { id: 'wc-max-temp', name: '最高温 40℃', temp: 40, ice: 0, wind: 0, builtin: true },
    { id: 'wc-min-temp', name: '最低温 -20℃', temp: -20, ice: 0, wind: 0, builtin: true },
    { id: 'wc-wind', name: '大风 30m/s', temp: 10, ice: 0, wind: 30, builtin: true },
    { id: 'wc-ice10', name: '覆冰 10mm', temp: -5, ice: 10, wind: 10, windOnIce: true, builtin: true },
    { id: 'wc-ice15', name: '覆冰 15mm', temp: -5, ice: 15, wind: 10, windOnIce: true, builtin: true },
    { id: 'wc-ice20', name: '覆冰 20mm', temp: -5, ice: 20, wind: 10, windOnIce: true, builtin: true },
    { id: 'wc-deice', name: '脱冰(邻档不均匀)', temp: -5, ice: 15, wind: 5, deIce: true, builtin: true },
  ];
}

export function generateDemoLine(): LineData {
  const towers = makeTowers();
  const spans = makeSpans(towers);
  // 脱冰工况: 第 2 档标记脱冰(-1 仅在 wc.deIce 下由 spanIce 解释),
  // 普通工况忽略覆盖, 保证均匀覆冰时悬垂串严格竖直
  spans[1].iceOverride = -1;
  const now = Date.now();
  return {
    id: 'demo-line',
    name: '石云山 220kV 测试线路',
    voltage: '220kV',
    corridorWidth: 40,
    towers,
    sections: makeSections(towers, spans),
    spans,
    crossings: makeCrossings(),
    terrain: makeTerrain(),
    conditions: makeConditions(),
    conductors: CONDUCTOR_LIBRARY,
    createdAt: now,
    updatedAt: now,
  };
}
