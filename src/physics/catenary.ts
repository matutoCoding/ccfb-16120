/**
 * 精确悬链线几何
 * 约定: 荷载平面内坐标 (u 水平, v 向下为正), 两端点 (0,0) 与 (L, h), h 为终点相对起点高差(可负)
 * 水平张力 H (N), 沿线索单位长度荷载 w (N/m), 参数 a = H/w
 */

export interface CatenaryEnds {
  L: number; // 水平档距 m
  h: number; // 高差 m (终点-起点, 终点高为正)
}

export interface CatenarySolution {
  a: number; // H/w
  H: number; // 水平张力 N
  w: number;
  s: number; // 悬链线总长 m
  /** 最低点距起点的水平距离 m; 负值表示最低点落在起点外侧(档外) */
  lowPointU: number;
  /** 最低点相对起点的下垂量 m (正数表示低于起点) */
  lowPointSag: number;
  /** 档内中点(弧垂)下垂量 m, 相对两端点连线 */
  midSpanSag: number;
}

const cosh = Math.cosh;
const sinh = Math.sinh;
const asinh = Math.asinh;

/** 由 a 求悬链线总长与最低点位置等几何量 */
export function solveGeometry(ends: CatenaryEnds, a: number): Omit<CatenarySolution, 'H' | 'w'> {
  const { L, h } = ends;
  // 最低点相对起点的水平偏移: x0 = L/2 - a*asinh(h/(2a*sinh(L/2a)))
  const x0 = L / 2 - a * asinh(h / (2 * a * sinh(L / (2 * a))));
  // 终点相对最低点的参数差
  const u2 = L - x0;
  const u1 = -x0;
  // 长度
  const s = a * (sinh(u2 / a) - sinh(u1 / a));
  // 最低点相对起点的下垂量: 起点在最低点上方 a*(cosh(u1/a)-1)
  const lowPointSag = a * (cosh(u1 / a) - 1);
  // 中点弧垂(相对弦): 弦在 L/2 处的 v 坐标为 h/2; 链在 L/2 处 v = a(cosh((L/2-x0)/a)-cosh(u1/a))
  const vMid = a * (cosh((L / 2 - x0) / a) - cosh(u1 / a));
  const midSpanSag = h / 2 - vMid; // 弦高 - 链高(向下坐标), 正值为下垂
  return { a, s, lowPointU: x0, lowPointSag, midSpanSag };
}

/**
 * 已知水平张力 H 与每米荷载 w, 求整档几何
 */
export function catenaryFromH(ends: CatenaryEnds, H: number, w: number): CatenarySolution {
  const a = H / w;
  return { ...solveGeometry(ends, a), H, w };
}

/**
 * 已知线长 s 反求水平张力 H (状态方程解出线长/应变后使用)
 * 线长方程 s = 2a*sinh(L/2a)*sqrt(1 + (h/(2a*sinh(L/2a)))²)
 * 用牛顿法解 a
 */
export function catenaryFromLength(ends: CatenaryEnds, s: number, w: number): CatenarySolution {
  const { L, h } = ends;
  const chord = Math.hypot(L, h);
  if (s < chord) {
    // 数值容差保护: 线长不得小于弦长
    s = chord * 1.0000001;
  }
  // 初值: 抛物线近似 s ≈ chord + w²L³/(24H²) ... 直接给一个松驰初值
  let a = (L * L) / (8 * Math.max(0.01, s - chord) + 1e-9);
  if (!isFinite(a) || a <= 0) a = L * 2;

  for (let iter = 0; iter < 60; iter++) {
    const z = L / (2 * a);
    const sh = sinh(z);
    const ch = cosh(z);
    const q = h / (2 * a * sh);
    const sCalc = 2 * a * sh * Math.sqrt(1 + q * q);
    const f = sCalc - s;
    // ds/da 数值导数(解析导数较繁, 用中心差分足够稳)
    const da = a * 1e-7;
    const z2 = L / (2 * (a + da));
    const sh2 = sinh(z2);
    const q2 = h / (2 * (a + da) * sh2);
    const sPlus = 2 * (a + da) * sh2 * Math.sqrt(1 + q2 * q2);
    const dSda = (sPlus - sCalc) / da;
    if (Math.abs(f) < 1e-10) break;
    const next = a - f / dSda;
    if (next <= 0) {
      a = a / 2;
    } else {
      a = next;
    }
  }
  const H = a * w;
  return { ...solveGeometry(ends, a), a, H, w };
}

/**
 * 悬链线上任意点坐标(荷载平面内, v 向下为正)
 * @param u 距起点水平距离 0..L
 */
export function pointAt(sol: CatenarySolution, u: number): { u: number; v: number } {
  const x0 = sol.lowPointU;
  const u1 = -x0;
  const v = sol.a * (Math.cosh((u - x0) / sol.a) - Math.cosh(u1 / sol.a));
  return { u, v };
}

/** 悬链线在 u 处的切线倾角 rad (相对水平线, 向下为正) */
export function slopeAt(sol: CatenarySolution, u: number): number {
  const x0 = sol.lowPointU;
  return Math.atan(Math.sinh((u - x0) / sol.a));
}

/** 悬链线在 u 处的张力 N (T = H*cosh((u-x0)/a)) */
export function tensionAt(sol: CatenarySolution, u: number): number {
  return sol.H * Math.cosh((u - sol.lowPointU) / sol.a);
}

/** 采样整条悬链线, 返回 n+1 个点(含两端) */
export function sampleCatenary(
  sol: CatenarySolution,
  ends: CatenaryEnds,
  n: number,
): { u: number; v: number }[] {
  const pts: { u: number; v: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const u = (ends.L * i) / n;
    pts.push(pointAt(sol, u));
  }
  return pts;
}

/**
 * 抛物线近似弧垂(用于初值与对照): f = w L² /(8 H) (平档)
 */
export function parabolicSag(L: number, w: number, H: number): number {
  return (w * L * L) / (8 * H);
}
