# 生成 NSIS 安装界面的两张位图（默认那套是灰色空白页，很难看）：
#   resources/installerSidebar.bmp  164x314  欢迎页 / 完成页左侧竖图
#   resources/installerHeader.bmp   150x057  后续页面右上角的横幅
#
# NSIS 只认 24 位无 alpha 的 BMP，所以这里固定用 Format24bppRgb，
# 配色跟应用图标同一套（#3a7aff → #5c42e0），不另外发明视觉。
param(
  [string]$OutDir = "$PSScriptRoot\..\resources",
  [string]$Version = ""
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not $Version) {
  # 必须显式 UTF8：Windows PowerShell 5.1 默认按 ANSI 读，中文产品名会变乱码
  $Version = (Get-Content "$PSScriptRoot\..\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version
}

$fontFamily = 'Microsoft YaHei UI'
$tmpFonts = New-Object System.Collections.ArrayList

function New-Font {
  param([single]$Size, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular)
  $font = $null
  try {
    $font = New-Object System.Drawing.Font($fontFamily, $Size, $Style, [System.Drawing.GraphicsUnit]::Pixel)
  } catch {
    $font = New-Object System.Drawing.Font('Segoe UI', $Size, $Style, [System.Drawing.GraphicsUnit]::Pixel)
  }
  [void]$tmpFonts.Add($font)
  return $font
}

function New-RoundedPath {
  param(
    [Parameter(Mandatory = $true)][System.Drawing.RectangleF]$Rect,
    [Parameter(Mandatory = $true)][single]$Radius
  )
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [single]($Radius * 2)
  $path.AddArc([single]$Rect.X, [single]$Rect.Y, $d, $d, [single]180, [single]90)
  $path.AddArc([single]($Rect.Right - $d), [single]$Rect.Y, $d, $d, [single]270, [single]90)
  $path.AddArc([single]($Rect.Right - $d), [single]($Rect.Bottom - $d), $d, $d, [single]0, [single]90)
  $path.AddArc([single]$Rect.X, [single]($Rect.Bottom - $d), $d, $d, [single]90, [single]90)
  $path.CloseFigure()
  return $path
}

# 应用标记：渐变圆角方块 + 白色的「27」，与 icon.ico 的构成一致
function Draw-Mark {
  param(
    [Parameter(Mandatory = $true)][System.Drawing.Graphics]$Graphics,
    [Parameter(Mandatory = $true)][single]$X,
    [Parameter(Mandatory = $true)][single]$Y,
    [Parameter(Mandatory = $true)][single]$Size
  )
  $rect = New-Object System.Drawing.RectangleF([single]$X, [single]$Y, [single]$Size, [single]$Size)
  $path = New-RoundedPath -Rect $rect -Radius ([single]($Size * 0.22))
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 58, 122, 255),
    [System.Drawing.Color]::FromArgb(255, 92, 66, 224),
    [single]60
  )
  try {
    $Graphics.FillPath($brush, $path)
  } finally {
    $brush.Dispose()
    $path.Dispose()
  }

  $font = New-Font -Size ([single]($Size * 0.46)) -Style ([System.Drawing.FontStyle]::Bold)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textRect = New-Object System.Drawing.RectangleF([single]$X, [single]($Y + $Size * 0.02), [single]$Size, [single]$Size)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  try {
    $Graphics.DrawString('27', $font, $white, $textRect, $format)
  } finally {
    $white.Dispose()
    $format.Dispose()
  }
}

function New-Canvas {
  param([int]$Width, [int]$Height)
  # 24bpp：NSIS 不接受带 alpha 的 BMP
  return New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
}

function Save-Bmp {
  param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  Write-Host ("wrote {0} ({1}x{2})" -f $Path, $Bitmap.Width, $Bitmap.Height)
}

# ----------------------------------------------------------------- 侧栏竖图
$sidebar = New-Canvas -Width 164 -Height 314
$g = [System.Drawing.Graphics]::FromImage($sidebar)
try {
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0, 0, 164, 314)),
    [System.Drawing.Color]::FromArgb(255, 16, 20, 41),
    [System.Drawing.Color]::FromArgb(255, 30, 32, 66),
    [single]90
  )
  try {
    $g.FillRectangle($bg, 0, 0, 164, 314)
  } finally {
    $bg.Dispose()
  }

  Draw-Mark -Graphics $g -X 50 -Y 44 -Size 64

  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center

  $nameFont = New-Font -Size 20 -Style ([System.Drawing.FontStyle]::Bold)
  $nameBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 245, 247, 255))
  try {
    $g.DrawString('倒数日', $nameFont, $nameBrush, (New-Object System.Drawing.RectangleF(0, 128, 164, 30)), $format)
  } finally {
    $nameBrush.Dispose()
  }

  $subFont = New-Font -Size 10
  $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 138, 146, 182))
  try {
    $g.DrawString('COUNTINGDOWN', $subFont, $subBrush, (New-Object System.Drawing.RectangleF(0, 162, 164, 18)), $format)
  } finally {
    $subBrush.Dispose()
  }

  # 一条细分隔线，别让下半部分太空
  $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 58, 70, 120), 1)
  try {
    $g.DrawLine($linePen, 52, 246, 112, 246)
  } finally {
    $linePen.Dispose()
  }

  $verFont = New-Font -Size 11
  $verBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 118, 126, 163))
  try {
    $g.DrawString(("v{0}" -f $Version), $verFont, $verBrush, (New-Object System.Drawing.RectangleF(0, 254, 164, 18)), $format)
  } finally {
    $verBrush.Dispose()
    $format.Dispose()
  }
} finally {
  $g.Dispose()
}
Save-Bmp -Bitmap $sidebar -Path (Join-Path $OutDir 'installerSidebar.bmp')
$sidebar.Dispose()

# ----------------------------------------------------------------- 顶部横幅
$header = New-Canvas -Width 150 -Height 57
$g = [System.Drawing.Graphics]::FromImage($header)
try {
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0, 0, 150, 57)),
    [System.Drawing.Color]::FromArgb(255, 16, 20, 41),
    [System.Drawing.Color]::FromArgb(255, 30, 32, 66),
    [single]0
  )
  try {
    $g.FillRectangle($bg, 0, 0, 150, 57)
  } finally {
    $bg.Dispose()
  }

  Draw-Mark -Graphics $g -X 14 -Y 14 -Size 29

  $nameFont = New-Font -Size 14 -Style ([System.Drawing.FontStyle]::Bold)
  $nameBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 245, 247, 255))
  try {
    $g.DrawString('倒数日', $nameFont, $nameBrush, 52, 12)
  } finally {
    $nameBrush.Dispose()
  }

  $verFont = New-Font -Size 10
  $verBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 138, 146, 182))
  try {
    $g.DrawString(("v{0}" -f $Version), $verFont, $verBrush, 53, 31)
  } finally {
    $verBrush.Dispose()
  }
} finally {
  $g.Dispose()
}
Save-Bmp -Bitmap $header -Path (Join-Path $OutDir 'installerHeader.bmp')
$header.Dispose()

foreach ($font in $tmpFonts) { $font.Dispose() }

# ----------------------------------------------------------------- 欢迎页整幅
# electron-builder 的辅助安装器**没有**内置欢迎页，要么没有这一页，
# 要么自己画一整页。这里直接画一张 503x313 的整幅图铺满页面主体：
# 图上就是全部内容，页面上不再放任何控件，位置不可能错。
$welcome = New-Canvas -Width 520 -Height 225
$g = [System.Drawing.Graphics]::FromImage($welcome)
try {
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0, 0, 520, 225)),
    [System.Drawing.Color]::FromArgb(255, 16, 20, 41),
    [System.Drawing.Color]::FromArgb(255, 34, 36, 74),
    [single]25
  )
  try {
    $g.FillRectangle($bg, 0, 0, 520, 272)
  } finally {
    $bg.Dispose()
  }

  Draw-Mark -Graphics $g -X 32 -Y 22 -Size 56

  $nameFont = New-Font -Size 24 -Style ([System.Drawing.FontStyle]::Bold)
  $nameBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 245, 247, 255))
  try {
    $g.DrawString('倒数日', $nameFont, $nameBrush, 100, 24)
  } finally {
    $nameBrush.Dispose()
  }

  $verFont = New-Font -Size 12
  $verBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 138, 146, 182))
  try {
    $g.DrawString(("v{0}   ·   Windows 桌面小组件" -f $Version), $verFont, $verBrush, 102, 60)
  } finally {
    $verBrush.Dispose()
  }

  $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 52, 60, 104), 1)
  try {
    $g.DrawLine($linePen, 32, 96, 488, 96)
  } finally {
    $linePen.Dispose()
  }

  $bodyFont = New-Font -Size 12
  $bodyBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 196, 203, 226))
  try {
    $text = "装完之后：`n" +
      "  ·  桌面上出现一张卡片，把日子数给你看`n" +
      "  ·  托盘常驻，右键可以改位置、隐藏、退出`n" +
      "  ·  完全离线运行，不联网也能用"
    $g.DrawString($text, $bodyFont, $bodyBrush, (New-Object System.Drawing.RectangleF(32, 106, 456, 100)))
  } finally {
    $bodyBrush.Dispose()
  }
} finally {
  $g.Dispose()
}
Save-Bmp -Bitmap $welcome -Path (Join-Path $OutDir 'installerWelcome.bmp')
$welcome.Dispose()
