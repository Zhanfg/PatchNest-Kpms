#!/usr/bin/env python3
"""Offline source contracts for PatchNest-Kpms issues #3, #4 and #5."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
MAKE = (ROOT / "modules/diagnostic-hello/Makefile").read_text(encoding="utf-8")
META = json.loads((ROOT / "modules/diagnostic-hello/module.json").read_text(encoding="utf-8"))
VALIDATOR = (ROOT / "scripts/validate_diagnostic_build.py").read_text(encoding="utf-8")
PROVENANCE = (ROOT / "scripts/write_build_provenance.py").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github/workflows/build-diagnostic.yml").read_text(encoding="utf-8")

# #3: final link, not compile, owns the linker script and emits a map.
compile_line = next(line for line in MAKE.splitlines() if " -c " in line)
link_line = next(line for line in MAKE.splitlines() if "$(CC) -r " in line)
assert "-T" not in compile_line and "-Wl,-T" not in compile_line
assert "-Wl,-T,$(LINKER_SCRIPT)" in link_line
assert "-Wl,-Map,$(MAP_FILE)" in link_line
assert "$(OBJECTS)" in link_line
assert "-MMD" in compile_line and "-MF diagnostic_hello.d" in compile_line
assert "ifneq ($(filter clean,$(MAKECMDGOALS)),clean)" in MAKE

# #4: build graph is declared and checked against Makefile + actual depfile.
build = META["build"]
assert build["sources"] == [META["source"]]
assert build["objects"] == ["diagnostic_hello.o"]
assert build["linkerScript"].endswith("diagnostic_hello.lds")
assert build["depfiles"] == ["diagnostic_hello.d"]
assert build["mapFile"] == "diagnostic_hello.map"
assert set(build["allowedUndefinedSymbols"]) >= {"kpver", "compat_copy_to_user"}
for token in (
    "PROHIBITED_BUILD_TOKENS",
    "undeclared local compilation input",
    "depfile_paths",
    "undefined_symbols",
    "unexpected undefined symbols",
    "build-inputs.json",
):
    assert token in VALIDATOR
assert "curl " in VALIDATOR and "git clone" in VALIDATOR and "$(shell" in VALIDATOR

# Source/build graph gate must run before any clone or toolchain download.
source_gate = WORKFLOW.index("Validate declared source/build graph before network access")
clone = WORKFLOW.index("Checkout pinned KPatch SDK")
toolchain = WORKFLOW.index("Install pinned ARM GNU toolchain")
assert source_gate < clone < toolchain
assert "validate_diagnostic_build.py --mode source" in WORKFLOW
assert "--mode artifact" in WORKFLOW
assert "diagnostic_hello.map" in WORKFLOW
assert "build-inputs.json" in WORKFLOW
assert "symbols.txt" in WORKFLOW and "relocations.txt" in WORKFLOW

# #5: source head/base/tested merge are separate fields. There is no ambiguous
# sourceCommit=$GITHUB_SHA provenance field anymore.
for key in ("sourceHeadCommit", "baseCommit", "testedCommit", "testedMergeCommit"):
    assert key in PROVENANCE
assert '"sourceCommit"' not in PROVENANCE
assert "PATCHNEST_SOURCE_HEAD" in PROVENANCE
assert "PATCHNEST_BASE_COMMIT" in PROVENANCE
assert "checkout_head = git(\"rev-parse\", \"HEAD\")" in PROVENANCE
assert "tested_merge = checkout_head if is_pr else None" in PROVENANCE
assert "sourceTreeStatusAtCheckout" in PROVENANCE

assert "github.event.pull_request.head.sha" in WORKFLOW
assert "github.event.pull_request.base.sha" in WORKFLOW
assert "PATCHNEST_SOURCE_TREE_STATUS=clean" in WORKFLOW
assert "write_build_provenance.py" in WORKFLOW
assert '"sourceCommit": "$GITHUB_SHA"' not in WORKFLOW

# Diagnostic channel boundary remains explicit.
assert META["channel"] == "build-only"
assert META["installable"] is False

print("PatchNest-Kpms issues #3/#4/#5 offline contracts passed.")
