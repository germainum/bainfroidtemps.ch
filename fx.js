// Effets d'interface : menu plein écran, apparition des blocs au défilement, et
// la variable `--p` qui fait tourner la forme et le titre d'accueil quand on
// descend. Rien ici n'est nécessaire à la lecture — sans JavaScript, le texte
// reste entier et les blocs restent visibles.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

function initMenu() {
  const btn = document.getElementById('menuBtn');
  const menu = document.getElementById('menu');
  const label = document.getElementById('menuLabel');
  if (!btn || !menu) return;

  const set = (open) => {
    menu.classList.toggle('open', open);
    menu.setAttribute('aria-hidden', String(!open));
    btn.setAttribute('aria-expanded', String(open));
    label.textContent = open ? 'Fermer' : 'Menu';
    document.body.classList.toggle('menu-open', open);
    // `inert` : sans lui, la tabulation traverserait un menu invisible.
    menu.inert = !open;
  };
  set(false);

  btn.addEventListener('click', () => set(!menu.classList.contains('open')));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('open')) { set(false); btn.focus(); }
  });
}

// Progression du défilement sur le premier écran, de 0 à 1.
function initScrollVar() {
  const screen = document.querySelector('.screen');
  if (!screen) return;
  let queued = false;
  const apply = () => {
    queued = false;
    const p = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight)));
    screen.style.setProperty('--p', p.toFixed(3));
  };
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }, { passive: true });
  apply();
}

function reveal() {
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || reduce.matches) return;
  document.documentElement.classList.add('can-reveal');
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('in');
      io.unobserve(en.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
  els.forEach((el) => io.observe(el));
}

export function initFx() {
  initMenu();
  initScrollVar();
  reveal();
}
