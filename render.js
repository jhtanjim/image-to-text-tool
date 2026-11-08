// Server-side page rendering: every tool gets its own URL, <title>, description and content (good for SEO).
// Used live by server.js and at build time by build-static.js.
import fs from 'node:fs';
import path from 'node:path';
import { TOOLS, SITE_NAME, getTool, CATEGORIES, categoryOf, shortDesc, SERVER_TOOLS } from './public/js/tools.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------------------------------------------------------- icons (inline SVG, inherit currentColor)
const svg = (d, size = 18, extra = '') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
export const ICONS = {
  chevron: svg('<path d="m6 9 6 6 6-6"/>', 16),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 16),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 18),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>', 22),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', 19, ' class="moon"'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 19, ' class="sun"'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2"/>', 30),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 16),
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>', 16),
};
const LOGO = `<svg class="logo-mark" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="9" fill="currentColor"/>
  <path d="M11 7.5h7.2l5.3 5.3V23a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2z" fill="#fff"/>
  <path d="M18 7.5V13h5.5" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".35"/>
  <rect x="5.5" y="16" width="21" height="2.6" rx="1.3" fill="#ef5350"/>
</svg>`;

const BADGE = { img: 'IMG', pdf: 'PDF', word: 'W', xls: 'X', csv: 'CSV', txt: 'T', html: '</>', ppt: 'P', qr: 'QR', bar: '|||' };
export function icon(tool) {
  return `<span class="ti" aria-hidden="true"><span class="ti-a t-${tool.from}">${esc(BADGE[tool.from])}</span><span class="ti-b t-${tool.to}">${esc(BADGE[tool.to])}</span></span>`;
}
const soonTag = (t) => (t.status === 'soon' ? '<em>Soon</em>' : '');

// ---------------------------------------------------------------- header
function header(current) {
  const currentCat = categoryOf(current)?.id;
  const groups = CATEGORIES.map((c) => `
      <div class="nav-group">
        <button class="nav-btn${c.id === currentCat ? ' current' : ''}" type="button" aria-expanded="false">${esc(c.name)} ${ICONS.chevron}</button>
        <div class="menu">${c.slugs.map(getTool).map((t) => `<a href="/${t.slug}"${t.slug === current ? ' class="current" aria-current="page"' : ''}>${icon(t)}<span>${esc(t.name)}</span>${soonTag(t)}</a>`).join('')}</div>
      </div>`).join('');
  return `<header class="topbar" id="topbar">
  <div class="wrap topbar-inner">
    <a class="logo" href="/" aria-label="${esc(SITE_NAME)} home">${LOGO}<span>Text<b>Snap</b></span></a>
    <nav class="nav" aria-label="Tools">${groups}
    </nav>
    <div class="top-actions">
      <a class="btn sm ghost all-link" href="#all-tools">All tools</a>
      <button id="themeToggle" class="icon-btn theme-toggle" type="button" title="Dark / light mode" aria-label="Switch dark or light mode">${ICONS.moon}${ICONS.sun}</button>
      <button id="menuToggle" class="icon-btn menu-toggle" type="button" aria-label="Open menu" aria-expanded="false">${ICONS.menu}</button>
    </div>
  </div>
</header>`;
}

// ---------------------------------------------------------------- hero
function hero(tool) {
  const cat = categoryOf(tool.slug);
  const privacy = SERVER_TOOLS.has(tool.slug)
    ? `${ICONS.lock} Files are deleted right after converting`
    : `${ICONS.lock} Files never leave your device`;
  return `<section class="hero">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="#all-tools">${esc(cat?.name || 'Tools')}</a></nav>
      <h1>${esc(tool.title)}</h1>
      <p>${esc(tool.desc)}</p>
      <ul class="trust">
        <li>${ICONS.check} 100% free, no sign-up</li>
        <li>${privacy}</li>
        <li>${ICONS.phone} Works on phone &amp; computer</li>
      </ul>
    </section>`;
}

const FLOW = `<ol class="flow" aria-label="How it works"><li><b>1</b> Upload</li><li><b>2</b> Convert</li><li><b>3</b> Download</li></ol>`;

function toolBody(tool, viewsDir) {
  if (tool.status === 'soon') {
    return `<section class="card soon-card">
      <div>${icon(tool)}</div>
      <h2>Coming soon</h2>
      <p><b>${esc(tool.name)}</b> is almost ready. Meanwhile, try one of the tools below.</p>
    </section>`;
  }
  const body = tool.fragment
    ? fs.readFileSync(path.join(viewsDir, 'tools', `${tool.fragment}.html`), 'utf8')
    : `<div id="tool-root" class="card tool"></div>`;
  return FLOW + body;
}

// ---------------------------------------------------------------- all tools (search + category tabs + cards)
function allTools(current) {
  const card = (t, cat) => `<a class="tool-card${t.slug === current ? ' current' : ''}${t.status === 'soon' ? ' soon' : ''}" href="/${t.slug}" data-cat="${cat.id}" data-search="${esc((t.name + ' ' + t.title + ' ' + t.desc).toLowerCase())}">
        ${icon(t)}<span class="tc-body"><b>${esc(t.name)}</b><small>${esc(shortDesc(t))}</small></span>${soonTag(t)}
      </a>`;
  return `<section class="all-tools" id="all-tools">
      <div class="tools-head">
        <div><h2>All tools</h2><p>${TOOLS.length} free tools for images, PDF, Word and Excel.</p></div>
        <label class="search">${ICONS.search}<input type="search" id="toolSearch" placeholder="Search tools… e.g. PDF, Excel, QR" aria-label="Search tools" /></label>
      </div>
      <div class="tabs" role="tablist">
        <button type="button" class="on" data-cat="all">All</button>
        ${CATEGORIES.map((c) => `<button type="button" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
      </div>
      <div class="tool-cards">${CATEGORIES.flatMap((c) => c.slugs.map((s) => card(getTool(s), c))).join('')}</div>
      <p class="no-results" hidden>No tools match your search.</p>
    </section>`;
}

// ---------------------------------------------------------------- how-to + FAQ
function info(tool) {
  const steps = tool.steps ? `<h2>How to use ${esc(tool.name)}</h2>
      <ol class="steps">${tool.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol>` : '';
  return `<section class="info">
      ${steps}
      <h2>Questions</h2>
      <details><summary>Is ${esc(SITE_NAME)} really free?</summary><p>Yes. Every tool is free to use with no sign-up and no watermark.</p></details>
      <details><summary>Are my files safe?</summary><p>${SERVER_TOOLS.has(tool.slug)
        ? 'Your file is converted on our server and deleted immediately afterwards. We never keep or share it.'
        : 'This tool runs entirely in your browser, so your files are never uploaded anywhere.'}</p></details>
      <details><summary>Does it work with Bangla (বাংলা)?</summary><p>Yes. Bangla text is supported in reading, converting and creating documents.</p></details>
      <details><summary>Do I need to install anything?</summary><p>No. It works in any modern browser on phone, tablet or computer.</p></details>
    </section>`;
}

// ---------------------------------------------------------------- footer
function footer() {
  const col = (c) => `<div><h4>${esc(c.name)}</h4><ul>${c.slugs.slice(0, 6).map(getTool).map((t) => `<li><a href="/${t.slug}">${esc(t.name)}</a></li>`).join('')}</ul></div>`;
  return `<footer class="footer">
    <div class="wrap footer-grid">
      <div class="f-brand"><a class="logo" href="/">${LOGO}<span>Text<b>Snap</b></span></a>
        <p>Free online tools to read text from images and convert PDF, Word and Excel files. Made in Bangladesh.</p></div>
      ${CATEGORIES.map(col).join('')}
    </div>
    <div class="wrap f-bottom"><span>© ${new Date().getFullYear()} ${esc(SITE_NAME)}</span><span>Free · Fast · Private</span></div>
  </footer>`;
}

// ---------------------------------------------------------------- page
export function renderPage(slug, viewsDir) {
  const tool = getTool(slug);
  if (!tool) return null;
  const scripts = (tool.scripts || []).map((s) => `<script src="${esc(s)}"></script>`).join('\n  ');
  const main = tool.status === 'soon' || !tool.script ? ''
    : tool.classic
      ? `<script src="/tools/${tool.script}"></script>`
      : `<script type="module">import mount from '/tools/${tool.script}'; mount(document.getElementById('tool-root'), ${JSON.stringify({ slug: tool.slug, mode: tool.mode || null })});</script>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(tool.title)} – Free Online | ${esc(SITE_NAME)}</title>
  <meta name="description" content="${esc(tool.desc)}" />
  <link rel="canonical" href="/${tool.slug}" />
  <meta name="theme-color" content="#0a7a52" />
  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0a7a52"/><path d="M11 7.5h7.2l5.3 5.3V23a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2z" fill="#fff"/><rect x="5.5" y="16" width="21" height="2.6" rx="1.3" fill="#ef5350"/></svg>')}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
  <link rel="stylesheet" href="/css/site.css" />
  <script>try{const t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch{}</script>
</head>
<body data-tool="${esc(tool.slug)}"${tool.wordFirst ? ' data-word-first="1"' : ''}>
  ${header(tool.slug)}
  <main class="wrap">
    ${hero(tool)}
    ${toolBody(tool, viewsDir)}
    ${allTools(tool.slug)}
    ${info(tool)}
  </main>
  ${footer()}
  <script src="/js/site.js"></script>
  ${scripts}
  ${main}
</body>
</html>`;
}
