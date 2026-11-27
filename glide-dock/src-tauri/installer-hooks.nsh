; Glide Dock uninstall: put the Windows taskbar back and remove the start-up entry, even if the dock
; was killed rather than quit. Runs before the files are deleted.
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\glide-dock.exe" --cleanup'
!macroend
