#!/usr/bin/env bash
# run-field.sh — the off-grid run: a laptop, a phone, and no network between
# them but the one this laptop is making.
#
# It is run-dev.sh with two arguments already on, and nothing else. There is no
# second copy of the stack here on purpose — every port, pane and sidecar is
# still run-dev's, so a fix there is a fix here:
#
#   --hotspot       put the Wi-Fi card into AP mode and wire the controller to
#                   this machine's address on it, so the phone can pair with no
#                   router involved. Also runs the backend HF_HUB_OFFLINE=1.
#   --bg-sidecars   relay, recorder, saver and backend go to logs instead of
#                   windows. You never watch them; what you watch is the app and
#                   the controller, and those two still open as panes.
#
# Everything run-dev takes still works and wins, since these are just leading
# arguments:
#
#   ./scripts/run-field.sh                  # the usual: AP up, two windows
#   ./scripts/run-field.sh --web            # app in the browser, not Electron
#   ./scripts/run-field.sh --no-backend     # skip AI suggestions
#   ./scripts/run-field.sh --hotspot-ssid gig --hotspot-pass drumsdrums
#
# Before you leave the internet behind, ONCE:
#
#   .venv/bin/python scripts/preload-models.py
#
# which pulls the inference weights and proves they load with the network off.
# Without it the first suggestion out there fails on a download that can't
# happen.
#
# Tearing it down (the AP outlives the script — see run-dev.sh):
#
#   ./scripts/run-dev.sh --hotspot-off
#
# Phone mic does not work on this run and the controller's mic button says so:
# getUserMedia needs a secure context and the controller is served over plain
# http. Take control, transport and pairing are all fine.

set -euo pipefail

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-dev.sh" \
  --hotspot --bg-sidecars "$@"
