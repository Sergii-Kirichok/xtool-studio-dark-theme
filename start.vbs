' Запускает xtool.mjs без окна консоли. Ярлык на рабочий стол: ПКМ по этому файлу -> Отправить -> Рабочий стол.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "node """ & dir & "\xtool.mjs""", 0, False
