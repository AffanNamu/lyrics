// Ready-made animated templates: each one sets the background, lyric animation, typography and overlays.
export const TEMPLATES = [
  { id: 'aurora-karaoke', name: 'Aurora Karaoke', tag: 'Sing-along',
    background: { type: 'aurora', colors: ['#7c5cff', '#22d3ee', '#f472b6'] },
    style: { fx: 'karaoke', font: 'Poppins', weight: 800, size: 78, color: '#ffffff', accent: '#c6f24e', posY: 0.5, upper: false },
    overlay: { vignette: 0.35, grain: 0, letterbox: false, progress: true } },
  { id: 'neon-nights', name: 'Neon Nights', tag: 'Retro',
    background: { type: 'synth', colors: ['#ff2d95', '#00e5ff', '#ffd23f'] },
    style: { fx: 'neon', font: 'Bebas Neue', weight: 400, size: 104, color: '#ffffff', accent: '#ff4fd8', posY: 0.3, upper: true },
    overlay: { vignette: 0.3, grain: 0.25, letterbox: false, progress: false } },
  { id: 'midnight-scroll', name: 'Midnight Scroll', tag: 'Streaming look',
    background: { type: 'gradient', colors: ['#4338ca', '#9d174d', '#0f766e'] },
    style: { fx: 'scroll', font: 'Inter', weight: 600, size: 74, color: '#ffffff', accent: '#ffffff', posY: 0.45, upper: false },
    overlay: { vignette: 0.25, grain: 0, letterbox: false, progress: true } },
  { id: 'pop-punch', name: 'Pop Punch', tag: 'Playful',
    background: { type: 'bokeh', colors: ['#ff5c8a', '#ffb23f', '#8b5cf6'] },
    style: { fx: 'pop', font: 'Anton', weight: 400, size: 96, color: '#ffffff', accent: '#ffe14d', posY: 0.5, upper: true },
    overlay: { vignette: 0.2, grain: 0, letterbox: false, progress: false } },
  { id: 'kinetic-type', name: 'Kinetic Type', tag: 'Bold',
    background: { type: 'rings', colors: ['#1d4ed8', '#c6f24e', '#f97316'] },
    style: { fx: 'kinetic', font: 'Anton', weight: 400, size: 96, color: '#ffffff', accent: '#c6f24e', posY: 0.5, upper: true },
    overlay: { vignette: 0.4, grain: 0, letterbox: false, progress: false } },
  { id: 'typewriter-noir', name: 'Typewriter Noir', tag: 'Minimal',
    background: { type: 'solid', colors: ['#101014', '#101014', '#101014'] },
    style: { fx: 'typewriter', font: 'Space Grotesk', weight: 500, size: 64, color: '#f4f1ea', accent: '#ff6b4a', posY: 0.5, upper: false },
    overlay: { vignette: 0.5, grain: 0.6, letterbox: true, progress: false } },
  { id: 'cinematic', name: 'Cinematic', tag: 'Film',
    background: { type: 'stars', colors: ['#1e3a8a', '#0f172a', '#fbbf24'] },
    style: { fx: 'cinematic', font: 'Playfair Display', weight: 700, size: 84, color: '#f8f1e4', accent: '#e8b86d', posY: 0.5, upper: true },
    overlay: { vignette: 0.55, grain: 0.3, letterbox: true, progress: false } },
  { id: 'caption-box', name: 'Caption Box', tag: 'Great on video',
    background: { type: 'gradient', colors: ['#0ea5e9', '#6366f1', '#111827'] },
    style: { fx: 'boxed', font: 'Poppins', weight: 600, size: 62, color: '#ffffff', accent: '#ffffff', posY: 0.78, upper: false },
    overlay: { vignette: 0, grain: 0, letterbox: false, progress: false } },
  { id: 'word-highlight', name: 'Word Highlight', tag: 'Social',
    background: { type: 'aurora', colors: ['#f97316', '#ef4444', '#a855f7'] },
    style: { fx: 'highlight', font: 'Poppins', weight: 800, size: 74, color: '#ffffff', accent: '#ffe14d', posY: 0.72, upper: true },
    overlay: { vignette: 0.2, grain: 0, letterbox: false, progress: false } },
  { id: 'glitch-eq', name: 'Glitch EQ', tag: 'Electronic',
    background: { type: 'bars', colors: ['#3b0764', '#22d3ee', '#f0abfc'] },
    style: { fx: 'glitch', font: 'Space Grotesk', weight: 700, size: 80, color: '#ffffff', accent: '#22e6ff', posY: 0.2, upper: true },
    overlay: { vignette: 0.35, grain: 0.2, letterbox: false, progress: true } },
  { id: 'ocean-wave', name: 'Ocean Wave', tag: 'Chill',
    background: { type: 'waves', colors: ['#0e7490', '#1d4ed8', '#5eead4'] },
    style: { fx: 'wave', font: 'Pacifico', weight: 400, size: 80, color: '#ffffff', accent: '#7df9e0', posY: 0.3, upper: false },
    overlay: { vignette: 0.25, grain: 0, letterbox: false, progress: false } },
  { id: 'vinyl-session', name: 'Vinyl Session', tag: 'Classic',
    background: { type: 'vinyl', colors: ['#b45309', '#f59e0b', '#7c2d12'] },
    style: { fx: 'fade', font: 'Playfair Display', weight: 700, size: 66, color: '#fff7ea', accent: '#f59e0b', posY: 0.86, upper: false },
    overlay: { vignette: 0.45, grain: 0.35, letterbox: false, progress: true } },
];

export function applyTemplate(project, id) {
  const t = TEMPLATES.find(x => x.id === id); if (!t) return;
  project.template = id;
  project.background = structuredClone(t.background);
  project.style = structuredClone(t.style);
  project.overlay = { ...structuredClone(t.overlay), title: project.overlay?.title || '', artist: project.overlay?.artist || '' };
}

export const SAMPLE_LINES = [
  { id: 's1', text: 'Feel the music tonight', start: 0.2, end: 2.6 },
  { id: 's2', text: 'Every word in the light', start: 2.8, end: 5.2 },
  { id: 's3', text: 'Sing it loud, sing it right', start: 5.4, end: 7.8 },
];
