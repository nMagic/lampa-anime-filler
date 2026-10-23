#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UPSTREAM,
  computeStatistics,
  createEvidence,
  renderCoverageMarkdown,
  runtimeIdentities,
  sha256
} from './lib/mapping-pipeline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_REVISION = 'a7b28ff590b70652843125b77b9a80f334d2c3ca';
const CATALOG_URL = `https://raw.githubusercontent.com/animecannonhunter-hash/anime-filler-list-data/${CATALOG_REVISION}/anime.json`;
const COVERAGE_JSON = resolve(ROOT, 'reports/mapping-coverage.json');
const COVERAGE_MD = resolve(ROOT, 'reports/mapping-coverage.md');
const RUNTIME_MAPPING = resolve(ROOT, 'data/mappings/generated.v1.json');

function usage() {
  return 'Usage: node scripts/build-mappings.mjs (--refresh | --verify) [--catalog-input FILE] [--aodb-input FILE] [--anibridge-input FILE]';
}

function parseArgs(argv) {
  const args = { refresh: false, verify: false, catalogInput: '', aodbInput: '', anibridgeInput: '' };
  const keys = { '--catalog-input': 'catalogInput', '--aodb-input': 'aodbInput', '--anibridge-input': 'anibridgeInput' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--refresh') args.refresh = true;
    else if (arg === '--verify') args.verify = true;
    else if (keys[arg]) {
      if (!argv[index + 1]) throw new Error(`${arg} requires a file\n${usage()}`);
      args[keys[arg]] = argv[++index];
    } else throw new Error(`Unknown argument ${arg}\n${usage()}`);
  }
  if (Number(args.refresh) + Number(args.verify) !== 1) throw new Error(`Choose exactly one mode\n${usage()}`);
  if (args.verify && (args.catalogInput || args.aodbInput || args.anibridgeInput)) throw new Error(`Input overrides are only valid with --refresh\n${usage()}`);
  return args;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'lampa-anime-filler-mapping-builder/1' } });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function inputText(file, source) {
  const text = file ? await readFile(resolve(ROOT, file), 'utf8') : await fetchText(source.url);
  if (source.sha256 && sha256(text) !== source.sha256) {
    throw new Error(`${source.id} SHA-256 mismatch; expected ${source.sha256}, got ${sha256(text)}`);
  }
  return text;
}

function runtimeDocument(evidence) {
  return {
    schemaVersion: 1,
    revision: `generated-${evidence.generatedAt.replace(/[^0-9]/g, '').slice(0, 14)}`,
    sources: Object.values(UPSTREAM).map(source => ({
      id: source.id,
      name: source.name,
      url: source.repository,
      revision: source.revision,
      license: source.license,
      attribution: source.attribution
    })),
    titles: runtimeIdentities(evidence)
  };
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function write(target, body) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body, 'utf8');
}

async function refresh(args) {
  const catalogText = args.catalogInput ? await readFile(resolve(ROOT, args.catalogInput), 'utf8') : await fetchText(CATALOG_URL);
  const [databaseText, mappingsText] = await Promise.all([
    inputText(args.aodbInput, UPSTREAM.animeOfflineDatabase),
    inputText(args.anibridgeInput, UPSTREAM.anibridge)
  ]);
  const catalog = JSON.parse(catalogText);
  const database = JSON.parse(databaseText);
  const mappings = JSON.parse(mappingsText);
  if (mappings.$meta.schema_version !== '3.0.3' || mappings.$meta.generated_on !== '2026-10-22T06:55:54Z') {
    throw new Error(`AniBridge metadata differs from the pinned artifact: ${JSON.stringify(mappings.$meta)}`);
  }
  const evidence = createEvidence(catalog, database, mappings);
  if (evidence.statistics.classification.titles !== 45 || evidence.statistics.classification.episodes !== 9552) {
    throw new Error(`Expected the full 45-title/9552-episode catalog, got ${JSON.stringify(evidence.statistics.classification)}`);
  }
  await Promise.all([
    write(COVERAGE_JSON, json(evidence)),
    write(COVERAGE_MD, renderCoverageMarkdown(evidence)),
    write(RUNTIME_MAPPING, json(runtimeDocument(evidence)))
  ]);
  return evidence;
}

async function verify() {
  const evidence = JSON.parse(await readFile(COVERAGE_JSON, 'utf8'));
  const index = JSON.parse(await readFile(resolve(ROOT, 'data/generated/v1/index.json'), 'utf8'));
  if (index.titles.length !== 45 || index.titles.reduce((sum, title) => sum + title.episodeCount, 0) !== 9552) {
    throw new Error('Generated bundle does not contain the full 45-title/9552-episode source catalog');
  }
  const expectedSlugs = index.titles.map(title => title.slug).sort();
  const actualSlugs = evidence.titles.map(title => title.slug).sort();
  if (JSON.stringify(actualSlugs) !== JSON.stringify(expectedSlugs)) throw new Error('Coverage report does not contain every catalog title exactly once');
  const actualCounts = new Map(index.titles.map(title => [title.slug, title.episodeCount]));
  for (const title of evidence.titles) {
    if (actualCounts.get(title.slug) !== title.classifiedEpisodes) throw new Error(`${title.slug}: classified episode count differs from the catalog`);
    if (!title.identity || !title.identity.status || !title.episodeMapping || !title.episodeMapping.status) throw new Error(`${title.slug}: missing resolution attempt`);
    if (title.identity.status !== 'verified' && title.identity.externalIds.tmdbTv.length === 1 && runtimeIdentities({ titles: [title] })[title.slug].ids.tmdbTv) {
      throw new Error(`${title.slug}: unresolved/ambiguous identity leaked into runtime TMDB mapping`);
    }
  }
  const statistics = computeStatistics(evidence.titles);
  if (JSON.stringify(statistics) !== JSON.stringify(evidence.statistics)) throw new Error('Coverage statistics are stale or inconsistent');
  if (statistics.classification.titles !== 45 || statistics.classification.episodes !== 9552) {
    throw new Error('Coverage report does not contain the full 45-title/9552-episode source catalog');
  }
  const expected = new Map([
    [COVERAGE_MD, renderCoverageMarkdown(evidence)],
    [RUNTIME_MAPPING, json(runtimeDocument(evidence))]
  ]);
  for (const [target, body] of expected) {
    if (await readFile(target, 'utf8') !== body) throw new Error(`Generated artifact is stale: ${target.slice(ROOT.length + 1)}`);
  }
  return evidence;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const evidence = args.refresh ? await refresh(args) : await verify();
  const stats = evidence.statistics;
  console.log(`Mapping coverage: ${stats.identity.verified}/${stats.classification.titles} verified identities; ` +
    `${stats.episodeConversion.verifiedEpisodes}/${stats.classification.episodes} verified episode conversions.`);
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
