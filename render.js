// Server-side page rendering: every tool gets its own URL, <title>, description and content (good for SEO).
import fs from 'node:fs';
import path from 'node:path';
import { TOOLS, NAV, SITE_NAME, getTool } from './public/js/tools.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BADGE = { img: 'IMG', pdf: 'PDF', word: 'W', xls: 'X', csv: 'CSV', txt: 'T', html: '</>', ppt: 'P', qr: 'QR', bar: '|||' };

export function icon(tool) {
  return `<span class="ti" aria-hidden="true"><span class="ti-a t-${tool.from}">${BADGE[tool.from]}</span><span class="ti-b t-${tool.to}">${BADGE[tool.to]}</span></span>`;
}

function toolsGrid(current) {
  return TOOLS.map((t) => `<a class="pill${t.slug === current ? ' current' : ''}" href="/${t.slug}">${icon(t)}<span>${esc(t.name)}</span>${t.status === 'soon' ? '<em>Soon</em>' : ''}</a>`).join('\n');
}

function header(current) {
  const links = NAV.map(getTool).map((t) => `<a href="/${t.slug}"${t.slug === current ? ' class="active"' : ''}>${esc(t.name)}</a>`).join('');
  return `<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="logo" href="/"><span class="logo-mark">T</span>${esc(SITE_NAME)}</a>
    <nav class="nav">${links}<a href="#all-tools">All tools</a></nav>
    <button id="themeToggle" class="icon-btn" title="Toggle dark mode" aria-label="Toggle dark mode">◐</button>
  </div>
</header>`;
}

function toolBody(tool, viewsDir) {
  if (tool.status === 'soon') {
    return `<section class="card soon-card">
      <div class="soon-icon">${icon(tool)}</div>
      <h2>Coming soon</h2>
      <p>We're building <b>${esc(tool.name)}</b> right now. In the meantime, try one of the tools below.</p>
    </section>`;
  }
  if (tool.fragment) return fs.readFileSync(path.join(viewsDir, 'tools', `${tool.fragment}.html`), 'utf8');
  return `<div id="tool-root" class="card tool"></div>`;
}

function howTo(tool) {
  if (!tool.steps) return '';
  return `<section class="info">
    <h2>How to use ${esc(tool.name)}</h2>
    <ol class="steps">${tool.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
  </section>`;
}

export function renderPage(slug, viewsDir) {
  const tool = getTool(slug);
  if (!tool) return null;
  const scripts = (tool.scripts || []).map((s) => `<script src="${esc(s)}"></script>`).join('\n  ');
  const main = tool.script
    ? tool.classic
      ? `<script src="/tools/${tool.script}"></script>`
      : `<script type="module">import mount from '/tools/${tool.script}'; mount(document.getElementById('tool-root'), ${JSON.stringify({ slug: tool.slug, mode: tool.mode || null })});</script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(tool.title)} – Free Online | ${esc(SITE_NAME)}</title>
  <meta name="description" content="${esc(tool.desc)}" />
  <link rel="canonical" href="/${tool.slug}" />
  <link rel="stylesheet" href="/css/site.css" />
  <script>try{const t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch{}</script>
</head>
<body data-tool="${esc(tool.slug)}"${tool.wordFirst ? ' data-word-first="1"' : ''}>
  ${header(tool.slug)}
  <main class="wrap">
    <section class="hero">
      <h1>${esc(tool.title)}</h1>
      <p>${esc(tool.desc)}</p>
    </section>
    ${toolBody(tool, viewsDir)}
    <section class="all-tools" id="all-tools">
      <h2>All tools</h2>
      <div class="grid">${toolsGrid(tool.slug)}</div>
    </section>
    ${howTo(tool)}
  </main>
  <footer class="footer"><div class="wrap">© ${new Date().getFullYear()} ${esc(SITE_NAME)} · Free online file tools</div></footer>
  <script src="/js/site.js"></script>
  ${scripts}
  ${main}
</body>
</html>`;
}
