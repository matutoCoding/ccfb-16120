/**
 * 覆冰截面几何
 * 不是均匀加粗的圆环: 按迎风侧偏厚生成
 *  - crescent 新月形: 冰厚沿圆周按 cosθ 分布, 迎风侧最厚
 *  - airfoil 翼形: 新月形基础上叠加偏心, 形心向迎风侧偏移并拉长, 近似 D 形翼
 * 截面局部坐标: y 横向(迎风方向 +), z 竖直
 */

export type IceShape = 'crescent' | 'airfoil';

export interface IceRing {
  /** 轮廓点(局部坐标 y,z), 绕导线中心闭合, 长度 n+1 */
  outer: { y: number; z: number }[];
  innerR: number; // 导线半径 m
  /** 冰截面面积 m² */
  area: number;
  /** 冰形心偏移(相对导线中心) m */
  centroidY: number;
}

/**
 * 生成覆冰环截面轮廓
 * @param radius 导线半径 m
 * @param ice 标称冰厚 b m (迎风侧最大厚度)
 * @param shape 冰形
 * @param n 轮廓分段数
 */
export function iceSection(
  radius: number,
  ice: number,
  shape: IceShape,
  n = 16,
): IceRing {
  const outer: { y: number; z: number }[] = [];
  let area = 0;
  let cy = 0;
  for (let i = 0; i <= n; i++) {
    const theta = (2 * Math.PI * i) / n;
    // 迎风侧 θ=0 (+y) 最厚 b, 背风侧 θ=π 最薄 0.15b
    const cosT = Math.cos(theta);
    const thicknessFactor = 0.575 + 0.425 * cosT; // 1.0 .. 0.15
    let bLocal = ice * thicknessFactor;
    let y: number;
    let z: number;
    if (shape === 'airfoil') {
      // 翼形: 上下表面不对称, 迎风侧拉长(类 D 形), 形心偏移
      const stretch = 1 + 0.35 * ice / Math.max(radius, 1e-6);
      const r = radius + bLocal;
      y = r * cosT * stretch;
      z = r * Math.sin(theta) * (0.82 + 0.1 * cosT);
    } else {
      const r = radius + bLocal;
      y = r * cosT;
      z = r * Math.sin(theta);
    }
    outer.push({ y, z });
    if (i < n) {
      // 扇形面积累加(多边形 shoelace 在闭合后统一算)
      area += 0.5;
      cy += y;
    }
  }
  // shoelace 面积
  let shoelace = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const p1 = outer[i];
    const p2 = outer[(i + 1) % n];
    shoelace += p1.y * p2.z - p2.y * p1.z;
    sumY += p1.y;
    count++;
  }
  area = Math.abs(shoelace) / 2 - Math.PI * radius * radius;
  cy = sumY / count;
  return { outer, innerR: radius, area, centroidY: shape === 'airfoil' ? cy * 0.6 : cy * 0.35 };
}

/**
 * 沿档距渐变的冰厚: 两端挂点处稍薄、档中最厚(实测覆冰分布趋势)
 * @param s 0..1 档内归一化位置
 * @param iceBase 该档标称冰厚 m
 */
export function taperedIce(s: number, iceBase: number): number {
  const taper = 0.85 + 0.15 * Math.sin(Math.PI * s);
  return iceBase * taper;
}
