export type Theme = 'light' | 'dark';
const KEY = 'maish-theme';

export function getTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try { window.localStorage.setItem(KEY, theme); } catch { /* ignore */ }
}
