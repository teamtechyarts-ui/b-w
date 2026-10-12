Add-Type -AssemblyName System.Drawing

$resDir = "d:\techyArts\B-W\mobile\android\app\src\main\res"
$folders = @("mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi")

foreach ($f in $folders) {
    Write-Host "--- $f ---"
    $dir = Join-Path $resDir $f
    Get-ChildItem $dir -Filter "*.png" | ForEach-Object {
        $bmp = [System.Drawing.Bitmap]::FromFile($_.FullName)
        
        # Check non-transparent / non-white content
        $minX = $bmp.Width; $maxX = 0; $minY = $bmp.Height; $maxY = 0;
        $hasBlueLogo = $false
        for ($y = 0; $y -lt $bmp.Height; $y++) {
            for ($x = 0; $x -lt $bmp.Width; $x++) {
                $p = $bmp.GetPixel($x, $y)
                if ($p.A -gt 20) {
                    # Check for blue logo color (R < 50, G between 50 and 120, B between 80 and 160)
                    if ($p.R -lt 50 -and $p.G -ge 50 -and $p.G -le 120 -and $p.B -ge 80) {
                        $hasBlueLogo = $true
                    }
                    if ($x -lt $minX) { $minX = $x }
                    if ($x -gt $maxX) { $maxX = $x }
                    if ($y -lt $minY) { $minY = $y }
                    if ($y -gt $maxY) { $maxY = $y }
                }
            }
        }
        
        Write-Host "  $($_.Name): $($bmp.Width)x$($bmp.Height), Content bounds: X=[$minX, $maxX], Y=[$minY, $maxY], BlueLogoFound=$hasBlueLogo"
        $bmp.Dispose()
    }
}
