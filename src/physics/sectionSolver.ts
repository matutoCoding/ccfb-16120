import type {
  ConductorType,
  LineData,
  Span,
  TensionSection,
  Tower,
  WorkCondition,
} from '../types';
import { specificLoad, type SpecificLoad } from './loads';
import {
  catenaryFromH,
  pointAt,
  slopeAt,
  tensionAt,
  type CatenarySolution,
} from './catenary';
import { representativeSpan, solveStateStress, installGamma } from './stateEquation';

/** 悬垂串单位长度重量估算 kg/m (复合绝缘子) */
export const STRING_UNIT_WEIGHT = 12;

export interface SpanMechanics {
  spanId: string;
  spanIndex: number;
  L: number; // 计算用水平档距(含串偏移修正)
  h: number; // 计算用高差
  ice: number; // 实际冰厚 mm
  load: SpecificLoad;
  H: number; // 水平张力 N
  TStart: number; // 起点张力 N
  TEnd: number; // 终点张力 N
  catenary: CatenarySolution;
  maxSag: number; // 最大弧垂 m (最低点相对起点悬挂连线... 采用最低点对弦的垂直距离)
  lowPointMileage: number; // 最低点里程
  lowPointZ: number; // 最低点世界坐标高程(不含风偏平面外的量, 为荷载平面内值)
  /** 荷载平面采样: u 距起点水平距离, v 向下位移(相对起点悬挂点) */
  samples: { u: number; v: number }[];
}

export interface StringSwing {
  towerId: string;
  longitudinalAngle: number; // 纵向偏角 rad (正: 沿里程增大方向)
  transverseAngle: number; // 横向风偏角 rad
  dx: number; // 挂点纵向位移 m
  dy: number; // 横向位移 m
  dz: number; // 竖向位移 m(负值下沉)
}

export interface SectionResult {
  sectionId: string;
  cableKind: 'phase' | 'ground';
  Lr: number;
  sigma: number; // 代表档距状态方程应力 MPa (均匀参考解)
  spans: SpanMechanics[];
  swings: StringSwing[];
  /** 每档最低点最大弧垂(对弦)列表, 便于报表 */
  sags: { spanId: string; sag: number }[];
}

const SAMPLE_COUNT = 40;

/** 取档的实际冰厚: 覆盖值优先, 脱冰档=0, 否则工况默认 */
export function spanIce(span: Span, wc: WorkCondition): number {
  if (wc.deIce) {
    // 脱冰工况: -1 标记该档完全脱冰, 其余档取覆盖值或工况默认冰厚
    return span.iceOverride === -1 ? 0 : span.iceOverride ?? wc.ice;
  }
  // 普通工况: 仅接受非负的档级覆盖, -1(脱冰标记)忽略
  if (span.iceOverride != null && span.iceOverride >= 0) return span.iceOverride;
  return wc.ice;
}

function towerById(line: LineData, id: string): Tower {
  const t = line.towers.find((x) => x.id === id);
  if (!t) throw new Error(`杆塔不存在: ${id}`);
  return t;
}

/**
 * 求解一个耐张段内一种线缆(相导线或地线)在指定工况下的力学形态
 * 连续档处理: 各档先按代表档距状态方程独立求应力 → 悬垂串张力差偏摆 →
 * 修正档端坐标后重解, 迭代 3 轮(均匀荷载下偏移自然为 0, 退化为标准状态方程解)
 */
export function solveSection(opts: {
  line: LineData;
  section: TensionSection;
  conductor: ConductorType;
  condition: WorkCondition;
  attachmentZ: (towerId: string) => number; // 挂点世界高程提供器
  attachmentY?: (towerId: string) => number; // 挂点横向坐标(风偏展示用)
}): SectionResult {
  const { line, section, conductor: c, condition: wc, attachmentZ } = opts;
  const spans = section.spanIds
    .map((id) => line.spans.find((s) => s.id === id)!)
    .filter(Boolean);
  const A = c.area;
  const E = c.elasticModulus;
  const g0 = installGamma(c);
  const sigma0 = section.installStress;
  const temp0 = section.installTemp;

  const spanInfos = spans.map((sp) => {
    const t1 = towerById(line, sp.fromTowerId);
    const t2 = towerById(line, sp.toTowerId);
    const L0geo = t2.mileage - t1.mileage;
    const h0geo = attachmentZ(sp.toTowerId) - attachmentZ(sp.fromTowerId);
    return { span: sp, Lbase: L0geo, hBase: h0geo, t1, t2 };
  });

  const Lr = representativeSpan(spanInfos.map((x) => ({ spanLength: x.Lbase })));

  // 各档荷载
  const loads = spanInfos.map(({ span }) => {
    const ice = spanIce(span, wc);
    return { ice, load: specificLoad(c, wc, ice) };
  });

  // 悬垂串偏摆迭代(纵向 + 横向)
  const interiorTowers = new Set<string>();
  for (let i = 0; i < spanInfos.length; i++) {
    const tw = spanInfos[i].t1;
    if (tw.kind === 'suspension') interiorTowers.add(tw.id);
  }
  const swingMap = new Map<string, StringSwing>();
  for (const id of interiorTowers) {
    const tw = towerById(line, id);
    swingMap.set(id, {
      towerId: id,
      longitudinalAngle: 0,
      transverseAngle: 0,
      dx: 0,
      dy: 0,
      dz: 0,
    });
    void tw;
  }

  // 各档状态方程参考应力(独立解, 作为连续档均衡前的初值与对照)
  const sigmaRefEach = spanInfos.map(({ span }, i) => {
    const { load } = loads[i];
    return solveStateStress({
      conductor: c,
      Lr,
      gamma: load.gamma,
      temp: wc.temp,
      sigma0,
      gamma0: g0,
      temp0,
    });
  });

  let mech: SpanMechanics[] = [];

  for (let iter = 0; iter < 5; iter++) {
    // 连续档水平张力均衡: 求全段统一 H*, 使各档在自身荷载下的线长
    // 与状态方程独立解的参考线长加权守恒(等效线长协调), 保证悬垂串张力差仅来自残余不平衡
    const Href = sigmaRefEach.map((s) => s * A);
    const refLengths = spanInfos.map((info, i) => {
      const swingL = swingMap.get(info.t1.id);
      const swingR = swingMap.get(info.t2.id);
      const L = info.Lbase + (swingR?.dx ?? 0) - (swingL?.dx ?? 0);
      const h = info.hBase + (swingR?.dz ?? 0) - (swingL?.dz ?? 0);
      return catenaryFromH({ L, h }, Href[i], loads[i].load.gamma * A).s;
    });
    // 二分统一 H*: 总参考线长 = 总均衡线长
    const totalRef = refLengths.reduce((a, b) => a + b, 0);
    let lo = Href[0] * 0.3;
    let hi = Href[0] * 2.5;
    const totalLengthAt = (Hstar: number) =>
      spanInfos.reduce((sum, info, i) => {
        const swingL = swingMap.get(info.t1.id);
        const swingR = swingMap.get(info.t2.id);
        const L = info.Lbase + (swingR?.dx ?? 0) - (swingL?.dx ?? 0);
        const h = info.hBase + (swingR?.dz ?? 0) - (swingL?.dz ?? 0);
        return sum + catenaryFromH({ L, h }, Hstar, loads[i].load.gamma * A).s;
      }, 0);
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (totalLengthAt(mid) > totalRef) lo = mid;
      else hi = mid;
    }
    const Hstar = (lo + hi) / 2;
    // 各档残余不平衡: 悬垂串可自由偏摆但夹具有摩擦, 实际张力介于"全均衡"与
    // "状态方程独立解"之间。取 8% 的独立解偏差作为有界残余不平衡张力,
    // 均匀荷载下各档独立解相同 → 残余为 0, 串严格竖直。
    const Heach = spanInfos.map((_, i) => Hstar + 0.08 * (Href[i] - Hstar));

    mech = spanInfos.map((info, idx) => {
      const swingL = swingMap.get(info.t1.id);
      const swingR = swingMap.get(info.t2.id);
      const dxL = swingL?.dx ?? 0;
      const dxR = swingR?.dx ?? 0;
      const dzL = swingL?.dz ?? 0;
      const dzR = swingR?.dz ?? 0;
      const L = info.Lbase + dxR - dxL;
      const h = info.hBase + dzR - dzL;
      const { load, ice } = loads[idx];
      const w = load.gamma * A;

      // 连续档水平张力(均衡 + 有界残余不平衡)
      const H = Heach[idx];
      const cat = catenaryFromH({ L, h }, H, w);
      const samples = Array.from({ length: SAMPLE_COUNT + 1 }, (_, k) => {
        const u = (L * k) / SAMPLE_COUNT;
        return pointAt(cat, u);
      });

      // 最低点里程与高程(最低点在档外时取档内最低端点)
      const x0 = cat.lowPointU;
      const lowU = Math.min(Math.max(x0, 0), L);
      const lowV = pointAt(cat, lowU).v;
      const zStart = attachmentZ(info.t1.id) + dzL;
      const lowPointZ = zStart - lowV;
      const lowPointMileage = info.t1.mileage + dxL + lowU;

      // 最大弧垂: 全采样点上链与弦的竖向间距(弦 v=h·u/L, 向下为正)最大值
      // 对最低点落在档外的陡坡档同样给出正值
      let maxSag = -Infinity;
      for (const p of samples) {
        const sag = (h * p.u) / L - p.v;
        if (sag > maxSag) maxSag = sag;
      }

      return {
        spanId: info.span.id,
        spanIndex: idx,
        L,
        h,
        ice,
        load,
        H,
        TStart: tensionAt(cat, 0),
        TEnd: tensionAt(cat, L),
        catenary: cat,
        maxSag,
        lowPointMileage,
        lowPointZ,
        samples,
      } satisfies SpanMechanics;
    });

    // 更新悬垂串偏角
    for (const towerId of interiorTowers) {
      const tw = towerById(line, towerId);
      const leftIdx = spanInfos.findIndex((x) => x.t2.id === towerId);
      const rightIdx = spanInfos.findIndex((x) => x.t1.id === towerId);
      const left = leftIdx >= 0 ? mech[leftIdx] : undefined;
      const right = rightIdx >= 0 ? mech[rightIdx] : undefined;
      const Hl = left?.H ?? right?.H ?? 0;
      const Hr = right?.H ?? left?.H ?? 0;
      const wl = left ? left.load.gamma * A : 0;
      const wr = right ? right.load.gamma * A : 0;
      // 悬垂点两侧导线张力的纵向(水平)分量: 左档指向 -x, 右档指向 +x
      // 纵向不平衡张力 = 右档端张力水平分量 - 左档端张力水平分量
      const TxLeft = left ? tensionAt(left.catenary, left.L) * Math.cos(slopeAt(left.catenary, left.L)) : 0;
      const TxRight = right ? tensionAt(right.catenary, 0) * Math.cos(slopeAt(right.catenary, 0)) : 0;
      const unbalancedTx = TxRight - TxLeft;
      // 串重 + 两侧各半档垂直荷载(竖向力)
      const Wstring = tw.stringLength * STRING_UNIT_WEIGHT * 9.80665;
      const Wspan =
        (left ? (wl * left.L) / 2 : 0) + (right ? (wr * right.L) / 2 : 0);
      const W = Wstring + Wspan;
      // 横向力: 两侧风荷载各半档
      const Pwind =
        (left ? (left.load.windPerMeter * left.L) / 2 : 0) +
        (right ? (right.load.windPerMeter * right.L) / 2 : 0);
      const thetaLong = Math.atan2(unbalancedTx, W);
      const thetaWind = Math.atan2(Pwind, W);
      const l = tw.stringLength;
      swingMap.set(towerId, {
        towerId,
        longitudinalAngle: thetaLong,
        transverseAngle: thetaWind,
        dx: l * Math.sin(thetaLong),
        dy: l * Math.sin(thetaWind),
        dz: l * (Math.cos(thetaLong) - 1),
      });
    }
  }

  // 均匀参考应力(报表对照用)
  const avgGamma =
    loads.reduce((s, x) => s + x.load.gamma, 0) / Math.max(1, loads.length);
  const sigmaRef = solveStateStress({
    conductor: c,
    Lr,
    gamma: avgGamma,
    temp: wc.temp,
    sigma0,
    gamma0: g0,
    temp0,
  });

  return {
    sectionId: section.id,
    cableKind: c.kind,
    Lr,
    sigma: sigmaRef,
    spans: mech,
    swings: [...swingMap.values()],
    sags: mech.map((m) => ({ spanId: m.spanId, sag: m.maxSag })),
  };
}

/** 档内任意里程处导线在荷载平面内的局部坐标 {v向下, 切线倾角} */
export function evalSpanAt(m: SpanMechanics, u: number) {
  const uu = Math.min(Math.max(u, 0), m.L);
  return { p: pointAt(m.catenary, uu), slope: slopeAt(m.catenary, uu) };
}
