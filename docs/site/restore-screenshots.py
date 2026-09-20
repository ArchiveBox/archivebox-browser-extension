#!/usr/bin/env -S uv run --no-project python
"""Restore validated screenshots, keeping capture and website revisions separate."""

import argparse
import hashlib
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PAGES = Path(__file__).resolve().parents[2] / ".github/pages"
sys.path.insert(0, str(PAGES))
import artifacts

# Repository-specific capture contract.
REPO = "ArchiveBox/archivebox-browser-extension"
BRANCH = "main"
BASE = "https://extension.archivebox.io/screenshots/"
MANIFEST = "manifest.json"


def validate(destination, run=None):
    manifest = json.loads((destination / MANIFEST).read_text())
    if run and manifest["revision"] != run["head_sha"]:
        raise ValueError("Screenshot revision differs from the original capture run")
    if not manifest.get("screenshots"):
        raise ValueError("Empty screenshot manifest")
    for capture in manifest["screenshots"]:
        for image in capture["images"]:
            png = (destination / artifacts.relative_path(image["file"])).read_bytes()
            if (
                png[:8] != bytes.fromhex("89504e470d0a1a0a")
                or int.from_bytes(png[16:20], "big") != image["imageWidth"]
                or int.from_bytes(png[20:24], "big") != image["imageHeight"]
            ):
                raise ValueError(f"Invalid PNG or dimensions: {image['file']}")
            if (
                image.get("sha256")
                and hashlib.sha256(png).hexdigest() != image["sha256"]
            ):
                raise ValueError(f"Screenshot checksum mismatch: {image['file']}")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    args.destination.mkdir(parents=True, exist_ok=True)
    if os.environ.get("GH_TOKEN"):
        for run in artifacts.runs(REPO, "screenshots.yml", BRANCH):
            if "site-screenshots" not in artifacts.names(REPO, run):
                continue
            artifacts.download(REPO, run, "site-screenshots", args.destination)
            validate(args.destination, run)
            print(
                f"Restored validated screenshots from {run['id']} ({run['head_sha']})"
            )
            return
    raw = artifacts.fetch(BASE, MANIFEST)
    manifest = json.loads(raw)
    names = [
        image["file"]
        for capture in manifest["screenshots"]
        for image in capture["images"]
    ]

    def restore(name):
        target = args.destination / artifacts.relative_path(name)
        data = artifacts.fetch(BASE, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(restore, names))
    (args.destination / MANIFEST).write_bytes(raw)
    validate(args.destination)
    print(f"Restored {len(names)} published files from {manifest['revision']}")


if __name__ == "__main__":
    main()
