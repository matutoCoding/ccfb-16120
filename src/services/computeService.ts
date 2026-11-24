import type {
  ConductorType,
  LineData,
  TensionSection,
  Tower,
  WorkCondition,
} from '../types';
import {
  solveSection,
  spanIce,
  type SectionResult,
} from '../physics/sectionSolver';
import { attachmentOf } from '../data/towerTemplates';
import type { CableCurve3D } from '../physics/galloping';
import { spanToWorld } from '../physics/clearance';

export const CABLE_ROLES = ['A', 'B', 'C', 'GW1', 'GW2'] as const;
export type CableRole = (typeof CABLE_ROLES)[number];

/** 挂点世界坐标(不含悬垂串偏移) */
export function attachmentWorld(
  tower: Tower,
  role: CableRole,
): { x: number; y: number; z: number } {
  const ov = tower.attachmentOverrides?.[role];
  const local = attachmentOf(tower.form, tower.height, role, ov);
  return {
    x: tower.mileage,
    y: local.y,
    z: tower.groundZ + local.dz,
  };
}

export interface SectionComputed {
  section: TensionSection;
  phase: SectionResult;
  ground: SectionResult;
  phaseConductor: ConductorType;
  groundConductor: ConductorType;
}

/** 计算一条线路在指定工况下全部耐张段的相导线与地线力学 */
export function computeLine(
  line: LineData,
  condition: WorkCondition,
): SectionComputed[] {
  return line.sections.map((section) => {
    const phaseConductor = line.conductors.find(
      (c) => c.id === section.conductorId,
    )!;
    const groundConductor = line.conductors.find(
      (c) => c.id === section.groundId,
    )!;
    const zOf = (towerId: string, role: CableRole) => {
      const tw = line.towers.find((t) => t.id === towerId)!;
      return attachmentWorld(tw, role).z;
    };
    const phase = solveSection({
      line,
      section,
      conductor: phaseConductor,
      condition,
      attachmentZ: (id) => zOf(id, 'B'),
    });
    const ground = solveSection({
      line,
      section,
      conductor: groundConductor,
      condition,
      attachmentZ: (id) => zOf(id, 'GW1'),
    });
    return { section, phase, ground, phaseConductor, groundConductor };
  });
}

/** 分裂导线子线偏移 (m), 返回各子线相对挂点的 (dy,dz) */
export function bundleOffsets(mode: 1 | 2 | 4, spacingMm: number): { dy: number; dz: number }[] {
  const s = spacingMm / 1000;
  if (mode === 1) return [{ dy: 0, dz: 0 }];
  if (mode === 2) return [{ dy: -s / 2, dz: 0 }, { dy: s / 2, dz: 0 }];
  return [
    { dy: -s / 2, dz: -s / 2 },
    { dy: s / 2, dz: -s / 2 },
    { dy: -s / 2, dz: s / 2 },
    { dy: s / 2, dz: s / 2 },
  ];
}

export interface SectionCableCurve extends CableCurve3D {
  /** 每档在 points 中的索引区间 [start,end] 与里程范围, 供按档精确切分 */
  segments: { spanId: string; indexStart: number; indexEnd: number; xStart: number; xEnd: number }[];
}

/**
 * 生成一条线缆(某角色、含分裂子线)在静态工况下的世界坐标曲线
 * 每根子线一条 SectionCableCurve
 */
export function buildCableCurves(opts: {
  line: LineData;
  computed: SectionComputed;
  result: SectionResult;
  role: CableRole;
  bundleMode: 1 | 2 | 4;
  spacingMm: number;
  swingDx: Map<string, number>;
  swingDz: Map<string, number>;
  swingDy: Map<string, number>;
}): SectionCableCurve[] {
  const { line, result, role, swingDx, swingDz, swingDy } = opts;
  const curves: SectionCableCurve[] = [];
  const offsets = bundleOffsets(opts.bundleMode, opts.spacingMm);

  for (const off of offsets) {
    const points: { x: number; y: number; z: number }[] = [];
    const segments: SectionCableCurve['segments'] = [];
    for (const mech of result.spans) {
      const span = line.spans.find((s) => s.id === mech.spanId)!;
      const t1 = line.towers.find((t) => t.id === span.fromTowerId)!;
      const a1 = attachmentWorld(t1, role);
      const dxL = swingDx.get(t1.id) ?? 0;
      const dzL = swingDz.get(t1.id) ?? 0;
      const dyL = swingDy.get(t1.id) ?? 0;
      const curve = spanToWorld({
        mech,
        xStart: a1.x + dxL,
        zStart: a1.z + dzL,
        yAttach: a1.y + dyL,
        bundleOffsetY: off.dy,
        bundleOffsetZ: off.dz,
      });
      const indexStart = points.length;
      // 首档全量, 后续档跳过重复的连接点
      if (points.length === 0) points.push(...curve.points);
      else points.push(...curve.points.slice(1));
      segments.push({
        spanId: mech.spanId,
        indexStart,
        indexEnd: points.length - 1,
        xStart: curve.points[0].x,
        xEnd: curve.points[curve.points.length - 1].x,
      });
    }
    curves.push({ points, segments });
  }
  return curves;
}

/** 各档冰厚查询(mm) */
export function iceOfSpan(line: LineData, spanId: string, wc: WorkCondition): number {
  const span = line.spans.find((s) => s.id === spanId)!;
  return spanIce(span, wc);
}
