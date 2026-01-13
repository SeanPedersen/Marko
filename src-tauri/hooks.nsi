!macro NSIS_HOOK_POST_INSTALL
  CreateShortcut "$DESKTOP\Markdown Viewer.lnk" "$INSTDIR\markdown-viewer-v2.exe" "" "$INSTDIR\markdown-viewer-v2.exe" 0
!macroend

!macro NSIS_HOOK_POST_UNINSTALL
  Delete "$DESKTOP\Markdown Viewer.lnk"
!macroend
