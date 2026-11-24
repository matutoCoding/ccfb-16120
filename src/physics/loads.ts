import type { ConductorType, WorkCondition } from '../types';
import { G, ICE_DENSITY, AIR_PRESSURE_COEF, WIND_SHAPE_COEF } from './constants';

/**
 * 比载 γ (N/(m·mm²)) —— 单位长度、单位截面积上的荷载
 * 按 GB 50545 架空输电线路荷载规范口径计算
 */
export interface SpecificLoad {
  gamma1: number; // 自重比载
  gamma2: number; // 覆冰冰重比载
  gamma3: number; // 垂直总比载 (自重+冰)
  gamma4: number; // 无冰风比载
  gamma5: number; // 覆冰风比载
  gamma: number; // 综合比载 (用于悬链线求解)
  windAngle: number; // 风偏角 rad (综合荷载平面与铅垂面夹角)
  icePerMeter: number; // 每米冰重 kg/m
  windPerMeter: number; // 每米横向风荷载 N/m
  verticalPerMeter: number; // 每米垂直荷载 N/m (含分裂根数折算前, 单根)
}

/**
 * 单根导线/地线在指定工况下的比载
 * @param ice 覆冰厚度 mm (0 = 无冰, 脱冰档按 0 处理)
 */
export function specificLoad(cond: ConductorType, wc: WorkCondition, ice: number): SpecificLoad {
  const A = cond.area;
  const d = cond.diameter;
  // g1 自重
  const g1 = (cond.unitWeight * G) / A;

  // g2 冰重: 环形冰截面积 π b(d+b) mm²
  const b = Math.max(0, ice);
  const iceArea = Math.PI * b * (d + b); // mm²
  const iceMass = (ICE_DENSITY * iceArea) / 1e6; // kg/m
  const g2 = (iceMass * G) / A;
  const g3 = g1 + g2;

  // 风压
  const q = AIR_PRESSURE_COEF * wc.wind * wc.wind; // Pa
  // g4 无冰风 (d mm → m)
  const p4 = WIND_SHAPE_COEF * q * d * 1e-3; // N/m
  const g4 = p4 / A;
  // g5 覆冰风, 受风直径 d+2b
  const p5 = WIND_SHAPE_COEF * q * (d + 2 * b) * 1e-3;
  const g5 = b > 0 ? p5 / A : 0;

  const g = Math.hypot(g3, g5);
  const windAngle = Math.atan2(g5, g3);

  return {
    gamma1: g1,
    gamma2: g2,
    gamma3: g3,
    gamma4: g4,
    gamma5: g5,
    gamma: g,
    windAngle,
    icePerMeter: iceMass,
    windPerMeter: b > 0 ? p5 : p4,
    verticalPerMeter: g3 * A,
  };
}

/** 单根线每米综合荷载 N/m */
export function totalLoadPerMeter(cond: ConductorType, wc: WorkCondition, ice: number): number {
  return specificLoad(cond, wc, ice).gamma * cond.area;
}
