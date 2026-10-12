Add-Type -AssemblyName System.Drawing

$srcFile = "d:\techyArts\B-W\mobile\src\assets\bw_logo.png"
$resDir = "d:\techyArts\B-W\mobile\android\app\src\main\res"

# Load source image
$src = [System.Drawing.Bitmap]::FromFile($srcFile)

# Compute content bounding box
$minX = $src.Width; $maxX = 0; $minY = $src.Height; $maxY = 0;
for ($y = 0; $y -lt $src.Height; $y++) {
    for ($x = 0; $x -lt $src.Width; $x++) {
        $p = $src.GetPixel($x, $y)
        if ($p.A -gt 15) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}

$srcCropRect = New-Object System.Drawing.Rectangle($minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))
$aspect = $srcCropRect.Width / $srcCropRect.Height

Write-Host "Source cropped: $($srcCropRect.Width) x $($srcCropRect.Height) (aspect $aspect)"

# Densities and sizes
$densities = @(
    @{ name = "mipmap-mdpi";    legacySize = 48;  adaptiveSize = 108 },
    @{ name = "mipmap-hdpi";    legacySize = 72;  adaptiveSize = 162 },
    @{ name = "mipmap-xhdpi";   legacySize = 96;  adaptiveSize = 216 },
    @{ name = "mipmap-xxhdpi";  legacySize = 144; adaptiveSize = 324 },
    @{ name = "mipmap-xxxhdpi"; legacySize = 192; adaptiveSize = 432 }
)

function Setup-Graphics($g) {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

foreach ($d in $densities) {
    $targetFolder = Join-Path $resDir $d.name
    if (-not (Test-Path $targetFolder)) {
        New-Item -ItemType Directory -Path $targetFolder | Out-Null
    }

    # 1. Adaptive foreground (transparent background, logo in safe zone)
    # Adaptive size: 108dp. Safe zone diameter: 66dp (61% of canvas).
    # Width of logo: 50% of canvas width (54dp at 108dp) so corners comfortably fit inside 66dp circle
    $aSize = $d.adaptiveSize
    $bmpFg = New-Object System.Drawing.Bitmap($aSize, $aSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gFg = [System.Drawing.Graphics]::FromImage($bmpFg)
    Setup-Graphics $gFg
    $gFg.Clear([System.Drawing.Color]::Transparent)

    $targetW = [math]::Round($aSize * 0.50)
    $targetH = [math]::Round($targetW / $aspect)
    $destX = [math]::Round(($aSize - $targetW) / 2)
    $destY = [math]::Round(($aSize - $targetH) / 2)
    $destRect = New-Object System.Drawing.Rectangle($destX, $destY, $targetW, $targetH)
    $gFg.DrawImage($src, $destRect, $srcCropRect, [System.Drawing.GraphicsUnit]::Pixel)
    $gFg.Dispose()

    $fgPath = Join-Path $targetFolder "ic_launcher_foreground.png"
    $bmpFg.Save($fgPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpFg.Dispose()
    Write-Host "Created $fgPath ($aSize x $aSize, logo $targetW x $targetH)"

    # 2. Legacy square/squircle ic_launcher.png (White background with rounded corners)
    $lSize = $d.legacySize
    $bmpLegacy = New-Object System.Drawing.Bitmap($lSize, $lSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gLegacy = [System.Drawing.Graphics]::FromImage($bmpLegacy)
    Setup-Graphics $gLegacy
    $gLegacy.Clear([System.Drawing.Color]::Transparent)

    # Rounded rectangle background (standard Android legacy icon corner radius ~8.33% or flat white)
    $radius = [math]::Round($lSize * 0.12)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2
    $rect = New-Object System.Drawing.Rectangle(0, 0, $lSize, $lSize)
    $path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()

    $brushWhite = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $gLegacy.FillPath($brushWhite, $path)

    # Draw logo centered with safe margin (~74% width)
    $targetWLegacy = [math]::Round($lSize * 0.74)
    $targetHLegacy = [math]::Round($targetWLegacy / $aspect)
    $destXLegacy = [math]::Round(($lSize - $targetWLegacy) / 2)
    $destYLegacy = [math]::Round(($lSize - $targetHLegacy) / 2)
    $destRectLegacy = New-Object System.Drawing.Rectangle($destXLegacy, $destYLegacy, $targetWLegacy, $targetHLegacy)
    $gLegacy.DrawImage($src, $destRectLegacy, $srcCropRect, [System.Drawing.GraphicsUnit]::Pixel)

    $brushWhite.Dispose()
    $path.Dispose()
    $gLegacy.Dispose()

    $legacyPath = Join-Path $targetFolder "ic_launcher.png"
    $bmpLegacy.Save($legacyPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpLegacy.Dispose()
    Write-Host "Created $legacyPath ($lSize x $lSize, logo $targetWLegacy x $targetHLegacy)"

    # 3. Legacy round ic_launcher_round.png (White circular background)
    $bmpRound = New-Object System.Drawing.Bitmap($lSize, $lSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gRound = [System.Drawing.Graphics]::FromImage($bmpRound)
    Setup-Graphics $gRound
    $gRound.Clear([System.Drawing.Color]::Transparent)

    $brushWhite = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    # Circle diameter slightly inset by 1px for smooth anti-aliasing
    $circleMargin = 1
    $circleSize = $lSize - ($circleMargin * 2)
    $gRound.FillEllipse($brushWhite, $circleMargin, $circleMargin, $circleSize, $circleSize)

    # Draw logo centered inside circle (safe width ~68% of circle diameter)
    $targetWRound = [math]::Round($circleSize * 0.68)
    $targetHRound = [math]::Round($targetWRound / $aspect)
    $destXRound = [math]::Round(($lSize - $targetWRound) / 2)
    $destYRound = [math]::Round(($lSize - $targetHRound) / 2)
    $destRectRound = New-Object System.Drawing.Rectangle($destXRound, $destYRound, $targetWRound, $targetHRound)
    $gRound.DrawImage($src, $destRectRound, $srcCropRect, [System.Drawing.GraphicsUnit]::Pixel)

    $brushWhite.Dispose()
    $gRound.Dispose()

    $roundPath = Join-Path $targetFolder "ic_launcher_round.png"
    $bmpRound.Save($roundPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmpRound.Dispose()
    Write-Host "Created $roundPath ($lSize x $lSize, logo $targetWRound x $targetHRound)"
}

$src.Dispose()
Write-Host "=== All icon densities successfully generated ==="
