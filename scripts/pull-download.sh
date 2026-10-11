#!/usr/bin/env bash
# pull-download.sh <machine> <remote-path> <dest> <expected-sha256> [--pdf]
#
# Pulls a file the browser machine staged, with resume: the transfer is
# appended in tail -c chunks over the existing ssh channel until the local
# partial reaches the remote size, then the claimed sha256 (and optionally
# the %PDF- magic) is checked before the file is moved into place. No rsync
# needed on the far side (Windows Git-Bash has none).
set -euo pipefail
machine=$1 remote=$2 dest=$3 want=$4
want_pdf=${5:-}
[[ $want_pdf == "--pdf" || -z $want_pdf ]] || { echo "usage: pull-download.sh <machine> <remote-path> <dest> <sha256> [--pdf]" >&2; exit 2; }
remote=${remote//\\//}

ssh_opts=(-o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=5 -o ServerAliveCountMax=2)
remote_size() {
  ssh "${ssh_opts[@]}" "$machine" "wc -c < \"$remote\"" 2>/dev/null | tr -d '\r[:space:]'
}
partial=$dest.part
mkdir -p "$(dirname "$dest")"

target=$(remote_size)
[[ $target =~ ^[0-9]+$ ]] || { echo "remote file not readable: $remote" >&2; exit 1; }

while :; do
  have=$(stat -c %s "$partial" 2>/dev/null || echo 0)
  if (( have > target )); then echo "partial ($have) larger than remote ($target); deleting stale partial" >&2; rm -f "$partial"; have=0; fi
  (( have == target )) && break
  ssh "${ssh_opts[@]}" "$machine" "tail -c +$((have + 1)) \"$remote\"" >> "$partial"
  fresh=$(stat -c %s "$partial")
  (( fresh > have )) || { echo "transfer made no progress at byte $have" >&2; exit 1; }
done

got=$(sha256sum "$partial" | awk '{print $1}')
[[ $got == "$want" ]] || { echo "sha256 mismatch: got $got want $want (partial kept at $partial)" >&2; exit 1; }
if [[ $want_pdf == "--pdf" ]]; then
  head -c 5 "$partial" | grep -q '^%PDF-' || { echo "not a PDF (magic missing); partial kept at $partial" >&2; exit 1; }
fi
mv "$partial" "$dest"
echo "pulled $dest ($target bytes, sha256 verified)"
