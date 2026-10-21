/* Lampa. Anime Filler: stable installer, marking-only v0.3.0. */
/* Lampa. Extension checker expects this API marker in downloaded JS. */
(function () {
  'use strict';
  if (window.lampa_anime_filler_loaded || document.getElementById('laf-install-loader')) return;
  var script = document.createElement('script');
  script.id = 'laf-install-loader';
  script.src = 'https://nmagic.github.io/lampa-anime-filler/lampa-anime-filler.js?v=0.3.0';
  script.async = true;
  script.onerror = function () { console.error('[Anime Filler] Unable to load plugin script'); };
  (document.head || document.documentElement).appendChild(script);
})();
