# Third-party data notice

## SkipTheFiller Anime Filler List Data

- Source: <https://github.com/animecannonhunter-hash/anime-filler-list-data>
- Pinned revision: `a7b28ff590b70652843125b77b9a80f334d2c3ca`
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Required attribution: <https://skipthefiller.com>

The build pipeline normalizes the source classification into the Lampa Anime Filler schema and records the source revision in every title shard.

## AniBridge Mappings

- Source: <https://github.com/anibridge/anibridge-mappings>
- Generated artifact: `mappings.min.json`
- Schema / generated at: `3.0.3` / `2026-10-22T06:55:54Z`
- SHA-256: `4e2dd941d4962c0997c30cdb69969eb2249276046f1359f6478348fe74f96cfc`
- License: MIT

`mappings.edits.yaml` is only an override layer and is not treated as the complete dataset. The pipeline consumes the full generated artifact, preserves direct descriptor/range evidence in the coverage report, rejects non-unique edges, and stores only the compact generated subset needed at runtime. The mutable `v3` URL is accepted only when its exact digest and metadata match this lock.

`provenance.zip` (SHA-256 `2d03ba9166d78db205d6a81dac63a6becf2db50e836dda17463c5b5c81d93011`) was inspected to distinguish source ingestion, inference, and manual override events. It is not required by the normal compact rebuild.

## anime-offline-database

- Source: <https://github.com/cedya77/anime-offline-database>
- Pinned release: `2026-43`
- Artifact: `anime-offline-database-minified.json`
- SHA-256: `1489835bcf9730e718a51c36f758d8bfe1ee2015a146a4449ba27c603aff9367`
- Database license: Open Data Commons Open Database License 1.0
- Contents license: Database Contents License 1.0

The database supplies exact primary/alternative titles, TV media type, episode counts, years, and confirmed AniDB/AniList/MyAnimeList links. The generated 45-title identity subset and reports retain this attribution and are redistributed under the applicable database terms.

## AniFillerPedia

- Source: <https://github.com/Napandee/AniFillerPedia>
- Code license: MIT
- Dataset license: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International

The project is non-commercial, so this provider is allowed by project policy. Its future adapter and derived bundle must preserve attribution, the NonCommercial restriction and ShareAlike terms. No AniFillerPedia data is included in the first bundle yet.
