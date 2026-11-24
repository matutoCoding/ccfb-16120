import type { ConductorType, WorkCondition } from '../types';
import { specificLoad } from './loads';

/**
 * 代表档距(规律档距) Lr = sqrt(ΣL³ / ΣL)
 */
export function representativeSpan(spans: { spanLength: number }[]): number {
  let sumL = 0;
  let sumL3 = 0;
  for (const s of spans) {
    sumL += s.spanLength;
    sumL3 += s.spanLength ** 3;
  }
  return Math.sqrt(sumL3 / sumL);
}

/**
 * 导线状态方程 (应力形式, 代表档距法)
 *   σ - γ²Lr²E/(24σ²) = σ0 - γ0²Lr²E/(24σ0²) - αE(t - t0)
 * 已知架线状态 (σ0, γ0, t0), 求目标工况应力 σ
 * @returns 应力 MPa (=N/mm²)
 */
export function solveStateStress(opts: {
  conductor: ConductorType;
  Lr: number;
  gamma: number; // 目标工况综合比载 N/(m·mm²)
  temp: number; // 目标工况气温 ℃
  sigma0: number; // 架线应力 MPa
  gamma0: number; // 架线比载(自重) N/(m·mm²)
  temp0: number; // 架线气温 ℃
}): number {
  const { conductor: c, Lr, gamma, temp, sigma0, gamma0, temp0 } = opts;
  const E = c.elasticModulus;
  const alpha = c.expansionCoeff;
  const K = (Lr * Lr * E) / 24;
  // 右端常数
  const C = sigma0 - (gamma0 * gamma0 * K) / (sigma0 * sigma0) - alpha * E * (temp - temp0);

  // f(σ) = σ - Kγ²/σ² - C = 0, 牛顿迭代
  let sigma = Math.max(10, sigma0 * 0.8);
  for (let i = 0; i < 80; i++) {
    const s2 = sigma * sigma;
    const f = sigma - (gamma * gamma * K) / s2 - C;
    const df = 1 + (2 * gamma * gamma * K) / (s2 * sigma);
    const next = sigma - f / df;
    if (next <= 0) {
      sigma = sigma / 2;
      continue;
    }
    if (Math.abs(next - sigma) / sigma < 1e-10) {
      sigma = next;
      break;
    }
    sigma = next;
  }
  return sigma;
}

/** 架线工况自重比载 */
export function installGamma(conductor: ConductorType): number {
  const wc: WorkCondition = {
    id: '__install__',
    name: '架线',
    temp: 15,
    ice: 0,
    wind: 0,
  };
  return specificLoad(conductor, wc, 0).gamma1;
}
