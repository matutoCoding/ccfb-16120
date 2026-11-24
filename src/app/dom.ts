/** 极简 DOM 构建工具 */
type ElProps<K extends keyof HTMLElementTagNameMap> = Omit<
  Partial<HTMLElementTagNameMap[K]>,
  'style'
> & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {} as ElProps<K>,
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v as string;
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign(el.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else {
      (el as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const child of children) {
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.innerHTML = '';
}

export function toast(msg: string, duration = 2200): void {
  const t = h('div', { class: 'toast', textContent: msg });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

export function fmt(n: number, digits = 2): string {
  if (!isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** 数字输入单元格 */
export function numInput(value: number, onchange: (v: number) => void, step = 1): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    value: String(value),
    step: String(step),
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (isFinite(v)) onchange(v);
    else toast('请输入有效数字');
  });
  return input;
}

export function download(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
