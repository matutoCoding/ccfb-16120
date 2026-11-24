import { store } from '../data/store';
import { h, clear, fmt, download } from '../app/dom';
import { computeLine } from '../services/computeService';
import { LineScene } from '../three/LineScene';
import { GallopingPlayer, PHASE_GAP_CRIT } from '../three/GallopingPlayer';
import { lineChart } from '../app/chart';

export function renderReportPage(root: HTMLElement): void {
  const line = store.line;
  if (!line) return;
  clear(root);

  const toolbar = h('div', { class: 'toolbar' }, [
    h('strong', { textContent: '校核报告' }),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn', textContent: '打印 / 另存 PDF', onclick: () => window.print() }),
    h('button', { class: 'btn primary', textContent: '导出 HTML 报告', onclick: () => exportHtml() }),
  ]);
  const body = h('div', { class: 'page-body scroll-y' });
  root.append(toolbar, body);

  // 离屏三维截图容器
  const shotHost = h('div', { style: 'position:fixed;left:-9999px;top:0;width:1200px;height:700px' });
  document.body.append(shotHost);

  const report = h('div', { class: 'report' });
  body.append(report);

  void buildReport(report, shotHost).finally(() => shotHost.remove());
}

async function buildReport(report: HTMLElement, shotHost: HTMLElement): Promise<void> {
  const line = store.line!;
  report.append(
    h('h1', { textContent: `${line.name} 覆冰弧垂与舞动三维校核报告` }),
    h('div', { class: 'meta', textContent: `生成时间: ${new Date().toLocaleString('zh-CN')} · 电压等级: ${line.voltage} · 杆塔 ${line.towers.length} 基 · 耐张段 ${line.sections.length} 个` }),
  );

  for (const wc of line.conditions) {
    const computed = computeLine(line, wc);
    report.append(h('h2', { textContent: `一、工况: ${wc.name}（${wc.temp}℃ / 冰${wc.ice}mm / 风${wc.wind}m/s）` }));

    for (const c of computed) {
      report.append(h('h3', { style: 'margin:14px 0 6px;font-size:14px', textContent: c.section.name }));
      const table = h('table', {});
      table.append(h('thead', {}, [h('tr', {
        innerHTML: '<th>档</th><th>档距m</th><th>冰厚mm</th><th>水平张力kN</th><th>最大弧垂m</th><th>最低点高程m</th><th>最低点里程m</th>',
      })]));
      const tbody = h('tbody', {});
      c.phase.spans.forEach((m) => {
        const sp = line.spans.find((s) => s.id === m.spanId)!;
        const t1 = line.towers.find((t) => t.id === sp.fromTowerId)!;
        const t2 = line.towers.find((t) => t.id === sp.toTowerId)!;
        tbody.append(h('tr', {}, [
          h('td', { textContent: `${t1.no}→${t2.no}` }),
          h('td', { textContent: String(Math.round(m.L)) }),
          h('td', { textContent: String(m.ice) }),
          h('td', { textContent: fmt(m.H / 1000, 2) }),
          h('td', { textContent: fmt(m.maxSag, 3) }),
          h('td', { textContent: fmt(m.lowPointZ, 2) }),
          h('td', { textContent: fmt(m.lowPointMileage, 1) }),
        ]));
      });
      table.append(tbody);
      report.append(table);
    }

    // 净距不满足清单
    const violations: { name: string; span: string; d: number; req: number }[] = [];
    const scene = new LineScene(shotHost, line, {
      iceShape: 'crescent',
      showIce: wc.ice > 0,
      showSpacers: true,
      showGroundWire: true,
    });
    scene.updateCondition(wc);
    for (const r of scene.getClearance()) {
      const sp = line.spans.find((s) => s.id === r.ground.spanId)!;
      const t1 = line.towers.find((t) => t.id === sp.fromTowerId)!;
      const t2 = line.towers.find((t) => t.id === sp.toTowerId)!;
      const spanName = `${t1.no}-${t2.no}`;
      if (!r.ground.ok) violations.push({ name: '对地距离', span: spanName, d: r.ground.minHeight, req: r.ground.required });
      for (const v of r.crossings) {
        if (!v.ok) violations.push({ name: v.crossingName, span: spanName, d: v.minDistance, req: v.required });
      }
    }

    report.append(h('h3', { style: 'margin:14px 0 6px;font-size:14px', textContent: '净距校核' }));
    if (violations.length === 0) {
      report.append(h('p', { textContent: '✓ 该工况下所有对地及交叉跨越净距均满足规范要求。' }));
    } else {
      const vt = h('table', {});
      vt.append(h('thead', {}, [h('tr', { innerHTML: '<th>对象</th><th>档</th><th>实测净距m</th><th>规范要求m</th><th>差值m</th>' })]));
      vt.append(h('tbody', {}, violations.map((v) => h('tr', {}, [
        h('td', { textContent: v.name }),
        h('td', { textContent: v.span }),
        h('td', { class: 'bad-cell', textContent: fmt(v.d, 2) }),
        h('td', { textContent: fmt(v.req, 1) }),
        h('td', { class: 'bad-cell', textContent: fmt(v.d - v.req, 2) }),
      ]))));
      report.append(vt);
    }

    // 三维截图
    const shot = scene.screenshot();
    scene.dispose();
    report.append(h('h3', { style: 'margin:14px 0 6px;font-size:14px', textContent: '三维场景截图' }));
    const img = h('img', { src: shot, alt: wc.name }) as HTMLImageElement;
    report.append(img);
    await new Promise((r) => setTimeout(r, 50));
  }

  // 舞动相间距曲线(每耐张段)
  report.append(h('h2', { textContent: '二、舞动相间距离曲线' }));
  for (const section of line.sections) {
    report.append(h('h3', { style: 'margin:14px 0 6px;font-size:14px', textContent: section.name }));
    const player = new GallopingPlayer(shotHost, line, section.id);
    const pairData = player.getPairData();
    const colors = ['#e74c3c', '#e67e22', '#27ae60'];
    const handle = lineChart({
      series: pairData.map((pd, i) => ({
        name: `${pd.pair[0]}-${pd.pair[1]}`,
        color: colors[i % 3],
        points: pd.timeline.map((r) => ({ x: r.t, y: r.minDistance })),
      })),
      xLabel: '时间 t (s)',
      yLabel: '相间最小距离 m',
      hLines: [{ y: PHASE_GAP_CRIT, color: '#d23f3f', label: `闪络临界 ${PHASE_GAP_CRIT}m` }],
    });
    const wrap = h('div', { style: 'background:#fff;border:1px solid #c6d2e2;padding:10px;border-radius:4px' }, [handle.svg]);
    report.append(wrap);
    const worst = pairData.map((pd) => `${pd.pair[0]}-${pd.pair[1]} 最小 ${fmt(pd.min, 2)}m@${fmt(pd.timeline[pd.minFrame].t, 3)}s`).join('；');
    report.append(h('p', { style: 'font-size:12px', textContent: worst }));
    const gshot = player.screenshot();
    player.dispose();
    report.append(h('img', { src: gshot, alt: section.name } as Partial<HTMLImageElement>) as HTMLImageElement);
  }

  report.append(h('h2', { textContent: '三、计算方法说明' }));
  report.append(h('ul', { style: 'font-size:12px;line-height:1.9' }, [
    h('li', { textContent: '导线形态采用精确悬链线求解, 状态方程按耐张段代表档距 Lr=√(ΣL³/ΣL) 以牛顿迭代解应力。' }),
    h('li', { textContent: '比载按 GB 50545 口径计算自重、覆冰(环形冰截面 πb(d+b))、无冰风与覆冰风荷载, 覆冰密度取 900kg/m³。' }),
    h('li', { textContent: '连续档悬垂串按两侧张力差迭代纵向偏角, 横向风偏由风荷载与垂直荷载之比确定, 偏摆位移回代各档档端坐标。' }),
    h('li', { textContent: '舞动按驻波椭圆轨迹建模, 三相及地线同帧运动, 相间最小距离逐帧由三维坐标直接量测, 与回放画面同源。' }),
    h('li', { textContent: '覆冰截面按迎风侧偏厚的新月形/翼形生成, 沿档距正弦渐变, 各档冰厚可独立覆盖, 支持档级脱冰。' }),
  ]));
}

async function exportHtml(): Promise<void> {
  const report = document.querySelector('.report') as HTMLElement;
  if (!report) return;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${store.line!.name}校核报告</title>
<style>
body{font-family:'Microsoft YaHei',sans-serif;max-width:980px;margin:24px auto;color:#1c2940;padding:0 20px}
table{border-collapse:collapse;width:100%;font-size:11px;margin:8px 0}
td,th{border:1px solid #c6d2e2;padding:5px 7px;text-align:left}
th{background:#e3eaf5}h1{text-align:center;font-size:22px}h2{border-left:4px solid #2b7de9;padding-left:8px;margin-top:26px}
.bad-cell{color:#d23f3f;font-weight:700}img{max-width:100%;border:1px solid #c6d2e2;border-radius:4px}
.meta{color:#5a6b85;text-align:center;font-size:12px}
</style></head><body>${report.innerHTML}</body></html>`;
  download(`${store.line!.name}_校核报告.html`, html, 'text/html');
}
