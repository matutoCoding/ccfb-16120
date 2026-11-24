import type { GallopingConfig } from '../types';

/**
 * 舞动: 导线整体做驻波运动, 截面中心的椭圆轨迹
 * 垂直向: z(t) = Av·sin(nπs)·cos(2πft)
 * 水平向: y(t) = Ah·sin(nπs)·cos(2πft + φ)
 * s = u/L ∈ [0,1], n = 半波数
 */

export interface GallopingFrame {
  t: number; // 秒
  /** 每个采样点的垂直位移(向上为正)与水平位移(横向) */
  points: { dz: number; dy: number }[];
}

export interface GallopingCurve {
  duration: number; // 一个周期 s
  nSamples: number;
  nFrames: number;
  /** frames[frame][sample] */
  frames: GallopingFrame[];
}

export function gallopingDisplacement(
  cfg: GallopingConfig,
  s: number, // 0..1
  t: number,
  phaseOffsetDeg = 0, // 各相舞动初相位差(°), 三相不同步是相间闪络的主因
): { dz: number; dy: number } {
  const n = cfg.loops;
  const Av = cfg.amplitude / 2; // 峰峰值 → 半幅
  const Ah = Av / Math.max(0.01, cfg.verticalRatio);
  const omega = 2 * Math.PI * cfg.freq;
  const phi = (cfg.phaseAngle * Math.PI) / 180;
  const psi = (phaseOffsetDeg * Math.PI) / 180;
  const envelope = Math.sin(n * Math.PI * s);
  return {
    dz: Av * envelope * Math.cos(omega * t + psi),
    dy: Ah * envelope * Math.cos(omega * t + phi + psi),
  };
}

/**
 * 预计算一条线缆的舞动帧序列
 * @param nSamples 沿线采样点数(与三维管段采样一致)
 * @param nFrames 一个周期内的帧数
 * @param phaseOffsetDeg 该线缆的舞动初相位
 */
export function buildGallopingCurve(
  cfg: GallopingConfig,
  nSamples: number,
  nFrames = 120,
  phaseOffsetDeg = 0,
): GallopingCurve {
  const duration = 1 / cfg.freq;
  const frames: GallopingFrame[] = [];
  for (let k = 0; k < nFrames; k++) {
    const t = (duration * k) / nFrames;
    const points = Array.from({ length: nSamples + 1 }, (_, i) =>
      gallopingDisplacement(cfg, i / nSamples, t, phaseOffsetDeg),
    );
    frames.push({ t, points });
  }
  return { duration, nSamples, nFrames, frames };
}

export interface CableCurve3D {
  /** 采样点世界坐标, 长度 nSamples+1 */
  points: { x: number; y: number; z: number }[];
}

/**
 * 三相 + 地线组合的逐帧最小空间距离
 * 三维画面与距离曲线共用同一份 curves 数据, 保证逐帧对得上
 * @param curves 每条线缆在各帧的世界坐标曲线 curves[cable][frame]
 * @param pairs 需要考察的线缆对(如三相两两)
 */
export function pairDistanceTimeline(
  curves: CableCurve3D[][],
  pairs: [number, number][],
  times: number[],
): {
  pair: [number, number];
  timeline: { t: number; minDistance: number; sampleIndex: number }[];
  min: number;
  minFrame: number;
}[] {
  return pairs.map(([ai, bi]) => {
    const timeline = times.map((t, f) => {
      const A = curves[ai][f].points;
      const B = curves[bi][f].points;
      let best = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < A.length; i++) {
        const d = Math.hypot(
          A[i].x - B[i].x,
          A[i].y - B[i].y,
          A[i].z - B[i].z,
        );
        if (d < best) {
          best = d;
          bestIdx = i;
        }
      }
      return { t, minDistance: best, sampleIndex: bestIdx };
    });
    let min = Infinity;
    let minFrame = 0;
    timeline.forEach((r, i) => {
      if (r.minDistance < min) {
        min = r.minDistance;
        minFrame = i;
      }
    });
    return { pair: [ai, bi], timeline, min, minFrame };
  });
}
