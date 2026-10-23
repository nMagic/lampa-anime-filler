import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

const GROUPS = ['OnlineAnime', 'OnlineENG', 'OnlineGEO', 'OnlinePaid', 'OnlineRUS', 'OnlineUKR'];

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function balanced(source, start, open, close) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === open) depth += 1;
    else if (char === close && --depth === 0) return index;
  }
  throw new Error(`unterminated ${open}${close} block`);
}

function field(body, name) {
  const match = new RegExp(`(?:^|[,\\n]\\s*)${name}\\s*:\\s*([^,\\n}]+)`).exec(body);
  return match ? match[1].trim() : '';
}

function quoted(value) {
  const match = /^(['"])([\s\S]*)\1$/.exec(value);
  return match ? match[2] : value;
}

export function parseOnlineMod(source, revision) {
  const marker = 'var Balancers = [';
  const markerAt = source.indexOf(marker);
  invariant(markerAt >= 0, 'Online_Mod Balancers registry not found');
  const arrayStart = source.indexOf('[', markerAt);
  const arrayEnd = balanced(source, arrayStart, '[', ']');
  const registry = source.slice(arrayStart + 1, arrayEnd);
  const sources = [];
  for (let cursor = 0; cursor < registry.length;) {
    const start = registry.indexOf('{', cursor);
    if (start < 0) break;
    const end = balanced(registry, start, '{', '}');
    const body = registry.slice(start + 1, end);
    cursor = end + 1;
    const name = quoted(field(body, 'name'));
    if (!name) continue;
    const title = quoted(field(body, 'title'));
    const moduleName = field(body, 'module');
    const disabled = field(body, 'disabled') || 'unknown';
    const modulePattern = new RegExp(`(?:function\\s+${moduleName}\\b|var\\s+${moduleName}\\s*=\\s*function\\b)`);
    const moduleMatch = modulePattern.exec(source);
    const registryLine = lineOf(source, arrayStart + 1 + start);
    const moduleLine = moduleMatch ? lineOf(source, moduleMatch.index) : null;
    const availability = disabled === 'false' ? 'active' : disabled === 'true' ? 'disabled' : 'conditional';
    sources.push({
      sourceId: `online_mod:${name}`,
      name: title,
      plugin: 'Online_Mod',
      revision,
      module: moduleName,
      availability: { status: availability, expression: disabled },
      episodeDataFormat: 'online_mod template payload: element.season + element.episode',
      episodeNumbers: { absolute: false, seasonal: true, exposedToAnimeFiller: true },
      numberingBasis: 'unknown',
      evidence: [
        `online_mod.js#L${registryLine}: registry entry`,
        moduleLine ? `online_mod.js#L${moduleLine}: ${moduleName} implementation` : `online_mod.js: ${moduleName} implementation not located`,
        'online_mod.js: provider-derived element is passed to Lampa.Template.get("online_mod", element)'
      ],
      aniBridgeMapping: 'not-applicable-until-basis-is-proved',
      binding: null,
      supportStatus: 'unknown',
      reason: 'The source exposes season/episode, but its external numbering basis is not proved by the implementation.',
      coverage: { titles: 0, episodes: 0 },
      deviceVerification: 'not-tested'
    });
  }
  invariant(sources.length > 0, 'Online_Mod registry was empty');
  return { sources, sha256: sha256(source), registryLine: lineOf(source, markerAt) };
}

async function filesBelow(root) {
  const result = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) result.push(path);
    }
  }
  await walk(root);
  return result.sort();
}

export async function parseLampac(root, revision) {
  const sources = [];
  const hashed = [];
  const clientPath = join(root, 'Online', 'plugin.js');
  const clientSource = await readFile(clientPath, 'utf8');
  invariant(clientSource.includes("var season = item.attr('s');") && clientSource.includes("var episode = item.attr('e');"),
    'Lampac client no longer parses provider s/e attributes as expected');
  invariant(/Lampa\.Template\.get\('lampac_prestige_full',\s*\{\s*title:[\s\S]{0,500}quality:/.test(clientSource),
    'Lampac public row-template payload changed; re-audit metadata exposure');
  hashed.push(`${relative(root, clientPath)}\0${sha256(clientSource)}\n`);
  for (const group of GROUPS) {
    const groupRoot = join(root, 'Modules', group);
    const providers = (await readdir(groupRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const provider of providers) {
      const providerRoot = join(groupRoot, provider.name);
      const manifestPath = join(providerRoot, 'manifest.json');
      const manifestText = await readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestText);
      for (const path of await filesBelow(providerRoot)) {
        const body = await readFile(path);
        hashed.push(`${relative(root, path)}\0${sha256(body)}\n`);
      }
      sources.push({
        sourceId: `lampac:${group.replace(/^Online/, '').toLowerCase()}:${provider.name.toLowerCase()}`,
        name: provider.name,
        plugin: 'Lampac NextGen Online',
        revision,
        module: relative(root, providerRoot),
        availability: {
          status: manifest.enable === false ? 'disabled' : manifest.dynamic ? 'conditional' : 'active',
          expression: `manifest.enable=${JSON.stringify(manifest.enable)}; manifest.dynamic=${JSON.stringify(manifest.dynamic)}`
        },
        episodeDataFormat: 'backend HTML attributes s/e -> internal element.season/element.episode; public lampac_prestige_full payload omits both',
        episodeNumbers: { absolute: false, seasonal: true, exposedToAnimeFiller: false },
        numberingBasis: 'unknown',
        evidence: [
          `${relative(root, manifestPath)}: module manifest`,
          'Online/plugin.js: s/e attributes are parsed into internal season/episode',
          'Online/plugin.js: lampac_prestige_full receives title/time/info/quality only'
        ],
        aniBridgeMapping: 'blocked-by-unexposed-numbering-and-unknown-basis',
        binding: null,
        supportStatus: 'unsupported',
        reason: 'The current public template payload does not expose provider season/episode to Anime Filler, and no provider basis is asserted.',
        coverage: { titles: 0, episodes: 0 },
        deviceVerification: 'not-tested'
      });
    }
  }

  const extensionsPath = join(root, 'Modules', 'LampaWeb', 'plugins', 'extensions.json');
  const extensionsText = await readFile(extensionsPath, 'utf8');
  hashed.push(`${relative(root, extensionsPath)}\0${sha256(extensionsText)}\n`);
  const extensions = JSON.parse(extensionsText);
  const seen = new Set();
  const opaque = [];
  for (const section of extensions.results || []) {
    if (!['best', 'video'].includes(section.hpu)) continue;
    for (const entry of section.results || []) {
      if (!/онлайн/i.test(`${entry.descr || ''} ${entry.name || ''}`)) continue;
      if (/nb557\.github\.io\/plugins\/online_mod\.js/i.test(entry.link || '')) continue;
      const key = String(entry.link || entry.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let host = 'endpoint';
      try { host = new URL(key).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-'); }
      catch (_) { /* The digest below remains the stable unique component. */ }
      const id = `${host}-${sha256(key).slice(0, 10)}`;
      opaque.push({
        sourceId: `lampa-extension:${id}`,
        name: entry.name,
        plugin: 'Lampa extension catalog',
        revision,
        module: entry.link,
        availability: { status: entry.available_lampa ? 'listed' : 'disabled', expression: `available_lampa=${entry.available_lampa}` },
        episodeDataFormat: 'unavailable',
        episodeNumbers: { absolute: false, seasonal: false, exposedToAnimeFiller: false },
        numberingBasis: 'unknown',
        evidence: [`Modules/LampaWeb/plugins/extensions.json: ${section.hpu} catalog entry`],
        aniBridgeMapping: 'not-applicable-without-source-contract',
        binding: null,
        supportStatus: 'unknown',
        reason: 'The catalog exposes a distribution endpoint but not a revision-pinned source registry or numbering contract.',
        coverage: { titles: 0, episodes: 0 },
        deviceVerification: 'not-tested'
      });
    }
  }
  return { sources: [...sources, ...opaque], moduleCount: sources.length, opaqueCount: opaque.length, sha256: sha256(hashed.sort().join('')) };
}

export function summarizeSourceInventory(sources, catalog) {
  const count = status => sources.filter(source => source.supportStatus === status).length;
  return {
    discoveredSources: sources.length,
    sourceAuditedImplementations: sources.filter(source => source.plugin !== 'Lampa extension catalog').length,
    confirmedNumberingBasis: sources.filter(source => source.numberingBasis !== 'unknown').length,
    implementedBindings: sources.filter(source => source.binding).length,
    statuses: {
      verified: count('verified'), partial: count('partial'), unknown: count('unknown'), unsupported: count('unsupported')
    },
    sourceBoundCoverage: { titles: 0, episodes: 0 },
    providerConversionInventory: {
      titles: catalog.statistics.episodeMappings.verified + catalog.statistics.episodeMappings.partial,
      episodes: catalog.statistics.episodeConversion.verifiedEpisodes,
      note: 'Build-time provider conversions are not source bindings.'
    },
    catalog: { titles: catalog.statistics.classification.titles, episodes: catalog.statistics.classification.episodes }
  };
}

export function renderSourceCoverage(inventory) {
  const s = inventory.statistics;
  const rows = inventory.sources.map(source => {
    const evidence = source.evidence.join('; ').replaceAll('|', '\\|');
    const reason = source.reason.replaceAll('|', '\\|');
    return `| ${source.sourceId} | ${source.plugin} | ${source.module} | ${source.numberingBasis} | ${source.binding ? 'implemented' : 'not implemented'} | ${evidence} | ${source.coverage.titles} / ${source.coverage.episodes} | ${source.supportStatus} | ${reason} |`;
  }).join('\n');
  return `# Source coverage\n\n` +
    `Generated from revision-pinned source registries. Do not edit this report manually.\n\n` +
    `## Semantics\n\n` +
    `- **Verified** — numbering basis and runtime binding are both reproducibly proved.\n` +
    `- **Partial** — a proved contract covers only an explicit subset.\n` +
    `- **Unknown** — the implementation or catalog entry exists, but its numbering basis is not proved.\n` +
    `- **Unsupported** — current integration does not expose enough episode metadata for a safe binding.\n\n` +
    `Device verification is tracked separately and is \`not-tested\` for every generated entry.\n\n` +
    `## Totals\n\n` +
    `| Metric | Value |\n|---|---:|\n` +
    `| Discovered sources | ${s.discoveredSources} |\n` +
    `| Source-audited implementations | ${s.sourceAuditedImplementations} |\n` +
    `| Confirmed numbering bases | ${s.confirmedNumberingBasis} |\n` +
    `| Implemented source bindings | ${s.implementedBindings} |\n` +
    `| Unknown | ${s.statuses.unknown} |\n` +
    `| Unsupported | ${s.statuses.unsupported} |\n` +
    `| Source-bound catalog coverage | ${s.sourceBoundCoverage.titles} titles / ${s.sourceBoundCoverage.episodes} episodes |\n` +
    `| Provider conversion inventory (not source coverage) | ${s.providerConversionInventory.titles} titles / ${s.providerConversionInventory.episodes} episodes |\n\n` +
    `The catalog contains ${s.catalog.titles} titles and ${s.catalog.episodes} classified episodes. A provider conversion is counted separately because it cannot be applied until an exact playback source proves the same numbering basis.\n\n` +
    `## Sources\n\n` +
    `| Source ID | Plugin | Module | Numbering basis | Binding | Evidence | Coverage (titles / episodes) | Status | Reason |\n` +
    `|---|---|---|---|---|---|---:|---|---|\n${rows}\n`;
}
