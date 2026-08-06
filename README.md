# PatchNest KPM Repository

Official verified-release catalog and isolated source workspace for [`PatchNest-Module`](https://github.com/Zhanfg/PatchNest-Module).

## Current status

The public catalog is intentionally empty. The six checked-in C files remain isolated prototypes and are not installable modules. They use Linux loadable-module interfaces rather than the pinned KernelPatch KPM SDK and therefore remain listed only in `drafts.json`.

The previous catalog contained placeholder or nonexistent downloads, including `example.com` URLs and assets under the retired `KPatch-Next-Module` name. Those entries were removed so PatchNest no longer offers broken or unverified installations.

```text
https://raw.githubusercontent.com/Zhanfg/PatchNest-Kpms/main/kpm_repo.json
```

An empty `modules` array is valid. PatchNest WebUI displays that no verified modules are currently available.

## Repository layout

```text
kpm_repo.json                    Verified installable catalog only
drafts.json                      Inventory and status of non-release prototypes
module/kpms/*.c                   Isolated prototype sources
modules/<id>/                     Required source location for a future release
scripts/validate.js               Schema and isolation checks
scripts/verify-release-assets.js  Source/tag/asset/digest verification
.github/workflows/validate.yml    Read-only validation pipeline
CATALOG_CONTRACT.md               Schema v2 and publication contract
AUDIT.md                          Restart findings and release gates
```

Release binaries, packages, and signatures are not committed to the source tree. Verified packages belong in GitHub Releases.

## Catalog schema v2

The top-level catalog records:

- `name`
- `description`
- `version` — currently `2`
- `repository` — the owner/repository that publishes assets
- `catalogUrl` — the canonical raw catalog URL
- `updatedAt` — a real `YYYY-MM-DD` date
- `modules` — verified installable entries only

PatchNest WebUI consumes the `modules` array and ignores the additional top-level provenance fields, so Schema v2 remains compatible with the current client.

Every installable module must include:

- identity: `id`, `name`, `version`, `author`, `description`
- source provenance: `source`, `sourceCommit`
- release provenance: `releaseTag`, `assetName`, `downloadUrl`, `sha256`
- compatibility: `minKpVersion`, `minPatchNestVersion`, `testedKernelRanges`
- policy: `signatureRequired`, `channel`

The complete contract is defined in [`CATALOG_CONTRACT.md`](CATALOG_CONTRACT.md).

## Automated gates

CI validates all `main`, pull-request, and `restart/**` revisions. It fails closed unless all of the following remain true:

1. catalog and draft metadata are normalized and internally consistent;
2. every checked-in prototype is inventoried exactly once as a draft;
3. no draft is simultaneously installable;
4. installable source lives under `modules/<id>/` and uses KernelPatch KPM metadata and entry points;
5. a release tag points to the recorded source commit;
6. the source file exists at that commit and the commit is an ancestor of the tested revision;
7. the GitHub Release URL matches the declared repository, tag, and asset name;
8. the downloaded package is a bounded ZIP and its SHA-256 matches the catalog;
9. stable entries require signatures;
10. `.ko`, `.kpm`, `.zip`, and `.sig` artifacts are not checked into the source tree.

With the current empty production catalog, release download verification exits successfully without downloading anything.

## Draft lifecycle

Allowed draft states are:

- `blocked-sdk-port`
- `awaiting-build-verification`
- `awaiting-device-validation`
- `rejected`

A `blocked-sdk-port` entry must still expose the Linux module interfaces that caused the block and must not simultaneously claim valid KPM entry points. This prevents a changed source file from silently retaining stale status metadata.

## Release boundary

Moving an entry into `kpm_repo.json` is a separate release decision. It requires a source-bearing tag, reproducible package, public digest, compatibility evidence, and real-device recovery testing. The restart work does not port, build, or publish the isolated prototypes.

## License

Source files retain their declared licenses and upstream copyright notices. A module without a confirmed compatible license cannot be released through the catalog.
