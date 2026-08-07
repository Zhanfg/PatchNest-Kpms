#!/usr/bin/env python3
"""Validate the build graph and final artifact policy for diagnostic-hello."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "modules/diagnostic-hello"
META = MODULE / "module.json"
MAKEFILE = MODULE / "Makefile"
INPUT_SUFFIXES = {".c", ".h", ".S", ".s", ".o", ".a", ".ld", ".lds"}
PROHIBITED_SOURCE = (
    re.compile(r"hook_wrap", re.I),
    re.compile(r"fp_hook", re.I),
    re.compile(r"syscall_hook", re.I),
    re.compile(r"kallsyms_lookup", re.I),
    re.compile(r"selinux", re.I),
    re.compile(r"\bmount\b", re.I),
    re.compile(r"proc_maps", re.I),
    re.compile(r"boot_state", re.I),
    re.compile(r"module_hide", re.I),
)


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def metadata() -> dict:
    data = json.loads(META.read_text(encoding="utf-8"))
    if data.get("id") != "patchnest-diagnostic-hello":
        fail("unexpected module id")
    if data.get("installable") is not False or data.get("channel") != "build-only":
        fail("diagnostic module must remain build-only and non-installable")
    build = data.get("build")
    if not isinstance(build, dict):
        fail("module.json build declaration missing")
    for key in ("sources", "objects", "linkerScript", "depfiles", "mapFile", "allowedUndefinedSymbols"):
        if key not in build:
            fail(f"module.json build.{key} missing")
    return data


def words_after_assignment(makefile: str, variable: str) -> list[str]:
    match = re.search(rf"^{re.escape(variable)}\s*:?=\s*(.+)$", makefile, re.M)
    if not match:
        fail(f"Makefile {variable} assignment missing")
    return match.group(1).split()


def validate_source() -> dict:
    data = metadata()
    build = data["build"]
    makefile = MAKEFILE.read_text(encoding="utf-8")

    declared_sources = [str(x) for x in build["sources"]]
    declared_objects = [str(x) for x in build["objects"]]
    declared_depfiles = [str(x) for x in build["depfiles"]]
    linker = str(build["linkerScript"])
    map_file = str(build["mapFile"])

    if declared_sources != [data["source"]]:
        fail("metadata source and build.sources disagree")
    if words_after_assignment(makefile, "OBJECTS") != declared_objects:
        fail("Makefile OBJECTS differs from module.json")
    if words_after_assignment(makefile, "DEPFILES") != declared_depfiles:
        fail("Makefile DEPFILES differs from module.json")
    if words_after_assignment(makefile, "LINKER_SCRIPT") != [Path(linker).name]:
        fail("Makefile LINKER_SCRIPT differs from module.json")
    if words_after_assignment(makefile, "MAP_FILE") != [map_file]:
        fail("Makefile MAP_FILE differs from module.json")

    compile_lines = [line.strip() for line in makefile.splitlines() if " -c " in line]
    link_lines = [line.strip() for line in makefile.splitlines() if "$(CC) -r " in line]
    if len(compile_lines) != 1 or len(link_lines) != 1:
        fail("expected exactly one compile and one final relocatable link command")
    if "-T" in compile_lines[0] or "-Wl,-T" in compile_lines[0]:
        fail("linker script must not be passed during -c compilation")
    if "-MMD" not in compile_lines[0] or "-MF diagnostic_hello.d" not in compile_lines[0]:
        fail("compile command must emit the declared depfile")
    if "-Wl,-T,$(LINKER_SCRIPT)" not in link_lines[0]:
        fail("final link does not apply the declared linker script")
    if "-Wl,-Map,$(MAP_FILE)" not in link_lines[0]:
        fail("final link does not emit the declared map file")
    if "$(OBJECTS)" not in link_lines[0]:
        fail("final link must consume only declared OBJECTS")

    declared_local = {
        (ROOT / source).resolve() for source in declared_sources
    } | {(ROOT / linker).resolve()}
    for item in MODULE.iterdir():
        if item.is_file() and item.suffix in INPUT_SUFFIXES:
            if item.suffix in {".o", ".a"}:
                # Build outputs are absent in source validation and rejected by
                # git cleanliness/provenance if checked in later.
                continue
            if item.resolve() not in declared_local:
                fail(f"undeclared local compilation input: {item.relative_to(ROOT)}")

    for source in declared_sources:
        path = (ROOT / source).resolve()
        if not path.is_file() or ROOT not in path.parents:
            fail(f"declared source missing/outside repository: {source}")
        text = path.read_text(encoding="utf-8")
        for pattern in PROHIBITED_SOURCE:
            if pattern.search(text):
                fail(f"prohibited source capability token {pattern.pattern!r} in {source}")
    for required in ("KPM_NAME(", "KPM_VERSION(", "KPM_INIT(", "KPM_EXIT("):
        if required not in (ROOT / declared_sources[0]).read_text(encoding="utf-8"):
            fail(f"required diagnostic declaration missing: {required}")

    return {
        "mode": "source",
        "sources": declared_sources,
        "objects": declared_objects,
        "linkerScript": linker,
        "depfiles": declared_depfiles,
        "mapFile": map_file,
    }


def depfile_paths(path: Path) -> list[Path]:
    text = path.read_text(encoding="utf-8").replace("\\\n", " ")
    if ":" not in text:
        fail(f"invalid depfile: {path}")
    _, raw = text.split(":", 1)
    paths = []
    for token in raw.split():
        candidate = Path(token)
        if not candidate.is_absolute():
            candidate = (MODULE / candidate).resolve()
        else:
            candidate = candidate.resolve()
        if candidate.is_file():
            paths.append(candidate)
    if not paths:
        fail("depfile contains no existing inputs")
    return paths


def undefined_symbols(readelf: str, artifact: Path) -> set[str]:
    output = subprocess.check_output([readelf, "-sW", str(artifact)], text=True)
    symbols: set[str] = set()
    for line in output.splitlines():
        fields = line.split()
        if len(fields) >= 8 and fields[6] == "UND":
            name = fields[7].split("@", 1)[0]
            if name:
                symbols.add(name)
    return symbols


def validate_artifact(readelf: str, output: Path) -> dict:
    data = metadata()
    validate_source()
    build = data["build"]
    artifact = MODULE / data["artifact"]
    map_path = MODULE / str(build["mapFile"])
    depfiles = [MODULE / str(item) for item in build["depfiles"]]
    for path in [artifact, map_path, *depfiles]:
        if not path.is_file() or path.stat().st_size == 0:
            fail(f"required build output missing/empty: {path.relative_to(ROOT)}")

    allowed = set(str(x) for x in build["allowedUndefinedSymbols"])
    actual = undefined_symbols(readelf, artifact)
    unexpected = sorted(actual - allowed)
    if unexpected:
        fail("unexpected undefined symbols: " + ", ".join(unexpected))

    inputs: dict[str, dict[str, object]] = {}
    for depfile in depfiles:
        for path in depfile_paths(depfile):
            try:
                display = str(path.relative_to(ROOT))
                origin = "repository"
            except ValueError:
                display = str(path)
                origin = "sdk-or-toolchain"
            inputs[display] = {
                "origin": origin,
                "sha256": sha256(path),
                "size": path.stat().st_size,
            }

    linker = ROOT / str(build["linkerScript"])
    inputs[str(linker.relative_to(ROOT))] = {
        "origin": "repository",
        "sha256": sha256(linker),
        "size": linker.stat().st_size,
    }
    manifest = {
        "schemaVersion": 1,
        "artifact": str(artifact.relative_to(ROOT)),
        "artifactSha256": sha256(artifact),
        "mapSha256": sha256(map_path),
        "undefinedSymbols": sorted(actual),
        "allowedUndefinedSymbols": sorted(allowed),
        "inputs": dict(sorted(inputs.items())),
    }
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("source", "artifact"), required=True)
    parser.add_argument("--readelf", default="readelf")
    parser.add_argument("--output", default="modules/diagnostic-hello/build-inputs.json")
    args = parser.parse_args()
    if args.mode == "source":
        result = validate_source()
    else:
        result = validate_artifact(args.readelf, ROOT / args.output)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
