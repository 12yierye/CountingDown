param(
  [string]$OutDir = "$PSScriptRoot\..\resources"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
  param(
    [Parameter(Mandatory = $true)][System.Drawing.RectangleF]$Rect,
    [Parameter(Mandatory = $true)][single]$Radius
  )
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [single]($Radius * 2)
  $segments = @(
    @{ X = $Rect.X; Y = $Rect.Y; Angle = 180 },
    @{ X = $Rect.Right - $d; Y = $Rect.Y; Angle = 270 },
    @{ X = $Rect.Right - $d; Y = $Rect.Bottom - $d; Angle = 0 },
    @{ X = $Rect.X; Y = $Rect.Bottom - $d; Angle = 90 }
  )
  foreach ($seg in $segments) {
    $path.AddArc([single]$seg.X, [single]$seg.Y, $d, $d, [single]$seg.Angle, [single]90)
  }
  $path.CloseFigure()
  return $path
}

function New-Icon {
  param(
    [Parameter(Mandatory = $true)][int]$Size,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = [single]$Size / 256.0
    $pad = [single](12 * $s)
    $rect = New-Object System.Drawing.RectangleF(
      [single]$pad,
      [single]$pad,
      [single]($Size - 2 * $pad),
      [single]($Size - 2 * $pad)
    )

    $path = New-RoundedPath -Rect $rect -Radius ([single](52 * $s))
    try {
      $topColor = [System.Drawing.Color]::FromArgb(255, 58, 122, 255)
      $bottomColor = [System.Drawing.Color]::FromArgb(255, 92, 66, 224)
      $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $topColor, $bottomColor, [single]60)
      try {
        $g.FillPath($brush, $path)
      } finally {
        $brush.Dispose()
      }

      # 日历顶部高光条
      $headerHeight = [single](58 * $s)
      $headerRect = New-Object System.Drawing.RectangleF(
        [single]$pad,
        [single]$pad,
        [single]($Size - 2 * $pad),
        $headerHeight
      )
      $headerPath = New-RoundedPath -Rect $headerRect -Radius ([single](52 * $s))
      try {
        $clip = $g.Clip
        $g.SetClip($headerPath)
        $headerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(72, 255, 255, 255))
        try {
          $g.FillRectangle($headerBrush, $headerRect)
        } finally {
          $headerBrush.Dispose()
          $g.Clip = $clip
        }
      } finally {
        $headerPath.Dispose()
      }

      # 挂环
      $ringBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
      try {
        $ringW = [single](15 * $s)
        $ringH = [single](28 * $s)
        foreach ($cx in @(88, 168)) {
          $rx = [single]($pad + ($cx * $s) - $ringW / 2)
          $ry = [single]($pad + 15 * $s)
          $ringRect = New-Object System.Drawing.RectangleF($rx, $ry, $ringW, $ringH)
          $ringPath = New-RoundedPath -Rect $ringRect -Radius ([single]($ringW / 2))
          try {
            $g.FillPath($ringBrush, $ringPath)
          } finally {
            $ringPath.Dispose()
          }
        }
      } finally {
        $ringBrush.Dispose()
      }

      # 日期数字
      $fontSize = [single](100 * $s)
      $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
      $format = New-Object System.Drawing.StringFormat
      try {
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $textRect = New-Object System.Drawing.RectangleF(
          [single]$pad,
          [single]($pad + 44 * $s),
          [single]($Size - 2 * $pad),
          [single]($Size - 2 * $pad - 44 * $s)
        )
        $g.DrawString('27', $font, $textBrush, $textRect, $format)
      } finally {
        $font.Dispose()
        $textBrush.Dispose()
        $format.Dispose()
      }
    } finally {
      $path.Dispose()
    }

    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "生成 $OutFile"
  } finally {
    $g.Dispose()
    $bmp.Dispose()
  }
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

New-Icon -Size 256 -OutFile (Join-Path $OutDir 'icon.png')
New-Icon -Size 32 -OutFile (Join-Path $OutDir 'tray.png')
New-Icon -Size 16 -OutFile (Join-Path $OutDir 'tray-16.png')

# 打包用 ico
$src = [System.Drawing.Image]::FromFile((Join-Path $OutDir 'icon.png'))
try {
  $hicon = $src.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($hicon)
  $fs = [System.IO.File]::Create((Join-Path $OutDir 'icon.ico'))
  try {
    $icon.Save($fs)
  } finally {
    $fs.Close()
  }
  Write-Host "生成 $(Join-Path $OutDir 'icon.ico')"
} finally {
  $src.Dispose()
}
