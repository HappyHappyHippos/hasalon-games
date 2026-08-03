param(
  [string]$AssetDir = 'packages/client/public/memes',
  [string]$OutputDir = "$env:TEMP/hasalon-meme-sheets"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot $AssetDir
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$files = Get-ChildItem -LiteralPath $source -Filter '*.jpg' | Sort-Object Name
$cellWidth = 220
$cellHeight = 180
$columns = 5
$rows = 4
$perSheet = $columns * $rows

for ($offset = 0; $offset -lt $files.Count; $offset += $perSheet) {
  $bitmap = [System.Drawing.Bitmap]::new($cellWidth * $columns, $cellHeight * $rows)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $font = [System.Drawing.Font]::new('Arial', 10, [System.Drawing.FontStyle]::Bold)
      try {
        for ($index = 0; $index -lt $perSheet -and $offset + $index -lt $files.Count; $index += 1) {
          $file = $files[$offset + $index]
          $image = [System.Drawing.Image]::FromFile($file.FullName)
          try {
            $column = $index % $columns
            $row = [Math]::Floor($index / $columns)
            $maxWidth = $cellWidth - 12
            $maxHeight = $cellHeight - 34
            $scale = [Math]::Min($maxWidth / $image.Width, $maxHeight / $image.Height)
            $width = [Math]::Round($image.Width * $scale)
            $height = [Math]::Round($image.Height * $scale)
            $x = $column * $cellWidth + [Math]::Round(($cellWidth - $width) / 2)
            $y = $row * $cellHeight + 4
            $graphics.DrawImage($image, $x, $y, $width, $height)
            $graphics.DrawString($file.BaseName, $font, [System.Drawing.Brushes]::Black, $column * $cellWidth + 6, $row * $cellHeight + $cellHeight - 25)
          } finally { $image.Dispose() }
        }
      } finally { $font.Dispose() }
    } finally { $graphics.Dispose() }
    $number = [Math]::Floor($offset / $perSheet) + 1
    $bitmap.Save((Join-Path $OutputDir "sheet-$number.jpg"), [System.Drawing.Imaging.ImageFormat]::Jpeg)
  } finally { $bitmap.Dispose() }
}

Write-Output $OutputDir
