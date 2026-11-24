import { store } from '../data/store';
import { h, clear, toast, numInput, fmt } from '../app/dom';
import { computeLine } from '../services/computeService';
import { specificLoad } from '../physics/loads';
import { solveStateStress, representativeSpan } from '../physics/stateEquation';
import { installGamma } from '../physics/stateEquation';
import { catenaryFromH } from '../physics/catenary';
import type { LineData, WorkCondition } from '../types';

export function renderConductorsPage(root: HTMLElement): void {
  const line = store.line;
  if (!line) return;
  clear(root);

  const toolbar = h('div', { class: 'toolbar' }, [
    h('strong', { textContent: '导线地线型号库与计算工况' }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn small',
      textContent: '+ 新型号',
      onclick: () => store.update((l) => {
        l.conductors.push({
          id: `c-${Date.now()}`,
          name: '新型号',
          kind: 'phase',
          area: 300,
          diameter: 22,
          unitWeight: 1,
          elasticModulus: 65000,
          expansionCoeff: 2e-5,
          ratedStrength: 80000,
        });
        renderConductorsPage(root);
      }),
    }),
  ]);

  const body = h('div', { class: 'page-body scroll-y' });
  root.append(toolbar, body);

  // 型号库
  const libPanel = h('div', { class: 'panel', style: 'margin-bottom:14px' });
  libPanel.append(h('h3', { textContent: '型号库（截面/单位重量/弹性模量/线膨胀系数）' }));
  const libTable = h('table', {});
  libTable.append(
    h('thead', {}, [h('tr', { innerHTML: '<th>型号</th><th>用途</th><th>截面 mm²</th><th>外径 mm</th><th>kg/m</th><th>E MPa</th><th>α 1/℃</th><th>RTS N</th>' })]),
    h('tbody', {}, line.conductors.map((c) => h('tr', {}, [
      h('td', { textContent: c.name }),
      h('td', {}, [h('span', { class: `badge ${c.kind === 'phase' ? 'ok' : 'ice'}`, textContent: c.kind === 'phase' ? '相导线' : '地线' })]),
      h('td', { class: 'mono', textContent: String(c.area) }),
      h('td', { class: 'mono', textContent: String(c.diameter) }),
      h('td', { class: 'mono', textContent: String(c.unitWeight) }),
      h('td', { class: 'mono', textContent: String(c.elasticModulus) }),
      h('td', { class: 'mono', textContent: c.expansionCoeff.toExponential(2) }),
      h('td', { class: 'mono', textContent: String(c.ratedStrength) }),
    ]))),
  );
  libPanel.append(libTable);
  body.append(libPanel);

  // 分裂与舞动参数
  for (const sec of line.sections) {
    const sp = h('div', { class: 'panel', style: 'margin-bottom:14px' });
    sp.append(h('h3', { textContent: `${sec.name} — 分裂与舞动参数` }));
    sp.append(
      h('div', { class: 'flex-row', style: 'flex-wrap:wrap' }, [
        field('分裂数', h('select', {
          innerHTML: [1, 2, 4].map((m) => `<option value="${m}" ${sec.bundle.mode === m ? 'selected' : ''}>${m} 分裂</option>`).join(''),
          onchange: (e: Event) => store.update((l) => {
            l.sections.find((x) => x.id === sec.id)!.bundle.mode = Number((e.target as HTMLSelectElement).value) as 1 | 2 | 4;
          }),
        } as Partial<HTMLSelectElement>) as HTMLSelectElement),
        field('分裂间距 mm', numInput(sec.bundle.spacing, (v) => store.update((l) => {
          l.sections.find((x) => x.id === sec.id)!.bundle.spacing = v;
        }), 10)),
        field('舞动频率 Hz', numInput(sec.galloping.freq, (v) => store.update((l) => {
          l.sections.find((x) => x.id === sec.id)!.galloping.freq = v;
        }), 0.01)),
        field('峰峰振幅 m', numInput(sec.galloping.amplitude, (v) => store.update((l) => {
          l.sections.find((x) => x.id === sec.id)!.galloping.amplitude = v;
        }), 0.1)),
        field('半波数', numInput(sec.galloping.loops, (v) => store.update((l) => {
          l.sections.find((x) => x.id === sec.id)!.galloping.loops = Math.max(1, Math.round(v));
        }))),
      ]),
    );
    body.append(sp);
  }

  // 工况管理 + 状态方程对照
  const wcPanel = h('div', { class: 'panel' });
  wcPanel.append(h('h3', { textContent: '计算工况（状态方程按耐张段代表档距求解）' }));
  const wcBar = h('div', { class: 'condition-bar' });
  for (const wc of line.conditions) {
    const chip = h('div', {
      class: `chip ${wc.id === store.currentConditionId ? 'active' : ''}`,
      textContent: wc.name,
      onclick: () => {
        store.currentConditionId = wc.id;
        store.emit();
        renderConductorsPage(root);
      },
    });
    wcBar.append(chip);
  }
  wcBar.append(h('button', {
    class: 'btn small',
    textContent: '+ 自定义工况',
    onclick: () => store.update((l) => {
      l.conditions.push({ id: `wc-${Date.now()}`, name: '自定义', temp: 10, ice: 0, wind: 0 });
      renderConductorsPage(root);
    }),
  }));
  wcPanel.append(wcBar);

  const wc = store.condition;
  if (wc) wcPanel.append(buildComparison(line, wc));
  body.append(wcPanel);
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h('div', { class: 'field', style: 'min-width:200px' }, [h('label', { textContent: label }), input]);
}

/**
 * 状态方程解 vs 老 Excel 状态方程表(抛物线口径)并排对照
 * 老表口径: 同样的状态方程, 但弧垂用抛物线 f=gL²/(8σ) 近似
 */
function buildComparison(line: LineData, wc: WorkCondition): HTMLElement {
  const wrap = h('div', {});
  const computed = computeLine(line, wc);

  for (const c of computed) {
    const sec = c.section;
    const cond = c.phaseConductor;
    const spanObjs = sec.spanIds.map((id) => line.spans.find((s) => s.id === id)!);
    const Lr = representativeSpan(spanObjs.map((s) => ({
      spanLength: line.towers.find((t) => t.id === s.toTowerId)!.mileage -
        line.towers.find((t) => t.id === s.fromTowerId)!.mileage,
    })));
    const g0 = installGamma(cond);
    const loadNow = specificLoad(cond, wc, wc.ice);
    const sigma = solveStateStress({
      conductor: cond,
      Lr,
      gamma: loadNow.gamma,
      temp: wc.temp,
      sigma0: sec.installStress,
      gamma0: g0,
      temp0: sec.installTemp,
    });

    const info = h('div', { class: 'muted', style: 'margin:10px 0' });
    info.innerHTML =
      `<b>${sec.name}</b> · 代表档距 Lr=<span class="mono">${fmt(Lr, 1)}m</span> · ` +
      `综合比载 γ=<span class="mono">${fmt(loadNow.gamma, 5)}</span> N/(m·mm²) · ` +
      `状态方程应力 σ=<span class="mono">${fmt(sigma, 2)}</span> MPa · 水平张力 H=<span class="mono">${fmt(sigma * cond.area / 1000, 1)}</span> kN`;
    wrap.append(info);

    const table = h('table', {});
    table.append(h('thead', {}, [h('tr', {
      innerHTML: '<th>档</th><th>档距 m</th><th>本系统弧垂(悬链线) m</th><th>老Excel表弧垂(抛物线) m</th><th>偏差</th><th>最低点高程 m</th><th>冰厚 mm</th>',
    })]));
    const tbody = h('tbody', {});

    c.phase.spans.forEach((m, i) => {
      const span = spanObjs[i];
      const t1 = line.towers.find((t) => t.id === span.fromTowerId)!;
      const t2 = line.towers.find((t) => t.id === span.toTowerId)!;
      const L = t2.mileage - t1.mileage;
      // 老 Excel 抛物线弧垂(平档近似, 用该档综合荷载与状态方程应力)
      const w = m.load.gamma * cond.area;
      const H = sigma * cond.area;
      const fExcel = (w * L * L) / (8 * H);
      // 本系统: 精确悬链线(含高差)
      const cat = catenaryFromH({ L, h: m.h }, m.H, w);
      void cat;
      const fSys = m.maxSag;
      const diff = Math.abs(fSys - fExcel) / fExcel;
      tbody.append(h('tr', {}, [
        h('td', { textContent: `${t1.no}→${t2.no}` }),
        h('td', { class: 'mono', textContent: String(L) }),
        h('td', { class: 'mono num-good', textContent: fmt(fSys, 3) }),
        h('td', { class: 'mono', textContent: fmt(fExcel, 3) }),
        h('td', { class: `mono ${diff > 0.01 ? 'num-bad' : ''}`, textContent: `${fmt(diff * 100, 2)}%` }),
        h('td', { class: 'mono', textContent: fmt(m.lowPointZ, 2) }),
        h('td', { class: 'mono', textContent: String(m.ice) }),
      ]));
    });
    table.append(tbody);
    wrap.append(table);
  }

  wrap.append(h('div', { class: 'muted', style: 'margin-top:8px', textContent: '说明: 老表采用抛物线近似且未计悬垂串偏移; 本系统采用精确悬链线并迭代连续档串偏角, 平档两者应 <1%。' }));
  void toast;
  return wrap;
}
