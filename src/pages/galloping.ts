import { store } from '../data/store';
import { h, clear, fmt } from '../app/dom';
import { GallopingPlayer, PHASE_GAP_CRIT, PHASE_GAP_WARN, type FrameInfo } from '../three/GallopingPlayer';
import { lineChart, legend } from '../app/chart';

const PAIR_COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#9fd8ff', '#c792ea', '#f39c12'];

export function renderGallopingPage(root: HTMLElement): void {
  const line = store.line;
  if (!line) return;
  clear(root);

  // 耐张段选择
  const top = h('div', { class: 'condition-bar' }, [
    h('span', { class: 'muted', textContent: '选择耐张段:' }),
    ...line.sections.map((s, i) =>
      h('div', {
        class: `chip ${i === 0 ? 'active' : ''}`,
        textContent: s.name,
        onclick: (e: Event) => {
          top.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
          (e.target as HTMLElement).classList.add('active');
          sectionId = s.id;
          rebuild();
        },
      }),
    ),
  ]);

  let sectionId = line.sections[0].id;
  const split = h('div', { class: 'split', style: 'flex:1;min-height:0' });
  const left = h('div', { class: 'panel scroll-y' });
  const viewport = h('div', { class: 'viewport' });
  split.append(left, viewport);
  root.append(top, split);

  let player: GallopingPlayer | null = null;

  function rebuild(): void {
    player?.dispose();
    clear(left);
    player = new GallopingPlayer(viewport, store.line!, sectionId);

    // ---- 左栏: 曲线 + 控制 ----
    left.append(h('h3', { textContent: '逐帧相间最小距离曲线' }));
    const pairData = player.getPairData();
    const series = pairData.map((pd, i) => ({
      name: `${pd.pair[0]}-${pd.pair[1]}`,
      color: PAIR_COLORS[i % PAIR_COLORS.length],
      points: pd.timeline.map((r) => ({ x: r.t, y: r.minDistance })),
    }));
    const chart = lineChart({
      series,
      xLabel: '时间 t (s)',
      yLabel: '相间距 m',
      hLines: [
        { y: PHASE_GAP_CRIT, color: '#f87272', label: `闪络临界 ${PHASE_GAP_CRIT}m` },
        { y: PHASE_GAP_WARN, color: '#fbbd23', label: `预警 ${PHASE_GAP_WARN}m` },
      ],
      markerX: 0,
    });
    const chartWrap = h('div', { class: 'chart-wrap' }, [
      chart.svg,
      legend(series.map((s) => ({ name: s.name, color: s.color }))),
    ]);
    left.append(chartWrap);

    // 最小值汇总
    const minInfo = h('div', { style: 'margin:8px 0' });
    minInfo.append(
      h('table', {}, [
        h('thead', {}, [h('tr', { innerHTML: '<th>相别</th><th>周期最小距离 m</th><th>出现时刻 s</th><th>判定</th>' })]),
        h('tbody', {}, pairData.map((pd, i) => {
          const t = pd.timeline[pd.minFrame].t;
          const crit = pd.min <= PHASE_GAP_CRIT;
          const warn = pd.min <= PHASE_GAP_WARN;
          return h('tr', { class: crit ? 'row-error' : '' }, [
            h('td', { textContent: `${pd.pair[0]}-${pd.pair[1]}` }),
            h('td', { class: `mono ${crit ? 'num-bad' : ''}`, textContent: fmt(pd.min, 2) }),
            h('td', { class: 'mono', textContent: fmt(t, 3) }),
            h('td', {}, [h('span', {
              class: `badge ${crit ? 'bad' : warn ? '' : 'ok'}`,
              textContent: crit ? '闪络风险' : warn ? '接近预警' : '安全',
              style: warn && !crit ? 'background:rgba(251,189,35,.15);color:var(--warn)' : '',
            })]),
          ]);
        })),
      ]),
    );
    left.append(minInfo);

    // 次档距包络说明
    left.append(h('h3', { style: 'margin-top:14px', textContent: '次档距轨迹包络' }));
    left.append(h('div', { class: 'muted', style: 'margin-bottom:8px', textContent: '包络管为各线缆一个舞动周期内的空间扫掠范围, 球体标记最大振幅位置。' }));
    left.append(h('button', {
      class: 'btn',
      textContent: '显示/隐藏轨迹包络',
      onclick: (e: Event) => {
        const shown = player!.toggleEnvelope();
        (e.target as HTMLElement).textContent = shown ? '隐藏轨迹包络' : '显示轨迹包络';
      },
    }));

    // 相机
    left.append(h('h3', { style: 'margin-top:14px', textContent: '相机控制' }));
    left.append(h('div', { class: 'flex-row', style: 'flex-wrap:wrap;gap:6px' }, [
      h('button', { class: 'btn small', textContent: '沿线路飞行', onclick: () => player!.flyAlong() }),
      ...store.line!.sections.find((s) => s.id === sectionId)!.spanIds.map((sid, idx) => {
        const sp = store.line!.spans.find((x) => x.id === sid)!;
        const t1 = store.line!.towers.find((t) => t.id === sp.fromTowerId)!;
        const t2 = store.line!.towers.find((t) => t.id === sp.toTowerId)!;
        return h('button', { class: 'btn small', textContent: `侧面 ${t1.no}-${t2.no}`, onclick: () => player!.sideView(idx) });
      }),
    ]));

    // ---- 时间轴 ----
    const marks = player.getTimelineMarks();
    const tickMarks = h('div', { class: 'tick-marks' });
    for (const m of marks) {
      tickMarks.append(h('div', { class: `tick ${m.crit ? 'crit' : ''}`, style: `left:${m.pos * 100}%` }));
    }
    const range = h('input', { type: 'range', min: '0', max: String(player.frameCount - 1), value: '0' }) as HTMLInputElement;
    const frameLabel = h('span', { class: 'mono muted', style: 'min-width:120px', textContent: `帧 0/${player.frameCount - 1}` });
    const distLabel = h('div', { class: 'muted', style: 'font-size:11px;margin-top:6px' });

    const updateMarker = (frame: number) => {
      range.value = String(frame);
      const t = (frame / player!.frameCount) * player!.period;
      frameLabel.textContent = `帧 ${frame}/${player!.frameCount - 1} · t=${fmt(t, 3)}s`;
      chart.setMarkerX(t);
    };

    player.onFrame = (frame: number, info: FrameInfo) => {
      updateMarker(frame);
      distLabel.innerHTML = info.pairs
        .map((p) => `<span style="color:${p.crit ? 'var(--danger)' : 'var(--fg)'}">${p.name}: ${fmt(p.distance, 2)}m</span>`)
        .join(' &nbsp;|&nbsp; ');
    };

    range.addEventListener('input', () => player!.setFrame(Number(range.value)));

    const speedSelect = h('select', {
      innerHTML: [
        ['0.1', '0.1× 极慢'],
        ['0.25', '0.25× 慢放'],
        ['0.5', '0.5×'],
        ['1', '1× 实时'],
      ].map(([v, l]) => `<option value="${v}" ${v === '0.25' ? 'selected' : ''}>${l}</option>`).join(''),
      onchange: (e: Event) => player!.setSpeed(Number((e.target as HTMLSelectElement).value)),
    } as Partial<HTMLSelectElement>) as HTMLSelectElement;

    const playBtn = h('button', { class: 'btn primary', textContent: '▶ 播放' });
    playBtn.addEventListener('click', () => {
      if (playBtn.textContent?.includes('播放')) {
        player!.play();
        playBtn.textContent = '⏸ 暂停';
      } else {
        player!.pause();
        playBtn.textContent = '▶ 播放';
      }
    });

    const timeline = h('div', { class: 'timeline-bar' }, [
      h('div', { class: 'controls' }, [
        playBtn,
        h('button', { class: 'btn small', textContent: '⏮', onclick: () => player!.stepFrame(-1) }),
        h('button', { class: 'btn small', textContent: '⏭', onclick: () => player!.stepFrame(1) }),
        range,
        frameLabel,
        speedSelect,
      ]),
      tickMarks,
      distLabel,
    ]);
    viewport.append(timeline);

    player.setFrame(0);
  }

  rebuild();

  // 页面卸载清理
  const obs = new MutationObserver(() => {
    if (!document.body.contains(viewport)) {
      player?.dispose();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
