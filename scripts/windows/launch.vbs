' launch.vbs <node.exe> <cli.mjs> [instance] -- boot a chrome-control daemon
' (default instance, or the named one from hosts.json browsers.*) with no console window.
'
' Run by the \chrome-control task (at logon and every 5 minutes) as `wscript.exe //B //Nologo launch.vbs ...`.
' wscript is a GUI-subsystem program and never owns a console; .Run(cmd, 0,
' False) starts cmd/node hidden (SW_HIDE), and the official daemon then
' detaches with windowsHide. //B keeps any script error off the desktop.
Dim a, shell, fso, q, logs, cmd
Set a = WScript.Arguments
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
q = Chr(34)
logs = fso.GetParentFolderName(fso.GetParentFolderName(a(1))) & "\logs"
If Not fso.FolderExists(logs) Then fso.CreateFolder(logs)
inst = ""
If a.Count >= 3 Then inst = "set CHROME_CONTROL_INSTANCE=" & a(2) & " && "
cmd = "cmd.exe /d /c " & q & inst & q & a(0) & q & " " & q & a(1) & q & " service boot >> " & q & logs & "\startup.log" & q & " 2>&1" & q
shell.Run cmd, 0, False
