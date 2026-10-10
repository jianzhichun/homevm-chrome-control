#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
target=${1:-zengxiaoximac01}
readarray -t config < <(python3 -I - "$root/config/targets.json" "$target" <<'PY'
import json, sys
value = json.load(open(sys.argv[1]))[sys.argv[2]]
print(value['ssh'])
print(value['root'])
print(value['node'])
print(value.get('os', 'darwin'))
PY
)
ssh_args=(-o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=5 -o ServerAliveCountMax=2)
quote() { python3 -I -c 'import shlex,sys; print(shlex.quote(sys.argv[1]))' "$1"; }
remote_root=$(quote "${config[1]}")
node=$(quote "${config[2]}")
npm --prefix "$root" ci --ignore-scripts --no-audit --no-fund
case ${config[3]} in
darwin)
  rsync -az --exclude=node_modules --exclude=.git --exclude=tests --exclude=evidence --exclude=logs --exclude=__pycache__ \
    -e 'ssh -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=5 -o ServerAliveCountMax=2' \
    "$root/" "${config[0]}:${config[1]}/"
  ssh "${ssh_args[@]}" "${config[0]}" "set -e; export PATH=/opt/homebrew/bin:/usr/bin:/bin; npm --prefix $remote_root ci --ignore-scripts --no-audit --no-fund; python3 -I $remote_root/scripts/install-mac-service.py; $node $remote_root/interfaces/cli.mjs deploy status"
  ;;
win32) "$root/scripts/windows/deploy.sh" "${config[0]}" "${config[1]}" "${config[2]}" ;;
*) echo "Unsupported target os: ${config[3]}" >&2; exit 1 ;;
esac
if [[ -e "$HOME/bin/browserctl" || -L "$HOME/bin/browserctl" ]]; then
  [[ $(readlink -f "$HOME/bin/browserctl") == "$root/bin/browserctl" ]] || { echo 'Existing browserctl differs; refusing overwrite.' >&2; exit 1; }
else
  ln -s "$root/bin/browserctl" "$HOME/bin/browserctl"
fi
chmod +x "$root/bin/browserctl"
