# PatchNest KPM restart audit

Audit date: 2026-08-06

## Result

The repository previously presented eight catalog entries as installable, but none had a verified release pipeline:

- two entries used `https://example.com/...` placeholders;
- six entries referenced nonexistent assets under the retired `Zhanfg/KPatch-Next-Module` repository and `v0.3.0` tag;
- no catalog entry recorded an artifact SHA-256;
- no workflow built, verified, signed, or published the listed modules;
- the README still used the retired KPatch-Next and `/data/adb/kp-next` names.

The six checked-in C files are not currently valid KernelPatch KPM sources. They use Linux loadable-module interfaces such as `module_init`, `module_exit`, `MODULE_LICENSE`, and Linux kernel headers. A KernelPatch KPM instead requires the pinned KPM SDK and metadata/entry-point macros such as:

```c
KPM_NAME("...");
KPM_VERSION("...");
KPM_LICENSE("...");
KPM_AUTHOR("...");
KPM_DESCRIPTION("...");
KPM_INIT(...);
KPM_EXIT(...);
```

None of the six source files currently declares those interfaces.

## Immediate remediation

- The public `modules` array is empty until verified artifacts exist.
- All broken and placeholder download URLs were removed.
- Existing prototypes remain tracked and are inventoried in `drafts.json`.
- CI validates that every installable entry has a real HTTPS URL, SHA-256, source commit, compatibility data, and unique ID.
- CI also ensures every prototype source is accounted for in `drafts.json`.

## Porting order

The recommended order is based on implementation complexity and blast radius:

1. `module_name_hider.c`
2. `selinux_context_faker.c`
3. `mount_hide.c`
4. `proc_maps_hide.c`
5. `linker_redaction.c`
6. `boot_state_spoofer.c`

`boot_state_spoofer.c` must remain last because falsifying boot state and vbmeta-related values has the highest compatibility and integrity risk.

## Release gates

A prototype can be moved from `drafts.json` to `kpm_repo.json` only after:

1. SDK port and clean ARM64 KPM build;
2. static inspection and exported metadata verification;
3. deterministic artifact digest generation;
4. real-device load/control/unload testing;
5. reboot and safe-mode recovery testing;
6. compatibility scope documented by kernel version;
7. signed GitHub Release asset published;
8. download and digest verified from the public URL.
