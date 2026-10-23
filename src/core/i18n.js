// Languages. The game is written in English; another language is a dictionary of the English
// strings (lang/ru.js: exact lines, and patterns for lines with numbers and names in them).
// Translation happens where text reaches the screen: every text node the UI writes is looked up
// as it appears or changes (a MutationObserver over the page), so the code that builds menus,
// prompts and the HUD stays in English. Switching back restores the English it remembers.

import { settings } from './settings.js';
import { RU, RU_PATTERNS } from './lang/ru.js';

export const LANGS = [
  ['en', 'English'],
  ['ru', 'Русский'],
];

export function lang() {
  return settings.data.language === 'ru' ? 'ru' : 'en';
}

// lowercase keys too: labels are lowercased inside sentences ("to the front bumper")
const LOWER = new Map(Object.entries(RU).map(([k, v]) => [k.toLowerCase(), v.charAt(0).toLowerCase() + v.slice(1)]));
const cache = new Map();

// An English line in the current language (unchanged when there is no translation).
export function tr(s) {
  if (!s || lang() === 'en') return s;
  let r = cache.get(s);
  if (r === undefined) {
    r = look(s);
    cache.set(s, r);
  }
  return r;
}

function look(s) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  const core = m[2];
  if (!core || !/[A-Za-z]/.test(core)) return s;
  let out = RU[core];
  if (out === undefined)
    for (const [re, f] of RU_PATTERNS) {
      const x = re.exec(core);
      if (x) {
        out = typeof f === 'function' ? f(x, tr) : f;
        break;
      }
    }
  if (out === undefined) out = LOWER.get(core.toLowerCase());
  return out === undefined ? s : m[1] + out + m[3];
}

// ------------------------------------------------------------------ the page
const ORIG = new WeakMap(); // text node -> the English it was given
const WROTE = new WeakMap(); // text node -> what we put in it
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE']);

function skipNode(n) {
  const p = n.parentElement;
  return !p || SKIP.has(p.tagName) || p.closest('.no-tr');
}

function doText(n) {
  if (skipNode(n)) return;
  const cur = n.data;
  if (WROTE.get(n) === cur) return;
  // the game wrote new English (or this is the first time we see it)
  ORIG.set(n, cur);
  const t = tr(cur);
  if (t !== cur) {
    WROTE.set(n, t);
    n.data = t;
  } else WROTE.set(n, cur);
}

function doAttrs(el) {
  if (el.closest && el.closest('.no-tr')) return;
  for (const a of ['placeholder', 'title', 'aria-label']) {
    if (!el.hasAttribute || !el.hasAttribute(a)) continue;
    const key = 'trOrig_' + a;
    const v = el.getAttribute(a);
    if (el.dataset && el.dataset[key + 'w'] === v) continue;
    if (el.dataset) el.dataset[key] = v;
    const t = tr(v);
    if (el.dataset) el.dataset[key + 'w'] = t;
    if (t !== v) el.setAttribute(a, t);
  }
}

function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1 || SKIP.has(root.tagName)) return;
  doAttrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === 3) doText(n);
    else doAttrs(n);
  }
}

let observer = null;
export function startTranslation() {
  if (observer || typeof MutationObserver === 'undefined') return;
  document.documentElement.lang = lang();
  observer = new MutationObserver((recs) => {
    if (lang() === 'en') return;
    for (const r of recs) {
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') doAttrs(r.target);
      else for (const n of r.addedNodes) walk(n);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
  if (lang() !== 'en') walk(document.body);
  settings.onChange((k) => {
    if (k !== 'language' && k !== '*') return;
    document.documentElement.lang = lang();
    retranslate(document.body);
  });
}

// After a switch: everything on the page back to its English, then into the new language.
function retranslate(root) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    const o = ORIG.get(n);
    if (o === undefined) {
      if (lang() !== 'en') doText(n);
      continue;
    }
    const t = lang() === 'en' ? o : tr(o);
    WROTE.set(n, t);
    if (n.data !== t) n.data = t;
  }
}
