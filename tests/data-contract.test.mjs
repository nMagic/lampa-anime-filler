import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildBundle, serializeJson, sha256 } from '../scripts/lib/data-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(resolve(HERE, 'fixtures/catalog.valid.json'), 'utf8'));
const source = {
  id: 'fixture',
  name: 'Fixture data',
  url: 'https://example.test/data',
  revision: '0123456789abcdef',
  license: 'CC BY 4.0',
  attribution: 'Test fixture'
};

function build(catalog = fixture, identities = {
  naruto: { ids: { tmdbTv: 46260, mal: 20 }, aliases: ['Наруто'], sourceMappings: {
    online_mod: { system: 'tmdb', seasons: {
      1: [{ episodeStart: 1, episodeEnd: 3, absoluteStart: 1 }]
    } }
  } }
}) {
  return buildBundle(catalog, {
    source,
    generatedAt: '2026-10-22T00:00:00.000Z',
    identities
  });
}

test('builds deterministic manifest, index and per-title shards', () => {
  const first = build();
  const second = build();
  assert.deepEqual([...first.artifacts], [...second.artifacts]);
  assert.equal(first.manifest.catalog.titleCount, 2);
  assert.equal(first.manifest.catalog.episodeCount, 5);
  assert.equal(first.index.titles[0].id, 'fixture:naruto');
  assert.equal(first.index.titles[1].id, 'fixture:naruto-shippuden');
  assert.equal(first.shards[0].identity.ids.tmdbTv, 46260);
  assert.deepEqual(first.shards[0].identity.aliases, ['Наруто']);
  assert.deepEqual(first.shards[0].numbering.sourceMappings.online_mod.seasons[1], [
    { episodeStart: 1, episodeEnd: 3, absoluteStart: 1 }
  ]);
});

test('checksums cover the exact serialized shard and index bytes', () => {
  const bundle = build();
  const item = bundle.index.titles.find(entry => entry.slug === 'naruto');
  assert.equal(item.sha256, sha256(bundle.artifacts.get(item.shard)));
  assert.equal(bundle.manifest.catalog.sha256, sha256(serializeJson(bundle.index)));
});

test('keeps similar titles as separate canonical identities', () => {
  const bundle = build();
  assert.notEqual(bundle.index.titles[0].id, bundle.index.titles[1].id);
  assert.equal(bundle.index.titles[0].title, 'Naruto');
  assert.equal(bundle.index.titles[1].title, 'Naruto Shippuden');
});

test('preserves manga-canon and anime-canon classifications', () => {
  const title = {
    slug: 'classification-fixture',
    title: 'Classification Fixture',
    totalEpisodes: 3,
    episodes: [
      { number: 1, type: 'Manga Canon' },
      { number: 2, type: 'Anime Canon' },
      { number: 3, type: 'Mixed Canon/Filler' }
    ]
  };
  const shard = build([title], {}).shards[0];
  assert.equal(shard.episodes[1], 'manga_canon');
  assert.equal(shard.episodes[2], 'anime_canon');
  assert.equal(shard.episodes[3], 'mixed');
});

test('rejects duplicate slugs', () => {
  assert.throws(() => build([fixture[0], { ...fixture[1], slug: 'naruto' }]), /duplicate show slug naruto/);
});

test('rejects duplicate episodes, gaps and unsupported statuses', () => {
  const base = fixture[0];
  assert.throws(() => build([{ ...base, episodes: [base.episodes[0], base.episodes[0]] }]), /duplicate episode 1/);
  assert.throws(() => build([{ ...base, totalEpisodes: 2, episodes: [base.episodes[0], base.episodes[2]] }]), /gap before episode 3/);
  assert.throws(() => build([{ ...base, totalEpisodes: 1, episodes: [{ number: 1, type: 'Recap' }] }]), /unsupported episode status/);
});

test('rejects non-series-safe input instead of guessing', () => {
  const base = fixture[0];
  assert.throws(() => build([{ ...base, slug: '../naruto' }]), /invalid slug/);
  assert.throws(() => build([{ ...base, totalEpisodes: 1, episodes: [{ number: '1', type: 'Canon' }] }]), /positive safe integer/);
  assert.throws(() => build([{ ...base, totalEpisodes: 2 }]), /totalEpisodes=2 but 3 episodes/);
  assert.throws(() => build([{ ...base, url: 'http://example.test/naruto' }]), /only HTTPS URLs/);
  assert.throws(() => build(fixture, { naruto: { seasonOffsets: { 1: -1 } } }), /offset/);
  assert.throws(() => build(fixture, { missing: { ids: { tmdbTv: 1 } } }), /unknown slug/);
  assert.throws(() => build(fixture, { naruto: { sourceMappings: {
    online_mod: { system: 'tmdb', seasons: {
      1: [{ episodeStart: 1, episodeEnd: 4, absoluteStart: 1 }]
    } }
  } } }), /maps past catalog episode/);
  assert.throws(() => build(fixture, { naruto: { sourceMappings: {
    online_mod: { system: 'tmdb', seasons: {
      1: [
        { episodeStart: 1, episodeEnd: 2, absoluteStart: 1 },
        { episodeStart: 2, episodeEnd: 3, absoluteStart: 2 }
      ]
    } }
  } } }), /ranges overlap/);
});
