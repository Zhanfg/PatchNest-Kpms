# PatchNest KPM catalog contract

Contract version: 2

This document defines the boundary between isolated source drafts and modules that PatchNest may offer for installation.

## Top-level document

`kpm_repo.json` must contain:

| Field | Requirement |
|---|---|
| `name` | Non-empty display name |
| `description` | Non-empty catalog description |
| `version` | Integer `2` |
| `repository` | GitHub `owner/repository` identifier |
| `catalogUrl` | Canonical raw URL derived from `repository` and `main` |
| `updatedAt` | Real calendar date in `YYYY-MM-DD` form |
| `modules` | Array of verified installable entries |

The catalog is allowed to contain zero modules.

## Installable entry

Each entry in `modules` must satisfy all categories below.

### Identity

- `id`: unique lowercase kebab-case identifier;
- `name`: non-empty display name;
- `version`: semantic version;
- `author`: non-empty author or maintainer identity;
- `description`: non-empty functional description.

### Source provenance

- `source`: normalized path under `modules/<id>/`;
- `sourceCommit`: lowercase 40-character commit SHA;
- the commit must exist and be an ancestor of the catalog revision;
- the source file must exist at that commit;
- the source must expose `KPM_NAME`, `KPM_VERSION`, `KPM_LICENSE`, `KPM_INIT`, and `KPM_EXIT`;
- the source must not use Linux `module_init`, `module_exit`, or `MODULE_LICENSE` interfaces.

### Release provenance

- `releaseTag`: version-shaped Git tag;
- `assetName`: simple `.zip` filename;
- `downloadUrl`: exact GitHub Release asset URL derived from `repository`, `releaseTag`, and `assetName`;
- `sha256`: lowercase 64-character digest;
- the tag must resolve to `sourceCommit`;
- the public asset must download successfully, remain below 64 MiB, have ZIP magic, and match `sha256`;
- optional `size`, when present, must match the downloaded byte count.

### Compatibility and policy

- `minKpVersion`: semantic version;
- `minPatchNestVersion`: semantic version;
- `testedKernelRanges`: non-empty unique string array;
- `signatureRequired`: boolean;
- `channel`: `experimental` or `stable`;
- every `stable` entry must set `signatureRequired` to `true`.

## Draft inventory

`drafts.json` is not an installable catalog. Every checked-in `module/kpms/*.c` prototype must appear exactly once in `drafts` and must not share an ID with an installable module.

Allowed states:

| State | Meaning |
|---|---|
| `blocked-sdk-port` | Source still uses an incompatible module interface |
| `awaiting-build-verification` | Source form is eligible for build/provenance work but has no verified artifact |
| `awaiting-device-validation` | Build is verified but runtime/recovery evidence is incomplete |
| `rejected` | Source will not be published |

For `blocked-sdk-port`, CI verifies that the source still exposes a Linux loadable-module interface and does not simultaneously expose complete KPM identity and initialization metadata. A source transition therefore requires an explicit inventory-state change.

## Source-tree policy

The repository does not store release artifacts. Tracked files matching the following are rejected:

```text
*.ko
*.kpm
*.zip
*.sig
```

GitHub Releases are the only accepted distribution location for installable packages and signatures.

## Publication sequence

A publication PR must be atomic:

1. add or update source under `modules/<id>/`;
2. add documentation and license provenance;
3. complete static and deterministic build verification;
4. complete device load, control, unload, reboot, safe-mode, and recovery checks;
5. create a source-bearing tag;
6. publish the ZIP and required signature material through GitHub Releases;
7. calculate the public asset SHA-256 and size;
8. add the catalog entry with the exact tag, asset, source commit, compatibility evidence, and channel;
9. remove the corresponding draft entry only when the production entry passes every CI gate.

The tag, release asset, and catalog entry must never be overwritten in place. Corrections use a new version and a new tag.

## Client compatibility

The current PatchNest WebUI reads `data.modules` and the existing module fields. It ignores the new top-level Schema v2 provenance fields, so an empty or populated version-2 catalog remains readable without a client migration.
