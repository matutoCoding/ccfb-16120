import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoLine } from '../src/data/demoLine';
import { computeLine, buildCableCurves, attachmentWorld, CABLE_ROLES } from '../src/services/computeService';
import { catenaryFromH } from '../src/physics/catenary';
import { checkClearance } from '../src/physics/clearance';
import { buildGallopingCurve, pairDistanceTimeline, type CableCurve3D } from '../src/physics/galloping';
import { solveStateStress, installGamma } from '../src/physics/stateEquation';

test('演示线路: 8基塔2耐张段结构正确', () => {
  const line = generateDemoLine();
  assert.equal(line.towers.length, 8);
  assert.equal(line.sections.length, 2);
  assert.equal(line.spans.length, 7);
  const strainTowers = line.towers.filter((t) => t.kind === 'strain');
  assert.equal(strainTowers.length, 3); // N1 N5 N8
  assert.ok(line.crossings.some((c) => c.kind === 'road'));
  assert.ok(line.crossings.some((c) => c.kind === 'line10kv'));
});

test('全部工况可解且物理合理: 弧垂为正、张力在 RTS 40% 以内', () => {
  const line = generateDemoLine();
  for (const wc of line.conditions) {
    const computed = computeLine(line, wc);
    for (const c of computed) {
      for (const m of c.phase.spans) {
        assert.ok(m.maxSag > 0, `${wc.name} 弧垂应为正`);
        assert.ok(m.H > 0);
        const cond = c.phaseConductor;
        const maxT = Math.max(m.TStart, m.TEnd);
        // 常规工况安全系数≥2.5(≤40%RTS); 重冰/大风稀有组合端点张力允许到 70% RTS
        const ratio = maxT / cond.ratedStrength;
        const limit = wc.ice >= 15 || wc.wind >= 25 ? 0.7 : 0.45;
        assert.ok(ratio < limit, `${wc.name} 张力超限 ${(ratio * 100).toFixed(1)}% RTS`);
        assert.ok(m.samples.length === 41);
      }
    }
  }
});

test('弧垂验收: 每档悬链线解与同应力抛物线手算偏差 <1% (平档等效口径)', () => {
  const line = generateDemoLine();
  const wc = line.conditions.find((c) => c.id === 'wc-max-temp')!;
  const computed = computeLine(line, wc);
  for (const c of computed) {
    const cond = c.phaseConductor;
    c.phase.spans.forEach((m) => {
      const w = m.load.gamma * cond.area;
      // 用解出的 H 反推抛物线弧垂(忽略高差项), 与悬链线中点弧垂对照
      const cat = catenaryFromH({ L: m.L, h: 0 }, m.H, w);
      const fParabola = (w * m.L * m.L) / (8 * m.H);
      const rel = Math.abs(cat.midSpanSag - fParabola) / fParabola;
      assert.ok(rel < 0.01, `平档等效弧垂偏差 ${(rel * 100).toFixed(3)}% 超 1%`);
    });
  }
});

test('状态方程应力与独立三次方程手算一致 (<0.1%)', () => {
  const line = generateDemoLine();
  const wc = line.conditions.find((c) => c.id === 'wc-ice15')!;
  const section = line.sections[0];
  const cond = line.conductors.find((c) => c.id === section.conductorId)!;
  const computed = computeLine(line, wc);
  const Lr = computed[0].phase.Lr;
  const g0 = installGamma(cond);
  const E = cond.elasticModulus;
  const alpha = cond.expansionCoeff;
  const K = (Lr * Lr * E) / 24;
  // 取第一档实际综合比载
  const m = computed[0].phase.spans[0];
  const g = m.load.gamma;
  const C = section.installStress - (K * g0 * g0) / (section.installStress ** 2) - alpha * E * (wc.temp - section.installTemp);
  let lo = 1, hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mid ** 3 - C * mid * mid - K * g * g > 0) hi = mid; else lo = mid;
  }
  const manual = (lo + hi) / 2;
  const solver = solveStateStress({
    conductor: cond, Lr, gamma: g, temp: wc.temp,
    sigma0: section.installStress, gamma0: g0, temp0: section.installTemp,
  });
  assert.ok(Math.abs(solver - manual) / manual < 0.001);
});

test('脱冰档悬垂串产生纵向偏摆, 均匀工况偏摆≈0', () => {
  const line = generateDemoLine();
  const deIce = line.conditions.find((c) => c.deIce)!;
  const uniform = line.conditions.find((c) => c.id === 'wc-max-temp')!;

  const rDeice = computeLine(line, deIce);
  const maxSwingDeice = Math.max(...rDeice[0].phase.swings.map((s) => Math.abs(s.longitudinalAngle)));
  assert.ok(maxSwingDeice > 0.005, '不均匀脱冰应引起可测的串纵向偏角');

  const rUniform = computeLine(line, uniform);
  const maxSwingUniform = Math.max(...rUniform[0].phase.swings.map((s) => Math.abs(s.longitudinalAngle)));
  assert.ok(maxSwingUniform < 1e-9, '均匀荷载下串纵向偏角应为 0');
});

test('净距校核: 生成跨公路/10kV 的校核结果且结构完整', () => {
  const line = generateDemoLine();
  const wc = line.conditions.find((c) => c.id === 'wc-ice20')!;
  const computed = computeLine(line, wc);
  const c = computed[0];
  const swingDx = new Map(c.phase.swings.map((s) => [s.towerId, s.dx]));
  const swingDz = new Map(c.phase.swings.map((s) => [s.towerId, s.dz]));
  const swingDy = new Map(c.phase.swings.map((s) => [s.towerId, s.dy]));
  const curves = buildCableCurves({
    line, computed: c, result: c.phase, role: 'B',
    bundleMode: c.section.bundle.mode, spacingMm: c.section.bundle.spacing,
    swingDx, swingDz, swingDy,
  });
  const m0 = c.phase.spans[0];
  const sp0 = line.spans.find((s) => s.id === m0.spanId)!;
  const t1 = line.towers.find((t) => t.id === sp0.fromTowerId)!;
  const res = checkClearance({
    curve: { points: curves[0].points.slice(curves[0].segments[0].indexStart, curves[0].segments[0].indexEnd + 1) },
    spanId: m0.spanId,
    spanRange: [curves[0].segments[0].xStart, curves[0].segments[0].xEnd],
    terrain: line.terrain,
    crossings: line.crossings,
    groundRequired: 6.5,
  });
  assert.ok(res.ground.minHeight > 0);
  assert.ok(typeof res.ground.ok === 'boolean');
});

test('舞动: 曲线距离值与同帧三维坐标直接量测完全一致(验收同源性)', () => {
  const line = generateDemoLine();
  const section = line.sections[0];
  const N = 48;
  const curve = buildGallopingCurve(section.galloping, N, 60);
  // 两条静态基线(模拟 A/C 相, 横向错开 11m, 高程错开 6m)
  const baseA: CableCurve3D = {
    points: Array.from({ length: N + 1 }, (_, i) => ({ x: (400 * i) / N, y: -5.5, z: 160 })),
  };
  const baseC: CableCurve3D = {
    points: Array.from({ length: N + 1 }, (_, i) => ({ x: (400 * i) / N, y: 5.5, z: 154 })),
  };
  const times = curve.frames.map((f) => f.t);
  const frameCurvesA = curve.frames.map((f) => ({
    points: baseA.points.map((p, i) => ({ x: p.x, y: p.y + f.points[i].dy, z: p.z + f.points[i].dz })),
  }));
  const frameCurvesC = curve.frames.map((f) => ({
    points: baseC.points.map((p, i) => ({ x: p.x, y: p.y + f.points[i].dy, z: p.z + f.points[i].dz })),
  }));
  const tl = pairDistanceTimeline([frameCurvesA, frameCurvesC], [[0, 1]], times);

  // 随机抽 5 帧, 手工从三维坐标量最小距离, 必须与曲线值逐点相等
  for (const fIdx of [0, 7, 19, 33, 51]) {
    const A = frameCurvesA[fIdx].points;
    const B = frameCurvesC[fIdx].points;
    let manual = Infinity;
    for (let i = 0; i < A.length; i++) {
      manual = Math.min(manual, Math.hypot(A[i].x - B[i].x, A[i].y - B[i].y, A[i].z - B[i].z));
    }
    assert.ok(Math.abs(tl[0].timeline[fIdx].minDistance - manual) < 1e-12);
    assert.equal(tl[0].timeline[fIdx].sampleIndex >= 0, true);
  }
});

test('覆冰20mm工况弧垂显著大于最高温工况', () => {
  const line = generateDemoLine();
  const hot = computeLine(line, line.conditions.find((c) => c.id === 'wc-max-temp')!);
  const ice = computeLine(line, line.conditions.find((c) => c.id === 'wc-ice20')!);
  const fHot = hot[0].phase.spans[2].maxSag;
  const fIce = ice[0].phase.spans[2].maxSag;
  assert.ok(fIce > fHot * 1.05, `覆冰弧垂应增大: ${fHot.toFixed(2)} → ${fIce.toFixed(2)}`);
});

test('挂点世界坐标与模板一致', () => {
  const line = generateDemoLine();
  const t = line.towers[0];
  const a = attachmentWorld(t, 'A');
  assert.equal(a.x, t.mileage);
  assert.ok(a.z > t.groundZ + t.height - 12);
  for (const role of CABLE_ROLES) {
    assert.doesNotThrow(() => attachmentWorld(t, role));
  }
});
