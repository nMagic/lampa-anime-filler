/*
 * Lampa Anime Filler — marking-only prototype 0.2.1
 * Source code is independently written; no Lampa code copied.
 * Metadata backends: optional user-provided AFL JSON, fallback CC BY 4.0 SkipTheFiller dataset.
 * Phase 1: labels only; no playback/playlist modification.
 * https://github.com/animecannonhunter-hash/anime-filler-list-data
 */
(function () {
  'use strict';

  if (window.lampa_anime_filler_loaded) return;
  window.lampa_anime_filler_loaded = true;

  var DATASET_URL = 'https://raw.githubusercontent.com/animecannonhunter-hash/anime-filler-list-data/main/anime.json';
  var PREFIX = 'laf_';
  var CACHE_TTL = 24 * 60 * 60 * 1000;
  var state = { movie: null, slug: '', guide: null, loadId: 0, dataset: null, datasetPromise: null };
  var timer = null;
  var observer = null;
  var ROW_SELECTORS = '.online, .online-prestige__episode, .online-prestige__item, ' +
    '.torrent-file, .torrent-file__item, .full-episode, .files__item';
  var LABEL_SELECTORS = '.online__title, .online-prestige__title, .torrent-file__title, ' +
    '.torrent-file__name, .full-episode__name, .full-episode__title, .files__name';

  var LEGENDS = {
    filler: ['Филлер', '#e74c3c', 'Ф'],
    mixed: ['Канон + филлер', '#e5aa32', 'С'],
    manga_canon: ['Манга-канон', '#43b078', 'М'],
    anime_canon: ['Аниме-канон', '#4e98d8', 'А'],
    canon: ['Канон', '#43b078', 'К']
  };

  function log() {
    if (window.console && console.debug) console.debug.apply(console, ['[Anime Filler]'].concat([].slice.call(arguments)));
  }
  function getSetting(name, fallback) {
    try {
      var value = Lampa.Storage.get(PREFIX + name, fallback);
      if (typeof fallback === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
      return value === undefined ? fallback : value;
    } catch (_) { return fallback; }
  }
  function clean(s) {
    var str = String(s || '').toLowerCase();
    if (typeof str.normalize === 'function') str = str.normalize('NFKD');
    return str.replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function titles(movie) {
    return [movie.original_name, movie.original_title, movie.name, movie.title]
      .map(clean).filter(Boolean);
  }
  function mappings() {
    var stored = getSetting('mappings', {});
    var input = getSetting('mappings_json', '');
    if (input && typeof input === 'string') {
      try {
        var parsed = JSON.parse(input);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch (_) { log('Invalid mappings JSON'); }
    }
    return stored || {};
  }
  function findGuide(catalog, movie) {
    if (!Array.isArray(catalog) || !movie) return null;
    var map = mappings();
    var mapped = map && map[String(movie.id)];
    var candidate = mapped ? [clean(mapped)] : titles(movie);
    var ALIAS = {
      'naruto-shippuuden': 'naruto-shippuden',
      'naruto-shippuden': 'naruto-shippuden',
      'onepiece': 'one-piece',
      'boku-no-hero-academia': 'my-hero-academia'
    };
    candidate = candidate.map(function (s) { return ALIAS[s] || s; });
    for (var i = 0; i < candidate.length; i++) {
      for (var j = 0; j < catalog.length; j++) {
        if (clean(catalog[j].slug) === candidate[i] || clean(catalog[j].title) === candidate[i]) {
          return normalizeGuide(catalog[j], 'SkipTheFiller (CC BY 4.0)');
        }
      }
    }
    return null;
  }
  function normalizeType(t) {
    t = clean(t).replace(/-/g, '_');
    if (t === 'filler') return 'filler';
    if (t === 'mixed' || t === 'mixed_canon_filler') return 'mixed';
    if (t === 'manga_canon') return 'manga_canon';
    if (t === 'anime_canon') return 'anime_canon';
    if (t === 'canon') return 'canon';
    return null;
  }
  function normalizeGuide(input, source) {
    if (!input || typeof input !== 'object') return null;
    var map = Object.create(null);
    if (Array.isArray(input.episodes)) {
      input.episodes.forEach(function (ep) {
        var num = Number(ep.number);
        var type = normalizeType(ep.type);
        if (Number.isInteger(num) && num > 0 && type) map[num] = type;
      });
    } else {
      Object.keys(input.episodes || {}).forEach(function (num) {
        var type = normalizeType(input.episodes[num]);
        if (/^\d+$/.test(num) && type) map[Number(num)] = type;
      });
    }
    if (!Object.keys(map).length) return null;
    return { slug: input.slug || '', title: input.title || '', episodes: map,
      // Season offsets are OPTIONAL and must be explicitly sourced/verified.
      seasonOffsets: input.seasonOffsets || null,
      source: input.source || source || 'Пользовательские данные' };
  }
  function fetchJSON(url) {
    return fetch(url, { method: 'GET', credentials: 'omit' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }
  function fetchOpenDataset() {
    if (state.dataset) return Promise.resolve(state.dataset);
    if (!state.datasetPromise) {
      state.datasetPromise = fetchJSON(DATASET_URL).then(function (json) {
        if (!Array.isArray(json)) throw new Error('Неверный формат каталога');
        state.dataset = json;
        return json;
      }).catch(function (err) {
        state.datasetPromise = null;
        throw err;
      });
    }
    return state.datasetPromise;
  }
  function cacheKey(slug) { return PREFIX + 'guide_' + slug + '_' + clean(getSetting('source_url', '')).slice(0, 60); }
  function readCache(slug) {
    try {
      var cached = Lampa.Storage.get(cacheKey(slug), null);
      if (cached && cached.date > Date.now() - CACHE_TTL) return normalizeGuide(cached.data);
    } catch (_) { /* ignore */ }
    return null;
  }
  function writeCache(slug, guide) {
    try { Lampa.Storage.set(cacheKey(slug), { date: Date.now(), data: guide }); }
    catch (e) { log('Cache write:', e); }
  }
  function userMapping(movie) {
    var mapped = mappings();
    return mapped && mapped[String(movie.id)] ? clean(mapped[String(movie.id)]) : null;
  }
  function loadFor(movie) {
    var requestId = ++state.loadId;
    clearAllTags();
    state.movie = movie;
    state.guide = null;
    state.slug = userMapping(movie) || titles(movie)[0] || '';
    if (!state.slug) return;

    var cached = readCache(state.slug);
    if (cached) { state.guide = cached; scheduleScan(); updateCard(); return; }

    var base = String(getSetting('source_url', '') || '').trim().replace(/\/+$/, '');
    // A user-provided HTTPS JSON endpoint, e.g. https://host.example/filler/naruto.json
    var custom = base && /^https:\/\//i.test(base)
      ? fetchJSON(base + '/' + encodeURIComponent(state.slug) + '.json').then(function (json) {
        return normalizeGuide(json, 'AnimeFillerList (import)');
      }).catch(function (e) { log('Custom dataset unavailable:', e); return null; })
      : Promise.resolve(null);
    custom.then(function (guide) {
      if (guide) return guide;
      return fetchOpenDataset().then(function (catalog) { return findGuide(catalog, movie); });
    }).then(function (guide) {
      if (requestId !== state.loadId) return;
      if (!guide) { log('No guide found for', state.slug); updateCard(); return; }
      state.guide = guide;
      writeCache(state.slug, guide);
      updateCard();
      scheduleScan();
    }).catch(function (e) { if (requestId === state.loadId) log('Load failed:', e); });
  }
  function parseEpisode(title, seasonOffsets) {
    var s = String(title || '').trim();
    if (!s) return null;
    // Episodes covering a range, batch files, and packs are inherently ambiguous.
    if (/(?:\b[eE]\d{1,4}[-–+&](?:[eE])?\d{1,4}\b|(?:серии|episodes|эпизоды)\s*\d+\s*[-–]\s*\d+|\b\d{1,4}\s*[-–]\s*\d{1,4}(?=\.|\s*\]|$))/i.test(s)) return null;

    var seasonMatch = /(?:^|[^\w])S(\d{1,2})(?=E\d+|[\s./_-]|$)/i.exec(s) ||
      /(?:^|\W)(?:сезон|season)\s*(\d{1,2})(?!\d)/i.exec(s) ||
      /(?:^|\W)(\d{1,2})\s*(?:сезон|season)(?![\da-zа-я])/i.exec(s);
    // Online source pattern: "S1 / Episode 5". Never mark episode 5 as
    // absolute episode 5 unless this source's season mapping is verified.
    var hasSeason = !!seasonMatch || /(?:^|\W)S\d{1,2}\s*[/|:.-]\s*(?:E\d+|(?:episode|серия|эпизод)\s*\d+)/i.test(s);
    var season = seasonMatch ? Number(seasonMatch[1]) : null;
    var offsets = seasonOffsets || {};
    if (hasSeason && (season === null || !Object.prototype.hasOwnProperty.call(offsets, String(season)))) return null;

    var m = /\bS\d{1,2}[ ._/-]*E(\d{1,4})\b/i.exec(s);
    if (!m) m = /(?:^|\s|[\[(])(?:серия|серии|эпизод|episode|ep\.?)[\s:#.\-]*(\d{1,4})(?!\d)/i.exec(s);
    if (!m) m = /\bE(\d{2,4})(?!\d)/i.exec(s);
    if (!m) {
      // Common anime filenames "Title - 026 [1080p].mkv" / "Title [026].mkv".
      m = /(?:\s-\s|\[)(\d{2,4})(?=\s*(?:\]|\[|\(|\.|$))/i.exec(s);
      if (m && /^(?:480|720|1080|2160|264|265)$/.test(m[1])) return null;
    }
    if (!m) return null;
    var episode = Number(m[1]);
    if (!Number.isInteger(episode) || episode < 1) return null;
    return hasSeason ? Number(offsets[String(season)]) + episode : episode;
  }
  function indexFor(item, guide) {
    if (!guide || !item) return null;
    if (item.absolute_episode != null && /^\d+$/.test(String(item.absolute_episode))) return Number(item.absolute_episode);
    // Structured season+episode requires verified offsets. Do not guess from TMDB seasons.
    if (item.season != null && item.episode != null) {
      var offsets = guide.seasonOffsets;
      var key = String(item.season);
      if (!offsets || !Object.prototype.hasOwnProperty.call(offsets, key)) return null;
      return Number(offsets[key]) + Number(item.episode);
    }
    var name = item.name || item.title || item.filename || item.file || '';
    return parseEpisode(name, guide.seasonOffsets);
  }
  function classify(item, guide) {
    var n = typeof item === 'string' ? parseEpisode(item, guide && guide.seasonOffsets) : indexFor(item, guide);
    return n && guide && guide.episodes[n] ? { number: n, type: guide.episodes[n] } : null;
  }
  function rowElement(el) {
    return el && (el.jquery ? el[0] : el);
  }
  function clearTag(element) {
    var el = rowElement(element);
    if (!el || el.nodeType !== 1) return;
    var old = el.querySelector('.laf-badge');
    if (old) old.remove();
    el.classList.remove('laf-filler');
  }
  function clearAllTags() {
    var nodes = document.querySelectorAll('.laf-badge');
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
    nodes = document.querySelectorAll('.laf-filler');
    for (var j = 0; j < nodes.length; j++) nodes[j].classList.remove('laf-filler');
  }
  function statusTag(element, status) {
    if (!element || !status || !LEGENDS[status.type]) return;
    var el = rowElement(element);
    if (!el || el.nodeType !== 1) return;
    var old = el.querySelector('.laf-badge');
    var labelTarget = el.querySelector(LABEL_SELECTORS) || el;
    if (old && old.getAttribute('data-episode') === String(status.number) &&
        old.getAttribute('data-type') === status.type && old.parentNode === labelTarget) return;
    if (old) old.remove();
    var spec = LEGENDS[status.type];
    var span = document.createElement('span');
    span.className = 'laf-badge';
    span.setAttribute('data-episode', String(status.number));
    span.setAttribute('data-type', status.type);
    span.setAttribute('aria-hidden', 'true');
    span.textContent = spec[2] + ' · ' + spec[0];
    span.style.background = spec[1];
    span.title = 'Серия ' + status.number + ': ' + spec[0] + ' — ' + state.guide.source;
    labelTarget.appendChild(span);
    el.classList.toggle('laf-filler', status.type === 'filler');
  }
  function rowTitle(el) {
    var label = el.querySelector(LABEL_SELECTORS);
    if (label) {
      // Exclude our own badges from the text used to detect episode numbers.
      var clone = label.cloneNode(true);
      var badges = clone.querySelectorAll('.laf-badge');
      for (var i = 0; i < badges.length; i++) badges[i].remove();
      return clone.textContent;
    }
    // If UI markup is unknown, only rely on a short row title. Avoid large
    // combined text blocks and do not parse numbers from video quality/size.
    var raw = el.textContent || '';
    return raw.length <= 140 ? raw : '';
  }
  function scan() {
    if (!state.guide || !getSetting('mark', true)) {
      clearAllTags();
      return;
    }
    var nodes = document.querySelectorAll(ROW_SELECTORS);
    for (var i = 0; i < nodes.length && i < 1000; i++) {
      var node = nodes[i];
      if (node.closest('.laf-summary')) continue;
      var found = classify(rowTitle(node), state.guide);
      if (found) statusTag(node, found);
      else clearTag(node);
    }
  }
  function scheduleScan() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; scan(); }, 150);
  }
  function updateCard() {
    var summary = document.querySelector('.laf-summary');
    if (!summary) return;
    if (!state.guide) { summary.textContent = 'Anime Filler: нет данных для этого названия'; return; }
    var counts = { filler: 0, mixed: 0, manga_canon: 0, anime_canon: 0, canon: 0 };
    Object.keys(state.guide.episodes).forEach(function (n) { counts[state.guide.episodes[n]]++; });
    summary.textContent = 'Anime Filler: ' + counts.filler + ' филлеров, ' + counts.mixed + ' смешанных · ' + state.guide.source;
  }
  function addSummary(evt) {
    if (!evt || !evt.object || !evt.object.activity || typeof evt.object.activity.render !== 'function') return;
    var root = evt.object.activity.render();
    var dom = root && (root.jquery ? root[0] : root);
    if (!dom || !dom.querySelector || dom.querySelector('.laf-summary')) return;
    var host = dom.querySelector('.full-start-new__details, .full-start__title, .full-start-new__title, .full__details');
    if (!host) return;
    var summary = document.createElement('div');
    summary.className = 'laf-summary';
    summary.textContent = 'Anime Filler: загружаем классификацию…';
    host.appendChild(summary);
  }
  function addStyle() {
    var css = document.createElement('style');
    css.textContent = '.laf-badge{display:inline-block!important;color:#fff!important;padding:3px 7px;'
      + 'border-radius:4px;font-size:12px;font-weight:600;margin:3px 6px 3px 0;vertical-align:middle;'
      + 'white-space:nowrap;pointer-events:none;user-select:none;}'
      + '.laf-summary{font-size:13px;color:#d7d7d7;margin:8px 0;line-height:1.3;}'
      + '.laf-filler{box-shadow:inset 3px 0 0 #e74c3c;}';
    document.head.appendChild(css);
  }
  function settings() {
    Lampa.SettingsApi.addComponent({ component: 'lampa_anime_filler', name: 'Anime Filler',
      icon: '<svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg"><rect width="42" height="30" x="3" y="9" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 15v18m16-18v18M8 24h32" stroke="currentColor" stroke-width="2"/></svg>' });
    Lampa.SettingsApi.addParam({ component: 'lampa_anime_filler', param: { name: PREFIX + 'mark', type: 'trigger', default: true },
      field: { name: 'Помечать серии', description: 'М — манга-канон, А — аниме-канон, С — смешанная, Ф — филлер' } });
    Lampa.SettingsApi.addParam({ component: 'lampa_anime_filler', param: { name: PREFIX + 'source_url', type: 'input', values: 'string', default: '', placeholder: 'https://host.example/filler' },
      field: { name: 'Каталог AnimeFillerList JSON (HTTPS)', description: 'Путь к вашим файлам slug.json; иначе открытый набор SkipTheFiller (45 аниме)' } });
    Lampa.SettingsApi.addParam({ component: 'lampa_anime_filler', param: { name: PREFIX + 'mappings_json', type: 'input', values: 'string', default: '', placeholder: '{"12345":"one-piece"}' },
      field: { name: 'Привязки TMDB ID к названию (JSON)', description: 'Для несовпадающих названий: {"12345":"one-piece"}' } });
  }
  function init() {
    addStyle();
    settings();
    Lampa.Listener.follow('full', function (evt) {
      if (evt.type !== 'complite') return;
      var movie = evt.data && evt.data.movie;
      if (!movie || !movie.id) return;
      addSummary(evt);
      loadFor(movie);
    });
    Lampa.Listener.follow('torrent_file', function (evt) {
      if (evt.type === 'render' && state.guide && getSetting('mark', true)) {
        var item = evt.element || {};
        var result = classify(item, state.guide);
        if (result) statusTag(evt.item, result);
      }
      if (evt.type === 'list_open') scheduleScan();
    });
    Lampa.Listener.follow('activity', scheduleScan);
    observer = new MutationObserver(scheduleScan);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    log('Loaded 0.2.1, marking only');
  }
  window.LampaAnimeFiller = { parseEpisode: parseEpisode, normalizeGuide: normalizeGuide,
    findGuide: findGuide, classify: classify, scan: scan, state: state, version: '0.2.1' };
  if (window.appready) init();
  else Lampa.Listener.follow('app', function (evt) { if (evt.type === 'ready') init(); });
})();