/*
 * Lampa Anime Filler — marking-only prototype 0.4.1
 * Source code is independently written; no Lampa code copied.
 * Metadata backends: optional user-provided AFL JSON, fallback CC BY 4.0 SkipTheFiller dataset.
 * Phase 1: labels only; no playback/playlist modification.
 * https://github.com/animecannonhunter-hash/anime-filler-list-data
 */
(function () {
  'use strict';

  if (window.lampa_anime_filler_loaded) return;
  window.lampa_anime_filler_loaded = true;

  var BUNDLE_SCHEMA_VERSION = 1;
  var BUNDLE_BASE_URL = 'https://nmagic.github.io/lampa-anime-filler/data/generated/v1';
  var LEGACY_DATASET_URL = 'https://raw.githubusercontent.com/animecannonhunter-hash/anime-filler-list-data/main/anime.json';
  var PREFIX = 'laf_';
  var CACHE_TTL = 24 * 60 * 60 * 1000;
  var FETCH_TIMEOUT = 8000;
  var state = { movie: null, slug: '', guide: null, loadId: 0, dataset: null, datasetPromise: null,
    bundleCatalog: null,
    diagnostics: { phase: 'ожидаем карточку аниме', error: '', fullEvents: 0, templateHits: 0,
      rows: 0, matched: 0, parsed: 0, unknown: 0, sampleTitle: '', sampleTemplate: '', sampleMapping: '',
      provider: '', integrity: '', resolution: '' } };
  var timer = null;
  var observer = null;
  var ROW_SELECTORS = '.online, .online-prestige, .online-prestige__episode, .online-prestige__item, ' +
    '.torrent-file, .torrent-file__item, .full-episode, .files__item';
  var LABEL_SELECTORS = '.online__title, .online-prestige__title, .online-prestige__episode-number, .torrent-file__title, ' +
    '.torrent-file__name, .full-episode__name, .full-episode__title, .files__name';

  // Verified TMDB TV identities: localized and original names may have no Latin characters.
  // Never apply this ID-based mapping to unrelated shows or movies.
  var KNOWN_TMDB_TV = { '37854': 'one-piece' };

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
  function candidateSlugs(movie) {
    if (!movie) return [];
    var map = mappings();
    var id = String(movie.id || '');
    var manual = map && map[id] ? clean(map[id]) : '';
    var verified = KNOWN_TMDB_TV[id] || '';
    var resolved = [];
    if (manual) resolved.push(manual);
    if (verified) resolved.push(verified);
    return resolved.concat(titles(movie)).filter(function (s, i, arr) {
      return arr.indexOf(s) === i;
    });
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
    var candidate = candidateSlugs(movie);
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
      sourceMappings: input.sourceMappings || null,
      providerMappings: input.providerMappings || null,
      sourceBindings: input.sourceBindings || null,
      source: input.source || source || 'Пользовательские данные' };
  }
  function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function fetchResponse(url) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var controller = window.AbortController ? new window.AbortController() : null;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (controller) controller.abort();
        reject(new Error('Timeout ' + FETCH_TIMEOUT + 'ms'));
      }, FETCH_TIMEOUT);
      var options = { method: 'GET', credentials: 'omit' };
      if (controller) options.signal = controller.signal;
      fetch(url, options).then(function (response) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!response.ok) reject(new Error('HTTP ' + response.status));
        else resolve(response);
      }, function (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  function fetchJSON(url) {
    return fetchResponse(url).then(function (response) { return response.json(); });
  }
  function fetchText(url) {
    return fetchResponse(url).then(function (response) {
      if (typeof response.text !== 'function') throw new Error('Text response is unavailable');
      return response.text();
    });
  }

  // Synchronous SHA-256 keeps integrity checks available on older TV WebViews
  // where Web Crypto or TextEncoder may be absent.
  function sha256Text(input) {
    var bytes = [];
    var text = String(input);
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 63));
      else if (code < 0x10000) bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 63), 0x80 | (code & 63));
      else bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 63),
        0x80 | ((code >>> 6) & 63), 0x80 | (code & 63));
    }
    var bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var high = Math.floor(bitLength / 0x100000000);
    var lowBits = bitLength >>> 0;
    bytes.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255,
      (lowBits >>> 24) & 255, (lowBits >>> 16) & 255, (lowBits >>> 8) & 255, lowBits & 255);

    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var k = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    function rotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var words = new Array(64);
    for (var offset = 0; offset < bytes.length; offset += 64) {
      for (i = 0; i < 16; i++) {
        var pos = offset + i * 4;
        words[i] = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) |
          (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotate(words[i - 15], 7) ^ rotate(words[i - 15], 18) ^ (words[i - 15] >>> 3);
        var s1 = rotate(words[i - 2], 17) ^ rotate(words[i - 2], 19) ^ (words[i - 2] >>> 10);
        words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        var choice = (e & f) ^ ((~e) & g);
        var temp1 = (hh + sum1 + choice + k[i] + words[i]) >>> 0;
        var sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        var majority = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (sum0 + majority) >>> 0;
        hh = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
      h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    return h.map(function (value) { return ('00000000' + value.toString(16)).slice(-8); }).join('');
  }

  function parseJSON(text, label) {
    try { return JSON.parse(text); }
    catch (_) { throw new Error(label + ': invalid JSON'); }
  }
  function validChecksum(value) { return /^[a-f0-9]{64}$/.test(String(value || '')); }
  function validateManifest(manifest) {
    if (!isObject(manifest) || manifest.schemaVersion !== BUNDLE_SCHEMA_VERSION) throw new Error('Unsupported bundle schema');
    if (!manifest.buildId || !Array.isArray(manifest.sources) || !manifest.sources.length ||
        manifest.sources.some(function (source) {
          return !isObject(source) || !source.id || !source.revision || !source.license || !source.name;
        })) throw new Error('Invalid bundle manifest');
    var catalog = manifest.catalog;
    if (!isObject(catalog) || catalog.index !== 'index.json' || !validChecksum(catalog.sha256) ||
        !Number.isInteger(catalog.titleCount) || catalog.titleCount < 1 ||
        !Number.isInteger(catalog.episodeCount) || catalog.episodeCount < 1) throw new Error('Invalid bundle catalog descriptor');
    return manifest;
  }
  function validateIndexText(text, manifest) {
    if (sha256Text(text) !== manifest.catalog.sha256) throw new Error('Bundle index checksum mismatch');
    var index = parseJSON(text, 'Bundle index');
    if (!isObject(index) || index.schemaVersion !== BUNDLE_SCHEMA_VERSION || !Array.isArray(index.titles) ||
        index.titles.length !== manifest.catalog.titleCount) throw new Error('Invalid bundle index');
    var seen = Object.create(null);
    index.titles.forEach(function (item) {
      if (!isObject(item) || !item.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(item.slug || '')) ||
          !/^titles\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(String(item.shard || '')) ||
          !validChecksum(item.sha256) || !Number.isInteger(item.episodeCount) || item.episodeCount < 1 ||
          !isObject(item.ids) || !Array.isArray(item.aliases) || seen[item.id]) throw new Error('Invalid bundle title entry');
      seen[item.id] = true;
    });
    return index;
  }
  function catalogFromCache(value) {
    if (!isObject(value) || typeof value.manifestText !== 'string' || typeof value.indexText !== 'string') return null;
    try {
      var manifest = validateManifest(parseJSON(value.manifestText, 'Cached manifest'));
      var index = validateIndexText(value.indexText, manifest);
      return { date: Number(value.date) || 0, manifest: manifest, index: index,
        manifestText: value.manifestText, indexText: value.indexText, network: false };
    } catch (e) { log('Ignoring invalid bundle cache:', e); return null; }
  }
  function readBundleCatalog(name) {
    try { return catalogFromCache(Lampa.Storage.get(PREFIX + 'bundle_' + name + '_v1', null)); }
    catch (_) { return null; }
  }
  function writeBundleCatalog(candidate) {
    try {
      var activeKey = PREFIX + 'bundle_active_v1';
      var active = Lampa.Storage.get(activeKey, null);
      var activeParsed = catalogFromCache(active);
      if (activeParsed && activeParsed.manifest.buildId !== candidate.manifest.buildId) {
        Lampa.Storage.set(PREFIX + 'bundle_previous_v1', active);
      }
      Lampa.Storage.set(activeKey, { date: Date.now(), manifestText: candidate.manifestText,
        indexText: candidate.indexText });
    } catch (e) { log('Bundle catalog cache write:', e); }
  }
  function fetchBundleCatalog() {
    return fetchText(BUNDLE_BASE_URL + '/manifest.json').then(function (manifestText) {
      var manifest = validateManifest(parseJSON(manifestText, 'Bundle manifest'));
      return fetchText(BUNDLE_BASE_URL + '/' + manifest.catalog.index).then(function (indexText) {
        return { date: Date.now(), manifest: manifest, index: validateIndexText(indexText, manifest),
          manifestText: manifestText, indexText: indexText, network: true };
      });
    });
  }
  function resolveBundleItem(index, movie) {
    var id = String(movie && movie.id || '');
    var matches = index.titles.filter(function (item) {
      return item.ids && String(item.ids.tmdbTv || '') === id;
    });
    if (matches.length === 1) return { item: matches[0], method: 'TMDB ID' };
    if (matches.length > 1) throw new Error('Ambiguous TMDB mapping');

    var manual = userMapping(movie);
    if (manual) {
      matches = index.titles.filter(function (item) { return clean(item.slug) === manual; });
      if (matches.length === 1) return { item: matches[0], method: 'ручная привязка' };
      if (matches.length > 1) throw new Error('Ambiguous manual mapping');
    }

    var names = titles(movie);
    matches = index.titles.filter(function (item) {
      return (item.aliases || []).some(function (alias) { return names.indexOf(clean(alias)) >= 0; });
    });
    if (matches.length === 1) return { item: matches[0], method: 'проверенный alias' };
    if (matches.length > 1) throw new Error('Ambiguous verified alias');
    return null;
  }
  function shardCacheKey(item) {
    return PREFIX + 'bundle_shard_v1_' + clean(item.id) + '_' + item.sha256.slice(0, 12);
  }
  function validateShardText(text, candidate, item) {
    if (sha256Text(text) !== item.sha256) throw new Error('Bundle shard checksum mismatch');
    var shard = parseJSON(text, 'Bundle shard');
    if (!isObject(shard) || shard.schemaVersion !== BUNDLE_SCHEMA_VERSION || shard.id !== item.id ||
        !isObject(shard.episodes) || Object.keys(shard.episodes).length !== item.episodeCount ||
        !isObject(shard.identity) || !isObject(shard.numbering) || shard.numbering.scope !== 'regular' ||
        shard.numbering.basis !== 'absolute' || shard.numbering.startsAt !== 1 ||
        !isObject(shard.classification)) throw new Error('Invalid bundle shard');
    var sourceMatch = candidate.manifest.sources.some(function (source) {
      return source.id === shard.classification.sourceId && source.revision === shard.classification.sourceRevision;
    });
    if (!sourceMatch) throw new Error('Bundle shard provenance mismatch');
    var episodeKeys = Object.keys(shard.episodes);
    for (var episodeIndex = 0; episodeIndex < episodeKeys.length; episodeIndex++) {
      var episodeNumber = Number(episodeKeys[episodeIndex]);
      if (episodeNumber !== episodeIndex + 1 || normalizeType(shard.episodes[episodeKeys[episodeIndex]]) !== shard.episodes[episodeKeys[episodeIndex]]) {
        throw new Error('Invalid bundle episode classification');
      }
    }
    var guide = normalizeGuide({ slug: item.slug, title: shard.identity.title, episodes: shard.episodes,
      seasonOffsets: shard.numbering.seasonOffsets || null,
      sourceMappings: shard.numbering.sourceMappings || null,
      providerMappings: shard.numbering.providerMappings || null,
      sourceBindings: shard.numbering.sourceBindings || null }, 'Versioned bundle');
    if (!guide) throw new Error('Bundle shard has no supported episodes');
    var source = candidate.manifest.sources.filter(function (entry) {
      return entry.id === shard.classification.sourceId;
    })[0];
    guide.source = source.name + ' (' + source.license + '; bundle ' + candidate.manifest.buildId + ')';
    guide.bundle = { buildId: candidate.manifest.buildId, id: item.id, sha256: item.sha256 };
    return guide;
  }
  function readShard(candidate, item) {
    try {
      var cached = Lampa.Storage.get(shardCacheKey(item), null);
      if (!isObject(cached) || cached.sha256 !== item.sha256 || typeof cached.text !== 'string') return null;
      return validateShardText(cached.text, candidate, item);
    } catch (e) { log('Ignoring invalid shard cache:', e); return null; }
  }
  function loadShard(candidate, item) {
    var cached = readShard(candidate, item);
    if (cached) return Promise.resolve(cached);
    return fetchText(BUNDLE_BASE_URL + '/' + item.shard).then(function (text) {
      var guide = validateShardText(text, candidate, item);
      try { Lampa.Storage.set(shardCacheKey(item), { date: Date.now(), sha256: item.sha256, text: text }); }
      catch (e) { log('Bundle shard cache write:', e); }
      return guide;
    });
  }
  function uniqueCatalogs(candidates) {
    var builds = Object.create(null);
    return candidates.filter(function (candidate) {
      if (!candidate || builds[candidate.manifest.buildId]) return false;
      builds[candidate.manifest.buildId] = true;
      return true;
    });
  }
  function tryBundleCandidates(candidates, movie, position, lastError, matched) {
    if (position >= candidates.length) {
      if (matched && lastError) return Promise.reject(lastError);
      return Promise.resolve(null);
    }
    var candidate = candidates[position];
    var resolved;
    try { resolved = resolveBundleItem(candidate.index, movie); }
    catch (e) { return tryBundleCandidates(candidates, movie, position + 1, e, matched); }
    if (!resolved) return tryBundleCandidates(candidates, movie, position + 1, lastError, matched);
    return loadShard(candidate, resolved.item).then(function (guide) {
      if (candidate.network) writeBundleCatalog(candidate);
      candidate.date = Date.now();
      candidate.network = false;
      state.bundleCatalog = candidate;
      guide.bundle.resolution = resolved.method;
      return guide;
    }).catch(function (error) {
      return tryBundleCandidates(candidates, movie, position + 1, error, true);
    });
  }
  function loadBundleGuide(movie) {
    var active = state.bundleCatalog || readBundleCatalog('active');
    var previous = readBundleCatalog('previous');
    if (active && active.date > Date.now() - CACHE_TTL) {
      return tryBundleCandidates(uniqueCatalogs([active, previous]), movie, 0, null, false).catch(function (cachedError) {
        return fetchBundleCatalog().then(function (network) {
          state.bundleCatalog = network;
          return tryBundleCandidates(uniqueCatalogs([network, active, previous]), movie, 0, cachedError, false);
        });
      });
    }
    return fetchBundleCatalog().then(function (network) {
      state.bundleCatalog = network;
      return tryBundleCandidates(uniqueCatalogs([network, active, previous]), movie, 0, null, false);
    }).catch(function (error) {
      var cached = uniqueCatalogs([active, previous]);
      if (!cached.length) throw error;
      return tryBundleCandidates(cached, movie, 0, error, false);
    });
  }
  function fetchOpenDataset() {
    if (state.dataset) return Promise.resolve(state.dataset);
    if (!state.datasetPromise) {
      state.datasetPromise = fetchJSON(LEGACY_DATASET_URL).then(function (json) {
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
    state.diagnostics.phase = 'загружаем каталог';
    state.diagnostics.error = '';
    state.diagnostics.provider = '';
    state.diagnostics.integrity = '';
    state.diagnostics.resolution = '';
    state.diagnostics.rows = 0;
    state.diagnostics.parsed = 0;
    state.diagnostics.matched = 0;
    state.diagnostics.unknown = 0;
    state.diagnostics.sampleTitle = '';
    state.diagnostics.sampleMapping = '';
    state.slug = candidateSlugs(movie)[0] || '';
    if (!state.slug) return;

    var base = String(getSetting('source_url', '') || '').trim().replace(/\/+$/, '');
    // A user-provided HTTPS JSON endpoint, e.g. https://host.example/filler/naruto.json
    var custom = base && /^https:\/\//i.test(base)
      ? fetchJSON(base + '/' + encodeURIComponent(state.slug) + '.json').then(function (json) {
        return normalizeGuide(json, 'AnimeFillerList (import)');
      }).catch(function (e) { log('Custom dataset unavailable:', e); return null; })
      : Promise.resolve(null);
    custom.then(function (guide) {
      if (guide) return guide;
      return loadBundleGuide(movie).catch(function (error) {
        log('Versioned bundle unavailable:', error);
        if (requestId === state.loadId) state.diagnostics.error = 'bundle: ' + String(error && error.message || error);
        return null;
      }).then(function (bundleGuide) {
        if (bundleGuide) return bundleGuide;
        var cached = readCache(state.slug);
        if (cached) {
          cached.runtimeProvider = { provider: 'legacy cache', integrity: 'ранее проверенный guide',
            resolution: 'старый resolver' };
          return cached;
        }
        return fetchOpenDataset().then(function (catalog) {
          var legacy = findGuide(catalog, movie);
          if (legacy) {
            legacy.runtimeProvider = { provider: 'legacy fallback', integrity: 'формат проверен',
              resolution: 'старый resolver' };
          }
          return legacy;
        });
      });
    }).then(function (guide) {
      if (requestId !== state.loadId) return;
      if (!guide) { state.diagnostics.phase = 'аниме не найдено в каталоге';
        log('No guide found for', state.slug); updateCard(); return; }
      state.guide = guide;
      if (guide.bundle) {
        state.diagnostics.provider = guide.bundle.buildId;
        state.diagnostics.integrity = 'SHA-256 проверен';
        state.diagnostics.resolution = guide.bundle.resolution;
      } else if (guide.runtimeProvider) {
        state.diagnostics.provider = guide.runtimeProvider.provider;
        state.diagnostics.integrity = guide.runtimeProvider.integrity;
        state.diagnostics.resolution = guide.runtimeProvider.resolution;
      } else {
        state.diagnostics.provider = base ? 'custom JSON' : '';
        state.diagnostics.integrity = 'формат нормализован';
        state.diagnostics.resolution = base ? 'ручной slug' : '';
      }
      state.diagnostics.phase = guide.bundle ? 'данные из versioned bundle' : 'данные загружены';
      writeCache(state.slug, guide);
      updateCard();
      scheduleScan();
    }).catch(function (e) { if (requestId === state.loadId) {
      state.diagnostics.phase = 'ошибка загрузки каталога';
      state.diagnostics.error = String(e && e.message || e);
      log('Load failed:', e);
      updateCard();
    } });
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
    if (!m) m = /(?:^|\s|[\[(])(?:серия|серии|эпизод|episode|ep\.?)[\s:#.\-№]*(\d{1,4})(?!\d)/i.exec(s);
    if (!m) m = /(?:^|[^\d])(\d{1,4})\s*(?:-?(?:я|ая|й))?\s*(?:серия|эпизод|episode)(?![a-zа-я])/i.exec(s);
    if (!m) m = /\bE(\d{2,4})(?!\d)/i.exec(s);
    if (!m) {
      // Common anime filenames "Title - 026 [1080p].mkv" / "Title [026].mkv".
      m = /(?:\s-\s|\[)(\d{2,4})(?=\s*(?:\]|\[|\(|\.|$))/i.exec(s);
      if (m && /^(?:480|720|1080|2160|264|265)$/.test(m[1])) return null;
    }
    if (!m && /^\d{1,4}$/.test(s)) m = [s,s];
    if (!m) return null;
    var episode = Number(m[1]);
    if (!Number.isInteger(episode) || episode < 1) return null;
    return hasSeason ? Number(offsets[String(season)]) + episode : episode;
  }
  function indexFor(item, guide) {
    if (!guide || !item) return null;
    if (item.absolute_episode != null && /^\d+$/.test(String(item.absolute_episode))) {
      var absoluteAdapter = String(item.sourceAdapter || '').toLowerCase();
      // An explicit field from an identified playback adapter is trusted only
      // when the build-time source inventory proved that exact contract.
      if (absoluteAdapter && (!guide.sourceBindings || guide.sourceBindings[absoluteAdapter] !== 'absolute')) return null;
      return Number(item.absolute_episode);
    }
    // Structured season+episode requires a rule for this exact adapter and title.
    if (item.episode != null && /^\d{1,4}$/.test(String(item.episode))) {
      var adapter = String(item.sourceAdapter || '').toLowerCase();
      if (adapter) {
        if (item.season == null || item.season === '' || !/^\d+$/.test(String(item.season))) return null;
        // Payloads may describe their numbers, but they cannot authorize their
        // own basis. Only the revision-pinned build-time source contract can.
        var basis = String(guide.sourceBindings && guide.sourceBindings[adapter] || '').toLowerCase();
        var mapping = basis && guide.providerMappings && guide.providerMappings[basis];
        // Backward compatibility for already cached schema-v1 shards. New
        // bundles use providerMappings + an explicit sourceBindings entry.
        if (!mapping && guide.sourceMappings && guide.sourceMappings[adapter]) {
          mapping = guide.sourceMappings[adapter];
          basis = mapping.system || '';
        }
        var ranges = mapping && basis && mapping.seasons && mapping.seasons[String(item.season)];
        if (!Array.isArray(ranges)) return null;
        var episode = Number(item.episode);
        var matches = ranges.filter(function (range) {
          return range && Number.isInteger(range.episodeStart) && Number.isInteger(range.episodeEnd) &&
            Number.isInteger(range.absoluteStart) && episode >= range.episodeStart && episode <= range.episodeEnd;
        });
        if (matches.length !== 1) return null;
        return matches[0].absoluteStart + episode - matches[0].episodeStart;
      }
      if (item.season == null || item.season === '') return Number(item.episode);
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
    var diag = state.diagnostics;
    var rows = 0, parsed = 0, matched = 0, unknown = 0, sampleTitle = '', sampleMapping = '';
    for (var i = 0; i < nodes.length && i < 1000; i++) {
      var node = nodes[i];
      if (node.closest('.laf-summary')) continue;
      rows++;
      var label = rowTitle(node);
      if (!sampleTitle && label) sampleTitle = label.slice(0, 90);
      var metadataEpisode = node.getAttribute('data-laf-episode');
      var metadataSeason = node.getAttribute('data-laf-season');
      var absolute = node.getAttribute('data-laf-absolute');
      var sourceAdapter = node.getAttribute('data-laf-source');
      var item = metadataEpisode || absolute ? { episode: metadataEpisode,
        season: metadataSeason !== null ? metadataSeason : null, absolute_episode: absolute,
        sourceAdapter: sourceAdapter || '' } : label;
      var n = typeof item === 'string' ? parseEpisode(item, state.guide.seasonOffsets) : indexFor(item, state.guide);
      if (n) parsed++;
      else if (metadataEpisode || absolute) unknown++;
      if (!sampleMapping && (metadataEpisode || absolute)) {
        sampleMapping = (sourceAdapter || 'unknown') + ' S' + (metadataSeason || '?') +
          ' E' + (metadataEpisode || absolute || '?') + ' → ' + (n || 'unknown');
      }
      var found = n && state.guide.episodes[n] ? { number: n, type: state.guide.episodes[n] } : null;
      if (found) { matched++; statusTag(node, found); }
      else clearTag(node);
    }
    if (rows) {
      diag.rows = rows; diag.parsed = parsed; diag.matched = matched; diag.unknown = unknown;
      diag.sampleTitle = sampleTitle; diag.sampleMapping = sampleMapping;
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
  function showDiagnostics() {
    var diag = state.diagnostics;
    var example = diag.sampleTitle || 'не захвачено';
    var lines = [
      'Версия: 0.4.1',
      'Карточка: ' + (state.movie ? (state.movie.name || state.movie.title || state.movie.original_name || 'без названия') + ' (TMDB ' + state.movie.id + ')' : 'не открывалась'),
      'Каталог: ' + (state.slug || 'не выбран'),
      'Состояние: ' + diag.phase,
      'Серий в каталоге: ' + (state.guide ? Object.keys(state.guide.episodes).length : 0),
      'Источник: ' + (state.guide ? state.guide.source : 'нет'),
      'Data Provider: ' + (diag.provider || 'нет'),
      'Целостность: ' + (diag.integrity || 'не проверялась'),
      'Сопоставление: ' + (diag.resolution || 'нет'),
      'Открытий карточки: ' + diag.fullEvents,
      'Шаблонов серий: ' + diag.templateHits,
      'Последний шаблон: ' + (diag.sampleTemplate || 'нет'),
      'Строк на последнем экране: ' + diag.rows,
      'Номеров распознано: ' + diag.parsed,
      'Неизвестных соответствий: ' + diag.unknown,
      'Меток проставлено: ' + diag.matched,
      'Пример сопоставления: ' + (diag.sampleMapping || 'нет'),
      'Пример названия: ' + example,
      'Ошибка: ' + (diag.error || 'нет')
    ];
    if (Lampa.Modal && typeof Lampa.Modal.open === 'function') {
      var element = document.createElement('div');
      element.style.cssText = 'white-space:pre-wrap;font-size:1.15em;line-height:1.5;padding:1em;';
      element.textContent = lines.join('\n');
      Lampa.Modal.open({
        title: 'Anime Filler — диагностика',
        html: (window.jQuery || window.$)(element), size: 'medium', mask: true,
        onBack: function () { Lampa.Modal.close(); Lampa.Controller.toggle('settings_component'); }
      });
    } else if (Lampa.Noty) Lampa.Noty.show(lines.join(' | '));
  }

  function installTemplateHook() {
    if (!Lampa.Template || typeof Lampa.Template.get !== 'function') return;
    if (Lampa.Template.get.lafWrapped) return;
    var originalGet = Lampa.Template.get;
    var adapters = { online_mod: 'online_mod', online: 'lampa_online', lampac_prestige_full: 'bwa' };
    function sourceAdapter(templateName) {
      var adapter = adapters[templateName];
      if (adapter !== 'online_mod') return adapter;
      var balancer = Lampa.Storage && Lampa.Storage.get ? Lampa.Storage.get('online_mod_balanser', '') : '';
      var saveLast = Lampa.Storage && typeof Lampa.Storage.field === 'function' &&
        Lampa.Storage.field('online_mod_save_last_balanser') === true;
      if (saveLast && state.movie && state.movie.id != null && typeof Lampa.Storage.cache === 'function') {
        var saved = Lampa.Storage.cache('online_mod_last_balanser', 200, {});
        if (saved && saved[state.movie.id]) balancer = saved[state.movie.id];
      }
      balancer = String(balancer || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '');
      return 'online_mod:' + (balancer || 'unknown');
    }
    function wrappedGet(templateName, payload) {
      var element = originalGet.apply(this, arguments);
      if (!adapters[templateName] || !payload || typeof payload !== 'object') return element;
      if (payload.episode == null && payload.absolute_episode == null) return element;
      var node = element && (element.jquery ? element[0] : element);
      if (!node || typeof node.setAttribute !== 'function') return element;
      if (payload.episode != null) node.setAttribute('data-laf-episode', String(payload.episode));
      if (payload.season != null) node.setAttribute('data-laf-season', String(payload.season));
      if (payload.absolute_episode != null) node.setAttribute('data-laf-absolute', String(payload.absolute_episode));
      var adapter = sourceAdapter(templateName);
      node.setAttribute('data-laf-source', adapter);
      state.diagnostics.templateHits++;
      state.diagnostics.sampleTemplate = adapter + ' S' + (payload.season == null ? '?' : payload.season) + ' E' + (payload.episode || payload.absolute_episode || '?');
      scheduleScan();
      return element;
    }
    wrappedGet.lafWrapped = true;
    Lampa.Template.get = wrappedGet;
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
    Lampa.SettingsApi.addParam({ component: 'lampa_anime_filler',
      param: { name: PREFIX + 'diagnostics', type: 'button' },
      field: { name: 'Показать диагностику', description: 'Загрузка каталога и распознавание серий в Online_Mod / BWA' },
      onChange: showDiagnostics });
  }
  function init() {
    addStyle();
    settings();
    installTemplateHook();
    Lampa.Listener.follow('full', function (evt) {
      if (evt.type !== 'complite') return;
      var movie = evt.data && evt.data.movie;
      if (!movie || !movie.id) return;
      state.diagnostics.fullEvents++;
      addSummary(evt);
      loadFor(movie);
    });
    Lampa.Listener.follow('torrent_file', function (evt) {
      if (evt.type === 'render' && state.guide && getSetting('mark', true)) {
        var sourceItem = evt.element || {};
        var item = {};
        Object.keys(sourceItem).forEach(function (key) { item[key] = sourceItem[key]; });
        item.sourceAdapter = sourceItem.sourceAdapter || 'torrent';
        var result = classify(item, state.guide);
        if (result) statusTag(evt.item, result);
      }
      if (evt.type === 'list_open') scheduleScan();
    });
    Lampa.Listener.follow('activity', scheduleScan);
    observer = new MutationObserver(scheduleScan);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    log('Loaded 0.4.1, marking only');
  }
  window.LampaAnimeFiller = { parseEpisode: parseEpisode, normalizeGuide: normalizeGuide,
    findGuide: findGuide, classify: classify, scan: scan, sha256Text: sha256Text,
    loadBundleGuide: loadBundleGuide, state: state, version: '0.4.1' };
  if (window.appready) init();
  else Lampa.Listener.follow('app', function (evt) { if (evt.type === 'ready') init(); });
})();
