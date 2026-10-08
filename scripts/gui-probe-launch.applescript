tell application "Terminal"
 activate
 set newWindow to do script "/usr/bin/osascript -e 'tell application \"System Events\" to get UI elements enabled' > \"$HOME/workspace/chrome-control/evidence/gui-accessibility.txt\" 2>&1; /usr/bin/osascript -e 'tell application \"System Events\" to tell process \"Google Chrome\" to count of windows' >> \"$HOME/workspace/chrome-control/evidence/gui-accessibility.txt\" 2>&1; echo TERMINAL-DIRECT-PROBE-DONE; exit"
end tell