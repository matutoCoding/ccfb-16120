import type { LineData, Span } from '../types';
import { store } from '../data/store';
import { h, clear, toast, numInput, download } from '../app/dom';
import { attachmentWorld } from '../services/computeService';

/**
 * 线路台账页: 耐张段 → 档距/高差/悬垂串长/挂点坐标
 * 支持粘贴杆塔明细表(TSV)导入, 档距高差对不上的行标红
 */
export function renderLedgerPage(root: HTMLElement): void {
  const line = store.line;
  if (!line) return;
  clear(root);

  const toolbar = h('div', { class: 'toolbar' }, [
    h('strong', { textContent: '线路台账（按耐张段管理）' }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn',
      textContent: '导出明细表(TSV)',
      onclick: () => exportTable(line),
    }),
    h('button', {
      class: 'btn primary',
      textContent: '导入杆塔明细表',
      onclick: () => fileInput((text) => importTable(line, text, refresh)),
    }),
    h('button', {
      class: 'btn danger',
      textContent: '重置演示数据',
      onclick: async () => {
        await store.resetDemo();
        toast('已重置为演示线路');
      },
    }),
  ]);

  const body = h('div', { class: 'page-body scroll-y' });
  root.append(toolbar, body);

  // 概览卡片
  const overview = h('div', { class: 'panel', style: 'margin-bottom:12px' });
  overview.append(
    h('h3', { textContent: '工程概览' }),
    h('div', { class: 'muted' }, [
      `杆塔 ${line.towers.length} 基 · 耐张段 ${line.sections.length} 个 · 档 ${line.spans.length} 个 · `,
      `跨越物 ${line.crossings.length} 处 · 工况 ${line.conditions.length} 种 · 走廊宽度 ${line.corridorWidth}m`,
    ]),
  );
  body.append(overview);

  for (const section of line.sections) {
    body.append(renderSection(line, section, refresh));
  }

  function refresh(): void {
    renderLedgerPage(root);
  }
}

function renderSection(
  line: LineData,
  section: LineData['sections'][number],
  refresh: () => void,
): HTMLElement {
  const panel = h('div', { class: 'panel', style: 'margin-bottom:14px' });
  panel.append(h('h3', { textContent: `耐张段: ${section.name}` }));

  // 杆塔表
  const towerRows = section.towerIds.map((id) => {
    const t = line.towers.find((x) => x.id === id)!;
    const isStrain = t.kind === 'strain';
    return h('tr', {}, [
      h('td', { textContent: t.no }),
      h('td', {}, [
        h('span', {
          class: `badge ${isStrain ? 'ice' : 'ok'}`,
          textContent: isStrain ? '耐张塔' : '直线塔',
        }),
      ]),
      cell(numInput(t.mileage, (v) => store.update((l) => {
        const tw = l.towers.find((x) => x.id === t.id)!;
        tw.mileage = v;
      }))),
      cell(numInput(t.groundZ, (v) => store.update((l) => {
        l.towers.find((x) => x.id === t.id)!.groundZ = v;
      }))),
      cell(numInput(t.height, (v) => store.update((l) => {
        l.towers.find((x) => x.id === t.id)!.height = v;
      }))),
      cell(numInput(t.stringLength, (v) => store.update((l) => {
        l.towers.find((x) => x.id === t.id)!.stringLength = v;
      }), 0.1)),
      h('td', { class: 'mono', textContent: `y=${attachmentWorld(t, 'B').y.toFixed(1)} z=${attachmentWorld(t, 'B').z.toFixed(1)}` }),
    ]);
  });

  // 档距表(含校验标红)
  const spanRows = section.spanIds.map((sid) => {
    const span = line.spans.find((x) => x.id === sid)!;
    const t1 = line.towers.find((t) => t.id === span.fromTowerId)!;
    const t2 = line.towers.find((t) => t.id === span.toTowerId)!;
    const geoL = t2.mileage - t1.mileage;
    const geoH = attachmentWorld(t2, 'B').z - attachmentWorld(t1, 'B').z;
    const errL = span.spanLength != null && Math.abs(span.spanLength - geoL) > 0.5;
    const errH = span.elevationDiff != null && Math.abs(span.elevationDiff - geoH) > 0.5;
    const tr = h('tr', { class: errL || errH ? 'row-error' : '' });
    tr.append(
      h('td', { textContent: `${t1.no}→${t2.no}` }),
      cell(numInput(span.spanLength ?? geoL, (v) => store.update((l) => {
        l.spans.find((x) => x.id === sid)!.spanLength = v;
      }))),
      h('td', { class: `mono ${errL ? 'num-bad' : 'num-good'}`, textContent: geoL.toFixed(1) }),
      h('td', { class: 'muted', textContent: errL ? `差${(span.spanLength! - geoL).toFixed(1)}` : '一致' }),
      cell(numInput(span.elevationDiff ?? geoH, (v) => store.update((l) => {
        l.spans.find((x) => x.id === sid)!.elevationDiff = v;
      }), 0.1)),
      h('td', { class: `mono ${errH ? 'num-bad' : 'num-good'}`, textContent: geoH.toFixed(1) }),
      h('td', { class: 'muted', textContent: errH ? `差${(span.elevationDiff! - geoH).toFixed(1)}` : '一致' }),
      h('td', {}, [
        h('select', {
          innerHTML: ['默认工况', '覆冰10', '覆冰15', '覆冰20', '脱冰(0)']
            .map((o, i) => `<option value="${[-99, 10, 15, 20, -1][i]}">${o}</option>`)
            .join(''),
          onchange: (e: Event) => {
            const v = Number((e.target as HTMLSelectElement).value);
            store.update((l) => {
              const sp = l.spans.find((x) => x.id === sid)!;
              sp.iceOverride = v === -99 ? undefined : v;
            });
          },
        } as Partial<HTMLSelectElement>) as HTMLSelectElement,
      ]),
    );
    return tr;
  });

  const towerTable = h('table', {}, [
    h('thead', {}, [h('tr', { innerHTML: '<th>塔号</th><th>类型</th><th>里程 m</th><th>地面高程 m</th><th>塔高 m</th><th>串长 m</th><th>B相挂点(y,z)</th>' })]),
    h('tbody', {}, towerRows),
  ]);
  const spanTable = h('table', {}, [
    h('thead', {}, [
      h('tr', {
        innerHTML:
          '<th>档</th><th>录入档距</th><th>里程反算</th><th>档距校验</th><th>录入高差</th><th>挂点反算</th><th>高差校验</th><th>档覆冰</th>',
      }),
    ]),
    h('tbody', {}, spanRows),
  ]);

  panel.append(
    h('div', { class: 'muted', style: 'margin:8px 0 4px', textContent: '杆塔排位' }),
    towerTable,
    h('div', { class: 'muted', style: 'margin:12px 0 4px', textContent: '档距与高差（红色行 = 明细表录入值与排位坐标不一致，容差 0.5m）' }),
    spanTable,
  );
  void refresh;
  return panel;
}

function cell(input: HTMLElement): HTMLTableCellElement {
  return h('td', {}, [input]);
}

/** 导出 TSV 明细表 */
function exportTable(line: LineData): void {
  const rows = [['塔号', '类型', '里程m', '地面高程m', '塔高m', '串长m']];
  for (const t of line.towers) {
    rows.push([t.no, t.kind, String(t.mileage), String(t.groundZ), String(t.height), String(t.stringLength)]);
  }
  download('杆塔明细表.tsv', rows.map((r) => r.join('\t')).join('\n'), 'text/tab-separated-values');
}

function fileInput(onFile: (text: string) => void): void {
  const input = h('input', { type: 'file', accept: '.tsv,.csv,.txt', style: 'display:none' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onFile(String(reader.result));
    reader.readAsText(f, 'utf-8');
  });
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 1000);
}

/**
 * 导入杆塔明细表: 表头需含 塔号/里程/地面高程/塔高/串长(列名容错)
 * 档距高差由相邻杆塔反算, 与表中(若有)档距列比对
 */
function importTable(line: LineData, text: string, refresh: () => void): void {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    toast('文件内容不足两行');
    return;
  }
  const split = (r: string) => r.split(/\t|,/).map((s) => s.trim());
  const header = split(lines[0]);
  const idx = (names: string[]) =>
    header.findIndex((x) => names.some((n) => x.includes(n)));
  const iNo = idx(['塔号', '编号']);
  const iMile = idx(['里程']);
  const iZ = idx(['地面', '高程']);
  const iH = idx(['塔高']);
  const iStr = idx(['串长', '绝缘子']);
  if (iNo < 0 || iMile < 0) {
    toast('未识别到塔号/里程列');
    return;
  }

  let updated = 0;
  let mismatch = 0;
  store.update((l) => {
    for (let r = 1; r < lines.length; r++) {
      const cols = split(lines[r]);
      const no = cols[iNo];
      const tw = l.towers.find((t) => t.no === no);
      if (!tw) continue;
      const mile = parseFloat(cols[iMile]);
      if (isFinite(mile)) {
        if (Math.abs(mile - tw.mileage) > 0.5) mismatch++;
        tw.mileage = mile;
      }
      if (iZ >= 0) {
        const z = parseFloat(cols[iZ]);
        if (isFinite(z)) tw.groundZ = z;
      }
      if (iH >= 0) {
        const hgt = parseFloat(cols[iH]);
        if (isFinite(hgt)) tw.height = hgt;
      }
      if (iStr >= 0) {
        const sl = parseFloat(cols[iStr]);
        if (isFinite(sl)) tw.stringLength = sl;
      }
      updated++;
    }
  });
  toast(`导入 ${updated} 基塔${mismatch ? `，${mismatch} 处里程与原排位不一致已标红` : '，全部一致'}`);
  refresh();
}
