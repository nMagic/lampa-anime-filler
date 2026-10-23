# Versioned data bundles

The runtime data format is defined by [`schemas/data-bundle-v1.schema.json`](../schemas/data-bundle-v1.schema.json). Generate or validate the first pinned provider with:

```bash
node scripts/build-data.mjs --check
node scripts/build-data.mjs --out data/generated/v1
node scripts/build-data.mjs --verify data/generated/v1
```

The committed bundle is published by GitHub Pages at `data/generated/v1/`. Runtime v0.4.1 loads its manifest, verifies the exact index and title-shard bytes with SHA-256, and stores only validated artifacts. If the bundle is unavailable or invalid, the marking-only runtime falls back to a previously validated snapshot and then to the legacy catalog.

Verified TMDB identities and source-specific episode ranges live in `data/mappings/tmdb-tv.v1.json`. The builder validates every range against the classification length and includes the pinned mapping source in the manifest and build id. A seasonal value is usable only when the selected source adapter has an explicit mapping; there is no global `S1 → 0` assumption.
