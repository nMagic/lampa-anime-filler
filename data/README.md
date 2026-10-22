# Versioned data bundles

The runtime data format is defined by [`schemas/data-bundle-v1.schema.json`](../schemas/data-bundle-v1.schema.json). Generate or validate the first pinned provider with:

```bash
node scripts/build-data.mjs --check
node scripts/build-data.mjs --out data/generated/v1
node scripts/build-data.mjs --verify data/generated/v1
```

The committed bundle is published by GitHub Pages at `data/generated/v1/`. Runtime v0.4.0 loads its manifest, verifies the exact index and title-shard bytes with SHA-256, and stores only validated artifacts. If the bundle is unavailable or invalid, the marking-only runtime falls back to a previously validated snapshot and then to the legacy catalog.
