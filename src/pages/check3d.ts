import { store } from '../data/store';
import { h, clear, fmt, toast } from '../app/dom';
import { LineScene } from '../three/LineScene';
import { attachmentWorld } from '../services/computeService';
import type { IceShape } from '../physics/iceSection';

export function renderCheckPage(root: HTMLElement): void {
  const line = store.line;
  if (!line) return;
  clear(root);

  let iceShape: IceShape = 'crescent';
  let showIce = true;
  let showSpacers = true;

  // 工况条
  const wcBar = h('div', { class: 'condition-bar' });
  const renderChips = () => {
    clear(wcBar);
    for (const wc of line.conditions) {
      wcBar.append(h('div', {
        class: `chip ${wc.id === store.currentConditionId ? 'active' : ''}`,
        textContent: wc.name,
        onclick: () => {
          store.currentConditionId = wc.id;
          store.emit();
        },
      }));
    }
    wcBar.append(h('div', { class: 'sep' }));
    wcBar.append(
      h('div', {
        class: `chip ${iceShape === 'crescent' ? 'active' : ''}`,
        textContent: '新月形冰',
        onclick: () => {
          iceShape = 'crescent';
          store.emit();
        },
      }),
      h('div', {
        class: `chip ${iceShape === 'airfoil' ? 'active' : ''}`,
        textContent: '翼形冰',
        onclick: () => {
          iceShape = 'airfoil';
          store.emit();
        },
      }),
      h('div', {
        class: `chip ${showIce ? 'active' : ''}`,
        textContent: '覆冰可视化',
        onclick: () => {
          showIce = !showIce;
          store.emit();
        },
      }),
      h('div', {
        class: `chip ${showSpacers ? 'active' : ''}`,
        textContent: '间隔棒',
        onclick: () => {
          showSpacers = !showSpacers;
          store.emit();
        },
      }),
    );
  };
  renderChips();

  const split = h('div', { class: 'split', style: 'flex:1;min-height:0' });
  const left = h('div', { class: 'panel scroll-y' });
  const viewport = h('div', { class: 'viewport' });
  split.append(left, viewport);
  root.append(wcBar, split);

  let scene: LineScene | null = null;
  let lastWc = '';

  const buildScene = () => {
    scene?.dispose();
    scene = new LineScene(viewport, store.line!, {
      iceShape,
      showIce,
      showSpacers,
      showGroundWire: true,
    });
    const wc = store.condition!;
    scene.updateCondition(wc);
    lastWc = wc.id;
    renderPanel();
  };

  function renderPanel(): void {
    clear(left);
    if (!scene) return;
    const wc = store.condition!;
    left.append(h('h3', { textContent: `工况: ${wc.name}` }));
    left.append(h('div', { class: 'muted', style: 'line-height:1.8' }, [
      `气温 ${wc.temp}℃ · 冰厚 ${wc.ice}mm · 风速 ${wc.wind}m/s${wc.deIce ? ' · 脱冰(档级覆盖)' : ''}`,
    ]));

    // 弧垂表
    left.append(h('h3', { style: 'margin-top:14px', textContent: '各档弧垂与张力' }));
    const table = h('table', {});
    table.append(h('thead', {}, [h('tr', { innerHTML: '<th>档</th><th>弧垂 m</th><th>H kN</th><th>冰 mm</th>' })]));
    const tbody = h('tbody', {});
    for (const c of scene.computed) {
      c.phase.spans.forEach((m) => {
        const sp = store.line!.spans.find((s) => s.id === m.spanId)!;
        const t1 = store.line!.towers.find((t) => t.id === sp.fromTowerId)!;
        const t2 = store.line!.towers.find((t) => t.id === sp.toTowerId)!;
        tbody.append(h('tr', {}, [
          h('td', { textContent: `${t1.no}-${t2.no}` }),
          h('td', { class: 'mono', textContent: fmt(m.maxSag, 2) }),
          h('td', { class: 'mono', textContent: fmt(m.H / 1000, 1) }),
          h('td', { class: 'mono', textContent: String(m.ice) }),
        ]));
      });
    }
    table.append(tbody);
    left.append(table);

    // 串偏角
    const swings = scene.getSwingSummary();
    if (swings.some((s) => Math.abs(s.longDeg) > 0.05 || Math.abs(s.transDeg) > 0.05)) {
      left.append(h('h3', { style: 'margin-top:14px', textContent: '悬垂串偏摆' }));
      const st = h('table', {});
      st.append(h('thead', {}, [h('tr', { innerHTML: '<th>塔</th><th>纵向偏角°</th><th>风偏角°</th><th>位移 m</th>' })]));
      st.append(h('tbody', {}, swings.map((s) => h('tr', {}, [
        h('td', { textContent: s.towerNo }),
        h('td', { class: `mono ${Math.abs(s.longDeg) > 1 ? 'num-bad' : ''}`, textContent: fmt(s.longDeg, 2) }),
        h('td', { class: 'mono', textContent: fmt(s.transDeg, 2) }),
        h('td', { class: 'mono', textContent: fmt(s.dx, 3) }),
      ]))));
      left.append(st);
    }

    // 净距校核清单
    left.append(h('h3', { style: 'margin-top:14px', textContent: '净距校核清单' }));
    const results = scene.getClearance();
    let badCount = 0;
    const clTable = h('table', {});
    clTable.append(h('thead', {}, [h('tr', { innerHTML: '<th>对象</th><th>档</th><th>净距 m</th><th>要求</th><th>结论</th>' })]));
    const clBody = h('tbody', {});
    for (const r of results) {
      const sp = store.line!.spans.find((s) => s.id === r.ground.spanId)!;
      const t1 = store.line!.towers.find((t) => t.id === sp.fromTowerId)!;
      const t2 = store.line!.towers.find((t) => t.id === sp.toTowerId)!;
      const spanName = `${t1.no}-${t2.no}`;
      // 对地
      clBody.append(h('tr', { class: r.ground.ok ? '' : 'row-error' }, [
        h('td', { textContent: '地面' }),
        h('td', { textContent: spanName }),
        h('td', { class: 'mono', textContent: fmt(r.ground.minHeight, 2) }),
        h('td', { class: 'mono', textContent: fmt(r.ground.required, 1) }),
        h('td', {}, [h('span', { class: `badge ${r.ground.ok ? 'ok' : 'bad'}`, textContent: r.ground.ok ? '满足' : '不足' })]),
      ]));
      if (!r.ground.ok) badCount++;
      for (const v of r.crossings) {
        clBody.append(h('tr', { class: v.ok ? '' : 'row-error' }, [
          h('td', { textContent: v.crossingName }),
          h('td', { textContent: spanName }),
          h('td', { class: `mono ${v.ok ? '' : 'num-bad'}`, textContent: fmt(v.minDistance, 2) }),
          h('td', { class: 'mono', textContent: fmt(v.required, 1) }),
          h('td', {}, [h('span', { class: `badge ${v.ok ? 'ok' : 'bad'}`, textContent: v.ok ? '满足' : '不足' })]),
        ]));
        if (!v.ok) badCount++;
      }
    }
    clTable.append(clBody);
    left.append(clTable);
    left.append(h('div', {
      class: 'muted',
      style: 'margin-top:8px',
      textContent: badCount ? `⚠ ${badCount} 项净距不足, 三维中已标红并挂标签` : '✓ 全部净距满足规范要求',
    }));
  }

  // 相机工具
  const camTools = h('div', { class: 'camera-tools' }, [
    h('button', { class: 'btn small', textContent: '全线视角', onclick: () => buildScene() }),
    ...line.towers.slice(1).map((t, i) =>
      h('button', {
        class: 'btn small',
        textContent: `锁侧面 ${line.towers[i].no}-${t.no}`,
        onclick: () => {
          if (!scene) return;
          const prev = line.towers[i];
          const zc = (attachmentWorld(prev, 'B').z + attachmentWorld(t, 'B').z) / 2;
          scene.sm.sideView((prev.mileage + t.mileage) / 2, zc, t.mileage - prev.mileage);
        },
      }),
    ),
  ]);
  viewport.append(camTools);

  // 订阅状态: 工况/显示选项变化时重建
  const unsub = store.subscribe(() => {
    if (!document.body.contains(viewport)) {
      unsub();
      scene?.dispose();
      return;
    }
    renderChips();
    const wc = store.condition!;
    if (!scene || wc.id !== lastWc) {
      buildScene();
    } else {
      // 显示选项变化也重建(冰形/间隔棒)
      buildScene();
    }
  });

  // 延迟一帧等容器有尺寸
  requestAnimationFrame(buildScene);
  void toast;
}
