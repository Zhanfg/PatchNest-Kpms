# PatchNest Diagnostic Hello

This KPM is a non-invasive build and lifecycle diagnostic. It exists to prove that the repository can compile a KPM from reviewed source against a pinned KernelPatch SDK and produce auditable provenance.

## Behavior

- logs a message when loaded;
- returns the constant string `patchnest-diagnostic-ok` through control channel 0;
- logs a message when unloaded.

It does **not** hook kernel functions, alter SELinux or mount state, hide processes/modules/files, spoof boot state, or install persistence.

## Build integrity

`module.json` is the build-graph source of truth. The diagnostic candidate declares:

- every repository-local build input;
- its exact source list and local-header list;
- the linker script used by the final relocatable link;
- every generated output;
- the only undefined symbols allowed in the final ELF.

Validation fails closed when an undeclared source/header/object appears, the Makefile source list differs from metadata, a network-capable build recipe is introduced, a linker-only option is moved into the compile stage, or the final link stops using the declared linker script.

The final `gcc -r` command applies `diagnostic_hello.lds`, produces a linker map, and the workflow checks the resulting ELF symbol/relocation set rather than treating source-text lint as a capability proof.

## Build status

The artifact is build-only and is not listed in `kpm_repo.json`. CI uploads it as a temporary workflow artifact together with:

- ELF header/section/symbol/relocation reports;
- linker map and compiler dependency closure;
- hashes for source inputs, object, map, and final KPM;
- `build-provenance.json`.

Moving it into the installable catalog requires physical validation of:

1. load;
2. control channel response;
3. unload;
4. repeated load/unload;
5. reboot behavior;
6. failure recovery.

## Provenance

The module interface is derived from the GPL-2.0-or-later `demo-hello` example in `KernelSU-Next/KPatch-Next`, pinned to commit `0fe6d142266b80e5aa445a7ea1534f88a8f33a35`. The implementation narrows the example to a constant bounded response and checks user-copy failures.

For `pull_request` builds, provenance records three different identities instead of overloading `GITHUB_SHA`:

- `sourceHeadCommit`: the immutable PR head under review;
- `baseCommit`: the PR base commit;
- `testedMergeCommit`: the temporary merge commit that GitHub actually checked out and tested.

`testedCheckoutCommit` is recorded for every event. Push and manual builds use the same schema with `baseCommit` and `testedMergeCommit` set to `null`.
