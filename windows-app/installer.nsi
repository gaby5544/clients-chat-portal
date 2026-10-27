Unicode true
!include "MUI2.nsh"
Name "Vistra"
OutFile "Vistra-Setup.exe"
InstallDir "$LOCALAPPDATA\Vistra"
RequestExecutionLevel user
BrandingText "Vistra Secure Transaction Desk"
!define MUI_ICON "vistra.ico"
!define MUI_UNICON "vistra.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Vistra.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Vistra now"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "Vistra Transaction Desk"
VIAddVersionKey "CompanyName" "Vistra"
VIAddVersionKey "FileDescription" "Vistra installer"
VIAddVersionKey "FileVersion" "1.0.0.0"
Section "Install"
  SetOutPath "$INSTDIR"
  File "Vistra.exe"
  File "vistra.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Vistra.lnk" "$INSTDIR\Vistra.exe" "" "$INSTDIR\vistra.ico"
  CreateShortcut "$DESKTOP\Vistra.lnk" "$INSTDIR\Vistra.exe" "" "$INSTDIR\vistra.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Vistra" "DisplayName" "Vistra"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Vistra" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Vistra" "Publisher" "Vistra"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Vistra" "DisplayIcon" "$INSTDIR\vistra.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Vistra" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Vistra" "NoModify" 1
SectionEnd
Section "Uninstall"
  Delete "$SMPROGRAMS\Vistra.lnk"
  Delete "$DESKTOP\Vistra.lnk"
  Delete "$INSTDIR\Vistra.exe"
  Delete "$INSTDIR\vistra.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Vistra"
SectionEnd
