/** 轻量 SVG 折线图, 无第三方依赖 */

export interface LineSeries {
  name: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

export interface ChartHandle {
  svg: SVGSVGElement;
  setMarkerX: (x: number | null) => void;
}

export function lineChart(opts: {
  series: LineSeries[];
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  yMin?: number;
  yMax?: number;
  hLines?: { y: number; color: string; label: string }[];
  markerX?: number;
}): ChartHandle {
  const width = opts.width ?? 720;
  const height = opts.height ?? 260;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');

  const allX = opts.series.flatMap((s) => s.points.map((p) => p.x));
  const allY = opts.series.flatMap((s) => s.points.map((p) => p.y));
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  let yMin = opts.yMin ?? Math.min(...allY);
  let yMax = opts.yMax ?? Math.max(...allY);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.08;
  yMin -= pad;
  yMax += pad;

  const px = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * (width - padL - padR);
  const py = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin)) * (height - padT - padB);

  // 坐标轴
  const axis = document.createElementNS(svg.namespaceURI, 'g');
  const rect = document.createElementNS(svg.namespaceURI, 'rect');
  rect.setAttribute('x', String(padL));
  rect.setAttribute('y', String(padT));
  rect.setAttribute('width', String(width - padL - padR));
  rect.setAttribute('height', String(height - padT - padB));
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#2a3c57');
  axis.append(rect);

  // y 刻度(4 条)
  for (let i = 0; i <= 4; i++) {
    const yv = yMin + ((yMax - yMin) * i) / 4;
    const yy = py(yv);
    const tick = document.createElementNS(svg.namespaceURI, 'line');
    tick.setAttribute('x1', String(padL));
    tick.setAttribute('x2', String(width - padR));
    tick.setAttribute('y1', String(yy));
    tick.setAttribute('y2', String(yy));
    tick.setAttribute('stroke', '#1f2e44');
    axis.append(tick);
    const txt = document.createElementNS(svg.namespaceURI, 'text');
    txt.setAttribute('x', String(padL - 6));
    txt.setAttribute('y', String(yy + 4));
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('fill', '#8da2bd');
    txt.setAttribute('font-size', '10');
    txt.textContent = yv.toFixed(1);
    axis.append(txt);
  }
  // x 刻度(5 个)
  for (let i = 0; i <= 5; i++) {
    const xv = xMin + ((xMax - xMin) * i) / 5;
    const xx = px(xv);
    const txt = document.createElementNS(svg.namespaceURI, 'text');
    txt.setAttribute('x', String(xx));
    txt.setAttribute('y', String(height - padB + 16));
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', '#8da2bd');
    txt.setAttribute('font-size', '10');
    txt.textContent = xv.toFixed(2);
    axis.append(txt);
  }

  // 参考横线(规范限值)
  for (const hl of opts.hLines ?? []) {
    const yy = py(hl.y);
    const line = document.createElementNS(svg.namespaceURI, 'line');
    line.setAttribute('x1', String(padL));
    line.setAttribute('x2', String(width - padR));
    line.setAttribute('y1', String(yy));
    line.setAttribute('y2', String(yy));
    line.setAttribute('stroke', hl.color);
    line.setAttribute('stroke-dasharray', '6 4');
    axis.append(line);
    const txt = document.createElementNS(svg.namespaceURI, 'text');
    txt.setAttribute('x', String(width - padR - 4));
    txt.setAttribute('y', String(yy - 4));
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('fill', hl.color);
    txt.setAttribute('font-size', '10');
    txt.textContent = hl.label;
    axis.append(txt);
  }
  svg.append(axis);

  // 数据线
  for (const s of opts.series) {
    const path = document.createElementNS(svg.namespaceURI, 'polyline');
    path.setAttribute(
      'points',
      s.points.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' '),
    );
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', s.color);
    path.setAttribute('stroke-width', '1.8');
    if (s.dashed) path.setAttribute('stroke-dasharray', '5 3');
    svg.append(path);
  }

  // 当前帧标记
  let marker: SVGLineElement | null = null;
  const setMarkerX = (x: number | null) => {
    if (x == null) {
      marker?.remove();
      marker = null;
      return;
    }
    if (!marker) {
      marker = document.createElementNS(svg.namespaceURI, 'line') as SVGLineElement;
      marker.setAttribute('y1', String(padT));
      marker.setAttribute('y2', String(height - padB));
      marker.setAttribute('stroke', '#4da3ff');
      marker.setAttribute('stroke-width', '1.2');
      svg.appendChild(marker);
    }
    const xx = px(x);
    marker.setAttribute('x1', String(xx));
    marker.setAttribute('x2', String(xx));
  };
  if (opts.markerX != null) setMarkerX(opts.markerX);

  // 轴标签
  if (opts.xLabel) {
    const t = document.createElementNS(svg.namespaceURI, 'text');
    t.setAttribute('x', String((padL + width - padR) / 2));
    t.setAttribute('y', String(height - 4));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', '#8da2bd');
    t.setAttribute('font-size', '11');
    t.textContent = opts.xLabel;
    svg.append(t);
  }
  return { svg, setMarkerX };
}

export function legend(items: { name: string; color: string }[]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'legend';
  for (const it of items) {
    const span = document.createElement('span');
    span.innerHTML = `<i style="background:${it.color}"></i>${it.name}`;
    div.append(span);
  }
  return div;
}
