"""
Quick local test for the blanket inference logic.

Runs a model directly (no HTTP server) on an audio file and prints the
suggested amount for every blanket term. Any audio or video container works:
the audio track is extracted to a temp WAV with ffmpeg first (soundfile/
libsndfile cannot read containers like .mov).

Usage:
    .venv/bin/python test_inference.py clip.mov          # default model = clap
    .venv/bin/python test_inference.py clip.mov ast      # or: beats
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from inference import suggest_blanket_amounts



def extract_audio(src: str) -> str:
    """Decode any container's audio track to a mono 48 kHz temp WAV via ffmpeg."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", src,
            "-vn",            # drop video
            "-ac", "1",       # mono
            "-ar", "48000",   # 48 kHz (downsampled per-backend as needed)
            tmp.name,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return tmp.name


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: python test_inference.py <audio-or-video-file> [ast|beats|clap]")

    source = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else "clap"

    if not Path(source).exists():
        sys.exit(f"Source file not found: {source}")

    print(f"Extracting audio from {source} ...")
    wav = extract_audio(source)

    print(f"Running '{model}' inference (first run downloads model weights) ...")
    suggestions = suggest_blanket_amounts(wav, model=model)

    print(f"\nSuggested blanket amounts ({model}):\n")
    print(json.dumps(suggestions, indent=2))

    Path(wav).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
