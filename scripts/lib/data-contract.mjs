import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const EPISODE_STATUSES = Object.freeze([
  'canon',
  'manga_canon',
  'anime_canon',
  'filler',
  'mixed'
]);

const STATUS_ALIASES = Object.freeze({
  canon: 'canon',
  'manga canon': 'manga_canon',
  manga_canon: 'manga_canon',
  'anime canon': 'anime_canon',
  anime_canon: 'anime_canon',
  filler: 'filler',
  mixed: 'mixed',
  'mixed canon/filler': 'mixed',
  mixed_canon_filler: 'mixed'
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeStatus(value, context) {
  const status = STATUS_ALIASES[String(value || '').trim().toLowerCase()];
  invariant(status, `${context}: unsupported episode status ${JSON.stringify(value)}`);
  return status;
}

function normalizeIds(value, context) {
  if (value === undefined) return {};
  invariant(isPlainObject(value), `${context}: ids must be an object`);
  const result = {};
  for (const [provider, id] of Object.entries(value)) {
    invariant(/^[a-z][a-z0-9]*$/i.test(provider), `${context}: invalid id provider ${provider}`);
    invariant(
      (typeof id === 'string' && id.trim()) || (Number.isSafeInteger(id) && id > 0),
      `${context}: invalid ${provider} id`
    );
    result[provider] = typeof id === 'string' ? id.trim() : id;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => compareText(a, b)));
}

function normalizeAliases(value, primaryTitle, context) {
  if (value === undefined) return [];
  invariant(Array.isArray(value), `${context}: aliases must be an array`);
  const aliases = value.map(alias => String(alias || '').trim()).filter(Boolean);
  invariant(aliases.every((alias, index) => aliases.indexOf(alias) === index), `${context}: duplicate aliases`);
  return aliases.filter(alias => alias !== primaryTitle).sort(compareText);
}

function normalizeSeasonOffsets(value, context) {
  if (value === undefined) return undefined;
  invariant(isPlainObject(value), `${context}: seasonOffsets must be an object`);
  const result = {};
  for (const [season, offset] of Object.entries(value)) {
    invariant(/^[1-9][0-9]*$/.test(season), `${context}: invalid season ${season}`);
    invariant(Number.isSafeInteger(offset) && offset >= 0,
      `${context}: season ${season} offset must be a non-negative safe integer`);
    result[season] = offset;
  }
  invariant(Object.keys(result).length, `${context}: seasonOffsets must not be empty`);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => Number(a) - Number(b)));
}

function normalizeSourceMappings(value, episodeCount, context) {
  if (value === undefined) return undefined;
  invariant(isPlainObject(value), `${context}: sourceMappings must be an object`);
  const result = {};
  for (const [adapter, mapping] of Object.entries(value).sort(([a], [b]) => compareText(a, b))) {
    invariant(/^[a-z][a-z0-9_]*$/.test(adapter), `${context}: invalid source adapter ${adapter}`);
    invariant(isPlainObject(mapping), `${context}: ${adapter} mapping must be an object`);
    invariant(mapping.system === 'tmdb', `${context}: ${adapter} mapping system must be tmdb`);
    invariant(isPlainObject(mapping.seasons), `${context}: ${adapter} seasons must be an object`);
    const seasons = {};
    for (const [season, inputRanges] of Object.entries(mapping.seasons).sort(([a], [b]) => Number(a) - Number(b))) {
      invariant(/^[1-9][0-9]*$/.test(season), `${context}: ${adapter} has invalid season ${season}`);
      invariant(Array.isArray(inputRanges) && inputRanges.length,
        `${context}: ${adapter} season ${season} must contain ranges`);
      const ranges = inputRanges.map((range, index) => {
        const rangeContext = `${context}: ${adapter} season ${season} range ${index + 1}`;
        invariant(isPlainObject(range), `${rangeContext} must be an object`);
        const keys = Object.keys(range).sort();
        invariant(keys.join(',') === 'absoluteStart,episodeEnd,episodeStart',
          `${rangeContext} has unsupported fields`);
        invariant(Number.isSafeInteger(range.episodeStart) && range.episodeStart > 0,
          `${rangeContext} episodeStart must be a positive safe integer`);
        invariant(Number.isSafeInteger(range.episodeEnd) && range.episodeEnd >= range.episodeStart,
          `${rangeContext} episodeEnd must be at least episodeStart`);
        invariant(Number.isSafeInteger(range.absoluteStart) && range.absoluteStart > 0,
          `${rangeContext} absoluteStart must be a positive safe integer`);
        const absoluteEnd = range.absoluteStart + range.episodeEnd - range.episodeStart;
        invariant(absoluteEnd <= episodeCount,
          `${rangeContext} maps past catalog episode ${episodeCount}`);
        return {
          episodeStart: range.episodeStart,
          episodeEnd: range.episodeEnd,
          absoluteStart: range.absoluteStart
        };
      }).sort((a, b) => a.episodeStart - b.episodeStart);
      for (let index = 1; index < ranges.length; index += 1) {
        invariant(ranges[index - 1].episodeEnd < ranges[index].episodeStart,
          `${context}: ${adapter} season ${season} ranges overlap`);
      }
      seasons[season] = ranges;
    }
    invariant(Object.keys(seasons).length, `${context}: ${adapter} seasons must not be empty`);
    result[adapter] = { system: 'tmdb', seasons };
  }
  invariant(Object.keys(result).length, `${context}: sourceMappings must not be empty`);
  return result;
}

function normalizeProviderMappings(value, episodeCount, context) {
  if (value === undefined) return undefined;
  invariant(isPlainObject(value), `${context}: providerMappings must be an object`);
  const result = {};
  for (const [basis, mapping] of Object.entries(value).sort(([a], [b]) => compareText(a, b))) {
    invariant(/^[a-z][a-z0-9_]*$/.test(basis), `${context}: invalid numbering basis ${basis}`);
    invariant(isPlainObject(mapping), `${context}: ${basis} provider mapping must be an object`);
    invariant((Number.isSafeInteger(mapping.mediaId) && mapping.mediaId > 0) ||
      (typeof mapping.mediaId === 'string' && mapping.mediaId.trim()), `${context}: ${basis} mediaId is invalid`);
    invariant(isPlainObject(mapping.seasons), `${context}: ${basis} seasons must be an object`);
    const seasons = {};
    for (const [season, inputRanges] of Object.entries(mapping.seasons).sort(([a], [b]) => Number(a) - Number(b))) {
      invariant(/^[1-9][0-9]*$/.test(season), `${context}: ${basis} has invalid season ${season}`);
      invariant(Array.isArray(inputRanges) && inputRanges.length, `${context}: ${basis} season ${season} must contain ranges`);
      const ranges = inputRanges.map((range, index) => {
        const rangeContext = `${context}: ${basis} season ${season} range ${index + 1}`;
        invariant(isPlainObject(range), `${rangeContext} must be an object`);
        invariant(Object.keys(range).sort().join(',') === 'absoluteStart,episodeEnd,episodeStart', `${rangeContext} has unsupported fields`);
        invariant(Number.isSafeInteger(range.episodeStart) && range.episodeStart > 0, `${rangeContext} episodeStart must be positive`);
        invariant(Number.isSafeInteger(range.episodeEnd) && range.episodeEnd >= range.episodeStart, `${rangeContext} episodeEnd is invalid`);
        invariant(Number.isSafeInteger(range.absoluteStart) && range.absoluteStart > 0, `${rangeContext} absoluteStart must be positive`);
        invariant(range.absoluteStart + range.episodeEnd - range.episodeStart <= episodeCount, `${rangeContext} maps past catalog episode ${episodeCount}`);
        return { episodeStart: range.episodeStart, episodeEnd: range.episodeEnd, absoluteStart: range.absoluteStart };
      }).sort((a, b) => a.episodeStart - b.episodeStart);
      for (let index = 1; index < ranges.length; index += 1) {
        invariant(ranges[index - 1].episodeEnd < ranges[index].episodeStart, `${context}: ${basis} season ${season} ranges overlap`);
      }
      seasons[season] = ranges;
    }
    invariant(Object.keys(seasons).length, `${context}: ${basis} seasons must not be empty`);
    result[basis] = { mediaId: mapping.mediaId, seasons };
  }
  invariant(Object.keys(result).length, `${context}: providerMappings must not be empty`);
  return result;
}

function normalizeSourceBindings(value, providerMappings, context) {
  if (value === undefined) return undefined;
  invariant(isPlainObject(value), `${context}: sourceBindings must be an object`);
  const result = {};
  for (const [adapter, basis] of Object.entries(value).sort(([a], [b]) => compareText(a, b))) {
    invariant(/^[a-z][a-z0-9_.:-]*$/.test(adapter), `${context}: invalid source adapter ${adapter}`);
    invariant(typeof basis === 'string' && (basis === 'absolute' || providerMappings && providerMappings[basis]),
      `${context}: ${adapter} references unknown numbering basis ${basis}`);
    result[adapter] = basis;
  }
  invariant(Object.keys(result).length, `${context}: sourceBindings must not be empty`);
  return result;
}

function normalizeHttpsUrl(value, context) {
  let url;
  try { url = new URL(String(value || '')); }
  catch (_) { throw new Error(`${context}: invalid URL`); }
  invariant(url.protocol === 'https:', `${context}: only HTTPS URLs are allowed`);
  return url.href;
}

function normalizeShow(show, source, identity = {}) {
  invariant(isPlainObject(show), 'catalog entry must be an object');
  const slug = String(show.slug || '').trim();
  const title = String(show.title || '').trim();
  const context = slug || title || 'catalog entry';

  invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), `${context}: invalid slug`);
  invariant(title, `${context}: title is required`);
  invariant(Array.isArray(show.episodes) && show.episodes.length, `${context}: episodes must be a non-empty array`);

  const episodes = {};
  for (const episode of show.episodes) {
    invariant(isPlainObject(episode), `${context}: episode must be an object`);
    invariant(Number.isSafeInteger(episode.number) && episode.number > 0,
      `${context}: episode number must be a positive safe integer`);
    invariant(!Object.hasOwn(episodes, episode.number), `${context}: duplicate episode ${episode.number}`);
    episodes[episode.number] = normalizeStatus(episode.type, `${context} episode ${episode.number}`);
  }

  const numbers = Object.keys(episodes).map(Number).sort((a, b) => a - b);
  numbers.forEach((number, index) => {
    invariant(number === index + 1, `${context}: regular absolute numbering has a gap before episode ${number}`);
  });
  if (show.totalEpisodes !== undefined) {
    invariant(show.totalEpisodes === numbers.length,
      `${context}: totalEpisodes=${show.totalEpisodes} but ${numbers.length} episodes were supplied`);
  }

  const counts = { canon: 0, manga_canon: 0, anime_canon: 0, filler: 0, mixed: 0 };
  Object.values(episodes).forEach(status => { counts[status] += 1; });
  const ids = normalizeIds(identity.ids, context);
  const aliases = normalizeAliases(identity.aliases, title, context);
  const seasonOffsets = normalizeSeasonOffsets(identity.seasonOffsets, context);
  const sourceMappings = normalizeSourceMappings(identity.sourceMappings, numbers.length, context);
  const providerMappings = normalizeProviderMappings(identity.providerMappings, numbers.length, context);
  const sourceBindings = normalizeSourceBindings(identity.sourceBindings, providerMappings, context);

  const numbering = {
    scope: 'regular',
    basis: 'absolute',
    startsAt: 1
  };
  if (seasonOffsets) numbering.seasonOffsets = seasonOffsets;
  if (sourceMappings) numbering.sourceMappings = sourceMappings;
  if (providerMappings) numbering.providerMappings = providerMappings;
  if (sourceBindings) numbering.sourceBindings = sourceBindings;

  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${source.id}:${slug}`,
    identity: {
      mediaType: 'series',
      title,
      aliases,
      ids
    },
    numbering,
    classification: {
      sourceId: source.id,
      sourceRevision: source.revision,
      sourceUrl: normalizeHttpsUrl(show.url || source.url, `${context} sourceUrl`)
    },
    counts,
    episodes
  };
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function buildBundle(catalog, options) {
  invariant(Array.isArray(catalog) && catalog.length, 'source catalog must be a non-empty array');
  invariant(isPlainObject(options), 'build options are required');
  invariant(isPlainObject(options.source), 'source metadata is required');

  function normalizeSource(value, label) {
    invariant(isPlainObject(value), `${label} metadata is required`);
    const normalized = {
      id: String(value.id || '').trim(),
      name: String(value.name || '').trim(),
      url: normalizeHttpsUrl(value.url, `${label}.url`),
      revision: String(value.revision || '').trim(),
      license: String(value.license || '').trim(),
      attribution: String(value.attribution || '').trim()
    };
    invariant(/^[a-z][a-z0-9-]*$/.test(normalized.id), `${label}.id is invalid`);
    for (const [key, entry] of Object.entries(normalized)) invariant(entry, `${label}.${key} is required`);
    return normalized;
  }
  const source = normalizeSource(options.source, 'source');
  const additionalSources = (options.additionalSources || []).map((value, index) =>
    normalizeSource(value, `additionalSources[${index}]`));
  const sourceIds = new Set([source.id]);
  for (const additionalSource of additionalSources) {
    invariant(!sourceIds.has(additionalSource.id), `duplicate source id ${additionalSource.id}`);
    sourceIds.add(additionalSource.id);
  }

  const identities = options.identities || {};
  invariant(isPlainObject(identities), 'identities must be an object keyed by slug');
  const slugs = new Set();
  const ids = new Set();
  const shards = [];

  for (const show of catalog) {
    const slug = String(show && show.slug || '').trim();
    invariant(!slugs.has(slug), `duplicate show slug ${slug}`);
    slugs.add(slug);
    const shard = normalizeShow(show, source, identities[slug]);
    invariant(!ids.has(shard.id), `duplicate canonical id ${shard.id}`);
    ids.add(shard.id);
    shards.push(shard);
  }
  for (const identitySlug of Object.keys(identities)) {
    invariant(slugs.has(identitySlug), `identity mapping references unknown slug ${identitySlug}`);
  }
  const externalIds = new Set();
  for (const shard of shards) {
    for (const [provider, value] of Object.entries(shard.identity.ids)) {
      const externalId = `${provider}:${value}`;
      invariant(!externalIds.has(externalId), `duplicate external id ${externalId}`);
      externalIds.add(externalId);
    }
  }
  shards.sort((a, b) => compareText(a.id, b.id));

  const artifacts = new Map();
  const indexItems = shards.map(shard => {
    const path = `titles/${shard.id.slice(source.id.length + 1)}.json`;
    const body = serializeJson(shard);
    artifacts.set(path, body);
    return {
      id: shard.id,
      slug: shard.id.slice(source.id.length + 1),
      title: shard.identity.title,
      aliases: shard.identity.aliases,
      ids: shard.identity.ids,
      episodeCount: Object.keys(shard.episodes).length,
      counts: shard.counts,
      shard: path,
      sha256: sha256(body)
    };
  });

  const index = {
    schemaVersion: SCHEMA_VERSION,
    titles: indexItems
  };
  const indexBody = serializeJson(index);
  artifacts.set('index.json', indexBody);

  const episodeCount = indexItems.reduce((sum, item) => sum + item.episodeCount, 0);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    buildId: [source, ...additionalSources]
      .map(entry => `${entry.id}-${entry.revision.slice(0, 12)}`).join('-'),
    generatedAt: String(options.generatedAt || new Date().toISOString()),
    sources: [source, ...additionalSources],
    catalog: {
      index: 'index.json',
      sha256: sha256(indexBody),
      titleCount: indexItems.length,
      episodeCount,
      shardPattern: 'titles/{slug}.json'
    },
    validation: {
      numbering: 'contiguous-regular-absolute',
      unknownStatuses: 0,
      duplicateSlugs: 0,
      duplicateEpisodes: 0,
      gaps: 0
    }
  };
  artifacts.set('manifest.json', serializeJson(manifest));

  return { manifest, index, shards, artifacts };
}
