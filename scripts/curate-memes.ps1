param([int]$Count = 321, [switch]$Clean)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

$repoRoot = Split-Path -Parent $PSScriptRoot
$assetDir = Join-Path $repoRoot 'packages/client/public/memes'
$sharedDir = Join-Path $repoRoot 'packages/shared/src/games/memes'
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
if ($Clean) {
  $resolvedAssets = (Resolve-Path -LiteralPath $assetDir).Path
  $resolvedRepo = (Resolve-Path -LiteralPath $repoRoot).Path
  if (-not $resolvedAssets.StartsWith($resolvedRepo + [System.IO.Path]::DirectorySeparatorChar)) {
    throw "Refusing to clean outside the repository: $resolvedAssets"
  }
  Get-ChildItem -LiteralPath $resolvedAssets -Filter '*.jpg' -File | Remove-Item -Force
}

$client = [System.Net.Http.HttpClient]::new()
$client.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 HasalonGames/1.0 (family game asset curation)')

function Save-Jpeg([string]$url, [string]$path) {
  $bytes = $client.GetByteArrayAsync($url).GetAwaiter().GetResult()
  $stream = [System.IO.MemoryStream]::new($bytes, $false)
  try {
    $source = [System.Drawing.Image]::FromStream($stream)
    try {
      $scale = [Math]::Min(1.0, 640.0 / [Math]::Max($source.Width, $source.Height))
      $width = [Math]::Max(1, [Math]::Round($source.Width * $scale))
      $height = [Math]::Max(1, [Math]::Round($source.Height * $scale))
      $bitmap = [System.Drawing.Bitmap]::new($width, $height)
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.Clear([System.Drawing.Color]::White)
          $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $graphics.DrawImage($source, 0, 0, $width, $height)
        } finally { $graphics.Dispose() }
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
        $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
        $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]72)
        try { $bitmap.Save($path, $codec, $parameters) } finally { $parameters.Dispose() }
      } finally { $bitmap.Dispose() }
      return @{ Width = $width; Height = $height }
    } finally { $source.Dispose() }
  } finally { $stream.Dispose() }
}

# Imgflip documents /get_memes as its current popularity list, ordered by use
# over roughly the last 30 days. The public template page exposes the same live
# order in 40-item pages, so the top N needs ceil((N + 40) / 40) of them — the
# extra page is slack for the duplicates and blanks dropped further down.
$api = ($client.GetStringAsync('https://api.imgflip.com/get_memes?type=image').GetAwaiter().GetResult() | ConvertFrom-Json)
$apiByCode = @{}
foreach ($meme in $api.data.memes) {
  $code = [System.IO.Path]::GetFileNameWithoutExtension(([uri]$meme.url).AbsolutePath)
  $apiByCode[$code] = $meme
}

$cards = [System.Collections.Generic.List[object]]::new()
$pattern = '<div class="mt-box">.*?<h3 class="mt-title">\s*<a[^>]+href="/meme/([^"]+)"[^>]*>(.*?)</a>.*?<img[^>]+src="//i\.imgflip\.com/4/([^"]+)"'
for ($page = 1; $cards.Count -lt ($Count + 40); $page += 1) {
  $url = if ($page -eq 1) { 'https://imgflip.com/memetemplates' } else { "https://imgflip.com/memetemplates?page=$page" }
  $html = $client.GetStringAsync($url).GetAwaiter().GetResult()
  foreach ($match in [regex]::Matches($html, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)) {
    if ($cards.Count -ge ($Count + 40)) { break }
    $slug = $match.Groups[1].Value
    $name = [System.Net.WebUtility]::HtmlDecode(([regex]::Replace($match.Groups[2].Value, '<[^>]+>', '')).Trim())
    $file = $match.Groups[3].Value
    $code = [System.IO.Path]::GetFileNameWithoutExtension($file)
    $cards.Add([pscustomobject]@{ slug = $slug; name = $name; file = $file; code = $code })
  }
  # Pages are 40 items; allow the pages the count actually needs plus four
  # spare, rather than a fixed ceiling that silently caps a larger library.
  if ($page -gt ([Math]::Ceiling(($Count + 40) / 40) + 4)) {
    throw "Imgflip did not return enough image templates (got $($cards.Count), need $($Count + 40))."
  }
}

$items = [System.Collections.Generic.List[object]]::new()
$ids = [System.Collections.Generic.HashSet[string]]::new()
$imageHashes = [System.Collections.Generic.HashSet[string]]::new()
for ($index = 0; $index -lt $cards.Count; $index += 1) {
  if ($items.Count -ge $Count) { break }
  $card = $cards[$index]
  if ($card.name -eq 'Blank White Template') { continue }
  $id = ($card.slug -replace '[^a-zA-Z0-9-]+', '-').Trim('-').ToLowerInvariant()
  if (-not $ids.Add($id)) { $id = "$id-$($card.code)"; [void]$ids.Add($id) }
  $originalUrl = "https://i.imgflip.com/$($card.file)"
  $target = Join-Path $assetDir "$id.jpg"
  try {
    $dimensions = Save-Jpeg $originalUrl $target
  } catch {
    # A rare original URL can be unavailable while the resized CDN image is
    # live. Falling back to the 500-ish px template is still ample for the card.
    $dimensions = Save-Jpeg "https://i.imgflip.com/4/$($card.file)" $target
  }
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  if (-not $imageHashes.Add($hash)) {
    Remove-Item -LiteralPath $target -Force
    continue
  }
  $apiMeme = $apiByCode[$card.code]
  $boxCount = if ($apiMeme) { [int]$apiMeme.box_count } else { 2 }
  $slots = if ($boxCount -le 1) { 1 } else { 2 }
  # Proportional to the library size rather than fixed at 40/90, which were the
  # thirds of a 120-template run and would have made a 321-template one 90%
  # wildcard. The fractions are the originals: first third classic, up to
  # three-quarters reaction, the tail wildcard.
  $classicMax = [Math]::Round($Count / 3.0)
  $reactionMax = [Math]::Round($Count * 0.75)
  $tier = if ($items.Count -lt $classicMax) { 'classic' } elseif ($items.Count -lt $reactionMax) { 'reaction' } else { 'wildcard' }
  $items.Add([pscustomobject]@{
    id = $id
    name = $card.name
    aspect = [Math]::Round($dimensions.Width / $dimensions.Height, 6)
    slots = $slots
    tier = $tier
    rank = $index + 1
    source = "https://imgflip.com/meme/$($card.slug)"
    imageSource = $originalUrl
  })
  Write-Output ("[{0}/{1}] {2}" -f $items.Count, $Count, $card.name)
}
if ($items.Count -lt $Count) { throw "Only found $($items.Count) distinct Imgflip templates." }

$attribution = [System.Collections.Generic.List[string]]::new()
$attribution.Add('# Meme template sources')
$attribution.Add('')
$attribution.Add('Downloaded from Imgflip''s live "Top 30 days" template ranking. Popularity changes over time; the rank below records the order used when this library was curated. These are user-uploaded templates and this file does not assert an open-source licence for them.')
$attribution.Add('')
$attribution.Add('| rank | id | template | source |')
$attribution.Add('|---:|---|---|---|')
foreach ($item in $items) {
  $name = ([string]$item.name).Replace('|', '\|')
  $attribution.Add("| $($item.rank) | ``$($item.id)`` | $name | [Imgflip template]($($item.source)) |")
}
[System.IO.File]::WriteAllLines((Join-Path $assetDir 'ATTRIBUTION.md'), $attribution, [System.Text.UTF8Encoding]::new($false))

$generated = [System.Collections.Generic.List[string]]::new()
$generated.Add('/** Generated by scripts/curate-memes.ps1 from Imgflip''s live Top 30 Days list. */')
# `format` belongs on the shared interface even though nothing this script emits
# sets it: `gifTemplateAssets.ts` is typed against `MemeAsset` and every one of
# its rows carries `format: 'mp4'`. Leaving it out here compiles fine until the
# next time this script runs, and then breaks all of the animated templates at
# once — which is exactly what happened, because the checked-in file had been
# corrected by hand and the generator had not.
$generated.Add('export interface MemeAsset { id: string; name: string; aspect: number; slots: 1 | 2; tier: ''classic'' | ''reaction'' | ''wildcard''; source: string; format?: ''mp4'' }')
$generated.Add('export const MEME_ASSETS: MemeAsset[] = [')
foreach ($item in $items) {
  $escapedName = ([string]$item.name).Replace('\', '\\').Replace("'", "\'")
  $generated.Add("  { id: '$($item.id)', name: '$escapedName', aspect: $($item.aspect), slots: $($item.slots), tier: '$($item.tier)', source: '$($item.source)' },")
}
$generated.Add('];')
[System.IO.File]::WriteAllLines((Join-Path $sharedDir 'templateAssets.ts'), $generated, [System.Text.UTF8Encoding]::new($false))
& node (Join-Path $PSScriptRoot 'curate-meme-layouts.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Could not generate Imgflip text layouts.' }
Write-Output "Wrote $($items.Count) current Imgflip templates and source rows."
