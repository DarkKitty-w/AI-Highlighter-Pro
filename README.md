AI Highlighter Pro ✨
AI Highlighter Pro est une extension Chrome qui transforme votre navigateur en un assistant de recherche intelligent. Au lieu de lire manuellement de longs articles, vous pouvez simplement demander à l'IA ce que vous cherchez (par exemple, "toutes les définitions" ou "les risques et les dates clés"), et l'extension lira, trouvera et surlignera toutes les correspondances directement sur la page.

## 🚀 Fonctionnalités

Analyse par l'IA : Propulsé par l'API Google Gemini (gemini-1.5-flash-latest) pour une compréhension de texte de nouvelle génération.

Requêtes en langage naturel : Demandez simplement ce que vous voulez : "tous les risques", "les définitions et les formules", "les objectifs du projet".

Surlignage Dynamique : Surligne intelligemment tous les concepts correspondants directement sur la page.

Couleurs Aléatoires : Génère une couleur pastel unique et aléatoire pour chaque catégorie trouvée, rendant l'analyse visuellement claire.

Légende Dynamique : Le panneau latéral se met à jour automatiquement avec une légende de couleurs correspondant à ce qui a été trouvé.

Analyse de Page Complète : Lit l'intégralité des pages, même les plus longues (comme Wikipédia), en les découpant intelligemment en "chunks" qui se chevauchent.

Gestion du HTML Complexe : Surligne le texte de manière fiable, même s'il est séparé par d'autres balises HTML comme <b>, <br>, ou des liens.

Support LaTeX / KaTeX : Une fonctionnalité unique qui identifie les blocs de formules mathématiques (LaTeX/KaTeX) et les surligne en tant que blocs complets, ce que les surligneurs de texte standard ne peuvent pas faire.

Panneau Latéral Moderne : Une interface utilisateur propre et réactive construite avec l'API Side Panel de Chrome.

Mode Sombre : L'interface s'adapte à votre thème système (clair ou sombre).

Stockage Sécurisé : Mémorise votre clé API et votre dernière requête en toute sécurité dans le chrome.storage.local.

🛠️ Comment ça marche (La technique)
Ce n'est pas un simple "Ctrl+F". L'extension utilise un pipeline en plusieurs étapes pour garantir la précision :

1. Cartographie de la Page : Le script content.js ne se contente pas de prendre le texte brut. Il parcourt le DOM et "tagge" chaque élément textuel pertinent (<p>, <li>, <dd>, et même les blocs .katex) avec un ID unique (ex: data-ai-id="chunk-123").

2. Création de la "Carte" : Il génère ensuite un long fichier texte pour l'IA, composé de ces morceaux de texte et de leurs ID (ex: [ID:chunk-123]Ceci est le texte du paragraphe.[FIN ID]).

3. Découpage (Chunking) : Cette "carte" est divisée en morceaux de 15 000 caractères avec un chevauchement de 20% pour garantir qu'aucune définition n'est coupée entre deux chunks.

4. Appels API Parallèles : Tous les chunks sont envoyés simultanément à l'API Gemini (Promise.all), ce qui rend l'analyse très rapide.

5. Surlignage Ciblé : L'IA est instruite de renvoyer non seulement le texte, mais aussi le passage_id (ex: "chunk-123") où elle l'a trouvé. Le script de surlignage n'a plus besoin de "chercher" le texte sur toute la page ; il va directement à l'élément [data-ai-id="chunk-123"] et surligne le texte à l'intérieur de celui-ci.

6. Surlignage Robuste : La fonction de surlignage utilise une expression régulière (RegExp) complexe qui trouve le texte de l'IA même si son innerHTML est fragmenté par des balises <br>, <b> ou des sauts de ligne \n.

⚙️ Construit avec
Langages : JavaScript (ES6+), HTML5, CSS3

API & Technologies :

Google Gemini API (gemini-1.5-flash-latest)

Chrome Extension API (Manifest V3)

Chrome Side Panel API

Chrome Storage API

🚀 Démarrage
Prérequis
Vous avez besoin d'une clé API Google Gemini. Vous pouvez en obtenir une gratuitement sur Google AI Studio.

Installation
Téléchargez ce projet (ou clonez-le via Git).

Ouvrez Google Chrome et allez à l'adresse chrome://extensions.

Activez le "Mode développeur" en haut à droite.

Cliquez sur "Charger l'extension non empaquetée".

Sélectionnez le dossier où vous avez téléchargé (et dézippé) ce projet.

L'extension "AI Highlighter Pro" devrait maintenant apparaître dans votre barre d'outils.

📖 Utilisation
Rendez-vous sur n'importe quelle page web que vous souhaitez analyser (ex: Wikipédia).

Cliquez sur l'icône de l'extension dans votre barre d'outils pour ouvrir le panneau latéral.

Collez votre clé API Gemini dans le premier champ.

Dans le champ "What to analyze...", tapez ce que vous recherchez.

Exemples :

Toutes les définitions

Les points clés et les risques

Les dates et les objectifs du projet

formules et concepts principaux

Cliquez sur "Analyze & Highlight".

Attendez quelques secondes. La page se remplira de surlignages colorés, et la légende dans le panneau latéral se mettra à jour.

Cliquez sur "Clear All" pour tout effacer.

📄 Licence
Ce projet est sous licence MIT. Voir le fichier LICENSE.md pour plus de détails.
