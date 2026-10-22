# Third-party data notice

## SkipTheFiller Anime Filler List Data

- Source: <https://github.com/animecannonhunter-hash/anime-filler-list-data>
- Pinned revision: `a7b28ff590b70652843125b77b9a80f334d2c3ca`
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Required attribution: <https://skipthefiller.com>

The build pipeline normalizes the source classification into the Lampa Anime Filler schema and records the source revision in every title shard.

## AniBridge Mappings

- Source: <https://github.com/anibridge/anibridge-mappings>
- Pinned revision: `b9e7e129b21db37e0279c6458ac7d191f4ec1663`
- Mapping file: `mappings.edits.yaml`
- License: MIT

The build-time mapping uses the pinned TMDB identities and season ranges for One Piece, Naruto and Naruto Shippuden. Bleach season 2 is assembled from the pinned cour mappings; Bleach TMDB identity `30984` and the Online_Mod `S1 E366` numbering behavior were additionally verified against the supplied LG webOS diagnostic. The curated subset is stored in `data/mappings/tmdb-tv.v1.json`.

## AniFillerPedia

- Source: <https://github.com/Napandee/AniFillerPedia>
- Code license: MIT
- Dataset license: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International

The project is non-commercial, so this provider is allowed by project policy. Its future adapter and derived bundle must preserve attribution, the NonCommercial restriction and ShareAlike terms. No AniFillerPedia data is included in the first bundle yet.
