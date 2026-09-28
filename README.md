# PatchNest KPM Repository

Official KPM catalog and source workspace for [`PatchNest-Module`](https://github.com/Zhanfg/PatchNest-Module).

KernelPatch SDK canonical source: [`Zhanfg/KernelPatch-Public`](https://github.com/Zhanfg/KernelPatch-Public). The legacy `ZhanfgBuild/KernelPatch` predecessor is retained only for provenance and must not be used for new PatchNest builds.

## Current status

The public catalog is intentionally empty while the existing six source files are being ported from Linux kernel-module-style prototypes to the KernelPatch KPM SDK.

The previous catalog contained placeholder or nonexistent downloads, including `example.com` URLs and assets under the retired `KPatch-Next-Module` name. Those entries have been removed so PatchNest no longer offers broken or unverified installations.

```text
https://raw.githubusercontent.com/Zhanfg/PatchNest-Kpms/main/kpm_repo.json
```

An empty `modules` array is valid. PatchNest WebUI will display that no verified modules are currently available.

## Repository layout

```text
kpm_repo.json          Verified, installable catalog only
drafts.json            Inventory and porting status of non-release prototypes
module/kpms/*.c         Existing prototype sources
scripts/validate.js     Catalog and draft consistency checks
.github/workflows/      Validation pipeline
AUDIT.md                Restart audit and release gates
```

## Release policy

A module may enter `kpm_repo.json` only when all of the following are true:

1. It uses KernelPatch KPM metadata and entry points such as `KPM_NAME`, `KPM_VERSION`, `KPM_INIT`, and `KPM_EXIT`.
2. It builds against a pinned commit from the canonical [`Zhanfg/KernelPatch-Public`](https://github.com/Zhanfg/KernelPatch-Public) KPM SDK.
3. The produced file is an ARM64 KPM artifact, not a Linux `.ko` module.
4. The release asset has a 64-character SHA-256 recorded in the catalog.
5. The download URL is a real HTTPS GitHub Release asset.
6. Load, control, unload, reboot persistence, and failure recovery have been tested on a supported device.

## Catalog contract

Every installable module must include:

- `id`
- `name`
- `version`
- `author`
- `description`
- `downloadUrl`
- `sha256`
- `minKpVersion`
- `minPatchNestVersion`
- `sourceCommit`
- `testedKernelRanges`
- `signatureRequired`
- `channel`

`channel` is either `experimental` or `stable`. Draft prototypes never appear in the installable catalog.

## License

Source files retain their declared licenses and upstream copyright notices. A module without a confirmed compatible license cannot be released through the catalog.
