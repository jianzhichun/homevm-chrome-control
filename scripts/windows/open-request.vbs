' open-request.vbs -- open a URL in one profile of the ALREADY RUNNING
' Chrome, from the INTERACTIVE logon session. A chrome.exe spawned from an
' SSH session cannot hand the URL across logon sessions (the profile's
' ProcessSingleton lock lives in the interactive one), so the downloader
' instead writes %LOCALAPPDATA%\chrome-control\open-request.txt
'   line 1: chrome.exe path
'   line 2: profile directory name
'   line 3: url
' (ASCII only) and /Runs this task; wscript runs inside the user session,
' forwards the URL to the existing browser, and removes the request file.
Dim fso, shell, q, base, req, f, exe, profile, url
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
q = Chr(34)
base = fso.BuildPath(shell.ExpandEnvironmentStrings("%LOCALAPPDATA%"), "chrome-control")
req = fso.BuildPath(base, "open-request.txt")
If Not fso.FileExists(req) Then WScript.Quit 0
Set f = fso.OpenTextFile(req, 1)
exe = f.ReadLine
profile = f.ReadLine
url = f.ReadLine
f.Close
fso.DeleteFile req, True
If Len(exe) = 0 Or Len(profile) = 0 Or Len(url) = 0 Then WScript.Quit 0
shell.Run q & exe & q & " --profile-directory " & q & profile & q & " " & q & url & q, 0, False
