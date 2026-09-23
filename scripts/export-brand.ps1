$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$brandRoot = Split-Path $PSScriptRoot -Parent
$brandDir = Join-Path $brandRoot 'assets/brand'
$brandMaster = [Drawing.Image]::FromFile((Join-Path $brandDir 'scout-master.png'))

function Export-BrandPng([int]$Size, [string]$RelativePath, [double]$Scale = 1, [bool]$Opaque = $false) {
  $bitmap = [Drawing.Bitmap]::new($Size, $Size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear($(if ($Opaque) { [Drawing.Color]::FromArgb(255,247,244,238) } else { [Drawing.Color]::Transparent }))
    $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $extent = [int][Math]::Round($Size * $Scale)
    $offset = [int][Math]::Floor(($Size - $extent) / 2)
    $graphics.DrawImage($brandMaster, [Drawing.Rectangle]::new($offset,$offset,$extent,$extent))
    $destination = Join-Path $brandRoot $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    $bitmap.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

try {
  $sizes = @(16,24,32,48,64,128,256,512)
  foreach ($size in $sizes) { Export-BrandPng $size "assets/brand/scout-$size.png" }
  # ICO container: embed PNG frames without changing the approved artwork.
  $frames = @($sizes | Where-Object { $_ -le 256 } | ForEach-Object { ,([IO.File]::ReadAllBytes((Join-Path $brandDir "scout-$_.png"))) })
  $stream = [IO.File]::Create((Join-Path $brandDir 'app.ico'))
  $writer = [IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    for ($i=0; $i -lt $frames.Count; $i++) {
      $sizeByte = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
      $writer.Write([byte]$sizeByte); $writer.Write([byte]$sizeByte)
      $writer.Write([byte]0); $writer.Write([byte]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32)
      $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
      $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
  } finally { $writer.Dispose(); $stream.Dispose() }
  Export-BrandPng 32 'public/favicon.png'
  Export-BrandPng 32 'mobile/public/favicon.png'
  Export-BrandPng 192 'mobile/public/scout-192.png'
  Export-BrandPng 512 'mobile/public/scout-512.png'
  Export-BrandPng 512 'mobile/public/scout-maskable-512.png' 0.76 $true
  Export-BrandPng 1024 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png' 0.88 $true
  $densities = @{ mdpi=48; hdpi=72; xhdpi=96; xxhdpi=144; xxxhdpi=192 }
  foreach ($density in $densities.GetEnumerator()) {
    foreach ($name in @('ic_launcher','ic_launcher_round')) {
      Export-BrandPng $density.Value "android/app/src/main/res/mipmap-$($density.Key)/$name.png" 0.9 $true
    }
    Export-BrandPng ([int]($density.Value * 2.25)) "android/app/src/main/res/mipmap-$($density.Key)/ic_launcher_foreground.png" 0.62
  }
} finally { $brandMaster.Dispose() }
