' launch.vbs <node.exe> <cli.mjs> [instance] [profile] -- hidden CLI bootstrap.
' The scheduled task provides the interactive logon identity needed for DPAPI.
Dim a, shell, fso, q, logs, cmd, environment
Set a = WScript.Arguments
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set environment = shell.Environment("PROCESS")
q = Chr(34)
logs = fso.GetParentFolderName(fso.GetParentFolderName(a(1))) & "\logs"
If Not fso.FolderExists(logs) Then fso.CreateFolder(logs)
environment("CHROME_CONTROL_INSTANCE") = ""
environment("CHROME_CONTROL_PROFILE") = ""
If a.Count >= 3 Then environment("CHROME_CONTROL_INSTANCE") = a(2)
If a.Count >= 4 Then
  If a(3) <> "" And Left(a(3), 2) <> "$(" Then environment("CHROME_CONTROL_PROFILE") = a(3)
End If
cmd = "cmd.exe /d /c " & q & q & a(0) & q & " " & q & a(1) & q & " service boot >> " & q & logs & "\startup.log" & q & " 2>&1" & q
shell.Run cmd, 0, False
