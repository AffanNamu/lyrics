// Procedural animated backgrounds. Every function is a pure function of time, so preview and export match.
import { rnd, clamp } from './util.js';

export function rgba(hex, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
export function mix(h1, h2, t) {
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const c = s => Math.round((a >> s & 255) + ((b >> s & 255) - (a >> s & 255)) * t);
  return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
}
const dark = (hex, k = 0.82) => mix(hex, '#05060a', k);
const TAU = Math.PI * 2;

function base(ctx, W, H, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function glow(ctx, x, y, r, color, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a)); g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export const BACKGROUNDS = {
  solid: { name: 'Solid', draw(ctx, { W, H }, c) { ctx.fillStyle = c[0]; ctx.fillRect(0, 0, W, H); } },

  gradient: {
    name: 'Flow', draw(ctx, { W, H, t }, c) {
      const a = t * 0.25, r = Math.hypot(W, H) / 2, cx = W / 2, cy = H / 2;
      const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.addColorStop(0, dark(c[0], .35)); g.addColorStop(.5 + Math.sin(t * .4) * .2, dark(c[1], .5)); g.addColorStop(1, dark(c[2], .6));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    },
  },

  aurora: {
    name: 'Aurora', draw(ctx, { W, H, t, level }, c) {
      ctx.fillStyle = dark(c[0], .9); ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const R = Math.max(W, H) * (0.55 + level * 0.08);
      for (let i = 0; i < 5; i++) {
        const x = W * (0.5 + 0.42 * Math.sin(t * (0.11 + i * 0.037) + i * 1.9));
        const y = H * (0.5 + 0.42 * Math.cos(t * (0.09 + i * 0.043) + i * 2.7));
        glow(ctx, x, y, R * (0.7 + 0.3 * rnd(i)), c[i % 3], 0.34);
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  stars: {
    name: 'Starfield', draw(ctx, { W, H, t, S }, c) {
      base(ctx, W, H, dark(c[0], .88), dark(c[1], .93));
      glow(ctx, W / 2, H / 2, Math.max(W, H) * .6, c[0], .22);
      const maxR = Math.hypot(W, H) / 2;
      for (let i = 0; i < 170; i++) {
        const ph = (rnd(i) + t * (0.03 + 0.07 * rnd(i + .3))) % 1, a = rnd(i + .7) * TAU, r = ph * ph * maxR;
        const tw = 0.6 + 0.4 * Math.sin(t * 3 + i);
        ctx.fillStyle = rgba(i % 7 ? '#ffffff' : c[2], clamp(ph * 1.6, 0, 1) * tw);
        ctx.beginPath(); ctx.arc(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r, (0.6 + ph * 2.6) * S, 0, TAU); ctx.fill();
      }
    },
  },

  bokeh: {
    name: 'Bokeh', draw(ctx, { W, H, t, S, level }, c) {
      base(ctx, W, H, dark(c[0], .72), dark(c[2], .86));
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 26; i++) {
        const sp = 0.012 + 0.03 * rnd(i + .2), y = H * (1.15 - ((rnd(i) + t * sp) % 1) * 1.3);
        const x = W * rnd(i + .5) + Math.sin(t * .5 + i) * 40 * S, r = (50 + 150 * rnd(i + .9)) * S * (1 + level * .15);
        const g = ctx.createRadialGradient(x, y, r * .55, x, y, r);
        g.addColorStop(0, rgba(c[i % 3], .16)); g.addColorStop(.85, rgba(c[i % 3], .2)); g.addColorStop(1, rgba(c[i % 3], 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  },

  synth: {
    name: 'Synthwave', draw(ctx, { W, H, t, S, level }, c) {
      const hz = H * 0.58;
      base(ctx, W, H, '#07041a', dark(c[0], .45));
      const sr = Math.min(W, H) * (0.26 + level * 0.015), sy = hz - sr * 0.35;
      const sg = ctx.createLinearGradient(0, sy - sr, 0, sy + sr); sg.addColorStop(0, c[2]); sg.addColorStop(1, c[0]);
      glow(ctx, W / 2, sy, sr * 2.2, c[0], .35);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hz); ctx.clip();
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(W / 2, sy, sr, 0, TAU); ctx.fill();
      ctx.fillStyle = '#07041a';
      for (let i = 0; i < 6; i++) { const yy = sy + sr * (0.1 + i * 0.16), hh = sr * (0.02 + i * 0.012); ctx.fillRect(W / 2 - sr, yy, sr * 2, hh); }
      ctx.restore();
      ctx.fillStyle = '#060312'; ctx.fillRect(0, hz, W, H - hz);
      ctx.strokeStyle = rgba(c[1], .75); ctx.lineWidth = 2 * S; ctx.beginPath();
      for (let i = 0; i < 14; i++) { const p = ((i + (t * 0.6) % 1) / 14); const y = hz + (H - hz) * p * p; ctx.moveTo(0, y); ctx.lineTo(W, y); }
      for (let i = -12; i <= 12; i++) { ctx.moveTo(W / 2 + i * W * 0.035, hz); ctx.lineTo(W / 2 + i * W * 0.32, H); }
      ctx.stroke();
      glow(ctx, W / 2, hz, W * .8, c[1], .18);
    },
  },

  waves: {
    name: 'Waves', draw(ctx, { W, H, t, level }, c) {
      base(ctx, W, H, dark(c[0], .8), dark(c[1], .7));
      for (let k = 0; k < 5; k++) {
        const y0 = H * (0.48 + k * 0.1), amp = H * (0.035 + level * 0.012) * (1 + k * .2);
        ctx.fillStyle = rgba(c[k % 3], 0.2 + k * 0.05); ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W + 24; x += 24) {
          ctx.lineTo(x, y0 + Math.sin(x / W * (3 + k) + t * (0.7 + k * 0.23) + k) * amp + Math.sin(x / W * 9 - t * 1.1 + k * 2) * amp * .3);
        }
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      }
    },
  },

  rings: {
    name: 'Pulse', draw(ctx, { W, H, t, S, level }, c) {
      base(ctx, W, H, dark(c[0], .88), '#05060a');
      const cx = W / 2, cy = H / 2, maxR = Math.hypot(W, H) * .55;
      for (let k = 0; k < 8; k++) {
        const ph = (k / 8 + t * 0.09) % 1;
        ctx.strokeStyle = rgba(c[k % 3], (1 - ph) * 0.65); ctx.lineWidth = (3 + level * 14 * (1 - ph)) * S;
        ctx.beginPath(); ctx.arc(cx, cy, ph * maxR, 0, TAU); ctx.stroke();
      }
      glow(ctx, cx, cy, Math.min(W, H) * (0.3 + level * 0.25), c[1], .5);
    },
  },

  bars: {
    name: 'Equalizer', draw(ctx, { W, H, t, level }, c) {
      base(ctx, W, H, dark(c[0], .85), '#05060a');
      const n = 36, bw = W / n, mid = H * 0.5;
      const g = ctx.createLinearGradient(0, mid - H * .3, 0, mid + H * .3);
      g.addColorStop(0, rgba(c[2], .9)); g.addColorStop(.5, rgba(c[1], .95)); g.addColorStop(1, rgba(c[0], .9));
      ctx.fillStyle = g;
      for (let i = 0; i < n; i++) {
        const wob = 0.5 + 0.5 * Math.sin(t * (2.2 + rnd(i) * 5) + i * 1.3), env = Math.sin((i + .5) / n * Math.PI);
        const hh = H * 0.3 * (0.08 + (0.25 + 0.75 * level) * wob * (0.35 + 0.65 * env));
        const x = i * bw + bw * .18, w = bw * .64;
        ctx.beginPath(); ctx.roundRect(x, mid - hh, w, hh * 2, w / 2); ctx.fill();
      }
    },
  },

  vinyl: {
    name: 'Vinyl', draw(ctx, { W, H, t, level }, c) {
      base(ctx, W, H, dark(c[0], .78), '#060608');
      const cx = W / 2, cy = H * 0.5, R = Math.min(W, H) * 0.4;
      glow(ctx, cx, cy, R * 1.9, c[0], .3 + level * .1);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 1.1);
      ctx.fillStyle = '#0b0b0e'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = R * 0.006;
      for (let r = 0.42; r < 0.97; r += 0.035) { ctx.beginPath(); ctx.arc(0, 0, R * r, 0, TAU); ctx.stroke(); }
      for (let k = 0; k < 2; k++) {
        const sh = ctx.createLinearGradient(-R, 0, R, 0);
        sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(.5, 'rgba(255,255,255,.09)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sh; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, k * Math.PI - .22, k * Math.PI + .22); ctx.closePath(); ctx.fill();
      }
      const lg = ctx.createLinearGradient(-R * .36, -R * .36, R * .36, R * .36); lg.addColorStop(0, c[1]); lg.addColorStop(1, c[2]);
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(0, 0, R * 0.36, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-R * .2, -R * .012, R * .4, R * .024);
      ctx.fillStyle = '#060608'; ctx.beginPath(); ctx.arc(0, 0, R * 0.035, 0, TAU); ctx.fill();
      ctx.restore();
    },
  },
};

export function drawBackground(ctx, env, bg) {
  const b = BACKGROUNDS[bg?.type] || BACKGROUNDS.aurora;
  const c = bg?.colors?.length >= 3 ? bg.colors : ['#7c5cff', '#22d3ee', '#f472b6'];
  ctx.save(); b.draw(ctx, env, c); ctx.restore();
}
