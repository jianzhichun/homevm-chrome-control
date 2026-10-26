export PATH=/opt/homebrew/bin:/usr/bin:/bin
export XDG_RUNTIME_DIR="$HOME/Library/Caches/chrome-control/runtime"
export TMPDIR="$HOME/tmp/chrome-control"
export CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1
export CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1
cd "$HOME/Brook/Local/chrome-control"
browserctl --actor terminal-connect status | tee evidence/terminal-connect-status.txt
browserctl --actor terminal-connect pages | tee evidence/terminal-connect-pages.txt
touch evidence/terminal-connect-done.txt
