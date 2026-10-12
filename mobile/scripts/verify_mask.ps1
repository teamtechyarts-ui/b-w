Add-Type -AssemblyName System.Drawing

$resDir = "d:\techyArts\B-W\mobile\android\app\src\main\res"
$fgPath = Join-Path $resDir "mipmap-xxxhdpi\ic_launcher_foreground.png"
$fg = [System.Drawing.Bitmap]::FromFile($fgPath)

$canvasSize = 432
# Android adaptive icon viewport is the center 72dp out of 108dp.
# At xxxhdpi (4x), 72dp = 288px.
# Center is (216, 216). Viewport mask radius is 144px.
# Safe zone is 66dp = 264px (radius 132px).
$centerX = 216
$centerY = 216
$maskRadius = 144 # 72dp viewport mask

$clippedCirclePixels = 0
$minDistToCircleEdge = 9999

for ($y = 0; $y -lt $fg.Height; $y++) {
    for ($x = 0; $x -lt $fg.Width; $x++) {
        $p = $fg.GetPixel($x, $y)
        if ($p.A -gt 20) { # Visible logo pixel
            $distFromCenter = [math]::Sqrt([math]::Pow($x - $centerX, 2) + [math]::Pow($y - $centerY, 2))
            $distToEdge = $maskRadius - $distFromCenter
            if ($distToEdge -lt $minDistToCircleEdge) {
                $minDistToCircleEdge = $distToEdge
            }
            if ($distFromCenter -gt $maskRadius) {
                $clippedCirclePixels++
            }
        }
    }
}

Write-Host "Circular Mask Verification (72dp / 288px viewport):"
Write-Host "  Clipped logo pixels: $clippedCirclePixels"
Write-Host "  Minimum margin to mask edge: $([math]::Round($minDistToCircleEdge, 2)) px ($([math]::Round($minDistToCircleEdge / 4, 2)) dp)"

$fg.Dispose()
