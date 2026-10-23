import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  computeStatistics,
  createEvidence,
  normalizeTitle,
  runtimeIdentities
} from '../scripts/lib/mapping-pipeline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coverage = JSON.parse(await readFile(resolve(ROOT, 'reports/mapping-coverage.json'), 'utf8'));
const index = JSON.parse(await readFile(resolve(ROOT, 'data/generated/v1/index.json'), 'utf8'));
const runtime = JSON.parse(await readFile(resolve(ROOT, 'data/mappings/generated.v1.json'), 'utf8'));

function entry({ title, episodes, anilist, mal, anidb, type = 'TV', synonyms = [], year = 2020 }) {
  const sources = [];
  if (anilist) sources.push(`https://anilist.co/anime/${anilist}`);
  if (mal) sources.push(`https://myanimelist.net/anime/${mal}`);
  if (anidb) sources.push(`https://anidb.net/anime/${anidb}`);
  return { title, episodes, type, synonyms, sources, animeSeason: { year, season: 'SPRING' } };
}

function catalogShow(slug, title, count) {
  return { slug, title, episodes: Array.from({ length: count }, (_, index) => ({ number: index + 1, type: 'Canon' })) };
}

function fixtureMappings(values) {
  return { $meta: { schema_version: '3.0.3', generated_on: 'fixture' }, ...values };
}

test('coverage report accounts for the complete catalog and recomputes exactly', () => {
  assert.equal(index.titles.length, 45);
  assert.equal(index.titles.reduce((sum, title) => sum + title.episodeCount, 0), 9552);
  assert.deepEqual(coverage.statistics, computeStatistics(coverage.titles));
  assert.deepEqual(coverage.titles.map(title => title.slug).sort(), index.titles.map(title => title.slug).sort());
  for (const item of index.titles) {
    const result = coverage.titles.find(title => title.slug === item.slug);
    assert.ok(result, `${item.slug} was omitted`);
    assert.equal(result.classifiedEpisodes, item.episodeCount);
    assert.ok(result.identity.status);
    assert.ok(result.episodeMapping.status);
    assert.equal(result.episodeMapping.verifiedEpisodes + result.episodeMapping.unresolvedEpisodes, item.episodeCount);
  }
});

test('every declared provider mapping is bounded, non-overlapping and conflict-free at runtime', () => {
  for (const title of coverage.titles) {
    for (const [basis, mapping] of Object.entries(title.episodeMapping.providerMappings)) {
      const providerKeys = new Set();
      const absoluteKeys = new Set();
      for (const [season, ranges] of Object.entries(mapping.seasons)) {
        assert.match(season, /^[1-9]\d*$/);
        for (const range of ranges) {
          for (let episode = range.episodeStart; episode <= range.episodeEnd; episode += 1) {
            const absolute = range.absoluteStart + episode - range.episodeStart;
            assert.ok(absolute >= 1 && absolute <= title.classifiedEpisodes, `${title.slug}/${basis} maps out of bounds`);
            assert.ok(!providerKeys.has(`${season}:${episode}`), `${title.slug}/${basis} overlaps provider episodes`);
            assert.ok(!absoluteKeys.has(absolute), `${title.slug}/${basis} maps an absolute episode twice`);
            providerKeys.add(`${season}:${episode}`);
            absoluteKeys.add(absolute);
          }
        }
      }
      assert.ok(mapping.evidence.length, `${title.slug}/${basis} lacks provenance`);
    }
  }
});

test('unresolved and ambiguous identities never leak guessed TMDB IDs into the runtime index', () => {
  const generated = runtimeIdentities(coverage);
  assert.deepEqual(generated, runtime.titles);
  for (const title of coverage.titles) {
    if (title.identity.status !== 'verified') assert.equal(generated[title.slug].ids.tmdbTv, undefined);
  }
  assert.equal(generated['digimon-adventure'].ids.tmdbTv, undefined);
  assert.equal(generated['fist-of-the-north-star'].ids.tmdbTv, undefined);
  assert.equal(generated['d-gray-man'].ids.tmdbTv, undefined);
});

test('exact matching separates similar titles and accepts a localized exact alias', () => {
  const catalog = [catalogShow('alpha', 'Alpha', 3), catalogShow('alpha-next', 'Alpha Next', 2), catalogShow('localized', 'Локальное имя', 2)];
  const database = { data: [
    entry({ title: 'Alpha', episodes: 3, anilist: 1, mal: 1 }),
    entry({ title: 'Alpha Next', episodes: 2, anilist: 2, mal: 2 }),
    entry({ title: 'Original Name', episodes: 2, anilist: 3, mal: 3, synonyms: ['Локальное имя'] })
  ] };
  const mappings = fixtureMappings({
    'anilist:1': { 'tmdb_show:10:s1': { '1-3': '1-3' } },
    'anilist:2': { 'tmdb_show:11:s1': { '1-2': '1-2' } },
    'anilist:3': { 'tmdb_show:12:s1': { '1-2': '1-2' } }
  });
  const evidence = createEvidence(catalog, database, mappings);
  assert.deepEqual(evidence.titles.map(title => title.identity.externalIds.tmdbTv), [[10], [11], [12]]);
  assert.equal(normalizeTitle('Pokémon'), normalizeTitle('Pokemon'));
});

test('TV media type wins over a same-title movie and specials never enter regular mappings', () => {
  const catalog = [catalogShow('collision', 'Collision', 2)];
  const database = { data: [
    entry({ title: 'Collision', episodes: 1, anilist: 40, mal: 40, type: 'MOVIE' }),
    entry({ title: 'Collision', episodes: 2, anilist: 41, mal: 41 })
  ] };
  const mappings = fixtureMappings({
    'anilist:40': { 'tmdb_movie:99': { '1': '1' } },
    'anilist:41': {
      'tmdb_show:20:s0': { '1': '1' },
      'tmdb_show:20:s1': { '1-2': '1-2' }
    }
  });
  const title = createEvidence(catalog, database, mappings).titles[0];
  assert.deepEqual(title.identity.externalIds.tmdbTv, [20]);
  assert.deepEqual(Object.keys(title.episodeMapping.providerMappings.tmdb.seasons), ['1']);
});

test('season reset and continuous numbering are separate provider bases', () => {
  const catalog = [catalogShow('multi', 'Multi', 4)];
  const database = { data: [entry({ title: 'Multi', episodes: 4, anilist: 50, mal: 50, anidb: 50 })] };
  const mappings = fixtureMappings({
    'anilist:50': {
      'tmdb_show:30:s1': { '1-2': '1-2' },
      'tmdb_show:30:s2': { '3-4': '3-4' },
      'tvdb_show:31:s1': { '1-2': '1-2' },
      'tvdb_show:31:s2': { '3-4': '1-2' }
    }
  });
  const title = createEvidence(catalog, database, mappings).titles[0];
  assert.deepEqual(title.episodeMapping.providerMappings.tmdb.seasons['2'][0], { episodeStart: 3, episodeEnd: 4, absoluteStart: 3 });
  assert.deepEqual(title.episodeMapping.providerMappings.tvdb.seasons['2'][0], { episodeStart: 1, episodeEnd: 2, absoluteStart: 3 });
});

test('partial ranges remain partial and tied overlapping mappings are not guessed', () => {
  const catalog = [catalogShow('partial', 'Partial', 4)];
  const database = { data: [entry({ title: 'Partial', episodes: 4, anilist: 60, mal: 60 })] };
  const partial = createEvidence(catalog, database, fixtureMappings({
    'anilist:60': { 'tmdb_show:40:s1': { '1-2': '1-2' } }
  })).titles[0];
  assert.equal(partial.episodeMapping.status, 'partial');
  assert.equal(partial.episodeMapping.verifiedEpisodes, 2);
  assert.deepEqual(partial.episodeMapping.unresolvedAbsoluteRanges, ['3-4']);

  const conflicted = createEvidence(catalog, database, fixtureMappings({
    'anilist:60': { 'tmdb_show:40:s1': { '1-4': '1-4' } },
    'mal:60': { 'tmdb_show:40:s1': { '1-4': '2-5' } }
  })).titles[0];
  assert.ok(conflicted.episodeMapping.conflicts.length > 0);
  assert.ok(conflicted.episodeMapping.verifiedEpisodes < 4);
});

test('missing or corrupt external datasets fail instead of manufacturing results', () => {
  const catalog = [catalogShow('safe', 'Safe', 1)];
  assert.throws(() => createEvidence(catalog, {}, fixtureMappings({})), /anime-offline-database/);
  assert.throws(() => createEvidence(catalog, { data: [] }, {}), /AniBridge/);
  const unresolved = createEvidence(catalog, { data: [] }, fixtureMappings({})).titles[0];
  assert.equal(unresolved.identity.status, 'unresolved');
  assert.equal(runtimeIdentities({ titles: [unresolved] }).safe.ids.tmdbTv, undefined);
});

test('invalid external identifiers cannot establish an identity', () => {
  const catalog = [catalogShow('invalid', 'Invalid IDs', 1)];
  const database = { data: [{
    title: 'Invalid IDs', episodes: 1, type: 'TV', synonyms: [], animeSeason: { year: 2020, season: 'SPRING' },
    sources: [
      'https://anilist.co/anime/0',
      'https://myanimelist.net/anime/not-a-number',
      'https://anidb.net/anime/9007199254740993'
    ]
  }] };
  const result = createEvidence(catalog, database, fixtureMappings({
    'anilist:0': { 'tmdb_show:-1:s1': { '1': '1' } },
    'mal:not-a-number': { 'tmdb_show:abc:s1': { '1': '1' } }
  })).titles[0];
  assert.equal(result.identity.status, 'unresolved');
  assert.deepEqual(result.identity.externalIds.tmdbTv, []);
  assert.equal(runtimeIdentities({ titles: [result] }).invalid.ids.tmdbTv, undefined);
});

test('an upstream mapping change is visible and cannot silently preserve stale coverage', () => {
  const catalog = [catalogShow('changed', 'Changed', 2)];
  const database = { data: [entry({ title: 'Changed', episodes: 2, anilist: 70, mal: 70 })] };
  const before = createEvidence(catalog, database, fixtureMappings({
    'anilist:70': { 'tmdb_show:50:s1': { '1-2': '1-2' } },
    'mal:70': { 'tmdb_show:50:s1': { '1-2': '1-2' } }
  })).titles[0];
  const after = createEvidence(catalog, database, fixtureMappings({
    'anilist:70': { 'tmdb_show:50:s1': { '1-2': '1-2' } },
    'mal:70': { 'tmdb_show:50:s1': { '1-2': '2-3' } }
  })).titles[0];
  assert.equal(before.episodeMapping.verifiedEpisodes, 2);
  assert.ok(after.episodeMapping.verifiedEpisodes < before.episodeMapping.verifiedEpisodes);
  assert.ok(after.episodeMapping.conflicts.length > 0);
});
