# Versioned data bundles

The runtime data format is defined by [`schemas/data-bundle-v1.schema.json`](../schemas/data-bundle-v1.schema.json). Generate or validate the first pinned provider with:

```bash
node scripts/build-data.mjs --check
node scripts/build-data.mjs --out data/generated
```

Generated bundles are intentionally not consumed by runtime v0.3.0 yet. They become the source for a later Data Provider change after checksum, cache and compatibility tests are in place.
