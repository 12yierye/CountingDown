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

# 只负责画：返回一张位图，导出成 PNG 还是 ICO 由调用方决定
function New-IconBitmap {
  param(
    [Parameter(Mandatory = $true)][int]$Size
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
  } finally {
    $g.Dispose()
  }

  return $bmp
}

function New-Icon {
  param(
    [Parameter(Mandatory = $true)][int]$Size,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  $bmp = New-IconBitmap -Size $Size
  try {
    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "生成 $OutFile"
  } finally {
    $bmp.Dispose()
  }
}

# --------------------------------------------------------------------------
# 多尺寸 ICO
#
# 以前用 Bitmap.GetHicon() + Icon.Save() 只写出一个 256×256 层：
# 任务栏 / 任务管理器要的是 16×16、24×24 这类小尺寸，让系统从 256 缩放下来会发糊。
# 而且实测 Icon.Save() 对**所有**尺寸都写 PNG 压缩层，小尺寸下并非所有外壳组件都认。
# 这里自己拼 ICO：≤128 用经典 DIB 层，256 用 PNG 层（体积小，Vista 以后都支持）。
# --------------------------------------------------------------------------

# 一层 DIB：BITMAPINFOHEADER + 自下而上的 BGRA 位图 + 全 0 的 AND 掩码
function New-IcoDibEntry {
  param(
    [Parameter(Mandatory = $true)][System.Drawing.Bitmap]$Bitmap
  )

  $size = $Bitmap.Width
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $data = $Bitmap.LockBits(
    $rect,
    [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  try {
    $stride = $data.Stride
    $raw = New-Object byte[] ([Math]::Abs($stride) * $size)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
  } finally {
    $Bitmap.UnlockBits($data)
  }

  # AND 掩码每行按 4 字节对齐；32bpp 走 alpha 通道，掩码全 0 即可
  $maskStride = [int]([Math]::Floor(($size + 31) / 32) * 4)
  $xorSize = $size * $size * 4
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  try {
    # BITMAPINFOHEADER 的高度写两倍：XOR 位图 + AND 掩码
    $bw.Write([UInt32]40)
    $bw.Write([Int32]$size)
    $bw.Write([Int32]($size * 2))
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]0)
    $bw.Write([UInt32]$xorSize)
    $bw.Write([Int32]0)
    $bw.Write([Int32]0)
    $bw.Write([UInt32]0)
    $bw.Write([UInt32]0)

    for ($y = $size - 1; $y -ge 0; $y--) {
      $rowStart = if ($stride -ge 0) { $y * $stride } else { ($size - 1 - $y) * (-$stride) }
      $bw.Write($raw, $rowStart, $size * 4)
    }

    $mask = New-Object byte[] ($maskStride * $size)
    $bw.Write($mask, 0, $mask.Length)
    $bw.Flush()
    return , $ms.ToArray()
  } finally {
    $bw.Dispose()
    $ms.Dispose()
  }
}

function New-IcoPngEntry {
  param(
    [Parameter(Mandatory = $true)][System.Drawing.Bitmap]$Bitmap
  )

  $ms = New-Object System.IO.MemoryStream
  try {
    $Bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return , $ms.ToArray()
  } finally {
    $ms.Dispose()
  }
}

function Write-MultiSizeIco {
  param(
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $entries = New-Object System.Collections.ArrayList
  foreach ($size in $sizes) {
    $bmp = New-IconBitmap -Size $size
    try {
      $bytes = if ($size -ge 256) {
        New-IcoPngEntry -Bitmap $bmp
      } else {
        New-IcoDibEntry -Bitmap $bmp
      }
      [void]$entries.Add([pscustomobject]@{ Size = $size; Bytes = $bytes })
    } finally {
      $bmp.Dispose()
    }
  }

  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  try {
    $bw.Write([UInt16]0)                 # reserved
    $bw.Write([UInt16]1)                 # type = icon
    $bw.Write([UInt16]$entries.Count)

    $offset = 6 + 16 * $entries.Count
    foreach ($entry in $entries) {
      # 256 在目录项里用 0 表示
      $dim = if ($entry.Size -ge 256) { 0 } else { $entry.Size }
      $bw.Write([byte]$dim)
      $bw.Write([byte]$dim)
      $bw.Write([byte]0)                 # 调色板数量
      $bw.Write([byte]0)                 # reserved
      $bw.Write([UInt16]1)               # planes
      $bw.Write([UInt16]32)              # bpp
      $bw.Write([UInt32]$entry.Bytes.Length)
      $bw.Write([UInt32]$offset)
      $offset += $entry.Bytes.Length
    }

    foreach ($entry in $entries) {
      $bw.Write($entry.Bytes, 0, $entry.Bytes.Length)
    }

    $bw.Flush()
    [System.IO.File]::WriteAllBytes($OutFile, $ms.ToArray())
    Write-Host ("生成 {0}（{1} px，共 {2} 层）" -f $OutFile, ($sizes -join '/'), $entries.Count)
  } finally {
    $bw.Dispose()
    $ms.Dispose()
  }
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

New-Icon -Size 256 -OutFile (Join-Path $OutDir 'icon.png')
New-Icon -Size 32 -OutFile (Join-Path $OutDir 'tray.png')
New-Icon -Size 16 -OutFile (Join-Path $OutDir 'tray-16.png')

# 打包 / 窗口图标
Write-MultiSizeIco -OutFile (Join-Path $OutDir 'icon.ico')
