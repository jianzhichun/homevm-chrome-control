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
case ${config[3]} in
darwin) python3 -I "$root/scripts/deploy-mac.py" "$target" ;;
win32) "$root/scripts/windows/deploy.sh" "${config[0]}" "${config[1]}" "${config[2]}" ;;
*) echo "Unsupported target os: ${config[3]}" >&2; exit 1 ;;
esac
if [[ -e "$HOME/bin/browserctl" || -L "$HOME/bin/browserctl" ]]; then
  [[ $(readlink -f "$HOME/bin/browserctl") == "$root/bin/browserctl" ]] || { echo 'Existing browserctl differs; refusing overwrite.' >&2; exit 1; }
else
  ln -s "$root/bin/browserctl" "$HOME/bin/browserctl"
fi
chmod +x "$root/bin/browserctl"
