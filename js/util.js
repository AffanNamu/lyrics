// Small shared helpers: DOM builder, icons, formatting, toast and modal.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round3 = v => Math.round(v * 1000) / 1000;

/** Hyperscript: h('div.cls#id', {onclick, title, ...}, children...) */
export function h(tag, props, ...kids) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const P = {
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4h4v16H7zM14 4h4v16h-4z" fill="currentColor" stroke="none"/>',
  start: '<path d="M6 5v14M19 5l-9 7 9 7z"/>',
  end: '<path d="M18 5v14M5 5l9 7-9 7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  split: '<path d="M12 3v18"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 2-2 0-1.5-1-2-1-3s1-2 2.500-2H18a3 3 0 003-3c0-4.500-4-8-9-8z"/><circle cx="7.500" cy="11" r="1"/><circle cx="10" cy="7.500" r="1"/><circle cx="15" cy="7.500" r="1"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  zoomIn: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.500-4.500M11 8.500v5M8.500 11h5"/>',
  zoomOut: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.500-4.500M8.500 11h5"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.500 8.500a5 5 0 010 7"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  left: '<path d="M11 6l-6 6 6 6M5 12h14"/>',
  right: '<path d="M13 6l6 6-6 6M19 12H5"/>',
  tap: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  more: '<circle cx="5" cy="12" r="1.500"/><circle cx="12" cy="12" r="1.500"/><circle cx="19" cy="12" r="1.500"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
  share: '<circle cx="6" cy="12" r="2.500"/><circle cx="18" cy="6" r="2.500"/><circle cx="18" cy="18" r="2.500"/><path d="M8.200 10.900l7.600-3.800M8.200 13.100l7.600 3.800"/>',
  wifiOff: '<path d="M3 3l18 18M8.500 16.500a5 5 0 017 0M5 13a10 10 0 014-2.500M19 13a10 10 0 00-5-2.800M2 9.500a15 15 0 014.500-3M22 9.500a15 15 0 00-11-3.900"/><circle cx="12" cy="20" r="1"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/><path d="M9 12l2.500 2.500L15.500 10"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}

export function fmtTime(t, frac = true) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  const base = m + ':' + String(s).padStart(2, '0');
  return frac ? base + '.' + String(Math.floor((t % 1) * 10)) : base;
}
export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

let toastTimer;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/** Opens a modal. Returns {el, close}. `build(close)` returns the content node. */
export function modal(build, { wide = false, dismiss = true } = {}) {
  const back = h('div.modal-back');
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && dismiss) close(); };
  const box = h('div.modal' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true' });
  box.append(build(close));
  back.append(box);
  if (dismiss) back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  return { el: box, close };
}

export function confirmDialog(title, text, okLabel = 'Delete') {
  return new Promise(res => {
    modal(close => h('div', null,
      h('h3', title), h('p.muted', text),
      h('div.modal-actions', null,
        h('button.btn', { onclick: () => { close(); res(false); } }, 'Cancel'),
        h('button.btn.danger', { onclick: () => { close(); res(true); } }, okLabel))));
  });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = t => { t = clamp(t, 0, 1); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeBack = t => { t = clamp(t, 0, 1); const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
/** Deterministic pseudo-random in [0,1) from an integer seed. */
export const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
