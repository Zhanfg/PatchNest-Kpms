#!/usr/bin/env python3
"""Validate diagnostic-hello's declared build graph and final ELF policy."""
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
    r"hook_wrap", r"fp_hook", r"syscall_hook", r"kallsyms_lookup",
    r"selinux", r"\bmount\b", r"proc_maps", r"boot_state", r"module_hide",
)
PROHIBITED_BUILD_TOKENS = (
    "curl ", "wget ", "git clone", "$(shell", "python ", "python3 ",
    "node ", "perl ", "ruby ", "go run", "cargo ", "base64 -d",
)


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_metadata() -> dict:
    data = json.loads(META.read_text(encoding="utf-8"))
    if data.get("id") != "patchnest-diagnostic-hello": fail("unexpected module id")
    if data.get("installable") is not False or data.get("channel") != "build-only":
        fail("diagnostic module must remain build-only/non-installable")
    build = data.get("build")
    required = ("sources", "objects", "linkerScript", "depfiles", "mapFile", "allowedUndefinedSymbols")
    if not isinstance(build, dict) or any(key not in build for key in required):
        fail("incomplete module.json build declaration")
    symbols = build["allowedUndefinedSymbols"]
    if not isinstance(symbols, list) or not symbols or any(
        not isinstance(s, str) or not re.fullmatch(r"[A-Za-z0-9_.$]+", s) for s in symbols
    ):
        fail("allowedUndefinedSymbols must be a non-empty exact-name list")
    return data


def make_words(text: str, variable: str) -> list[str]:
    match = re.search(rf"^{re.escape(variable)}\s*:?=\s*(.+)$", text, re.M)
    if not match: fail(f"Makefile {variable} assignment missing")
    return match.group(1).split()


def validate_source(*, allow_generated: bool = False) -> dict:
    data = load_metadata()
    build = data["build"]
    text = MAKEFILE.read_text(encoding="utf-8")
    sources = [str(x) for x in build["sources"]]
    objects = [str(x) for x in build["objects"]]
    depfiles = [str(x) for x in build["depfiles"]]
    linker = str(build["linkerScript"])
    map_file = str(build["mapFile"])

    if sources != [data["source"]]: fail("metadata source/build.sources mismatch")
    if make_words(text, "OBJECTS") != objects: fail("Makefile OBJECTS mismatch")
    if make_words(text, "DEPFILES") != depfiles: fail("Makefile DEPFILES mismatch")
    if make_words(text, "LINKER_SCRIPT") != [Path(linker).name]: fail("linker-script declaration mismatch")
    if make_words(text, "MAP_FILE") != [map_file]: fail("map-file declaration mismatch")

    lowered = text.lower()
    for token in PROHIBITED_BUILD_TOKENS:
        if token.lower() in lowered: fail(f"undeclared network/generator command in Makefile: {token!r}")

    compile_lines = [line.strip() for line in text.splitlines() if " -c " in line]
    link_lines = [line.strip() for line in text.splitlines() if "$(CC) -r " in line]
    recipes = [line.strip() for line in text.splitlines() if line.startswith("\t")]
    if len(compile_lines) != 1 or len(link_lines) != 1: fail("expected one compile and one final link")
    compile_line, link_line = compile_lines[0], link_lines[0]
    clean_line = "rm -f $(OBJECTS) $(DEPFILES) $(MAP_FILE) $(TARGET)"
    if recipes != [link_line, compile_line, clean_line]:
        fail("module Makefile contains undeclared recipe commands")
    if "-T" in compile_line or "-Wl,-T" in compile_line: fail("linker script passed during compilation")
    if "-MMD" not in compile_line or "-MF diagnostic_hello.d" not in compile_line: fail("depfile emission missing")
    if "-Wl,-T,$(LINKER_SCRIPT)" not in link_line: fail("final link does not apply linker script")
    if "-Wl,-Map,$(MAP_FILE)" not in link_line: fail("final link does not emit map")
    if "$(OBJECTS)" not in link_line: fail("final link does not consume declared OBJECTS")

    declared = {(ROOT / p).resolve() for p in sources + [linker]}
    generated_objects = {(MODULE / p).resolve() for p in objects}
    for item in MODULE.iterdir():
        if not item.is_file() or item.suffix not in INPUT_SUFFIXES: continue
        resolved = item.resolve()
        if resolved in declared: continue
        if allow_generated and resolved in generated_objects: continue
        fail(f"undeclared/prebuilt compilation input: {item.relative_to(ROOT)}")

    for source in sources:
        path = (ROOT / source).resolve()
        if not path.is_file() or ROOT not in path.parents: fail(f"source missing/outside repository: {source}")
        source_text = path.read_text(encoding="utf-8")
        for pattern in PROHIBITED_SOURCE:
            if re.search(pattern, source_text, re.I): fail(f"prohibited token {pattern!r} in {source}")
    primary = (ROOT / sources[0]).read_text(encoding="utf-8")
    for required in ("KPM_NAME(", "KPM_VERSION(", "KPM_INIT(", "KPM_EXIT("):
        if required not in primary: fail(f"missing {required}")

    return {"mode": "source", "sources": sources, "objects": objects,
            "linkerScript": linker, "depfiles": depfiles, "mapFile": map_file}


def depfile_paths(path: Path) -> list[Path]:
    text = path.read_text(encoding="utf-8").replace("\\\n", " ")
    if ":" not in text: fail(f"invalid depfile: {path}")
    raw = text.split(":", 1)[1]
    paths: list[Path] = []
    for token in raw.split():
        candidate = Path(token)
        candidate = candidate.resolve() if candidate.is_absolute() else (MODULE / candidate).resolve()
        if candidate.is_file(): paths.append(candidate)
    if not paths: fail("depfile contains no existing inputs")
    return paths


def undefined_symbols(readelf: str, artifact: Path) -> set[str]:
    output = subprocess.check_output([readelf, "-sW", str(artifact)], text=True)
    result: set[str] = set()
    for line in output.splitlines():
        fields = line.split()
        if len(fields) >= 8 and fields[6] == "UND":
            name = fields[7].split("@", 1)[0]
            if name: result.add(name)
    return result


def validate_artifact(readelf: str, output: Path) -> dict:
    data = load_metadata()
    validate_source(allow_generated=True)
    build = data["build"]
    artifact = MODULE / data["artifact"]
    map_path = MODULE / str(build["mapFile"])
    depfiles = [MODULE / str(item) for item in build["depfiles"]]
    for path in [artifact, map_path, *depfiles]:
        if not path.is_file() or path.stat().st_size == 0: fail(f"missing/empty: {path.relative_to(ROOT)}")

    allowed = {str(x) for x in build["allowedUndefinedSymbols"]}
    actual = undefined_symbols(readelf, artifact)
    unexpected = sorted(actual - allowed)
    if unexpected: fail("unexpected undefined symbols: " + ", ".join(unexpected))

    inputs: dict[str, dict[str, object]] = {}
    for depfile in depfiles:
        for path in depfile_paths(depfile):
            try: display, origin = str(path.relative_to(ROOT)), "repository"
            except ValueError: display, origin = str(path), "sdk"
            inputs[display] = {"origin": origin, "sha256": sha256(path), "size": path.stat().st_size}
    linker_path = ROOT / str(build["linkerScript"])
    inputs[str(linker_path.relative_to(ROOT))] = {
        "origin": "repository", "sha256": sha256(linker_path), "size": linker_path.stat().st_size,
    }
    manifest = {
        "schemaVersion": 1, "artifact": str(artifact.relative_to(ROOT)),
        "artifactSha256": sha256(artifact), "mapSha256": sha256(map_path),
        "undefinedSymbols": sorted(actual), "allowedUndefinedSymbols": sorted(allowed),
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
    result = validate_source() if args.mode == "source" else validate_artifact(args.readelf, ROOT / args.output)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
