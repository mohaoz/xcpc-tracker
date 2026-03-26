# packages/api-contract

Legacy placeholder from the localhost API architecture.

The target product no longer treats a local API as the primary runtime contract. The new contract surface is:

- curated catalog JSON under `catalog/`
- generated frontend dataset artifacts under `generated/`
- local import/export JSON formats validated by root-level `schemas/`

Retain this directory only if we later need extracted TypeScript contract artifacts for generated data or import payloads.
