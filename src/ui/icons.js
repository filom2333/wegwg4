// Minimal line icons (24px viewBox, stroke = currentColor).

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICONS = {
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  food: svg('<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-1.7 0-3 2.2-3 5s1.3 4 3 4v9"/>'),
  water: svg('<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>'),
  energy: svg('<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/>'),
  moon: svg('<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>'),
  fuel: svg('<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h12M8 8h4M15 9h2l2 2v7a1.5 1.5 0 0 1-3 0v-3h-1"/>'),
  temp: svg('<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0zM12 10v7"/>'),
  battery: svg('<rect x="3" y="7" width="18" height="12" rx="1.5"/><path d="M7 7V5h3v2M14 7V5h3v2M7 13h3M15.5 11.5v3M14 13h3"/>'),
  car: svg('<path d="M3 15v-3l2-5h14l2 5v3M3 15h18v3h-2M5 18H3M7 18h10"/><circle cx="7" cy="16" r="1.5"/><circle cx="17" cy="16" r="1.5"/>'),
};
