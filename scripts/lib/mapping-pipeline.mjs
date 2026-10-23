import { createHash } from 'node:crypto';

export const PIPELINE_SCHEMA_VERSION = 1;

export const UPSTREAM = Object.freeze({
  anibridge: Object.freeze({
    id: 'anibridge',
    name: 'AniBridge generated mappings',
    url: 'https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json',
    repository: 'https://github.com/anibridge/anibridge-mappings',
    revision: 'schema-3.0.3-generated-2026-10-22T06:55:54Z',
    sha256: '4e2dd941d4962c0997c30cdb69969eb2249276046f1359f6478348fe74f96cfc',
    license: 'MIT',
    attribution: 'Generated AniBridge v3 mappings; exact artifact digest is pinned because the v3 release tag is mutable.'
  }),
  animeOfflineDatabase: Object.freeze({
    id: 'anime-offline-database',
    name: 'anime-offline-database',
    url: 'https://github.com/cedya77/anime-offline-database/releases/download/2026-43/anime-offline-database-minified.json',
    repository: 'https://github.com/cedya77/anime-offline-database',
    revision: '2026-43',
    sha256: '1489835bcf9730e718a51c36f758d8bfe1ee2015a146a4449ba27c603aff9367',
    license: 'ODbL-1.0 / DbCL-1.0',
    attribution: 'Metadata and cross-database identifiers from anime-offline-database release 2026-43.'
  })
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : compareText(String(a), String(b)));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function qualifiedTitle(value) {
  const match = /^(.*)\s+\((19|20)\d{2}\)\s*$/.exec(String(value || ''));
  return match ? { title: normalizeTitle(match[1]), year: Number(match[0].match(/\d{4}/)[0]) } : null;
}

function coreIds(entry) {
  const result = {};
  for (const source of entry.sources || []) {
    let match;
    let provider;
    if ((match = /^https:\/\/anidb\.net\/anime\/(\d+)(?:[/?#]|$)/.exec(source))) provider = 'anidb';
    else if ((match = /^https:\/\/anilist\.co\/anime\/(\d+)(?:[/?#]|$)/.exec(source))) provider = 'anilist';
    else if ((match = /^https:\/\/myanimelist\.net\/anime\/(\d+)(?:[/?#]|$)/.exec(source))) provider = 'mal';
    if (provider) {
      const value = Number(match[1]);
      if (Number.isSafeInteger(value) && value > 0) result[provider] = value;
    }
  }
  return result;
}

function sourceDescriptors(entry) {
  const ids = coreIds(entry);
  const descriptors = [];
  if (ids.anilist) descriptors.push(`anilist:${ids.anilist}`);
  if (ids.mal) descriptors.push(`mal:${ids.mal}`);
  if (ids.anidb) descriptors.push(`anidb:${ids.anidb}:R`);
  return descriptors;
}

function parseShowDescriptor(value) {
  const match = /^(tmdb_show|tvdb_show|imdb_show):([^:]+):s(\d+)$/.exec(value);
  if (!match) return null;
  const season = Number(match[3]);
  if (!Number.isSafeInteger(season) || season < 0) return null;
  if (match[1] === 'imdb_show') {
    if (!/^tt\d+$/.test(match[2])) return null;
    return { provider: match[1], id: match[2], season };
  }
  if (!/^\d+$/.test(match[2])) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return { provider: match[1], id, season };
}

function parseRange(value, cap) {
  const match = /^(\d+)(?:-(\d*)?)?$/.exec(String(value));
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : match[2] ? Number(match[2]) : cap;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return null;
  return { start, end };
}

function directMappings(entry, mappings) {
  const result = [];
  for (const source of sourceDescriptors(entry)) {
    const targets = mappings[source];
    if (!targets || typeof targets !== 'object') continue;
    for (const [target, ranges] of Object.entries(targets)) {
      const descriptor = parseShowDescriptor(target);
      if (descriptor) result.push({ source, target, descriptor, ranges });
    }
  }
  return result;
}

function candidateRecord(entry, mappings, matchedBy) {
  const ids = coreIds(entry);
  const direct = directMappings(entry, mappings);
  const external = { anidb: ids.anidb || null, anilist: ids.anilist || null, mal: ids.mal || null };
  for (const provider of ['tmdb_show', 'tvdb_show', 'imdb_show']) {
    external[provider] = unique(direct.filter(item => item.descriptor.provider === provider).map(item => item.descriptor.id));
  }
  return {
    title: entry.title,
    mediaType: entry.type,
    episodes: Number(entry.episodes) || 0,
    year: Number(entry.animeSeason && entry.animeSeason.year) || null,
    matchedBy,
    ids: external,
    descriptors: sourceDescriptors(entry),
    directMappings: direct.map(item => ({ source: item.source, target: item.target, ranges: item.ranges }))
      .sort((a, b) => compareText(`${a.source}|${a.target}`, `${b.source}|${b.target}`))
  };
}

function findCandidates(show, database, mappings) {
  const normalized = normalizeTitle(show.title);
  const qualified = qualifiedTitle(show.title);
  const results = [];
  for (const entry of database.data || []) {
    if (entry.type !== 'TV') continue;
    const primary = normalizeTitle(entry.title);
    const aliases = (entry.synonyms || []).map(normalizeTitle);
    let matchedBy = '';
    if (primary === normalized) matchedBy = 'exact-primary-title';
    else if (aliases.includes(normalized)) matchedBy = 'exact-alternative-title';
    else if (qualified && primary === qualified.title && Number(entry.animeSeason && entry.animeSeason.year) === qualified.year) {
      matchedBy = 'exact-title-and-year';
    }
    if (!matchedBy) continue;
    const ids = coreIds(entry);
    if (Object.keys(ids).length < 1) continue;
    results.push(candidateRecord(entry, mappings, matchedBy));
  }
  return results.sort((a, b) => a.year - b.year || compareText(a.title, b.title) || a.episodes - b.episodes);
}

function tmdbIds(candidate) {
  return candidate.ids.tmdb_show || [];
}

function chooseCandidates(show, candidates) {
  if (!candidates.length) return { identityStatus: 'unresolved', selected: [], reason: 'No exact TV title, alternative-title, or title+year match with a database identifier.' };
  const exactCount = candidates.filter(candidate => candidate.episodes === show.episodes.length && tmdbIds(candidate).length === 1);
  if (exactCount.length === 1) {
    return { identityStatus: 'verified', selected: exactCount, method: 'exact-title-and-episode-count-with-direct-anibridge-link' };
  }
  if (exactCount.length > 1) {
    const ids = unique(exactCount.flatMap(tmdbIds));
    if (ids.length === 1) return { identityStatus: 'verified', selected: exactCount, method: 'exact-count-tmdb-consensus' };
    return { identityStatus: 'ambiguous', selected: [], reason: `Multiple exact-count candidates resolve to different TMDB shows: ${ids.join(', ')}.` };
  }

  const mapped = candidates.filter(candidate => tmdbIds(candidate).length > 0);
  const ids = unique(mapped.flatMap(tmdbIds));
  if (ids.length === 1) {
    return { identityStatus: 'verified', selected: mapped, method: 'exact-title-cross-id-tmdb-consensus' };
  }
  if (ids.length > 1) {
    const sum = candidates.reduce((total, candidate) => total + candidate.episodes, 0);
    if (sum === show.episodes.length) {
      return { identityStatus: 'partial', selected: candidates, reason: 'The catalog entry aggregates exact-title series that have different TMDB show IDs.' };
    }
    return { identityStatus: 'ambiguous', selected: [], reason: `Exact-title candidates conflict on TMDB show ID (${ids.join(', ')}) and episode counts do not prove composition.` };
  }
  if (candidates.length === 1 && candidates[0].descriptors.length >= 2) {
    return { identityStatus: 'partial', selected: candidates, reason: 'Anime identity is cross-linked, but AniBridge has no direct TMDB TV mapping.' };
  }
  return { identityStatus: 'unresolved', selected: [], reason: 'Candidates lack a unique direct TMDB TV relationship.' };
}

function collectExternalIds(selected) {
  const result = { anidb: [], anilist: [], mal: [], tmdbTv: [], tvdb: [], imdb: [] };
  for (const candidate of selected) {
    if (candidate.ids.anidb) result.anidb.push(candidate.ids.anidb);
    if (candidate.ids.anilist) result.anilist.push(candidate.ids.anilist);
    if (candidate.ids.mal) result.mal.push(candidate.ids.mal);
    result.tmdbTv.push(...candidate.ids.tmdb_show);
    result.tvdb.push(...candidate.ids.tvdb_show);
    result.imdb.push(...candidate.ids.imdb_show);
  }
  return Object.fromEntries(Object.entries(result).map(([provider, values]) => [provider, unique(values)]));
}

function isBaseCandidate(candidate, selected) {
  const earliestYear = Math.min(...selected.map(item => item.year || 9999));
  if ((candidate.year || 9999) !== earliestYear) return false;
  return !/(?:\b(?:season|part|cour|final)\b|\b[2-9](?:nd|rd|th)\b|\bhallow\b|\bshippuuden\b|\b20\d{2}\b)/i.test(candidate.title);
}

function extractProviderRanges(show, selected, provider, mediaId) {
  const episodeCount = show.episodes.length;
  const ranges = [];
  const conflicts = [];
  for (const candidate of selected) {
    const anchor = candidate.episodes >= episodeCount || isBaseCandidate(candidate, selected);
    for (const mapping of candidate.directMappings) {
      const descriptor = parseShowDescriptor(mapping.target);
      if (!descriptor || descriptor.provider !== provider || String(descriptor.id) !== String(mediaId) || descriptor.season === 0) continue;
      for (const [sourceText, targetText] of Object.entries(mapping.ranges || {})) {
        const cap = Math.max(episodeCount, candidate.episodes || 0);
        const source = parseRange(sourceText, cap);
        const target = parseRange(targetText, cap);
        if (!source || !target || source.end - source.start !== target.end - target.start) {
          conflicts.push(`${mapping.source} -> ${mapping.target} has an unsupported range ${sourceText}:${targetText}`);
          continue;
        }
        let absoluteStart = null;
        let proof = '';
        if (anchor) {
          absoluteStart = source.start;
          proof = candidate.episodes === episodeCount ? 'single-entry-exact-count' : 'single-entry-catalog-prefix';
        } else if (provider === 'tmdb_show' && target.start > source.start) {
          absoluteStart = target.start;
          proof = 'tmdb-absolute-candidate';
        }
        if (absoluteStart === null) continue;
        const maxLength = episodeCount - absoluteStart + 1;
        if (maxLength <= 0) continue;
        const length = Math.min(target.end - target.start + 1, maxLength);
        ranges.push({
          season: descriptor.season,
          episodeStart: target.start,
          episodeEnd: target.start + length - 1,
          absoluteStart,
          proof,
          evidence: `${mapping.source} -> ${mapping.target} ${sourceText}:${targetText}`
        });
      }
    }
  }

  const byKey = new Map();
  for (const range of ranges) {
    const key = `${range.season}:${range.episodeStart}:${range.episodeEnd}:${range.absoluteStart}:${range.evidence}`;
    if (!byKey.has(key)) byKey.set(key, range);
  }
  const deduped = [...byKey.values()].sort((a, b) => a.season - b.season || a.episodeStart - b.episodeStart || a.absoluteStart - b.absoluteStart);
  const pairVotes = new Map();
  for (const range of deduped) {
    for (let offset = 0; offset <= range.episodeEnd - range.episodeStart; offset += 1) {
      const providerKey = `${range.season}:${range.episodeStart + offset}`;
      const absolute = range.absoluteStart + offset;
      const key = `${providerKey}:${absolute}`;
      const vote = pairVotes.get(key) || { providerKey, absolute, proofs: new Set(), evidence: new Set(), votes: 0 };
      vote.votes += 1;
      vote.proofs.add(range.proof);
      vote.evidence.add(range.evidence);
      pairVotes.set(key, vote);
    }
  }

  const votes = [...pairVotes.values()];
  function strictWinner(item, group) {
    const alternatives = group.filter(other => other !== item);
    return alternatives.every(other => item.votes > other.votes);
  }
  const winners = votes.filter(vote => {
    const sameProviderEpisode = votes.filter(other => other.providerKey === vote.providerKey);
    const sameAbsoluteEpisode = votes.filter(other => other.absolute === vote.absolute);
    const winner = strictWinner(vote, sameProviderEpisode) && strictWinner(vote, sameAbsoluteEpisode);
    if (!winner && (sameProviderEpisode.length > 1 || sameAbsoluteEpisode.length > 1)) {
      conflicts.push(`Conflicting ${provider} candidates in season ${vote.providerKey.split(':')[0]}; only strict-consensus edges were applied.`);
    }
    return winner;
  });
  // Candidate-only TMDB offsets are accepted only as part of a gap-free prefix.
  const absoluteEpisodes = new Set(winners.map(vote => vote.absolute));
  let prefix = 0;
  while (absoluteEpisodes.has(prefix + 1)) prefix += 1;
  const finalVotes = winners.filter(vote => !vote.proofs.has('tmdb-absolute-candidate') || vote.absolute <= prefix);
  const finalEpisodes = new Set();
  const finalProviderEpisodes = new Map();
  const finalEvidence = new Set();
  for (const vote of finalVotes) {
    finalEpisodes.add(vote.absolute);
    finalProviderEpisodes.set(vote.providerKey, vote.absolute);
    for (const item of vote.evidence) finalEvidence.add(item);
  }
  const seasons = {};
  const seasonNumbers = unique([...finalProviderEpisodes.keys()].map(key => Number(key.split(':')[0])));
  for (const season of seasonNumbers) {
    const episodes = [...finalProviderEpisodes.entries()]
      .filter(([key]) => Number(key.split(':')[0]) === season)
      .map(([key, absolute]) => ({ episode: Number(key.split(':')[1]), absolute }))
      .sort((a, b) => a.episode - b.episode);
    const compressed = [];
    for (const item of episodes) {
      const last = compressed[compressed.length - 1];
      if (last && item.episode === last.episodeEnd + 1 && item.absolute === last.absoluteStart + last.episodeEnd - last.episodeStart + 1) {
        last.episodeEnd = item.episode;
      } else compressed.push({ episodeStart: item.episode, episodeEnd: item.episode, absoluteStart: item.absolute });
    }
    seasons[season] = compressed;
  }
  return {
    provider,
    mediaId,
    seasons,
    coveredEpisodes: [...finalEpisodes].sort((a, b) => a - b),
    evidence: [...finalEvidence].sort(compareText),
    conflicts: unique(conflicts)
  };
}

function compactRanges(numbers) {
  if (!numbers.length) return [];
  const result = [];
  let start = numbers[0], end = numbers[0];
  for (const number of numbers.slice(1)) {
    if (number === end + 1) end = number;
    else { result.push(start === end ? String(start) : `${start}-${end}`); start = end = number; }
  }
  result.push(start === end ? String(start) : `${start}-${end}`);
  return result;
}

function aliasesFor(show, selected) {
  return unique(selected.map(candidate => candidate.title).filter(title => normalizeTitle(title) !== normalizeTitle(show.title))).slice(0, 8);
}

function resolveTitle(show, database, mappings) {
  const candidates = findCandidates(show, database, mappings);
  const choice = chooseCandidates(show, candidates);
  const selected = choice.selected;
  const externalIds = collectExternalIds(selected.length ? selected : candidates);
  const providerMappings = {};
  const providerCoveredEpisodes = [];
  const mappingConflicts = [];
  if (choice.identityStatus === 'verified' && externalIds.tmdbTv.length === 1) {
    for (const [basis, provider, ids] of [
      ['tmdb', 'tmdb_show', externalIds.tmdbTv],
      ['tvdb', 'tvdb_show', externalIds.tvdb]
    ]) {
      if (ids.length !== 1) continue;
      const mapping = extractProviderRanges(show, selected, provider, ids[0]);
      mappingConflicts.push(...mapping.conflicts);
      if (mapping.coveredEpisodes.length) providerMappings[basis] = {
        mediaId: mapping.mediaId,
        seasons: mapping.seasons,
        evidence: mapping.evidence,
        coveredAbsoluteRanges: compactRanges(mapping.coveredEpisodes)
      };
      providerCoveredEpisodes.push(...mapping.coveredEpisodes);
    }
  }
  const covered = unique(providerCoveredEpisodes);
  const unresolved = [];
  for (let number = 1; number <= show.episodes.length; number += 1) if (!covered.includes(number)) unresolved.push(number);
  let episodeStatus = covered.length === show.episodes.length ? 'verified' : covered.length ? 'partial' : 'unresolved';
  if (choice.identityStatus === 'ambiguous') episodeStatus = 'ambiguous';
  if (choice.identityStatus === 'partial' && externalIds.tmdbTv.length > 1) episodeStatus = 'unsupported';
  const status = choice.identityStatus === 'verified' && episodeStatus === 'verified' ? 'verified'
    : choice.identityStatus === 'ambiguous' ? 'ambiguous'
      : choice.identityStatus === 'unresolved' ? 'unresolved'
        : episodeStatus === 'unsupported' ? 'unsupported' : 'partial';
  const reason = choice.reason || (episodeStatus === 'partial'
    ? 'Identity is verified, but AniBridge proves only a subset of the catalog absolute numbering.'
    : episodeStatus === 'unresolved' ? 'Identity is verified, but no conflict-free episode conversion was proved.' : '');
  return {
    canonicalId: `skipthefiller:${show.slug}`,
    slug: show.slug,
    title: show.title,
    classifiedEpisodes: show.episodes.length,
    status,
    identity: {
      status: choice.identityStatus,
      method: choice.method || null,
      mediaType: 'series',
      externalIds,
      candidates: candidates.map(candidate => ({
        title: candidate.title,
        mediaType: candidate.mediaType,
        episodes: candidate.episodes,
        year: candidate.year,
        matchedBy: candidate.matchedBy,
        ids: candidate.ids,
        descriptors: candidate.descriptors
      })),
      selectedDescriptors: unique(selected.flatMap(candidate => candidate.descriptors)),
      source: ['anime-offline-database', 'anibridge'],
      reason: choice.reason || null
    },
    episodeMapping: {
      status: episodeStatus,
      verifiedEpisodes: covered.length,
      unresolvedEpisodes: unresolved.length,
      verifiedAbsoluteRanges: compactRanges(covered),
      unresolvedAbsoluteRanges: compactRanges(unresolved),
      supportedNumberingBasis: ['absolute', ...Object.keys(providerMappings)],
      providerMappings,
      conflicts: unique(mappingConflicts),
      reason: reason || null
    },
    sourceApplicability: {
      'bwa:absolute_episode': choice.identityStatus === 'verified' && externalIds.tmdbTv.length === 1 ? show.episodes.length : 0,
      'online_mod:seasonal': 0,
      'lampa_online:seasonal': 0,
      'unknown:seasonal': 0
    },
    aliases: aliasesFor(show, selected)
  };
}

export function computeStatistics(titles) {
  const classificationEpisodes = titles.reduce((sum, title) => sum + title.classifiedEpisodes, 0);
  const verifiedEpisodeNumbers = titles.reduce((sum, title) => sum + title.episodeMapping.verifiedEpisodes, 0);
  const identity = Object.fromEntries(['verified', 'partial', 'unresolved', 'ambiguous'].map(status =>
    [status, titles.filter(title => title.identity.status === status).length]));
  const episodeMappings = Object.fromEntries(['verified', 'partial', 'unresolved', 'ambiguous', 'unsupported'].map(status =>
    [status, titles.filter(title => title.episodeMapping.status === status).length]));
  const adapterCoverage = {};
  for (const adapter of ['bwa:absolute_episode', 'online_mod:seasonal', 'lampa_online:seasonal', 'unknown:seasonal']) {
    adapterCoverage[adapter] = {
      titles: titles.filter(title => title.sourceApplicability[adapter] > 0).length,
      episodes: titles.reduce((sum, title) => sum + title.sourceApplicability[adapter], 0)
    };
  }
  return {
    classification: { titles: titles.length, episodes: classificationEpisodes },
    identity,
    episodeMappings,
    episodeConversion: { verifiedEpisodes: verifiedEpisodeNumbers, unresolvedEpisodes: classificationEpisodes - verifiedEpisodeNumbers },
    adapterCoverage,
    ambiguousTitles: titles.filter(title => title.status === 'ambiguous').length
  };
}

export function createEvidence(catalog, database, mappings) {
  invariant(Array.isArray(catalog) && catalog.length, 'catalog must be a non-empty array');
  invariant(database && Array.isArray(database.data), 'invalid anime-offline-database input');
  invariant(mappings && mappings.$meta && mappings.$meta.schema_version, 'invalid AniBridge mappings input');
  const titles = catalog.map(show => {
    invariant(show && show.slug && show.title && Array.isArray(show.episodes), 'invalid catalog entry');
    return resolveTitle(show, database, mappings);
  }).sort((a, b) => compareText(a.slug, b.slug));
  return {
    schemaVersion: PIPELINE_SCHEMA_VERSION,
    generatedAt: '2026-10-22T06:55:54.000Z',
    sources: UPSTREAM,
    semantics: {
      verified: 'Unique TV identity and complete, conflict-free provider episode conversion.',
      partial: 'Identity or episode conversion is verified only for a proper subset.',
      unresolved: 'No reproducible exact-match identity or episode conversion was found.',
      ambiguous: 'Multiple plausible identities conflict; none is selected.',
      unsupported: 'Identity is understood, but the catalog aggregates structures not safely representable by one runtime identity.'
    },
    titles,
    statistics: computeStatistics(titles)
  };
}

export function runtimeIdentities(evidence) {
  const result = {};
  for (const title of evidence.titles) {
    const ids = {};
    const external = title.identity.externalIds;
    if (title.identity.status === 'verified') {
      if (external.tmdbTv.length === 1) ids.tmdbTv = external.tmdbTv[0];
      if (external.anilist.length === 1) ids.anilist = external.anilist[0];
      if (external.mal.length === 1) ids.mal = external.mal[0];
      if (external.anidb.length === 1) ids.anidb = external.anidb[0];
      if (external.tvdb.length === 1) ids.tvdb = external.tvdb[0];
      if (external.imdb.length === 1) ids.imdb = external.imdb[0];
    }
    const providerMappings = {};
    for (const [basis, mapping] of Object.entries(title.episodeMapping.providerMappings)) {
      providerMappings[basis] = { mediaId: mapping.mediaId, seasons: mapping.seasons };
    }
    result[title.slug] = { ids, aliases: title.aliases };
    if (Object.keys(providerMappings).length) result[title.slug].providerMappings = providerMappings;
  }
  return result;
}

export function renderCoverageMarkdown(evidence) {
  const stats = evidence.statistics;
  const lines = [
    '# Mapping coverage', '',
    `Generated from pinned AniBridge and anime-offline-database artifacts at ${evidence.generatedAt}.`, '',
    '## Status semantics', ''
  ];
  for (const [status, meaning] of Object.entries(evidence.semantics)) lines.push(`- **${status}** — ${meaning}`);
  lines.push('', '## Summary', '', '| Dimension | Result |', '|---|---:|',
    `| Classification | ${stats.classification.titles} titles / ${stats.classification.episodes} episodes |`,
    `| Verified identities | ${stats.identity.verified} |`,
    `| Partial identities | ${stats.identity.partial} |`,
    `| Unresolved identities | ${stats.identity.unresolved} |`,
    `| Ambiguous identities | ${stats.identity.ambiguous} |`,
    `| Complete episode mappings | ${stats.episodeMappings.verified} |`,
    `| Partial episode mappings | ${stats.episodeMappings.partial} |`,
    `| Verified episode conversions | ${stats.episodeConversion.verifiedEpisodes} |`,
    `| Unresolved episode conversions | ${stats.episodeConversion.unresolvedEpisodes} |`,
    '', '## Viewing-source coverage', '', '| Source and basis | Titles | Episodes |', '|---|---:|---:|');
  for (const [adapter, coverage] of Object.entries(stats.adapterCoverage)) lines.push(`| ${adapter} | ${coverage.titles} | ${coverage.episodes} |`);
  lines.push('', '> Provider mappings do not imply an Online_Mod or BWA seasonal mapping. A source adapter is counted only when its numbering basis is independently established.', '',
    '## Catalog audit', '',
    '| Title | Episodes | Identity | TMDB TV | Episode mapping | Verified | Basis | Reason |',
    '|---|---:|---|---|---|---:|---|---|');
  for (const title of evidence.titles) {
    const tmdb = title.identity.externalIds.tmdbTv.join(', ') || '—';
    const basis = title.episodeMapping.supportedNumberingBasis.join(', ');
    const reason = (title.episodeMapping.reason || title.identity.reason || '').replace(/\|/g, '\\|');
    lines.push(`| ${title.title} | ${title.classifiedEpisodes} | ${title.identity.status} | ${tmdb} | ${title.episodeMapping.status} | ${title.episodeMapping.verifiedEpisodes} | ${basis} | ${reason || '—'} |`);
  }
  lines.push('', '## Reproduction', '',
    '- `node scripts/build-mappings.mjs --refresh` downloads and checksum-verifies the pinned upstream artifacts, analyzes every catalog entry, and rewrites generated evidence, runtime mappings, and both reports.',
    '- `node scripts/build-mappings.mjs --verify` regenerates the compact runtime mapping and reports from committed evidence and fails on omitted titles or stale artifacts.',
    '- The mutable AniBridge `v3` URL is never trusted by name alone: its SHA-256 and `$meta` values must match the lock.', '');
  return `${lines.join('\n')}\n`;
}
