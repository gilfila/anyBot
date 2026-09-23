; electron-builder NSIS hooks. Loaded automatically from build/installer.nsh.

!macro customInit
  ; 0.2.25 shipped @capacitor/android (a mobile-only dependency) with its
  ; Gradle build output under resources\app.asar.unpacked, at paths up to
  ; 258 characters. Before installing, NSIS runs the old uninstaller, which
  ; moves every file into $PLUGINSDIR\old-install for rollback; that longer
  ; path passes MAX_PATH, the move fails, and the update aborts with exit
  ; code 2. The desktop app never loads @capacitor, so delete it in place
  ; (where the paths still fit) before the old uninstaller runs.
  ; $INSTDIR is already resolved from the registry by initMultiUser here.
  ${if} ${FileExists} "$INSTDIR\resources\app.asar.unpacked\node_modules\@capacitor\*.*"
    RMDir /r "$INSTDIR\resources\app.asar.unpacked\node_modules\@capacitor"
  ${endif}
!macroend
