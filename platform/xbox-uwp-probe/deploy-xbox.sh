#!/usr/bin/env bash
set -euo pipefail

# Installs the probe package on an Xbox in Developer Mode and prints the probe result.
#
# Credentials come from PORTAL_USER / PORTAL_PASS, or from the file named by
# PORTAL_ENV (default ~/.config/giera/xbox-portal.env, chmod 600).
#
#   ./deploy-xbox.sh install
#   ./deploy-xbox.sh result
#
# Dev Home on the console shows both the address and the portal credentials.

PORTAL_ENV="${PORTAL_ENV:-$HOME/.config/giera/xbox-portal.env}"
if [ -f "$PORTAL_ENV" ]; then
  set -a
  . "$PORTAL_ENV"
  set +a
fi

CONSOLE="${CONSOLE:-192.168.50.105}"
PORTAL_USER="${PORTAL_USER:?set PORTAL_USER or write $PORTAL_ENV}"
PORTAL_PASS="${PORTAL_PASS:?set PORTAL_PASS or write $PORTAL_ENV}"
BASE="https://${CONSOLE}:11443"
APPX="${APPX:-$(cd "$(dirname "$0")" && pwd)/dist/Giera.XboxProbe_1.0.0.0_x64.appx}"
PFN_PREFIX="Giera.XboxProbe_1.0.0.0_x64__"

portal() {
  curl -sk -u "${PORTAL_USER}:${PORTAL_PASS}" "$@"
}

packages() {
  portal "${BASE}/api/app/packagemanager/packages"
}

full_package() {
  packages | jq -r --arg p "$PFN_PREFIX" '.InstalledPackages[]|select(.PackageFullName|startswith($p))|.PackageFullName' | head -1
}

case "${1:-install}" in
  install)
    [ -f "$APPX" ] || { echo "missing package: $APPX" >&2; exit 1; }
    portal -F "file=@${APPX}" \
      "${BASE}/api/app/packagemanager/package?package=$(basename "$APPX")" -o /dev/null
    echo "installed $(full_package)"
    ;;
  result)
    full="$(full_package)"
    [ -n "$full" ] || { echo "probe package is not installed on the console" >&2; exit 1; }
    portal -G "${BASE}/api/filesystem/apps/file" \
      --data-urlencode "knownfolderid=LocalAppData" \
      --data-urlencode "packagefullname=${full}" \
      --data-urlencode 'filename=LocalState\probe-result.json'
    echo
    ;;
  launch)
    echo "start the app from Dev Home on the console; the portal has no app-launch API on Xbox" >&2
    exit 2
    ;;
  *)
    echo "usage: $0 [install|result]" >&2
    exit 2
    ;;
esac