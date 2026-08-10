// Consignes de sécurité et contre-indications, montrées une fois à l'ouverture,
// et rappelables depuis le pied de page à tout moment.
//
// Deux écrans, jamais un diagnostic : l'app informe des risques et renvoie vers
// un médecin en cas de doute, elle ne demande jamais à l'utilisateur de se
// déclarer apte — une case « je n'ai aucune contre-indication » donnerait une
// fausse assurance que ni l'app ni personne ici n'est en mesure de garantir.

const $ = (id) => document.getElementById(id);
const KEY = 'leman.v2.onboarded';

function setStep(step) {
  $('onboarding').dataset.step = step;
}

function open() {
  setStep('safety');
  $('onboarding').hidden = false;
  document.body.classList.add('timing');
  $('onbNext').focus();
}

function close(persist) {
  $('onboarding').hidden = true;
  document.body.classList.remove('timing');
  if (persist) {
    try {
      localStorage.setItem(KEY, '1');
    } catch { /* navigation privée : les consignes redemanderont la prochaine fois, sans conséquence */ }
  }
}

export function initOnboarding() {
  $('onbNext').addEventListener('click', () => setStep('health'));
  $('onbBack').addEventListener('click', () => setStep('safety'));
  $('onbDone').addEventListener('click', () => close(true));

  // Accès permanent depuis le pied de page : les consignes ne sont pas
  // qu'un rite de passage au premier lancement, on doit pouvoir les relire.
  $('reviewSafety').addEventListener('click', () => open());

  let already = false;
  try {
    already = localStorage.getItem(KEY) === '1';
  } catch { /* Storage indisponible : on montre par prudence plutôt que de supposer */ }

  if (!already) open();
}
