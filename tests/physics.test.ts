import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catenaryFromH, catenaryFromLength, parabolicSag } from '../src/physics/catenary';
import { solveStateStress, representativeSpan } from '../src/physics/stateEquation';
import { specificLoad } from '../src/physics/loads';
import type { ConductorType, WorkCondition } from '../src/types';

// LGJ-400/35 典型参数
const cond: ConductorType = {
  id: 'lgj400',
  name: 'LGJ-400/35',
  kind: 'phase',
  area: 425.24,
  diameter: 26.82,
  unitWeight: 1.349,
  elasticModulus: 65000,
  expansionCoeff: 2.05e-5,
  ratedStrength: 103900,
};

const wc15: WorkCondition = { id: 't15', name: '15℃', temp: 15, ice: 0, wind: 0 };

test('平档悬链线: 已知H反解线长再回解, 弧垂与抛物线小偏差一致', () => {
  const L = 400;
  const H = 40000; // N
  const w = cond.unitWeight * 9.80665;
  const cat = catenaryFromH({ L, h: 0 }, H, w);

  // 手算抛物线弧垂 f = wL²/(8H)
  const fParabola = parabolicSag(L, w, H);
  // 悬链线中点弧垂(精确)
  const fExact = cat.midSpanSag;
  const rel = Math.abs(fExact - fParabola) / fParabola;
  // 400m 档、f/L≈6.6% 时两者偏差应在 0.5% 以内
  assert.ok(rel < 0.005, `弧垂偏差 ${(rel * 100).toFixed(3)}% 超出 0.5%`);

  // 线长反解 H 必须还原
  const back = catenaryFromLength({ L, h: 0 }, cat.s, w);
  assert.ok(Math.abs(back.H - H) / H < 1e-6, '线长反解水平张力失败');
  assert.ok(Math.abs(back.midSpanSag - fExact) / fExact < 1e-6);
});

test('高差档悬链线: 线长往返一致性', () => {
  const L = 350;
  const h = 45;
  const H = 42000;
  const w = cond.unitWeight * 9.80665;
  const cat = catenaryFromH({ L, h }, H, w);
  const back = catenaryFromLength({ L, h }, cat.s, w);
  assert.ok(Math.abs(back.H - H) / H < 1e-6);
  // 高陡档最低点可落在档外(低端外侧), 属正常物理现象
  assert.ok(cat.lowPointU < 0, '终点高、档距短的陡坡, 最低点应在起点外侧');
});

test('缓高差档悬链线: 最低点落在档内', () => {
  const L = 500;
  const h = 20;
  const H = 38000;
  const w = cond.unitWeight * 9.80665;
  const cat = catenaryFromH({ L, h }, H, w);
  assert.ok(cat.lowPointU > 0 && cat.lowPointU < L, '缓坡档最低点应在档内');
  const back = catenaryFromLength({ L, h }, cat.s, w);
  assert.ok(Math.abs(back.H - H) / H < 1e-6);
});

test('比载: 自重比载与手算一致', () => {
  const load = specificLoad(cond, wc15, 0);
  const expected = (cond.unitWeight * 9.80665) / cond.area;
  assert.ok(Math.abs(load.gamma1 - expected) / expected < 1e-12);
  assert.ok(Math.abs(load.gamma - expected) < 1e-12); // 无风无冰综合=自重
});

test('覆冰比载: 10mm 冰重手算核对', () => {
  const wc: WorkCondition = { id: 'ice10', name: '覆冰10', temp: -5, ice: 10, wind: 10 };
  const load = specificLoad(cond, wc, 10);
  const d = cond.diameter;
  const iceArea = Math.PI * 10 * (d + 10); // mm²
  const iceMass = (900 * iceArea) / 1e6; // kg/m
  assert.ok(Math.abs(load.icePerMeter - iceMass) / iceMass < 1e-12);
  assert.ok(load.gamma3 > load.gamma1);
  assert.ok(load.gamma5 > 0); // 覆冰风
});

test('状态方程: 降温工况应力升高、高温工况应力降低', () => {
  const Lr = 400;
  const g0 = specificLoad(cond, wc15, 0).gamma1;
  const sigma0 = 0.25 * (cond.ratedStrength / cond.area); // 年平均应力

  const cold = solveStateStress({
    conductor: cond,
    Lr,
    gamma: g0,
    temp: -20,
    sigma0,
    gamma0: g0,
    temp0: 15,
  });
  const hot = solveStateStress({
    conductor: cond,
    Lr,
    gamma: g0,
    temp: 40,
    sigma0,
    gamma0: g0,
    temp0: 15,
  });
  assert.ok(cold > sigma0, '低温应力应升高');
  assert.ok(hot < sigma0, '高温应力应降低');

  // 同温同荷载 → 恒等
  const same = solveStateStress({
    conductor: cond,
    Lr,
    gamma: g0,
    temp: 15,
    sigma0,
    gamma0: g0,
    temp0: 15,
  });
  assert.ok(Math.abs(same - sigma0) / sigma0 < 1e-8);
});

test('状态方程手算复核 (教材经典算例口径, 误差<1%)', () => {
  // 取 LGJ-400/35, Lr=400m, 架线 15℃ 应力 61.1MPa(=25%RTS/A)
  // 高温 40℃ 无冰: 用教材迭代公式独立手算
  const Lr = 400;
  const g = specificLoad(cond, wc15, 0).gamma1;
  const sigma0 = 0.25 * (cond.ratedStrength / cond.area);
  const E = cond.elasticModulus;
  const alpha = cond.expansionCoeff;
  const K = (Lr * Lr * E) / 24;

  // 独立手算: σ³ - Cσ² - Kg² = 0, C = σ0 - Kg²/σ0² - αEΔt
  const dt = 40 - 15;
  const C = sigma0 - (K * g * g) / (sigma0 * sigma0) - alpha * E * dt;
  // 三次方程求正根(二分)
  let lo = 1;
  let hi = sigma0 * 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const f = mid ** 3 - C * mid * mid - K * g * g;
    if (f > 0) hi = mid;
    else lo = mid;
  }
  const manual = (lo + hi) / 2;
  const solver = solveStateStress({
    conductor: cond,
    Lr,
    gamma: g,
    temp: 40,
    sigma0,
    gamma0: g,
    temp0: 15,
  });
  assert.ok(
    Math.abs(solver - manual) / manual < 0.001,
    `状态方程解 ${solver.toFixed(3)} vs 手算 ${manual.toFixed(3)}`,
  );

  // 再由应力算 400m 平档弧垂, 与抛物线手算比 <1%
  const H = solver * cond.area;
  const w = g * cond.area;
  const cat = catenaryFromH({ L: 400, h: 0 }, H, w);
  const fManual = (w * 400 * 400) / (8 * H);
  assert.ok(
    Math.abs(cat.midSpanSag - fManual) / fManual < 0.01,
    `弧垂 ${cat.midSpanSag.toFixed(3)} vs 手算 ${fManual.toFixed(3)}`,
  );
});

test('代表档距计算', () => {
  const spans = [300, 350, 400, 350, 300].map((spanLength) => ({ spanLength }));
  const Lr = representativeSpan(spans);
  const sumL3 = spans.reduce((s, x) => s + x.spanLength ** 3, 0);
  const sumL = spans.reduce((s, x) => s + x.spanLength, 0);
  assert.ok(Math.abs(Lr - Math.sqrt(sumL3 / sumL)) < 1e-9);
});

test('覆冰工况弧垂大于无冰同温工况', () => {
  const Lr = 400;
  const g0 = specificLoad(cond, wc15, 0).gamma1;
  const sigma0 = 0.25 * (cond.ratedStrength / cond.area);
  const wcIce: WorkCondition = { id: 'i', name: '冰', temp: -5, ice: 15, wind: 10 };
  const gIce = specificLoad(cond, wcIce, 15).gamma;

  const sNoIce = solveStateStress({
    conductor: cond, Lr, gamma: g0, temp: -5, sigma0, gamma0: g0, temp0: 15,
  });
  const sIce = solveStateStress({
    conductor: cond, Lr, gamma: gIce, temp: -5, sigma0, gamma0: g0, temp0: 15,
  });
  const H0 = sNoIce * cond.area;
  const H1 = sIce * cond.area;
  const f0 = catenaryFromH({ L: 400, h: 0 }, H0, g0 * cond.area).midSpanSag;
  const f1 = catenaryFromH({ L: 400, h: 0 }, H1, gIce * cond.area).midSpanSag;
  assert.ok(f1 > f0, '覆冰弧垂应显著增大');
});
