tell application "System Events"
 set axEnabled to UI elements enabled
 try
  tell process "Google Chrome" to set countWindows to count of windows
  return "accessibility=" & (axEnabled as text) & ", chromeWindowCount=" & (countWindows as text)
 on error reason number code
  return "accessibility=" & (axEnabled as text) & ", error=" & (code as text) & ", reason=" & reason
 end try
end tell
