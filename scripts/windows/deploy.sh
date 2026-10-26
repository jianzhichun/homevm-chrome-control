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

# 2. Preserve source rollback, then copy only this project's source.
remote "r=\$(cygpath -u $(q "$root")); if [[ -d \"\$r\" ]]; then b=\"\$r/evidence/rollback/\$(date +%Y%m%d-%H%M%S)\"; mkdir -p \"\$b\"; tar -C \"\$r\" --exclude=node_modules --exclude=.git --exclude=tests --exclude=evidence --exclude=logs -czf \"\$b/source.tar.gz\" .; fi"
# The lockfile resolves to npm.internal, whose CA is in the Windows store but
# not in Node's bundled list, hence --use-system-ca.
tar -C "$project" --exclude=node_modules --exclude=.git --exclude=tests --exclude=evidence --exclude=logs --exclude=__pycache__ -czf - . |
  remote "d=\$(cygpath -u $(q "$root")); mkdir -p \"\$d\" && tar -xzf - -C \"\$d\""
# npm's cache and compile cache go to a per-run temp dir that is removed after.
remote "cd \"\$(cygpath -u $(q "$root"))\" && n=\$(cygpath -u $(q "$node")) && mkdir -p \"\$HOME/tmp\" && c=\$(mktemp -d \"\$HOME/tmp/chrome-control-npm.XXXXXX\") && trap 'rm -rf -- \"\$c\"' EXIT &&
  NODE_DISABLE_COMPILE_CACHE=1 \"\$n\" --use-system-ca \"\$(dirname \"\$n\")/node_modules/npm/bin/npm-cli.js\" ci --ignore-scripts --no-audit --no-fund --no-update-notifier --cache \"\$(cygpath -w \"\$c\")\" &&
  \"\$n\" scripts/prune-obsolete.mjs && \"\$n\" scripts/patch-playwright-opener.mjs"

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
  python3 -I - "$here/task.xml" "$sid" "$user" "$(winpath "$root")" "$(winpath "$node")" "$2" <<'PY' | iconv -f utf-8 -t utf-16 | remote "mkdir -p \"\$HOME/tmp\"; f=\$(mktemp \"\$HOME/tmp/chrome-control-task.XXXXXX.xml\"); trap 'rm -f -- \"\$f\"' EXIT; cat > \"\$f\"; schtasks //Create //TN $(q "$1") //XML \"\$(cygpath -w \"\$f\")\" //F"
import sys
from xml.sax.saxutils import escape
template, sid, user, root, node, instance = sys.argv[1:]
print(open(template).read().format(sid=escape(sid), user=escape(user), root=escape(root), node=escape(node), instance=escape(instance)), end='')
PY
}
render_task chrome-control ""
for inst in $instances; do
  render_task "chrome-control-$inst" "$inst"
done
local_digest=$(node "$project/interfaces/cli.mjs" deploy capabilities | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["sourceDigest"])')
remote_digest=$(remote "env MSYS2_ARG_CONV_EXCL='*' $(q "$node") $(q "$root/interfaces/cli.mjs") deploy capabilities" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["sourceDigest"])')
[[ $local_digest == "$remote_digest" ]] || { printf 'Windows source digest mismatch\n' >&2; exit 1; }
printf 'Windows source verified: %s\n' "$remote_digest"

