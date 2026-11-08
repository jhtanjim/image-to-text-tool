// Runs on every page: theme toggle, menus, and the tools search/filter.
(() => {
  const root = document.documentElement;

  // ---- Dark / light mode (remembered per browser)
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch {}
  });

  // ---- Mobile menu
  const topbar = document.getElementById('topbar');
  const menuBtn = document.getElementById('menuToggle');
  menuBtn?.addEventListener('click', () => {
    const open = topbar.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  // ---- Category dropdowns: hover on desktop (CSS), tap/click to open (touch + keyboard + mobile menu)
  const groups = [...document.querySelectorAll('.nav-group')];
  groups.forEach((g) => {
    const btn = g.querySelector('.nav-btn');
    btn.addEventListener('click', () => {
      const open = !g.classList.contains('open');
      groups.forEach((o) => { o.classList.remove('open'); o.querySelector('.nav-btn').setAttribute('aria-expanded', 'false'); });
      g.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-group') && !e.target.closest('#menuToggle')) groups.forEach((g) => g.classList.remove('open'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { groups.forEach((g) => g.classList.remove('open')); topbar?.classList.remove('open'); }
  });
  // Close the mobile menu when jumping to a section on this page
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', () => topbar?.classList.remove('open')));

  // ---- All tools: search + category tabs
  const search = document.getElementById('toolSearch');
  const cards = [...document.querySelectorAll('.tool-card')];
  const tabs = [...document.querySelectorAll('.tabs button')];
  const empty = document.querySelector('.no-results');
  let cat = 'all';
  function filter() {
    const q = (search?.value || '').trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    cards.forEach((c) => {
      const ok = (cat === 'all' || c.dataset.cat === cat) && words.every((w) => c.dataset.search.includes(w));
      c.hidden = !ok;
      if (ok) shown++;
    });
    if (empty) empty.hidden = shown > 0;
  }
  search?.addEventListener('input', () => {
    // searching looks across all categories
    if (search.value && cat !== 'all') { cat = 'all'; tabs.forEach((t) => t.classList.toggle('on', t.dataset.cat === 'all')); }
    filter();
  });
  tabs.forEach((t) => t.addEventListener('click', () => {
    cat = t.dataset.cat;
    tabs.forEach((o) => o.classList.toggle('on', o === t));
    filter();
  }));
})();
