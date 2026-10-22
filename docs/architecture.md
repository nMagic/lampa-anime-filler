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

The mapper receives structured adapter context: source adapter id, canonical title id, numbering basis, season, episode, absolute episode and file range. It prefers a verified absolute number; seasonal positions require an explicit mapping for the exact adapter and title. Runtime v0.4.1 implements validated TMDB ranges for Online_Mod and intentionally leaves BWA season/episode values unknown until its numbering is device-verified. Mappings should pass a reverse/round-trip check when both directions exist. Ambiguity returns `unknown`.

### Lampa Adapter

Each source adapter owns metadata capture, row observation and playlist context. Priority is public structured events, then structured template payload, then a scoped DOM fallback. Adapter order starts with Online_Mod, followed by BWA, MODS, Showy and TorrServer. The existing `Lampa.Template.get` wrapper remains a compatibility fallback until Online_Mod has an equally reliable public event path.

### Playback Controller

Rollout order is dry-run diagnostics, manual skip, then explicit opt-in automatic skip. Automatic skip is off by default and requires verified anime identity, exact episode mapping, trusted non-stale classification and a known next allowed playlist item. On any error playback continues normally.

## Data policy

The project is non-commercial. Non-commercial and ShareAlike datasets are acceptable when their attribution and redistribution requirements are preserved. Provider quality is evaluated independently from licensing: a permitted source can still be rejected for wrong mappings, stale coverage or ambiguous numbering.

## Current implementation boundary

Version 0.4.1 publishes and consumes the versioned SkipTheFiller bundle plus a pinned build-time TMDB mapping. Resolver confidence is intentionally narrow: exact TMDB TV id, explicit user mapping, or a verified alias. Online_Mod structured rows carry an adapter id into the source-aware mapper; BWA is accepted only when it provides an explicit absolute episode. Automatic skipping is still absent, and LG webOS must be tested again after deployment; BWA, Tizen and Android TV remain separate device tests.
