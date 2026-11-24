import type { Tower, TowerForm } from '../types';
import { store } from '../data/store';
import { h, clear, toast, numInput } from '../app/dom';
import { getTemplate } from '../data/towerTemplates';
import { SceneManager } from '../three/SceneManager';
import { buildTower, buildTerrain, buildCrossing } from '../three/builders';
import * as THREE from 'three';
import { DEFAULT_CLEARANCE } from '../physics/constants';

export function renderTowersPage(root: HTMLElement): void {
  if (!store.line) return;
  const line: import('../types').LineData = store.line;
  clear(root);

  const split = h('div', { class: 'split split-wide' });
  const left = h('div', { class: 'panel scroll-y' });
  const right = h('div', { class: 'viewport' });
  root.append(split);
  split.append(left, right);

  // ---- 左: 编辑区 ----
  left.append(h('h3', { textContent: '杆塔模板与挂点' }));
  const towerSelect = h('select', {
    innerHTML: line.towers.map((t) => `<option value="${t.id}">${t.no} ${t.kind === 'strain' ? '耐张' : '直线'}</option>`).join(''),
  }) as HTMLSelectElement;
  left.append(h('div', { class: 'field' }, [h('label', { textContent: '选择杆塔' }), towerSelect]));

  const editArea = h('div', {});
  left.append(editArea);

  left.append(h('h3', { style: 'margin-top:18px', textContent: '跨越物布置' }));
  const crossArea = h('div', {});
  left.append(crossArea);

  function renderEdit(): void {
    clear(editArea);
    const tw = line.towers.find((t) => t.id === towerSelect.value)!;
    const forms: TowerForm[] = ['cathead', 'cup', 'strain'];
    editArea.append(
      h('div', { class: 'field' }, [
        h('label', { textContent: '塔型' }),
        h('select', {
          innerHTML: forms.map((f) => `<option value="${f}" ${f === tw.form ? 'selected' : ''}>${f === 'cathead' ? '猫头塔' : f === 'cup' ? '酒杯塔' : '耐张塔'}</option>`).join(''),
          onchange: (e: Event) => store.update((l) => {
            l.towers.find((t) => t.id === tw.id)!.form = (e.target as HTMLSelectElement).value as TowerForm;
            renderEdit();
          }),
        } as Partial<HTMLSelectElement>) as HTMLSelectElement,
      ]),
      h('div', { class: 'field' }, [h('label', { textContent: '塔高 m' }), numInput(tw.height, (v) => store.update((l) => {
        l.towers.find((t) => t.id === tw.id)!.height = v;
      }), 0.5)]),
    );

    const tpl = getTemplate(tw.form, tw.height);
    const attachTable = h('table', {});
    attachTable.append(
      h('thead', {}, [h('tr', { innerHTML: '<th>角色</th><th>横向 y m</th><th>挂高 dz m</th>' })]),
      h('tbody', {}, tpl.attachments.map((a) => {
        const ov = tw.attachmentOverrides?.[a.role];
        const curY = ov?.y ?? a.y;
        const curDz = ov?.dz ?? a.dz;
        return h('tr', {}, [
          h('td', { textContent: a.role }),
          h('td', {}, [numInput(curY, (v) => store.update((l) => {
            const t = l.towers.find((x) => x.id === tw.id)!;
            t.attachmentOverrides = { ...t.attachmentOverrides, [a.role]: { y: v, dz: (t.attachmentOverrides?.[a.role]?.dz ?? a.dz) } };
          }), 0.1)]),
          h('td', {}, [numInput(curDz, (v) => store.update((l) => {
            const t = l.towers.find((x) => x.id === tw.id)!;
            t.attachmentOverrides = { ...t.attachmentOverrides, [a.role]: { y: (t.attachmentOverrides?.[a.role]?.y ?? a.y), dz: v } };
          }), 0.1)]),
        ]);
      })),
    );
    editArea.append(
      attachTable,
      h('button', {
        class: 'btn small',
        style: 'margin-top:8px',
        textContent: '恢复模板默认挂点',
        onclick: () => store.update((l) => {
          l.towers.find((t) => t.id === tw.id)!.attachmentOverrides = undefined;
          renderEdit();
        }),
      }),
    );

    // 横担层信息(只读展示)
    editArea.append(
      h('div', { class: 'muted', style: 'margin-top:12px', innerHTML: tpl.crossArms.map((c, i) => `横担层${i + 1}: 高程偏移 ${c.dz}m, 单侧长 ${c.halfWidth}m`).join('<br>') }),
    );
  }
  renderEdit();
  towerSelect.addEventListener('change', renderEdit);

  // 跨越物编辑
  function renderCrossings(): void {
    clear(crossArea);
    const table = h('table', {});
    table.append(h('thead', {}, [h('tr', { innerHTML: '<th>名称</th><th>类型</th><th>里程</th><th>高程/杆高</th><th>要求净距</th>' })]));
    const tbody = h('tbody', {});
    for (const cr of line.crossings) {
      tbody.append(h('tr', {}, [
        h('td', { textContent: cr.name }),
        h('td', { textContent: cr.kind === 'road' ? '公路' : cr.kind === 'line10kv' ? '10kV' : '民房' }),
        h('td', {}, [numInput(cr.mileage, (v) => store.update((l) => {
          l.crossings.find((x) => x.id === cr.id)!.mileage = v;
        }))]),
        h('td', {}, [numInput(cr.z, (v) => store.update((l) => {
          l.crossings.find((x) => x.id === cr.id)!.z = v;
        }), 0.5)]),
        h('td', {}, [numInput(cr.requiredClearance, (v) => store.update((l) => {
          l.crossings.find((x) => x.id === cr.id)!.requiredClearance = v;
        }), 0.1)]),
      ]));
    }
    table.append(tbody);
    crossArea.append(table);
    crossArea.append(h('button', {
      class: 'btn small',
      style: 'margin-top:8px',
      textContent: '+ 添加跨越物',
      onclick: () => store.update((l) => {
        l.crossings.push({
          id: `cross-${Date.now()}`,
          kind: 'house',
          name: '新建民房',
          mileage: 500,
          width: 8,
          z: 130,
          lateralWidth: 10,
          requiredClearance: DEFAULT_CLEARANCE.house,
        });
        renderCrossings();
      }),
    }));
  }
  renderCrossings();

  // ---- 右: 三维预览(地形 + 全部塔 + 跨越物) ----
  const sm = new SceneManager(right);
  sm.scene.add(buildTerrain(line));
  const towerGroup = new THREE.Group();
  for (const t of line.towers) towerGroup.add(buildTower(t));
  for (const cr of line.crossings) sm.scene.add(buildCrossing(cr));
  sm.scene.add(towerGroup);

  // 聚焦到选中塔: z-up 下横向(y)正侧平视, 略带纵向偏移产生立体感
  const focusTower = (id: string) => {
    const tw = line.towers.find((t) => t.id === id)!;
    const zMid = tw.groundZ + tw.height * 0.5;
    sm.camera.position.set(tw.mileage + 22, 82, zMid);
    sm.controls.target.set(tw.mileage, 0, zMid);
    sm.controls.update();
  };
  focusTower(towerSelect.value);
  towerSelect.addEventListener('change', () => focusTower(towerSelect.value));

  // 数据变化后重建塔
  const unsub = store.subscribe(() => {
    if (!document.body.contains(right)) {
      unsub();
      sm.dispose();
      return;
    }
    towerGroup.clear();
    for (const t of store.line!.towers) towerGroup.add(buildTower(t));
  });
  void toast;
  void THREE;
}
