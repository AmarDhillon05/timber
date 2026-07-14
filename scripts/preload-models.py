#!/usr/bin/env python
"""Fetch every model the inference service can serve, then prove each one loads
with the network turned off.

The service pulls its weights from HuggingFace at request time
(`from_pretrained` in inference/inference.py), which is invisible until the
first session somewhere with no wifi: whichever model has never been asked for
on this machine tries to download, and the suggestion fails. This script pulls
them all ahead of time so that never happens.

The pull is only half the job, and the half that can lie. A warm cache still
sends HuggingFace a revalidation request on load unless it is told not to, so
the honest check is to load each model in a subprocess with HF_HUB_OFFLINE=1 --
which is exactly what the machine will look like off-grid. A model that only
"works" because the network answered isn't preloaded.

Usage:

    .venv/bin/python scripts/preload-models.py

    # ...or park the weights inside the repo instead of ~/.cache/huggingface,
    # e.g. to carry them to another machine. Export the same HF_HOME when you
    # run the service, or it won't find them.
    .venv/bin/python scripts/preload-models.py --hf-home ./models/hf

BEATs is not fetched: it loads from a checkpoint file (BEATS_CHECKPOINT), not
from a HuggingFace id, so there is nothing here to download it from. The script
reports whether that checkpoint is present and leaves it at that.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# How to load each backend, mirroring what inference.py actually calls -- an
# import that differs from the real one would verify the wrong thing.
LOADERS = {
    "clap": (
        "from transformers import ClapModel, ClapProcessor\n"
        "ClapModel.from_pretrained({id!r})\n"
        "ClapProcessor.from_pretrained({id!r})\n"
    ),
    "ast": (
        "from transformers import AutoFeatureExtractor, ASTForAudioClassification\n"
        "AutoFeatureExtractor.from_pretrained({id!r})\n"
        "ASTForAudioClassification.from_pretrained({id!r})\n"
    ),
}


def load_offline(backend: str, model_id: str) -> tuple[bool, str]:
    """Load `backend` in a subprocess with the hub forced offline, the way the
    service will have to load it in the field."""
    env = {
        **os.environ,
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "HF_HUB_DISABLE_TELEMETRY": "1",
    }
    proc = subprocess.run(
        [sys.executable, "-c", LOADERS[backend].format(id=model_id)],
        env=env,
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        return True, ""
    tail = (proc.stderr or proc.stdout).strip().splitlines()
    return False, tail[-1] if tail else f"exit {proc.returncode}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--hf-home",
        metavar="DIR",
        help="Cache the weights here instead of the default ~/.cache/huggingface.",
    )
    args = ap.parse_args()

    # Must be set before anything imports huggingface_hub -- the cache path is
    # read at import time, so a later assignment is silently ignored.
    if args.hf_home:
        os.environ["HF_HOME"] = str(Path(args.hf_home).expanduser().resolve())

    from huggingface_hub import snapshot_download

    from inference.config import Settings

    # The model ids come from Settings, so this preloads whatever the service is
    # actually configured to serve rather than a second copy of the defaults.
    settings = Settings()
    wanted = {"clap": settings.clap_model_id, "ast": settings.ast_model_id}

    cache = os.environ.get("HF_HOME") or "~/.cache/huggingface (default)"
    print(f"cache   {cache}")
    print(f"default {settings.default_model}  (DEFAULT_MODEL)\n")

    failed = []
    for backend, model_id in wanted.items():
        print(f"-> {backend}: {model_id}")
        try:
            snapshot_download(model_id)
        except Exception as exc:  # network down, gated repo, bad id
            print(f"   FAIL  download: {exc}\n")
            failed.append(backend)
            continue

        ok, why = load_offline(backend, model_id)
        if ok:
            print("   ok    downloaded, and loads with the network off\n")
        else:
            print(f"   FAIL  downloaded, but will not load offline: {why}\n")
            failed.append(backend)

    # BEATs can't be fetched from here; just say where it stands so a missing
    # checkpoint isn't discovered in the field.
    if not settings.beats_checkpoint:
        print("-- beats: BEATS_CHECKPOINT unset, backend unavailable (fine unless you want it)")
    elif Path(settings.beats_checkpoint).is_file():
        print(f"ok beats: checkpoint present at {settings.beats_checkpoint}")
    else:
        print(f"FAIL beats: BEATS_CHECKPOINT set but missing: {settings.beats_checkpoint}")
        failed.append("beats")

    if failed:
        print(f"\n{len(failed)} backend(s) not ready offline: {', '.join(failed)}")
        return 1

    print("\nAll backends load with no network.")
    print("Run the service offline with HF_HUB_OFFLINE=1 so a warm cache is never")
    print("held up revalidating against a hub it cannot reach:")
    print("\n    HF_HUB_OFFLINE=1 ./scripts/run-dev.sh")
    if args.hf_home:
        print(f"\nWeights are under {os.environ['HF_HOME']} -- export HF_HOME to match.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
