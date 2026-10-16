' Launch the product-sheet server (port 3002) in its own hidden console so closing or Ctrl+C
' in any other terminal cannot stop it. Run by the "SML Product Sheet" scheduled task / Startup.
' Stop it with:  taskkill /F /PID <pid listening on 127.0.0.1:3002>
Set shell = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
shell.Run "cmd /c ""set PRODUCT_SHEET_BACKGROUND=1&& node --env-file=.env product-sheet/server.js >> product-sheet\server.log 2>&1""", 0, False
