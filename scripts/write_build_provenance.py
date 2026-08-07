#!/usr/bin/env python3
"""Write deterministic provenance for the diagnostic KPM build."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def env(name: str, required: bool = True) -> str:
    value = os.environ.get(name, "").strip()
    if required and not value:
        raise SystemExit(f"ERROR: missing environment variable {name}")
    return value


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def require_sha(label: str, value: str) -> None:
    if not SHA_RE.fullmatch(value):
        raise SystemExit(f"ERROR: {label} must be a full lowercase Git SHA")


def require_ancestor(ancestor: str, descendant: str, label: str) -> None:
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", ancestor, descendant],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        raise SystemExit(f"ERROR: {label} {ancestor} is not an ancestor of tested commit {descendant}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    artifact = (ROOT / args.artifact).resolve()
    inputs = (ROOT / args.inputs).resolve()
    output = (ROOT / args.output).resolve()
    if not artifact.is_file() or not inputs.is_file():
        raise SystemExit("ERROR: artifact/build-input manifest missing")

    event_name = env("GITHUB_EVENT_NAME")
    source_head = env("PATCHNEST_SOURCE_HEAD")
    base_commit = env("PATCHNEST_BASE_COMMIT", required=False) or None
    checkout_head = git("rev-parse", "HEAD")
    expected_checkout = env("GITHUB_SHA")
    for label, value in (("sourceHeadCommit", source_head), ("testedCommit", checkout_head), ("GITHUB_SHA", expected_checkout)):
        require_sha(label, value)
    if checkout_head != expected_checkout:
        raise SystemExit(f"ERROR: checkout HEAD {checkout_head} != GITHUB_SHA {expected_checkout}")

    is_pr = event_name == "pull_request"
    tested_merge = checkout_head if is_pr else None
    if is_pr:
        if not base_commit:
            raise SystemExit("ERROR: pull_request provenance requires base commit")
        require_sha("baseCommit", base_commit)
        require_ancestor(source_head, checkout_head, "source head")
        require_ancestor(base_commit, checkout_head, "base commit")
    else:
        if base_commit is not None:
            raise SystemExit("ERROR: non-PR provenance must not invent a base commit")
        if source_head != checkout_head:
            raise SystemExit("ERROR: non-PR sourceHeadCommit must equal testedCommit")

    input_manifest = json.loads(inputs.read_text(encoding="utf-8"))
    artifact_digest = sha256(artifact)
    if input_manifest.get("artifactSha256") != artifact_digest:
        raise SystemExit("ERROR: build-input manifest artifact digest mismatch")

    provenance = {
        "schemaVersion": 2,
        "eventName": event_name,
        "repository": env("GITHUB_REPOSITORY"),
        "workflowRef": env("GITHUB_WORKFLOW_REF"),
        "runId": env("GITHUB_RUN_ID"),
        "sourceHeadCommit": source_head,
        "baseCommit": base_commit,
        "testedCommit": checkout_head,
        "testedMergeCommit": tested_merge,
        "sourceTreeStatusAtCheckout": env("PATCHNEST_SOURCE_TREE_STATUS"),
        "artifact": artifact.name,
        "artifactSha256": artifact_digest,
        "artifactSize": artifact.stat().st_size,
        "buildInputsManifest": inputs.name,
        "buildInputsSha256": sha256(inputs),
        "upstreamSdk": {
            "repository": env("KP_REPOSITORY"),
            "commit": env("KP_COMMIT"),
        },
        "toolchain": {
            "url": env("ARM_TOOLCHAIN_URL"),
            "archiveSha256": env("ARM_TOOLCHAIN_SHA256"),
        },
    }
    if provenance["sourceTreeStatusAtCheckout"] != "clean":
        raise SystemExit("ERROR: provenance requires clean source checkout")

    output.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(provenance, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
