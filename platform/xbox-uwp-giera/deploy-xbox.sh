#!/usr/bin/env bash
set -euo pipefail

# Installs the Giera package on an Xbox in Developer Mode and prints the host boot log.
#
#   CONSOLE=192.168.1.50 PORTAL_USER=jakub PORTAL_PASS=secret ./deploy-xbox.sh install
#   CONSOLE=192.168.1.50 PORTAL_USER=jakub PORTAL_PASS=secret ./deploy-xbox.sh log
#
# Dev Home on the console shows both the address and the portal credentials.

CONSOLE="${CONSOLE:?set CONSOLE to the console address shown in Dev Home}"
PORTAL_USER="${PORTAL_USER:?set PORTAL_USER}"
PORTAL_PASS="${PORTAL_PASS:?set PORTAL_PASS}"
BASE="https://${CONSOLE}:11443"
APPX="${APPX:-AppPackages/Giera.Uwp_1.0.0.0_x64_Test/Giera.Uwp_1.0.0.0_x64.appx}"
PFN_PREFIX="Giera.Uwp_1.0.0.0_x64__"

portal() {
  curl -sk -u "${PORTAL_USER}:${PORTAL_PASS}" "$@"
}

packages() {
  portal "${BASE}/api/app/packagemanager/packages"
}

case "${1:-install}" in
  install)
    [ -f "$APPX" ] || { echo "missing package: $APPX" >&2; exit 1; }
    portal -F "file=@${APPX}" \
      "${BASE}/api/app/packagemanager/package?package=$(basename "$APPX")"
    echo
    packages | tr ',' '\n' | grep -E 'PackageFullName|Name' || true
    ;;
  log)
    full="$(packages | tr ',' '\n' | grep -o "${PFN_PREFIX}[a-z0-9]*" | head -1)"
    [ -n "$full" ] || { echo "Giera.Uwp is not installed on the console" >&2; exit 1; }
    portal -G "${BASE}/api/filesystem/apps/file" \
      --data-urlencode "knownfolderid=LocalAppData" \
      --data-urlencode "packagefullname=${full}" \
      --data-urlencode "path=boot-log.txt"
    echo
    ;;
  *)
    echo "usage: $0 [install|log]" >&2
    exit 2
    ;;
esac