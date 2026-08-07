# PatchNest KPM Repository

Official KPM catalog and source workspace for [`PatchNest-Module`](https://github.com/Zhanfg/PatchNest-Module).

## Current status

The public installable catalog is intentionally empty. The six historical sources under `module/kpms/` remain non-release drafts because they are Linux kernel-module-style prototypes rather than verified KernelPatch KPMs.

The previous catalog contained placeholder or nonexistent downloads. Those entries have been removed so PatchNest no longer offers broken or unverified installations.

```text
https://raw.githubusercontent.com/Zhanfg/PatchNest-Kpms/main/kpm_repo.json
```

An empty `modules` array is valid. PatchNest WebUI will display that no verified modules are currently available.

## Verified-build baseline

`modules/diagnostic-hello/` is a deliberately non-invasive KPM candidate used only to validate the build and provenance chain. It performs no hooks, hiding, policy changes, boot-state changes, or persistence.

CI builds it against the pinned KernelPatch SDK commit, verifies the Arm toolchain archive, inspects the relocatable ARM64 ELF, rejects writable-executable and PLT/GOT sections, and uploads the artifact with a provenance manifest. It remains `build-only` and is not added to `kpm_repo.json` until physical load/control/unload testing is recorded.

## Repository layout

```text
kpm_repo.json                    Verified, installable catalog only
drafts.json                      Inventory and porting status of historical prototypes
module/kpms/*.c                   Historical non-release prototype sources
modules/diagnostic-hello/         Safe build/lifecycle baseline candidate
scripts/validate.js               Catalog and draft consistency checks
.github/workflows/validate.yml    Catalog validation
.github/workflows/build-diagnostic.yml
                                  Pinned diagnostic KPM build and ELF inspection
AUDIT.md                          Restart audit and release gates
```

## Release policy

A module may enter `kpm_repo.json` only when all of the following are true:

1. It uses KernelPatch KPM metadata and entry points such as `KPM_NAME`, `KPM_VERSION`, `KPM_INIT`, and `KPM_EXIT`.
2. It builds against a pinned KernelPatch KPM SDK commit and verified compiler archive.
3. The produced file is a relocatable ARM64 KPM artifact, not a Linux `.ko` module.
4. The artifact contains no unexpected writable-executable or PLT/GOT sections.
5. The release asset has a 64-character SHA-256 recorded in the catalog.
6. The download URL is a real HTTPS GitHub Release asset.
7. Load, control, unload, repeated lifecycle, reboot behavior, and failure recovery have been tested on a supported device.

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

`channel` is either `experimental` or `stable`. Draft and build-only candidates never appear in the installable catalog.

## License

Source files retain their declared licenses and upstream copyright notices. A module without a confirmed compatible license cannot be released through the catalog.
