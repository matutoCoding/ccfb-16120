import type { CableCurve3D } from './galloping';
import type { SpanMechanics } from './sectionSolver';

/** 220kV 工频操作/雷电过电压所需的最小相间空气间隙参考值 m */
export const PHASE_GAP_LIMIT = 2.0;

/**
 * 把荷载平面(向下 v)的悬链线采样转换为世界坐标
 * 风偏角 β: 综合荷载平面相对铅垂面偏转, 横向 y = v·sinβ, 高程 z = zStart - v·cosβ
 */
export function spanToWorld(opts: {
  mech: SpanMechanics;
  xStart: number; // 起点里程(含串位移)
  zStart: number; // 起点挂点高程(含串下沉)
  yAttach: number; // 挂点横向坐标
  bundleOffsetY?: number; // 分裂导线相对挂点的横向偏移
  bundleOffsetZ?: number; // 分裂导线相对挂点的竖向偏移
}): CableCurve3D {
  const { mech, xStart, zStart, yAttach } = opts;
  const oy = opts.bundleOffsetY ?? 0;
  const oz = opts.bundleOffsetZ ?? 0;
  const beta = mech.load.windAngle;
  const sinB = Math.sin(beta);
  const cosB = Math.cos(beta);
  const points = mech.samples.map((s) => {
    const x = xStart + s.u;
    const y = yAttach + oy + s.v * sinB;
    const z = zStart + oz - s.v * cosB;
    return { x, y, z };
  });
  return { points };
}

export interface ClearanceViolation {
  crossingId: string;
  crossingName: string;
  kind: string;
  spanId: string;
  minDistance: number;
  required: number;
  mileage: number; // 最小距离点里程
  conductorZ: number;
  objectZ: number;
  ok: boolean;
}

export interface GroundClearance {
  spanId: string;
  minHeight: number; // 导线最低点对地高度 m
  required: number;
  mileage: number;
  ok: boolean;
}

/** 线性插值地形中线高程 */
export function terrainZAt(terrain: { mileage: number; centerZ: number }[], x: number): number {
  if (terrain.length === 0) return 0;
  if (x <= terrain[0].mileage) return terrain[0].centerZ;
  for (let i = 0; i < terrain.length - 1; i++) {
    const a = terrain[i];
    const b = terrain[i + 1];
    if (x >= a.mileage && x <= b.mileage) {
      const t = (x - a.mileage) / (b.mileage - a.mileage);
      return a.centerZ + (b.centerZ - a.centerZ) * t;
    }
  }
  return terrain[terrain.length - 1].centerZ;
}

function objectTopZ(
  kind: string,
  z: number,
  poleHeight: number | undefined,
  atX: number,
  centerX: number,
  width: number,
): number {
  if (kind === 'line10kv') {
    // 10kV 导线近似水平悬挂于杆顶, 档中略下垂, 这里取杆顶高程(保守)
    void atX;
    void centerX;
    void width;
    return z + (poleHeight ?? 0);
  }
  return z; // 路面、屋顶取给定高程
}

/**
 * 对一条世界坐标导线曲线做对地与跨越净距校核
 * @param spanId 该曲线所属档
 * @param spanRange 档的里程起止(只在档范围内考察跨越物)
 */
export function checkClearance(opts: {
  curve: CableCurve3D;
  spanId: string;
  spanRange: [number, number];
  terrain: { mileage: number; centerZ: number }[];
  crossings: {
    id: string;
    name: string;
    kind: string;
    mileage: number;
    width: number;
    z: number;
    poleHeight?: number;
    requiredClearance: number;
  }[];
  groundRequired: number;
}): { crossings: ClearanceViolation[]; ground: GroundClearance } {
  const { curve, spanId, spanRange, terrain, crossings, groundRequired } = opts;
  const [x0, x1] = spanRange;

  // 对地(排除两端塔位各 12m 的塔基平台, 该范围由杆塔本体占据, 不参与导线对地校核)
  const guard = 12;
  let minHeight = Infinity;
  let minMileage = x0;
  for (const p of curve.points) {
    if (p.x < x0 + guard || p.x > x1 - guard) continue;
    const gz = terrainZAt(terrain, p.x);
    const h = p.z - gz;
    if (h < minHeight) {
      minHeight = h;
      minMileage = p.x;
    }
  }
  const ground: GroundClearance = {
    spanId,
    minHeight,
    required: groundRequired,
    mileage: minMileage,
    ok: minHeight >= groundRequired,
  };

  // 跨越物
  const result: ClearanceViolation[] = [];
  for (const cr of crossings) {
    const lo = cr.mileage - cr.width / 2;
    const hi = cr.mileage + cr.width / 2;
    if (hi < x0 || lo > x1) continue;
    let best = Infinity;
    let bestMileage = cr.mileage;
    let bestCZ = 0;
    let bestOZ = 0;
    for (const p of curve.points) {
      if (p.x < lo || p.x > hi) continue;
      const oz = objectTopZ(cr.kind, cr.z, cr.poleHeight, p.x, cr.mileage, cr.width);
      const d = p.z - oz;
      if (d < best) {
        best = d;
        bestMileage = p.x;
        bestCZ = p.z;
        bestOZ = oz;
      }
    }
    if (isFinite(best)) {
      result.push({
        crossingId: cr.id,
        crossingName: cr.name,
        kind: cr.kind,
        spanId,
        minDistance: best,
        required: cr.requiredClearance,
        mileage: bestMileage,
        conductorZ: bestCZ,
        objectZ: bestOZ,
        ok: best >= cr.requiredClearance,
      });
    }
  }
  return { crossings: result, ground };
}
