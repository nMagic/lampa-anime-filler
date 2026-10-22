#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from './lib/data-contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REVISION = 'a7b28ff590b70652843125b77b9a80f334d2c3ca';
const SOURCE_URL = `https://raw.githubusercontent.com/animecannonhunter-hash/anime-filler-list-data/${SOURCE_REVISION}/anime.json`;
const EXPECTED_TITLES = 45;
const EXPECTED_EPISODES = 9552;

const SOURCE = Object.freeze({
  id: 'skipthefiller',
  name: 'SkipTheFiller Anime Filler List Data',
  url: 'https://github.com/animecannonhunter-hash/anime-filler-list-data',
  revision: SOURCE_REVISION,
  license: 'CC BY 4.0',
  attribution: 'Data from https://skipthefiller.com'
});

const IDENTITIES = Object.freeze({
  'one-piece': {
    ids: { tmdbTv: 37854 },
    aliases: ['Ван-Пис', 'ワンピース']
  }
});

function usage() {
  return 'Usage: node scripts/build-data.mjs [--check] [--input FILE] [--out DIRECTORY]';
}

function parseArgs(argv) {
  const args = { check: false, input: '', out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') args.check = true;
    else if (arg === '--input') {
      if (!argv[index + 1]) throw new Error(`--input requires a file\n${usage()}`);
      args.input = argv[++index];
    } else if (arg === '--out') {
      if (!argv[index + 1]) throw new Error(`--out requires a directory\n${usage()}`);
      args.out = argv[++index];
    }
    else throw new Error(`Unknown argument ${arg}\n${usage()}`);
  }
  if (!args.check && !args.out) throw new Error(`--out is required unless --check is used\n${usage()}`);
  return args;
}

async function fetchSource() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(SOURCE_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'lampa-anime-filler-data-builder/1' }
    });
    if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args.input
    ? await readFile(resolve(ROOT, args.input), 'utf8')
    : await fetchSource();
  const catalog = JSON.parse(text);
  const generatedAt = process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000)
    : new Date();
  if (Number.isNaN(generatedAt.valueOf())) throw new Error('SOURCE_DATE_EPOCH must be a Unix timestamp');
  const bundle = buildBundle(catalog, {
    source: SOURCE,
    identities: IDENTITIES,
    generatedAt: generatedAt.toISOString()
  });

  if (bundle.manifest.catalog.titleCount !== EXPECTED_TITLES) {
    throw new Error(`expected ${EXPECTED_TITLES} titles, got ${bundle.manifest.catalog.titleCount}`);
  }
  if (bundle.manifest.catalog.episodeCount !== EXPECTED_EPISODES) {
    throw new Error(`expected ${EXPECTED_EPISODES} episodes, got ${bundle.manifest.catalog.episodeCount}`);
  }

  if (!args.check) {
    const out = resolve(ROOT, args.out);
    for (const [relativePath, body] of bundle.artifacts) {
      const target = resolve(out, relativePath);
      if (target !== out && !target.startsWith(`${out}/`)) throw new Error(`unsafe output path ${relativePath}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body, 'utf8');
    }
  }

  console.log(
    `Validated schema v${bundle.manifest.schemaVersion}: ` +
    `${bundle.manifest.catalog.titleCount} titles, ${bundle.manifest.catalog.episodeCount} episodes, ` +
    `source ${SOURCE.revision.slice(0, 12)}`
  );
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
