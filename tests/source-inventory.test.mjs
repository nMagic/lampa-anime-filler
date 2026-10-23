import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseOnlineMod, renderSourceCoverage, summarizeSourceInventory } from '../scripts/lib/source-inventory.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventory = JSON.parse(await readFile(resolve(ROOT, 'data/sources/inventory.v1.json'), 'utf8'));
const contracts = JSON.parse(await readFile(resolve(ROOT, 'data/sources/contracts.v1.json'), 'utf8'));
const catalog = JSON.parse(await readFile(resolve(ROOT, 'reports/mapping-coverage.json'), 'utf8'));

test('complete generated registry accounts for every extracted implementation and endpoint', () => {
  assert.equal(inventory.extraction.onlineModRegistryEntries, 23);
  assert.equal(inventory.extraction.lampacProviderModules, 71);
  assert.equal(inventory.extraction.opaqueCatalogEndpoints, 8);
  assert.equal(inventory.sources.length, 102);
  assert.equal(inventory.sources.length, Object.values(inventory.extraction).reduce((sum, value) => sum + value, 0));
  assert.equal(new Set(inventory.sources.map(source => source.sourceId)).size, inventory.sources.length);
  assert.deepEqual(inventory.statistics, summarizeSourceInventory(inventory.sources, catalog));
});

test('every source is classified and unproved contracts remain fail-closed', () => {
  for (const source of inventory.sources) {
    assert.ok(['verified', 'partial', 'unknown', 'unsupported'].includes(source.supportStatus), source.sourceId);
    assert.ok(source.availability.status, source.sourceId);
    assert.ok(source.episodeDataFormat, source.sourceId);
    assert.ok(source.evidence.length, source.sourceId);
    if (source.binding) assert.notEqual(source.numberingBasis, 'unknown', source.sourceId);
    else assert.deepEqual(source.coverage, { titles: 0, episodes: 0 }, source.sourceId);
  }
  assert.deepEqual(contracts.bindings, {});
  assert.equal(inventory.statistics.confirmedNumberingBasis, 0);
  assert.equal(inventory.statistics.implementedBindings, 0);
});

test('coverage report is generated from the registry, not maintained by hand', async () => {
  assert.equal(await readFile(resolve(ROOT, 'reports/source-coverage.md'), 'utf8'), renderSourceCoverage(inventory));
});

test('Online_Mod extractor discovers a newly registered balancer automatically', () => {
  const prefix = 'function alpha(){}\nfunction beta(){}\n';
  const two = `${prefix}var Balancers = [{name:'alpha',title:'Alpha',module:alpha,disabled:false},{name:'beta',title:'Beta',module:beta,disabled:true}];`;
  assert.deepEqual(parseOnlineMod(two, 'fixture').sources.map(source => source.sourceId), ['online_mod:alpha', 'online_mod:beta']);
  const three = two.replace('];', ",{name:'gamma',title:'Gamma',module:gamma,disabled:featureGate}];");
  const parsed = parseOnlineMod(`function gamma(){}\n${three}`, 'fixture');
  assert.equal(parsed.sources.length, 3);
  assert.equal(parsed.sources[2].availability.status, 'conditional');
});

test('all 45 catalog titles remain visible when source coverage is computed', () => {
  assert.equal(inventory.statistics.catalog.titles, 45);
  assert.equal(inventory.statistics.catalog.episodes, 9552);
  assert.equal(inventory.statistics.providerConversionInventory.episodes, 7330);
  assert.equal(inventory.statistics.sourceBoundCoverage.episodes, 0);
});
