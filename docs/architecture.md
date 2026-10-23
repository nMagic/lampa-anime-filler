# Architecture

This document records the target architecture after the v0.3.0 audit. It is intentionally incremental: the verified Online_Mod marking path stays in place until each replacement layer has its own regression and device tests.

## Safety invariants

1. Unknown anime identity, numbering or classification means `unknown`, never `canon` or `filler`.
2. Fuzzy title matching cannot authorize marking or playback changes.
3. Multi-episode files, packs, unknown season offsets, OVA and specials are not coerced into regular absolute episodes.
4. Automatic skipping remains disabled until the data, resolver, mapper and source adapter all return verified results.
5. A failed update may fall back only to an older bundle that already passed validation.

## Components

### Build-time data pipeline

Inputs are pinned by revision. Every provider has an explicit license, attribution and provenance record. The builder rejects unknown statuses, duplicate slugs/episodes, gaps in a regular absolute sequence and inconsistent episode totals. It emits:

- `manifest.json` — schema/build/source metadata and index checksum;
- `index.json` — compact identities and per-title shard locations;
- `titles/{slug}.json` — one classification shard per title.

The first provider is the CC BY 4.0 SkipTheFiller snapshot. AniFillerPedia is an approved non-commercial provider for the next provider adapter; its CC BY-NC-SA data must retain attribution and ShareAlike terms in a separate source record. Public data and architecture from projects without an explicit license may be integrated, but their source code is not copied verbatim.

### Data Provider (implemented in v0.4.0)

Runtime loads the manifest, then the index and only the selected title shard. The index and shard are checked with SHA-256 before parsing; the built-in synchronous implementation also works when an older TV WebView lacks Web Crypto. Cache keys include schema version, build id, canonical title id and shard checksum. A timeout or malformed response cannot replace a valid cached bundle. The previous validated catalog remains available as a rollback snapshot.

### Anime Resolver

Resolution order:

1. exact TMDB TV id;
2. exact IMDb/TVDB id;
3. exact AniList/MAL/AniDB id;
4. explicit user mapping;
5. verified provider alias.

Title-only candidates may be shown in diagnostics for manual confirmation but do not have verified confidence. Movies, TV series and specials have separate identities.

### Episode Mapper

The mapper receives structured adapter context: source adapter id, canonical title id, numbering basis, season, episode, absolute episode and file range. Provider ranges (`tmdb`, `tvdb`) are independent from source bindings (`online_mod:cdnvideohub`, `bwa`, and so on); a seasonal position is usable only when the exact adapter is bound to a proved basis. An adapter-labelled absolute field is also rejected unless that exact adapter has an `absolute-field` contract. Runtime v0.4.1 captures the Online_Mod balancer and intentionally leaves its seasonal rows and BWA/Lampac values unknown until each basis and metadata surface are proved. Ambiguity returns `unknown`.

### Source inventory and contracts

The build-time source inventory parses the actual Online_Mod `Balancers` registry, every Lampac NextGen `Modules/Online*/manifest.json`, and online-playback endpoints from the Lampac extension catalog. It records pinned revisions, availability expressions, metadata exposure, evidence, status and per-source coverage. `contracts.v1.json` is generated only from evidence-backed entries. Its generic contract kinds are `provider-seasonal` and `absolute-field`, so adding a source that conforms to an existing contract does not add mapper code. An unclassified new entry changes the generated inventory and must be reviewed; it never inherits another source's basis.

### Lampa Adapter

Each source adapter owns metadata capture, row observation and playlist context. Priority is public structured events, then structured template payload, then a scoped DOM fallback. Adapter order starts with Online_Mod, followed by BWA, MODS, Showy and TorrServer. The existing `Lampa.Template.get` wrapper remains a compatibility fallback until Online_Mod has an equally reliable public event path.

### Playback Controller

Rollout order is dry-run diagnostics, manual skip, then explicit opt-in automatic skip. Automatic skip is off by default and requires verified anime identity, exact episode mapping, trusted non-stale classification and a known next allowed playlist item. On any error playback continues normally.

## Data policy

The project is non-commercial. Non-commercial and ShareAlike datasets are acceptable when their attribution and redistribution requirements are preserved. Provider quality is evaluated independently from licensing: a permitted source can still be rejected for wrong mappings, stale coverage or ambiguous numbering.

## Current implementation boundary

Version 0.4.1 publishes and consumes the versioned SkipTheFiller bundle plus a generated compact cross-ID/provider mapping. The build pipeline checks the full 45-title catalog against pinned AniBridge and anime-offline-database artifacts and emits explicit partial/ambiguous outcomes. Resolver confidence is intentionally narrow: exact TMDB TV id, explicit user mapping, or a verified alias. The current source inventory contains 102 entries but zero evidence-backed runtime bindings: Online_Mod exposes provider-owned seasonal values without a proved external basis, while Lampac's public row template omits its internal season/episode. Automatic skipping is still absent, and LG webOS must be tested again after deployment; BWA, Tizen and Android TV remain separate device tests.
