#!/usr/bin/env bash
# run-dev.sh — Linux equivalent of run-dev.ps1: bring up the whole dev stack,
# each process in its own terminal window, with the relay URL wired per-process
# via EXPO_PUBLIC_RELAY_URL.
#
# Six processes: relay (:8787) · recorder (:8790) · saver (:8791) ·
# app/web (:8081) · controller (:8082) · backend/uvicorn (:8000). The app and controller never
# talk directly — both reach the relay, so the relay must be up for pairing to
# work. The recorder sidecar (recorder/linux) does two jobs over one local
# WebSocket: system-audio capture (PipeWire loopback) AND media control (MPRIS
# over D-Bus — how the phone remote's skip/play-pause buttons reach Spotify et
# al). Without it, arming system audio on the Record page and the remote's
# transport buttons both fail with a message naming how to start it. Pass
# --no-backend to skip uvicorn: the app pings it on launch and degrades
# gracefully, so dev without AI suggestions doesn't need it.
#
# Every port auto-bumps to the next free one if something is already listening
# (and prints what moved), so stale dev servers can't wedge the stack.
#
# The app opens in the ELECTRON shell by default (two panes: the Expo web dev
# server + an Electron window pointed at it), same as run-dev.ps1 on Windows.
# On Linux NOTHING depends on Electron any more — both system audio and media
# control come from the recorder sidecar — so --web (skip the Electron pane,
# use the browser) is a full-featured run.
#
# On kernels that restrict unprivileged user namespaces (recent Ubuntu),
# Electron's chrome-sandbox needs a one-time setuid fix after every npm
# install; the script detects this and prints the exact sudo command.
#
# Projects the app saves and reopens live in ONE folder — the saver's root,
# passed as SAVED_DATA_DIR. It defaults to <repo>/saved_data; point --saved-data
# (or the env var) somewhere else and both saving and the app's "Open a saved
# project" list follow it, since both go through the saver.
#
# Usage:
#   ./scripts/run-dev.sh                   # app as Electron; controller web on THIS machine
#   ./scripts/run-dev.sh --web             # app as web (browser) instead of Electron
#   ./scripts/run-dev.sh --lan             # controller reachable from a phone (auto LAN IP)
#   ./scripts/run-dev.sh --no-backend      # skip uvicorn (:8000) / AI suggestions
#   ./scripts/run-dev.sh --relay-port 9000 # move the relay off 8787 (wires all three)
#   ./scripts/run-dev.sh --app-port 9081 --controller-port 9082 --backend-port 9000
#   ./scripts/run-dev.sh --recorder-port 9790 # move the recorder sidecar off 8790
#   ./scripts/run-dev.sh --saver-port 9791 # move the saver sidecar off 8791
#   ./scripts/run-dev.sh --saved-data ~/timber-projects # where projects are saved
#   ./scripts/run-dev.sh --hotspot         # laptop IS the network; phone joins it
#   ./scripts/run-dev.sh --hotspot-off     # tear that down, restore the old Wi-Fi
#
# --lan auto-detects this machine's LAN IP and points ONLY the controller at
# it, so a phone on the same Wi-Fi can reach the relay. The app + relay stay
# on localhost (they share this machine). If the detected IP is wrong, set
# EXPO_PUBLIC_RELAY_URL yourself in the controller window.
#
# --hotspot is --lan with no Wi-Fi network at all: NetworkManager puts the
# wireless card into AP mode, the phone joins THAT, and the controller is wired
# to the laptop's address on it. Two devices, a router nowhere in sight — for
# recording somewhere with no infrastructure. Implies --lan. It also runs the
# backend with HF_HUB_OFFLINE=1, since a warm HuggingFace cache still tries to
# revalidate against a hub it now cannot reach (see scripts/preload-models.py,
# which fetches the weights and proves they load with the network off — run it
# ONCE while you still have internet).
#
# The AP outlives this script on purpose: the panes are backgrounded and the
# script returns, so tearing down on exit would kill the network the moment it
# came up. --hotspot-off puts it away and restores whatever Wi-Fi you were on.
#
# Taking the radio also takes this machine's internet, so `npm install` and any
# model download must already have happened. Deps are installed BEFORE the AP
# comes up for that reason.
#
# Phone-mic sharing does NOT work over the hotspot and the controller disables
# its mic button there: a browser only grants getUserMedia to a secure context,
# and the controller is served over plain http. Take control, transport buttons
# and pairing all work. Serving the relay over HTTPS is what unlocks the mic.
#
# Each pane opens in a new window of whatever terminal emulator is found
# (gnome-terminal, konsole, xfce4-terminal, tilix, terminator, kitty,
# alacritty, x-terminal-emulator, xterm, in that order). If none is found
# (e.g. headless), processes run in the background with output logged to
# scripts/logs/*.log instead.

set -euo pipefail

lan=0
hotspot=0
hotspot_off=0
hotspot_ssid="timber"
hotspot_pass="timber-take" # NetworkManager requires 8+ chars for WPA
bg_sidecars=0
backend=1
web=0
relay_port=8787
app_port=8081
controller_port=8082
backend_port=8000
recorder_port=8790
saver_port=8791
saved_data="${SAVED_DATA_DIR:-}" # empty → <repo>/saved_data, resolved below

while [ $# -gt 0 ]; do
  case "$1" in
    --lan) lan=1; shift ;;
    # --hotspot is --lan whose network happens to be this laptop, so it turns
    # --lan on and only replaces where the IP comes from.
    --hotspot) hotspot=1; lan=1; shift ;;
    --hotspot-off) hotspot_off=1; shift ;;
    --hotspot-ssid) hotspot_ssid="$2"; shift 2 ;;
    --hotspot-ssid=*) hotspot_ssid="${1#*=}"; shift ;;
    --hotspot-pass) hotspot_pass="$2"; shift 2 ;;
    --hotspot-pass=*) hotspot_pass="${1#*=}"; shift ;;
    --bg-sidecars) bg_sidecars=1; shift ;;
    --backend) backend=1; shift ;;
    --no-backend) backend=0; shift ;;
    --web) web=1; shift ;;
    --relay-port) relay_port="$2"; shift 2 ;;
    --relay-port=*) relay_port="${1#*=}"; shift ;;
    --app-port) app_port="$2"; shift 2 ;;
    --app-port=*) app_port="${1#*=}"; shift ;;
    --controller-port) controller_port="$2"; shift 2 ;;
    --controller-port=*) controller_port="${1#*=}"; shift ;;
    --backend-port) backend_port="$2"; shift 2 ;;
    --backend-port=*) backend_port="${1#*=}"; shift ;;
    --recorder-port) recorder_port="$2"; shift 2 ;;
    --recorder-port=*) recorder_port="${1#*=}"; shift ;;
    --saver-port) saver_port="$2"; shift 2 ;;
    --saver-port=*) saver_port="${1#*=}"; shift ;;
    --saved-data) saved_data="$2"; shift 2 ;;
    --saved-data=*) saved_data="${1#*=}"; shift ;;
    -h|--help)
      # Everything from line 2 up to the first non-comment line, so the header
      # IS the help text and can't drift out of sync with a hardcoded range.
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- Hotspot -----------------------------------------------------------------
#
# The AP is a NetworkManager connection, so bringing it up REPLACES whatever
# Wi-Fi this card was on. We record both names — the AP's and the one we
# displaced — because the script exits while the stack keeps running, so
# teardown can't be a trap here; it has to be a thing you can run later
# (--hotspot-off) against state that survived the exit.
hotspot_state="$root/scripts/logs/hotspot.state"

wifi_iface() {
  nmcli -t -f DEVICE,TYPE device 2>/dev/null | awk -F: '$2=="wifi" { print $1; exit }'
}

# Name of the connection currently active on $1, if any.
active_con_on() {
  nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null |
    awk -F: -v dev="$1" '$2==dev { print $1; exit }'
}

hotspot_up() {
  command -v nmcli >/dev/null 2>&1 || {
    echo "--hotspot needs nmcli (NetworkManager), which isn't installed." >&2
    exit 1
  }

  local iface prev con ip tries
  iface="$(wifi_iface)"
  [ -n "$iface" ] || { echo "--hotspot: no Wi-Fi device found." >&2; exit 1; }

  # Not every card can be an access point, and the failure if it can't is a
  # cryptic nmcli error — so ask the driver first and say the useful thing.
  if command -v iw >/dev/null 2>&1 && ! iw list 2>/dev/null | grep -qE '^[[:space:]]+\* AP$'; then
    echo "--hotspot: this Wi-Fi card doesn't report AP mode; it can't host a network." >&2
    exit 1
  fi

  prev="$(active_con_on "$iface")"

  echo "Bringing up hotspot '$hotspot_ssid' on $iface (this drops your current Wi-Fi)..."
  if ! nmcli device wifi hotspot ifname "$iface" ssid "$hotspot_ssid" \
       password "$hotspot_pass" >/dev/null; then
    echo "--hotspot: nmcli couldn't start the AP." >&2
    exit 1
  fi

  con="$(active_con_on "$iface")"
  mkdir -p "$(dirname "$hotspot_state")"
  printf '%s\n%s\n' "$con" "$prev" >"$hotspot_state"

  # The shared-mode address (10.42.0.1/24 as a rule, but read it rather than
  # assume it — this is the address the phone will be told to talk to).
  for tries in 1 2 3 4 5; do
    ip="$(nmcli -g IP4.ADDRESS device show "$iface" 2>/dev/null | head -n1 | cut -d/ -f1)"
    [ -n "$ip" ] && break
    sleep 1
  done
  [ -n "$ip" ] || { echo "--hotspot: AP is up but has no IPv4 address yet." >&2; exit 1; }

  ap_ip="$ip"
}

hotspot_down() {
  local con prev
  [ -f "$hotspot_state" ] || { echo "No hotspot recorded as up — nothing to do."; return 0; }
  { read -r con; read -r prev; } <"$hotspot_state" || true

  [ -n "${con:-}" ] && nmcli connection down "$con" >/dev/null 2>&1 &&
    echo "Hotspot '$con' down."
  if [ -n "${prev:-}" ]; then
    if nmcli connection up "$prev" >/dev/null 2>&1; then
      echo "Reconnected to '$prev'."
    else
      echo "Couldn't rejoin '$prev' automatically — pick your Wi-Fi from the menu." >&2
    fi
  fi
  rm -f "$hotspot_state"
}

if [ "$hotspot_off" -eq 1 ]; then
  hotspot_down
  exit 0
fi

# The saver's root — where projects are saved to AND opened from. Created up
# front so the sidecar's listing has a folder to read on a fresh checkout.
[ -z "$saved_data" ] && saved_data="$root/saved_data"
mkdir -p "$saved_data"
saved_data="$(cd "$saved_data" && pwd)" # absolute: the saver runs from saver/

# True if something is already listening on 127.0.0.1:$1 (bash /dev/tcp probe —
# a successful connect means busy; the subshell closes the fd immediately).
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# Ports already claimed by this run. Our own processes haven't started
# listening yet when later picks happen, so a bumped port must be reserved
# here or two panes could land on the same one (e.g. app 8081→8082 while the
# controller's default is 8082).
chosen_ports=""
port_chosen() { case " $chosen_ports " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# Reassign the port variable named by $1 to itself or, if taken (by a live
# listener or an earlier pick), the next free port up — announcing the move.
# Mutates in place (no subshell), so the reservation list persists. Runs
# BEFORE the relay URLs are built, so bumping the relay rewires the clients too.
pick_port() {
  local var="$1" name="$2" p orig
  eval "p=\$$var"
  orig="$p"
  while port_busy "$p" || port_chosen "$p"; do p=$((p + 1)); done
  [ "$p" != "$orig" ] && echo "Port $orig busy — $name moved to :$p" >&2
  chosen_ports="$chosen_ports $p"
  eval "$var=$p"
}

pick_port relay_port relay
pick_port recorder_port recorder
pick_port saver_port saver
pick_port app_port app
pick_port controller_port controller
[ "$backend" -eq 1 ] && pick_port backend_port backend

# App <-> relay are on the same box, so the app always uses localhost.
app_relay="http://localhost:${relay_port}"

# Controller URL: localhost for a same-machine web run; the LAN IP for a phone.
detect_lan_ip() {
  local ips ip
  ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | grep -v '^169\.254\.' || true)
  ip=$(echo "$ips" | grep '^192\.168\.' | head -n1)
  [ -z "$ip" ] && ip=$(echo "$ips" | grep '^10\.' | head -n1)
  [ -z "$ip" ] && ip=$(echo "$ips" | head -n1)
  echo "$ip"
}

# Install deps where missing (relay has none, but this creates node_modules).
# BEFORE the hotspot: putting the card into AP mode takes this machine off the
# internet, and npm can't install from a network of one.
for d in relay controller mobile; do
  if [ ! -d "$root/$d/node_modules" ]; then
    echo "Installing deps in $d ..."
    (cd "$root/$d" && npm install)
  fi
done

# The hotspot is the network the phone will be on, so its address is the one the
# controller has to be told about — same wiring as --lan, different source for
# the IP. Nothing else moves: app, relay and sidecars stay on localhost, because
# they were always on the same box as each other.
ap_ip=""
[ "$hotspot" -eq 1 ] && hotspot_up

if [ "$lan" -eq 1 ]; then
  lan_ip="${ap_ip:-$(detect_lan_ip)}"
  if [ -z "$lan_ip" ]; then
    echo "Could not auto-detect a LAN IP; set EXPO_PUBLIC_RELAY_URL manually." >&2
    exit 1
  fi
  controller_relay="http://${lan_ip}:${relay_port}"
  echo "Controller wired to LAN relay: ${controller_relay}"
else
  controller_relay="$app_relay"
fi

# Find a terminal emulator to open each pane in its own window.
term_cmd=""
for t in gnome-terminal konsole xfce4-terminal tilix terminator kitty alacritty x-terminal-emulator xterm; do
  if command -v "$t" >/dev/null 2>&1; then
    term_cmd="$t"
    break
  fi
done

mkdir -p "$root/scripts/logs"

# Run detached, output to a log. Two callers want this: a headless box with no
# terminal emulator to open, and --bg-sidecars, which wants it on purpose.
start_bg() {
  local title="$1" body="$2" logfile
  logfile="$root/scripts/logs/$(echo "$title" | tr '[:upper:] ' '[:lower:]-').log"
  bash -c "$body" >"$logfile" 2>&1 &
  echo "  $title — background (PID $!), log: $logfile"
}

# Launch one pane. $2 is a full shell command string (already includes cd/env).
start_pane() {
  local title="$1" body="$2"
  local full="$body; ec=\$?; echo; echo \"[${title}] exited (\$ec) — press Enter to close.\"; read -r"

  case "$term_cmd" in
    gnome-terminal) gnome-terminal --title="$title" -- bash -c "$full" & ;;
    konsole) konsole -p tabtitle="$title" -e bash -c "$full" & ;;
    xfce4-terminal) xfce4-terminal --title="$title" -x bash -c "$full" & ;;
    tilix) tilix -t "$title" -e bash -c "$full" & ;;
    terminator) terminator -T "$title" -x bash -c "$full" & ;;
    kitty) kitty --title "$title" bash -c "$full" & ;;
    alacritty) alacritty --title "$title" -e bash -c "$full" & ;;
    x-terminal-emulator) x-terminal-emulator -T "$title" -e bash -c "$full" & ;;
    xterm) xterm -T "$title" -e bash -c "$full" & ;;
    "")
      echo "No terminal emulator found — '$title' runs detached instead."
      start_bg "$title" "$body"
      ;;
  esac
}

# The four processes you never actually watch (relay, recorder, saver, backend).
# --bg-sidecars sends them to logs so the only windows that open are the two you
# look at: the app and the controller.
start_sidecar() {
  if [ "$bg_sidecars" -eq 1 ]; then
    start_bg "$1" "$2"
  else
    start_pane "$1" "$2"
  fi
}

# 1. Relay — the pairing middleman. RELAY_PORT is the single source of truth;
#    the app/controller URLs above are built from the same $relay_port.
start_sidecar "Timber relay" "cd '$root/relay' && RELAY_PORT='$relay_port' npm start"

# 1b. Recorder — the system-audio sidecar (recorder/README.md). Zero-dep node,
#     so no install step; the app's EXPO_PUBLIC_RECORDER_URL points at it below.
start_sidecar "Timber recorder" "cd '$root/recorder/linux' && RECORDER_PORT='$recorder_port' node server.js"

# 1c. Saver — the project-persistence sidecar (saver/README.md). Zero-dep
#     node; SAVED_DATA_DIR is the one folder it saves into and lists from, so
#     it backs both the editor's Save and the app's "Open a saved project".
start_sidecar "Timber saver" "cd '$root/saver' && SAVER_PORT='$saver_port' SAVED_DATA_DIR='$saved_data' node server.js"

# 2. App (receiver). EXPO_PUBLIC_INFERENCE_URL follows the backend port so a
#    bumped/overridden backend is still found (harmless when it isn't started).
#
#    Default is the Electron shell, as two panes: the Expo web dev server, and
#    an Electron window that waits for it then loads it (the same pipeline as
#    mobile's win:electron:dev, but with the chosen port). --web skips the
#    Electron pane and you open the browser instead.
app_env="EXPO_PUBLIC_RELAY_URL='$app_relay' EXPO_PUBLIC_INFERENCE_URL='http://localhost:$backend_port' EXPO_PUBLIC_RECORDER_URL='ws://localhost:$recorder_port' EXPO_PUBLIC_SAVER_URL='http://localhost:$saver_port'"
start_pane "Timber app (web)" "cd '$root/mobile' && $app_env npm run web -- --port $app_port"

if [ "$web" -eq 0 ]; then
  # Preflight: on kernels that restrict unprivileged user namespaces (recent
  # Ubuntu), Electron aborts unless chrome-sandbox is setuid root — which npm
  # install can't set. Rather than crash, fall back to --no-sandbox for this
  # run (acceptable for a dev shell that only loads localhost) and print the
  # permanent fix.
  elec_flags=""
  sandbox="$root/mobile/node_modules/electron/dist/chrome-sandbox"
  if [ -f "$sandbox" ] && [ "$(stat -c '%a:%U' "$sandbox")" != "4755:root" ]; then
    elec_flags="--no-sandbox"
    echo "⚠  Electron's sandbox helper isn't setuid root; launching with --no-sandbox"
    echo "   for this run. Permanent fix (redo after any npm install that touches"
    echo "   electron):"
    echo "     sudo chown root:root '$sandbox' && sudo chmod 4755 '$sandbox'"
  fi
  start_pane "Timber app (electron)" "cd '$root/mobile' && npx wait-on 'tcp:127.0.0.1:$app_port' && ELECTRON_START_URL='http://localhost:$app_port' npx electron $elec_flags electron/main.js"
fi

# 3. Controller (sender) — web by default; a Metro dev server (for a phone via
#    Expo Go) when --lan. Separate port so it never collides with the app.
if [ "$lan" -eq 1 ]; then
  ctl_cmd="npm start -- --port $controller_port"
else
  ctl_cmd="npm run web -- --port $controller_port"
fi
start_pane "Timber controller" "cd '$root/controller' && EXPO_PUBLIC_RELAY_URL='$controller_relay' $ctl_cmd"

# 4. Backend (inference) — on by default, --no-backend skips it; activates
#    .venv if present. Deps come from inference/requirements.txt (it declares
#    uvicorn). Without it the app's AI suggestions are disabled but everything
#    else works.
app_mode="electron"
[ "$web" -eq 1 ] && app_mode="web"
if [ "$backend" -eq 1 ]; then
  # On the hotspot there is no hub to reach, and a warm HuggingFace cache will
  # still try — hanging the first suggestion on a DNS timeout before it falls
  # back to disk. HF_HUB_OFFLINE=1 tells it not to bother. It only works because
  # the weights are already there; scripts/preload-models.py is what puts them
  # there, and it verifies exactly this load path.
  hf_env=""
  [ "$hotspot" -eq 1 ] && hf_env="HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 "
  start_sidecar "Timber backend" "cd '$root' && if [ -f .venv/bin/activate ]; then . .venv/bin/activate; fi; ${hf_env}uvicorn inference.api:app --reload --port $backend_port"
  echo "Launched relay (:$relay_port), recorder (:$recorder_port), saver (:$saver_port), app (:$app_port, $app_mode), controller (:$controller_port), backend (:$backend_port)."
else
  echo "Launched relay (:$relay_port), recorder (:$recorder_port), saver (:$saver_port), app (:$app_port, $app_mode), controller (:$controller_port). Backend skipped (--no-backend)."
fi
echo "Projects save to and open from: $saved_data"
echo "Pair: open the remote screen in the app, enter the shown code in the controller."

if [ "$hotspot" -eq 1 ]; then
  echo
  echo "Hotspot up — this laptop IS the network."
  echo "  join on the phone   Wi-Fi '$hotspot_ssid', password '$hotspot_pass'"
  echo "  controller          http://${ap_ip}:${controller_port}"
  echo "  relay it talks to   ${controller_relay}"
  echo "  backend             offline (HF_HUB_OFFLINE=1)"
  echo "  phone mic           disabled — needs HTTPS; take control works"
  echo
  echo "iOS will say 'No Internet Connection'; that's correct, ignore it. Turn"
  echo "auto-join off for other networks or the phone may wander off this one."
  echo "When you're done:  ./scripts/run-dev.sh --hotspot-off"
fi
