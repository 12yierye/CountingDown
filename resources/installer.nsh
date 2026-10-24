; 安装界面定制（electron-builder 的 nsis.include 入口）
;
; 这个文件会在 installer.nsi 之前被 include，所以这里的 !define 能影响后面
; MUI2 页面的装配；!macro 则是 electron-builder 自己留的钩子。
;
; 注意：不要在这里 !define MUI_FINISHPAGE_RUN / MUI_FINISHPAGE_RUN_FUNCTION，
; 模板里已经定义过，重复定义会直接编译失败。

; ---------------------------------------------------------------------------
; 1) 去掉「为谁安装」这一页
;
; perMachine=false 时 electron-builder 一定会插一个「仅为我 / 所有用户」的单选页。
; 一个倒数日小组件不需要问这个：装到当前用户、不写系统目录、不弹 UAC 就对了。
; 设 $isForceCurrentInstall=1 后，那一页的 PRE 回调会自己 Abort 掉（页面被跳过），
; 安装模式仍然是 per-user。
; ---------------------------------------------------------------------------
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; ---------------------------------------------------------------------------
; 2) 欢迎页：electron-builder 的辅助安装器默认**没有**这一页，
;    要么从目录页开始（很生硬），要么自己画。这里自己画：
;    页面主体就是一张整幅图（installerWelcome.bmp，503x313，脚本生成），
;    图上写着版本、装完有什么、下一步会发生什么；页面上不再放别的控件，
;    也就不会出现控件错位。
;
;    函数必须写在宏里：这个文件在 MUI2 / LogicLib / nsDialogs 之前被 include，
;    直接写 Function 会因为 ${If}、${NSD_CreateBitmap} 还没定义而编译失败。
; ---------------------------------------------------------------------------
!macro customWelcomePage
  !insertmacro MUI_PAGE_INIT
  Page custom WelcomePageCreate WelcomePageLeave

  Function WelcomePageCreate
    !insertmacro MUI_HEADER_TEXT "安装倒数日" "两步就装完，全程不需要管理员权限"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    File /oname=$PLUGINSDIR\cd-welcome.bmp "${BUILD_RESOURCES_DIR}\installerWelcome.bmp"
    ${NSD_CreateBitmap} 0 0 100% 100% ""
    Pop $1
    ${NSD_SetImage} $1 "$PLUGINSDIR\cd-welcome.bmp" $2

    nsDialogs::Show
  FunctionEnd

  Function WelcomePageLeave
    ${NSD_FreeImage} $2
  FunctionEnd
!macroend

; ---------------------------------------------------------------------------
; 3) 安装位置页
; ---------------------------------------------------------------------------
!define MUI_DIRECTORYPAGE_TEXT_TOP "倒数日会装进这个文件夹。想换地方点「浏览」，或者直接改路径。"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "安装到"

; ---------------------------------------------------------------------------
; 4) 安装进度页：彩色进度条，别用那条灰白相间的
; ---------------------------------------------------------------------------
!define MUI_INSTFILESPAGE_PROGRESSBAR colored

; ---------------------------------------------------------------------------
; 5) 完成页：告诉用户装完之后该看哪儿
; ---------------------------------------------------------------------------
!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "倒数日 ${VERSION} 已经装好了。$\r$\n$\r$\n托盘里会多一个图标，卡片默认出现在屏幕右上角。右键托盘可以改位置、开鼠标穿透、隐藏卡片，或者彻底退出。"
!define MUI_FINISHPAGE_RUN_TEXT "立即运行倒数日"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT
