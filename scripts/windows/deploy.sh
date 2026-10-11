#!/usr/bin/env bash
# deploy.sh <ssh-alias> <root> <node> -- deploy chrome-control to a Windows host.
# The remote login shell is MSYS/Git-Bash: remote paths go through cygpath, and
# files travel over ssh stdin (tar, no rsync/scp on the far side).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
project=$(cd "$here/../.." && pwd)
host=$1 root=$2 node=$3
node_version=v24.21.0
[[ $node == *"/node-$node_version-win-x64/node.exe" ]] || { echo "targets.json node must be node-$node_version-win-x64" >&2; exit 1; }
remote() { ssh -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 "$host" "$@"; }
q() { printf %q "$1"; }

# 1. Pinned portable Node, verified against the official SHASUMS256.txt.
if ! remote "test -x \"\$(cygpath -u $(q "$node"))\""; then
  cache=${TMPDIR:-$HOME/tmp}/chrome-control-node; mkdir -p "$cache"
  zip=node-$node_version-win-x64.zip
  [[ -f $cache/$zip ]] || curl -fsS -m 300 -o "$cache/$zip" "https://nodejs.org/dist/$node_version/$zip"
  curl -fsS -m 30 "https://nodejs.org/dist/$node_version/SHASUMS256.txt" | grep " $zip\$" | (cd "$cache" && sha256sum -c -)
  app=$(dirname "$(dirname "$node")")
  remote "d=\$(cygpath -u $(q "$app")); mkdir -p \"\$d\" && cat > \"\$d/node.zip\" && cd \"\$d\" && unzip -q -o node.zip && rm node.zip" < "$cache/$zip"
fi

# 2. Code (no deletion of remote files, as on macOS), then locked dependencies.
# The lockfile resolves to npm.internal, whose CA is in the Windows store but
# not in Node's bundled list, hence --use-system-ca.
tar -C "$project" --exclude=node_modules --exclude=.git --exclude=tests --exclude=evidence --exclude=logs --exclude=__pycache__ -czf - . |
  remote "d=\$(cygpath -u $(q "$root")); mkdir -p \"\$d\" && tar -xzf - -C \"\$d\""
# npm's cache and compile cache go to a per-run temp dir that is removed after.
remote "cd \"\$(cygpath -u $(q "$root"))\" && n=\$(cygpath -u $(q "$node")) && c=\$(mktemp -d) && trap 'rm -rf \"\$c\"' EXIT &&
  NODE_DISABLE_COMPILE_CACHE=1 \"\$n\" --use-system-ca \"\$(dirname \"\$n\")/node_modules/npm/bin/npm-cli.js\" ci --ignore-scripts --no-audit --no-fund --no-update-notifier --cache \"\$(cygpath -w \"\$c\")\""

# 3. Logon tasks, rendered here (UTF-16, as schtasks expects) and registered.
#    The default task is always installed; the named-instance task(s) from
#    hosts.json browsers.* (the owner's real Chrome) are added alongside it,
#    each booting its own daemon in the interactive session.
read -r sid user < <(remote '"$(cygpath -u "$SYSTEMROOT")/System32/whoami.exe" //user //fo csv //nh' | tr -d '\r"' | awk -F, '{print $2, $1}')
winpath() { tr / '\\' <<<"$1"; }
instances=$(python3 -I - "$project/config/hosts.json" <<'PY'
import json, sys
spec = json.load(open(sys.argv[1])).get('win32', {})
for name in (spec.get('browsers') or {}):
    print(name)
PY
)
render_task() { # $1=task name  $2=instance arg ('' or ' real')
  python3 -I - "$here/task.xml" "$sid" "$user" "$(winpath "$root")" "$(winpath "$node")" "$2" <<'PY' | iconv -f utf-8 -t utf-16 | remote 'cat > "$TEMP/chrome-control.task.xml"'
import sys
from xml.sax.saxutils import escape
template, sid, user, root, node, instance = sys.argv[1:]
print(open(template).read().format(sid=escape(sid), user=escape(user), root=escape(root), node=escape(node), instance=escape(instance)), end='')
PY
  remote "schtasks //Create //TN $1 //XML \"\$(cygpath -w \"\$TEMP/chrome-control.task.xml\")\" //F; rc=\$?; rm -f \"\$TEMP/chrome-control.task.xml\"; exit \$rc"
}
render_task chrome-control ""
for inst in $instances; do
  render_task "chrome-control-$inst" " $inst"
done
