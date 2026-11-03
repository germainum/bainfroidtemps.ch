// Effets d'interface : lettres qui s'allument sous le curseur, et apparition
// des blocs au défilement. Rien ici n'est nécessaire à la lecture — sans
// JavaScript, le texte reste entier, et les blocs restent visibles.

const PALETTE = ['#f2283c', '#6f5bff', '#2fd27a', '#35b6ff', '#ffb02e', '#ff6fb5'];
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

// Découpe le texte d'un élément en lettres, sans toucher à ses balises : le
// <i> du logo garde son italique.
function splitLetters(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const letters = [];
  for (const node of nodes) {
    if (!node.nodeValue.trim()) continue;
    const frag = document.createDocumentFragment();
    for (const ch of node.nodeValue) {
      if (ch === ' ') {
        // Un vrai espace disparaît entre éléments flex : on garde une cale.
        const sp = document.createElement('span');
        sp.className = 'sp';
        sp.textContent = '\u00a0';
        frag.append(sp);
        continue;
      }
      const span = document.createElement('span');
      span.className = 'l';
      span.textContent = ch;
      frag.append(span);
      letters.push(span);
    }
    node.replaceWith(frag);
  }
  return letters;
}

// Les lettres proches du curseur prennent une couleur, puis la rendent en
// douceur : la transition ne joue qu'au retour (voir `.l` dans app.css).
function lightLetters(root) {
  const letters = splitLetters(root);
  if (!letters.length) return;
  // Le texte lu par les lecteurs d'écran reste celui de l'élément entier.
  if (!root.getAttribute('aria-label')) root.setAttribute('aria-label', root.textContent.trim());
  letters.forEach((l) => l.setAttribute('aria-hidden', 'true'));

  let rects = null;
  const measure = () => { rects = letters.map((l) => l.getBoundingClientRect()); };
  root.addEventListener('pointerenter', measure);
  window.addEventListener('resize', () => { rects = null; });

  root.addEventListener('pointermove', (e) => {
    if (reduce.matches) return;
    if (!rects) measure();
    letters.forEach((l, i) => {
      const r = rects[i];
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      if (dx * dx + dy * dy > 34 * 34 || l.classList.contains('hot')) return;
      l.style.setProperty('--c', PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      l.classList.add('hot');
      setTimeout(() => l.classList.remove('hot'), 140);
    });
  });
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
  document.querySelectorAll('[data-letters]').forEach(lightLetters);
  reveal();
}
