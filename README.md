# Bains Froids Léman

Application web installable (PWA) pour préparer un bain froid dans le Léman : la
température de l'eau à l'endroit où vous êtes, la durée conseillée qui en découle,
et un minuteur qui guide l'immersion. Conçue pour l'iPhone — elle s'ajoute à
l'écran d'accueil, s'ouvre en plein écran comme une app native, et fonctionne hors
ligne avec la dernière valeur connue.

Aucun compte, aucune clé d'API, aucun paquet à installer : des fichiers statiques et
un instantané de données produit par la CI.

En ligne : **https://bainfroidtemps.ch/**

## Installation sur iPhone

1. Publiez le site (voir « Déploiement » ci-dessous) — Safari exige HTTPS pour
   installer une PWA.
2. Ouvrez l'adresse dans **Safari** (pas Chrome : sur iOS, seul Safari peut installer).
3. **Partager** → **Sur l'écran d'accueil** → **Ajouter**.

L'icône apparaît sur l'écran d'accueil ; au lancement, l'app s'ouvre sans barre
d'adresse et affiche immédiatement la dernière température en cache, avant de
rafraîchir.

## Ce qu'affiche l'app

L'écran d'accueil est un écran de préparation, tenu à quatre éléments : rien à
lire, une décision à prendre.

- la **température de l'eau** au lieu courant, en très gros — c'est la seule
  information dont dépend tout le reste ; elle est estompée au-delà de six heures ;
- une **phrase du jour** sous le chiffre : ce que l'app dit de l'eau, plutôt que
  ce qu'elle mesure. Elle suit la température et la date — même formule toute la
  journée, une autre demain. Le ton reste posé : jamais une performance à
  accomplir ;
- trois **repères** : la **tendance sur 24 h** (`+0,4°`, `stable`), l'âge du
  chiffre avec sa nature (**mesuré** ou **simulé** — « relevé » ne disait pas d'où
  il venait), et la **source** — nom de la station officielle, ou `Eawag`.
  Aucun des trois ne répète le chiffre : ils disent d'où il vient et s'il bouge ;
- **mon temps de présence**, réglable, qui découle de la température ;
- le **bouton de lancement** — « Je me jette à l'eau ». Il vit dans un bandeau
  fixe, toujours visible, y compris en parcourant la carte ou la courbe plus bas :
  le geste ne doit dépendre ni de remonter pour le retrouver, ni d'un excès de
  prudence pour l'éviter par mégarde.

Le **lieu le plus proche de vous** est sélectionné d'emblée si la localisation est
autorisée, avec la distance affichée. À la première ouverture, le chiffre monte
jusqu'à sa valeur et une vague traverse le bandeau — une fois, sans boucler : un
mouvement perpétuel derrière une valeur qu'on vient lire finirait par gêner.

En dessous : une **carte du lac** portant la température des dix lieux,
comparables entre elles car toutes issues du modèle, et une **courbe sur sept
jours** — cinq écoulés en trait plein, deux de prévision en pointillé.

Dix lieux sont proposés, des Pâquis au Bouveret. On passe de l'un à l'autre par un
**point de la carte**, par **balayage horizontal** sur le premier écran, ou par les
flèches du clavier. Le balayage cède la place au défilement dès que le geste est
vertical. Aux extrémités, il s'arrête plutôt que de boucler.

Pour ajouter un lieu, complétez la constante `SPOTS` dans `sources.js` : le point
doit se situer **sur l'eau**, sinon la simulation ne renvoie rien.

## Sécurité : accueil et contre-indications

Au **premier lancement**, un écran de sécurité en deux temps s'ouvre avant tout
le reste (`onboarding.js`) : les quatre risques de l'eau froide — choc thermique,
jamais seul, afterdrop, sortie immédiate — puis un écran de **contre-indications**
(cardiaque, tension, grossesse, épilepsie, Raynaud) qui renvoie vers un médecin,
avec les numéros d'urgence suisses. L'app **n'est pas un dispositif médical** et
ne le prétend nulle part : il n'existe **aucune case « je suis apte »** —
s'auto-certifier donnerait une assurance que rien ici ne peut garantir. Un flag
`leman.v2.onboarded` évite de le remontrer, et le lien « Consignes et
contre-indications » en pied de page le rouvre à volonté.

La **régularité** apparaît sur l'écran d'accueil, en une ligne, une fois un
premier bain consigné — `statsPhrase()`, jamais un chiffre de durée ni de froid
mis en avant. Un test dédié (`tools/test-parsers.mjs`) vérifie qu'aucun scénario,
même un bain long et glacial, ne produit une phrase récompensant l'escalade :
c'est la contrainte du §5 du cahier des charges, testée plutôt que promise.

## Minuteur de bain froid

La durée conseillée découle de la température de l'eau : **une minute par degré**,
et c'est un plafond, jamais un objectif. Dix minutes à 10 °C. La valeur est
plafonnée à 20 minutes, car au-delà de 18 °C la règle perd son sens — ce n'est
plus un bain froid. Elle reste réglable à la main.

Pendant l'immersion, une **respiration guidée** accompagne l'entrée dans l'eau :
quatre secondes d'inspiration, six d'expiration, l'expiration allongée étant ce
qui calme la réponse au choc thermique. Un cercle s'ouvre et se referme au rythme
de la consigne, pour ne pas avoir à lire.

Un **message du coach** l'accompagne, ancré dans le temps plutôt que dans la
mécanique de sécurité : « Installe-toi » à 0:00, « le premier souffle coupé,
c'est normal » à 0:15, « ton corps s'ajuste » à une minute, « rien à prouver »
à mi-parcours, « encore un souffle » dans la dernière minute, « voilà » à
l'échéance — et pendant le dépassement. `bathCoach()` dans `sources.js` retient
le seuil le plus avancé déjà atteint ; sur un bain très court, où plusieurs
seuils tombent à la même seconde, les seuils relatifs à la durée choisie
(mi-parcours, dernière minute, fin) l'emportent sur ceux à heure fixe.

Le lancement demande **deux gestes** : « Démarrer », qui affiche les consignes
essentielles, puis un **maintien d'une seconde** sur un bouton circulaire dont
l'anneau se remplit. Ce n'est pas une coquetterie : cette seconde impose une
lecture des consignes juste avant d'entrer dans l'eau, et rend impossible un
lancement par mégarde. Relâcher trop tôt n'enclenche rien et le dit.

C'est là, et nulle part ailleurs, que se lisent les six consignes de sécurité —
« quelqu'un vous accompagne et vous voit » en tête. L'écran d'accueil ne les
répète pas : elles n'ont d'utilité qu'au moment d'entrer dans l'eau.

Pendant l'immersion, le minuteur passe par trois temps, dont les seuils suivent la
durée totale : entrée dans l'eau (respiration), régime stable (rester près du
bord), puis préparation de la sortie. À l'échéance, il compte le dépassement
plutôt que de s'arrêter en silence.

**L'écran change de nature** dès le lancement : fond profond, texte clair. On ne
lit plus une donnée, on traverse un moment — et un fond sombre se regarde mieux
les yeux pleins d'eau. Les jetons de couleur sont redéfinis sur le conteneur du
minuteur, ce qui teinte d'un coup tout ce qu'il contient.

Une **vibration** marque le départ, chaque minute entière, et l'échéance.
Attention : **iOS n'expose pas `navigator.vibrate`** — sur iPhone, le code se
tait et le repère reste sonore. Il fonctionne sur Android. Rien dans l'interface
ne promet une vibration, faute de pouvoir la tenir partout.

### Après la sortie

« Je sors » ne referme pas l'écran, il ouvre le bilan : « Voilà. », la durée
tenue, la température de l'eau, et deux gestes — **« J'y étais »**, qui inscrit
l'immersion au journal local, et un **partage** natif (`navigator.share`, absent
du bouton si le navigateur ne l'a pas).

Rien n'est enregistré avant ce geste : un bain interrompu au bout de dix secondes
n'a pas à figurer dans une série. Le journal vit dans `localStorage`, cent
entrées au plus, sans compte ni serveur.

`bathStats()` en tire une **série de jours consécutifs**, la température la plus
froide affrontée et les minutes de la semaine. Deux décisions valent d'être
connues : s'être baigné **hier** suffit à maintenir la série (sans quoi elle
tomberait à zéro chaque matin avant le bain), et une série interrompue
avant-hier vaut zéro (sans quoi le compteur resterait figé sur un exploit
ancien). `statsPhrase()` la formule en habitude — « 5 jours que tu réponds
présent » — et non en score à défendre.

Deux détails d'implémentation qui comptent :

- le décompte se calcule depuis un **horodatage de départ**, jamais par
  accumulation de ticks : iOS suspend le JavaScript en arrière-plan, et un
  compteur incrémental dériverait ;
- la session est **conservée** : un rechargement en pleine immersion la retrouve,
  et une sortie l'efface définitivement.

Le signal sonore ne peut pas retentir si l'app est en arrière-plan — iOS y suspend
l'audio. L'écran le rappelle plutôt que de le taire.

## Soutien et contact

Deux liens en bas de page, à des niveaux d'insistance distincts du bouton de
lancement — qui garde seul le violet plein :

- **« Offre-moi un café »**, pastille lilas, vers
  [paypal.me/germainlot](https://paypal.me/germainlot) ;
- **« Contactez-moi sur WhatsApp »**, contour seul, pour une demande de création
  d'application. Le message est prérempli. Le libellé nomme WhatsApp : une
  destination inattendue au toucher se paie en confiance.

## Le bandeau d'action fixe

Le bouton de lancement vit dans un bandeau `position: fixed`, et **l'invite
d'installation iOS vit dedans**, empilée au-dessus de lui. C'est le résultat
d'un bug : les deux étaient fixés au même bord indépendamment, chacun ignorant
la hauteur de l'autre, et le texte de l'invite passait sous le bouton.

La hauteur du bandeau est ensuite **mesurée** par `trackDockHeight()`
(`app.js`), qui écrit `--dock-h` sur `:root` via un `ResizeObserver`. La page
s'en sert pour réserver la place en bas — `.app`, `.screen` et le message
transitoire. Une valeur en dur ne pouvait pas tenir : l'invite apparaît puis
disparaît, l'encoche varie d'un appareil à l'autre, et un libellé peut passer à
la ligne.

Les règles affichées viennent de la SSS, 24 heures, 20 minutes et la WTA, citées
dans l'app. Elles ne remplacent pas un avis médical.

## Sources de données

| Source | Rôle | Nature | Chemin |
| --- | --- | --- | --- |
| [existenz.ch](https://api.existenz.ch/) (données OFEV) | températures mesurées en station | mesure in situ | appelée directement par le navigateur |
| [Alplakes / Eawag](https://www.alplakes.eawag.ch/) | valeur en tout point + historique + prévision | simulation Delft3D-FLOW | précalculée par la CI (voir ci-dessous) |
| [Natural Earth](https://www.naturalearthdata.com/) | contour du lac | domaine public | figé dans `sources.js` |

Une mesure officielle située à moins de 12 km du lieu choisi et datant de moins de
six heures est privilégiée ; sinon la simulation prend le relais ; sinon le cache
local, avec son âge affiché.

### La carte

Le contour du Léman vient de **Natural Earth 10m** (domaine public), converti
depuis son GeoJSON en `[lat, lon]` dans `sources.js`. Trente-huit points : la
silhouette est juste, mais lissée près des rives — ce n'est pas une carte de
navigation.

Toucher la carte sélectionne le lieu **le plus proche du doigt**, sur une seule
zone sensible couvrant le dessin. Une cible par lieu semblait plus naturelle, mais
au Haut-Lac, Montreux et Le Bouveret ne sont qu'à quatre kilomètres : des cibles
confortables s'y recouvraient et l'une des deux devenait inatteignable. Au clavier,
les flèches font le même travail.

Un test vérifie que **les dix lieux tombent dans l'eau**, et il travaille : il a
d'abord pris Genève et Nyon en défaut sur un contour dessiné à la main, puis
Genève, Le Bouveret, Évian et Thonon sur le contour réel, plus sévère près des
rives. Les quatre ont été repoussés de 0,2 à 1,5 km au large. Sa portée dépasse
la carte : un point posé à terre n'obtiendrait aucune valeur du modèle.

### Pourquoi le modèle passe par la CI

L'API Alplakes ne renvoie pas d'en-tête CORS : le navigateur refuse donc l'appel
depuis une page web, alors que la même URL fonctionne parfaitement hors navigateur.
`tools/build-model-data.mjs` l'interroge donc dans GitHub Actions — où CORS n'existe
pas — pour les dix lieux, et dépose `data/model.json` dans le site publié. L'app lit
ce fichier depuis sa propre origine, sans requête bloquée.

Le workflow tourne à chaque poussée **et toutes les heures**, ce qui suffit largement :
la température d'un lac varie de moins d'un demi-degré par heure. Trois garde-fous :

- l'instantané déjà en ligne est récupéré avant régénération, donc une panne
  d'Alplakes ne fait pas disparaître les données publiées ;
- un échec de génération ne bloque pas la publication du code ;
- l'app affiche l'âge de l'instantané dès qu'il dépasse six heures — une CI en panne
  se voit, au lieu de figer silencieusement la température.

`data/model.json` n'est pas versionné : c'est un produit de compilation. Pour le
générer en local, `npm run data`.

## Référencement et partage

Le `<head>` porte un titre orienté recherche (« Température du Léman — Bain froid
en direct »), une description, l'URL canonique, les balises **Open Graph** et
**Twitter Card**, et un bloc **JSON-LD** de type `WebApplication` — sans quoi
Google prend une app pour un article de blog. `robots.txt` et `sitemap.xml`
complètent l'ensemble.

### Le vrai plafond : du texte à indexer

L'app était **invisible pour un moteur de recherche**, et pas à cause de ses
balises. Mesuré sur la page : **125 mots indexables**, dont l'essentiel était de
l'habillage (« Fermer », « Offre-moi un café »), **aucun `<h1>`**, et **aucune
température dans le HTML** — les valeurs sont des tirets remplis par JavaScript,
et les consignes de sécurité vivent dans un dialogue `hidden`.

Deux corrections, dans cet ordre d'importance :

**Une section rédigée**, sous l'app plutôt que dedans : l'écran de préparation
reste nu, et le texte qui rend le site trouvable vit plus bas, pour qui descend.
Elle répond aux questions réellement posées — la température du jour lieu par
lieu, combien de temps rester, comment entrer, où se baigner — et porte le `<h1>`
qui manquait. **125 → 823 mots.**

**Le préremplissage en CI** (`tools/prerender-seo.mjs`). Google exécute le
JavaScript, mais tard et sans garantie, alors que les valeurs sont déjà connues au
moment de la publication. Le script les inscrit dans `index.html` entre des
marqueurs `<!-- prerender:… -->`, et met à jour le `lastmod` du sitemap. Il ne
touche qu'à l'intérieur des marqueurs, ne peut donc pas abîmer la page, et il est
idempotent.

Le dépôt garde des **tirets**, pas des valeurs : si le préremplissage échoue, un
robot voit une absence plutôt qu'un chiffre périmé, et `renderTempsList()` sert
les vrais visiteurs comme avant.

### Le balisage FAQ, et ce qu'il ne fait plus

Un `FAQPage` en JSON-LD reprend **mot pour mot** les six questions visibles —
Google rejette, à juste titre, un balisage qui décrit un contenu absent de la
page.

Il faut savoir ce qu'il n'apporte pas. **Les résultats enrichis FAQ n'existent
plus** : Google les a restreints en août 2023 aux sites gouvernementaux et de
santé reconnus, puis **entièrement supprimés de la recherche le 7 mai 2026**, y
compris pour ceux-là. Ce balisage ne produira donc aucun affichage dépliant dans
les résultats, et le support de la FAQ a quitté le Rich Results Test en juin
2026 — une absence dans l'outil de test est normale, pas un défaut.

Il est conservé quand même : Google a confirmé continuer à l'analyser pour
comprendre les pages, il ne coûte que deux kilo-octets, et d'autres
consommateurs — moteurs concurrents, systèmes de réponse par IA — peuvent s'en
servir. Ce qui porte la valeur, c'est le **texte visible** des six questions, qui
compte comme contenu indexable et répond à de vraies recherches.

### Ce qui reste à faire, et son risque

Le levier suivant serait une **page par lieu** (`/vevey`, `/lausanne`…), la façon
habituelle de se placer sur « température eau Lausanne ». Elle n'est pas faite,
et volontairement : dix pages qui ne diffèrent que par un chiffre sont du contenu
mince, ce que Google sanctionne. Il faudrait à chacune un texte propre et
défendable — position sur le lac, rive, station la plus proche et sa distance —
avant que l'opération soit un gain plutôt qu'un risque.

Deux points valent d'être connus avant de toucher à ces balises :

- **les URL absolues sont obligatoires** dans `canonical`, `og:url`, `og:image`,
  `twitter:image` et le `url` du JSON-LD : les robots des réseaux sociaux ne
  résolvent pas les chemins relatifs. Elles sont donc écrites en dur ;
- **`og-image.png` doit exister**. Une balise `og:image` qui pointe vers un
  fichier absent produit une carte de partage cassée, pire que pas de carte du
  tout. Elle est générée par `npm run og` et versionnée.

Tout le reste du site utilise des **chemins relatifs** (`./`, `icons/…`), y
compris `start_url` et `scope` du manifest. C'est ce qui a permis de passer du
sous-dossier `germainum.github.io/CAS/` au domaine propre sans toucher à un seul
d'entre eux.

### Changer de domaine

Huit valeurs portent l'adresse en dur — cinq dans `index.html` (`canonical`,
`og:url`, `og:image`, `twitter:image`, `url` du JSON-LD), le `Sitemap:` de
`robots.txt`, le `<loc>` de `sitemap.xml` et le fichier `CNAME`. Ce dernier doit
correspondre au champ *Settings → Pages → Custom domain* : un désaccord entre les
deux ne casse rien avec un déploiement par Actions, où le réglage fait autorité,
mais rend le dépôt trompeur.

Côté registraire, un domaine apex chez GitHub Pages demande quatre
enregistrements **A** (et, si l'on veut IPv6, quatre **AAAA**) :

```
A     @      185.199.108.153
A     @      185.199.109.153
A     @      185.199.110.153
A     @      185.199.111.153
CNAME www    germainum.github.io.
```

Deux vérifications valent mieux qu'une supposition : `Custom domain` dit ce que
GitHub attend, le DNS dit où le nom pointe réellement. Tant que le second ne
répond pas, le site reste injoignable même si le premier est correct.

Enfin, **« Enforce HTTPS »** doit être coché dès que le certificat est délivré :
Safari exige HTTPS pour installer une PWA.

## Développement

```bash
npm test                      # tests de la couche données, sans réseau
npm run data                  # génère data/model.json (nécessite le réseau)
npm run check                 # interroge les API réelles et diagnostique
npm run check montreux        # idem pour un autre lieu
npm run serve                 # sert le site sur http://localhost:4173
npm run icons                 # régénère les icônes (nécessite pillow)
npm run og                    # régénère l'image de partage (nécessite pillow)
npm run seo                   # inscrit les valeurs dans index.html (après npm run data)
```

L'app expose aussi un dépliant **« Diagnostic des sources »** en bas de page :
utile depuis l'iPhone lui-même, il liste les appels réussis ou échoués.

### Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | structure de la page et métadonnées iOS |
| `app.css` | mise en forme, thèmes clair et sombre, encoches d'écran |
| `sources.js` | URL, analyse des réponses, choix de la valeur — sans DOM ni réseau |
| `app.js` | requêtes, cache local, rendu, cycle de vie |
| `bath.js` | minuteur : consignes, maintien de confirmation, phases, session |
| `onboarding.js` | écran de sécurité et contre-indications, au premier lancement |
| `lakemap.js` | carte du lac : silhouette, points, températures |
| `sw.js` | service worker : réseau d'abord, cache en secours |
| `manifest.webmanifest` | nom, icônes, mode plein écran |
| `robots.txt`, `sitemap.xml` | référencement : autorisation et URL canonique |
| `og-image.png` | vignette de partage, 1200 × 630 |
| `tools/build-model-data.mjs` | précalcul de `data/model.json` dans la CI |
| `tools/test-parsers.mjs` | 100 tests sur `sources.js` |
| `tools/check-sources.mjs` | vérification des API en conditions réelles |
| `tools/make-icons.py` | génération des icônes PNG |
| `tools/make-og-image.py` | génération de la vignette de partage |
| `tools/prerender-seo.mjs` | inscrit les températures dans `index.html`, en CI |

`sources.js` ne touche ni au DOM ni au réseau, ce qui permet de le tester
directement sous Node : c'est là que vit toute la logique susceptible de casser
quand une API amont change.

## Déploiement

**Avec GitHub Actions** (workflow `.github/workflows/pages.yml` inclus) : rien à
régler. Le workflow active lui-même GitHub Pages en mode « GitHub Actions »
(`enablement: true`) au premier passage. Chaque poussée sur la branche par défaut
lance les tests puis publie le site ; une pull request se limite aux tests.

**Sans Actions** : dans *Settings → Pages*, choisissez **Deploy from a branch**, la
branche voulue et le dossier `/ (root)`. Le fichier `.nojekyll` garantit que tous
les fichiers sont servis tels quels. Attention : `data/model.json` n'étant pas
versionné, cette voie prive l'app du modèle — il faut alors lancer `npm run data` et
committer le fichier, ou renoncer à la courbe.

Tout hébergeur statique en HTTPS convient également, à condition d'y exécuter
`npm run data` à intervalle régulier.

## Limites

- La simulation Alplakes n'est pas une mesure : elle peut s'écarter de la réalité
  locale, en particulier près des rives et lors de remontées d'eau froide (bise).
- Sa fraîcheur est celle du dernier passage de la CI, une heure au plus.
  GitHub désactive les workflows planifiés après 60 jours sans activité sur le
  dépôt : au-delà, l'instantané cesse de se rafraîchir et l'app l'indique.
- Les stations de l'OFEV mesurent la température près de la surface à un point
  précis ; une plage abritée peut être sensiblement plus chaude.
- Aucune donnée de qualité de l'eau ni de sécurité de baignade n'est fournie.

## Licence

MIT.
