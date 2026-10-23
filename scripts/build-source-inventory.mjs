#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLampac, parseOnlineMod, renderSourceCoverage, summarizeSourceInventory } from './lib/source-inventory.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = resolve(ROOT, 'data/sources/inventory.v1.json');
const REPORT = resolve(ROOT, 'reports/source-coverage.md');
const CONTRACTS = resolve(ROOT, 'data/sources/contracts.v1.json');
const COVERAGE = resolve(ROOT, 'reports/mapping-coverage.json');
const ONLINE_REVISION = '9fbcac14ef8331ca8026a486e92c1a7f59220756';
const LAMPAC_REVISION = '402df720422648cbd3f232293746681688598b69';
const ONLINE_SHA256 = '02b758821deaae1afe16f75beba6a76991e93dc4577fba96f8150f38f165ab6a';
// Digest covers Online/plugin.js, all Modules/Online* provider trees and the
// extension catalog. Update it only together with LAMPAC_REVISION and review.
const LAMPAC_SHA256 = '2f423801c09ea7eee7dd32e5258b37778ffb4b7545980a5f39456cc262a5fbf0';

function args(argv) {
  const result = { verify: false, online: '', lampac: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--verify') result.verify = true;
    else if (argv[index] === '--online-mod-input') result.online = argv[++index] || '';
    else if (argv[index] === '--lampac-input') result.lampac = argv[++index] || '';
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (!result.verify && (!result.online || !result.lampac)) {
    throw new Error('generation requires --online-mod-input FILE --lampac-input DIRECTORY');
  }
  return result;
}

function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }

async function main() {
  const options = args(process.argv.slice(2));
  const catalog = JSON.parse(await readFile(COVERAGE, 'utf8'));
  if (options.verify) {
    const inventory = JSON.parse(await readFile(INVENTORY, 'utf8'));
    const contracts = JSON.parse(await readFile(CONTRACTS, 'utf8'));
    if (inventory.sources.length !== inventory.statistics.discoveredSources) throw new Error('source inventory count is inconsistent');
    const ids = inventory.sources.map(source => source.sourceId);
    if (new Set(ids).size !== ids.length) throw new Error('duplicate source IDs');
    for (const source of inventory.sources) {
      if (!['verified', 'partial', 'unknown', 'unsupported'].includes(source.supportStatus)) throw new Error(`${source.sourceId}: missing status`);
      if (source.binding && source.numberingBasis === 'unknown') throw new Error(`${source.sourceId}: binding has no confirmed basis`);
      if ((source.coverage.titles || source.coverage.episodes) && !source.binding) throw new Error(`${source.sourceId}: unbound coverage must be zero`);
    }
    const expectedStats = summarizeSourceInventory(inventory.sources, catalog);
    if (serialize(expectedStats) !== serialize(inventory.statistics)) throw new Error('source inventory statistics are stale');
    const expectedReport = renderSourceCoverage(inventory);
    if (expectedReport !== await readFile(REPORT, 'utf8')) throw new Error('source coverage report is stale');
    const expectedBindings = Object.fromEntries(inventory.sources.filter(source => source.binding)
      .map(source => [source.sourceId, source.binding]));
    if (serialize(contracts.bindings) !== serialize(expectedBindings)) throw new Error('source contracts are stale');
    console.log(`Verified ${inventory.sources.length} discovered sources; ${inventory.statistics.implementedBindings} safe bindings.`);
    return;
  }

  const onlineText = await readFile(resolve(options.online), 'utf8');
  const online = parseOnlineMod(onlineText, ONLINE_REVISION);
  const lampac = await parseLampac(resolve(options.lampac), LAMPAC_REVISION);
  if (online.sha256 !== ONLINE_SHA256) throw new Error(`Online_Mod input digest mismatch: ${online.sha256}`);
  if (lampac.sha256 !== LAMPAC_SHA256) {
    throw new Error(`Lampac input digest mismatch: ${lampac.sha256}`);
  }
  const sources = [...online.sources, ...lampac.sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const inventory = {
    schemaVersion: 1,
    generatedAt: '2026-10-23T00:00:00.000Z',
    repositories: [
      { id: 'online_mod', url: 'https://github.com/nb557/plugins', revision: ONLINE_REVISION, artifact: 'online_mod.js', sha256: online.sha256 },
      { id: 'lampac', url: 'https://github.com/lampac-nextgen/lampac', revision: LAMPAC_REVISION, artifact: 'Modules/Online* + Online/plugin.js + extensions.json', sha256: lampac.sha256 }
    ],
    extraction: { onlineModRegistryEntries: online.sources.length, lampacProviderModules: lampac.moduleCount, opaqueCatalogEndpoints: lampac.opaqueCount },
    sources,
    statistics: summarizeSourceInventory(sources, catalog)
  };
  await mkdir(dirname(INVENTORY), { recursive: true });
  await writeFile(INVENTORY, serialize(inventory));
  await writeFile(CONTRACTS, serialize({
    schemaVersion: 1,
    generatedAt: inventory.generatedAt,
    semantics: {
      'provider-seasonal': 'Season and episode are converted through the named provider basis.',
      'absolute-field': 'The adapter exposes a verified regular absolute episode field.'
    },
    bindings: Object.fromEntries(sources.filter(source => source.binding).map(source => [source.sourceId, source.binding]))
  }));
  await writeFile(REPORT, renderSourceCoverage(inventory));
  console.log(`Generated ${sources.length} sources: ${online.sources.length} Online_Mod, ${lampac.moduleCount} Lampac modules, ${lampac.opaqueCount} opaque endpoints.`);
}

main().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
