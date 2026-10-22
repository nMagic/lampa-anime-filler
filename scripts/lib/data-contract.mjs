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

  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${source.id}:${slug}`,
    identity: {
      mediaType: 'series',
      title,
      aliases,
      ids
    },
    numbering: {
      scope: 'regular',
      basis: 'absolute',
      startsAt: 1
    },
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

  const source = {
    id: String(options.source.id || '').trim(),
    name: String(options.source.name || '').trim(),
    url: normalizeHttpsUrl(options.source.url, 'source.url'),
    revision: String(options.source.revision || '').trim(),
    license: String(options.source.license || '').trim(),
    attribution: String(options.source.attribution || '').trim()
  };
  for (const [key, value] of Object.entries(source)) invariant(value, `source.${key} is required`);

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
    buildId: `${source.id}-${source.revision.slice(0, 12)}`,
    generatedAt: String(options.generatedAt || new Date().toISOString()),
    sources: [source],
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
