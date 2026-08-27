param([string]$OutputDirectory=$PSScriptRoot)
# DS Harness app icon: dark rounded base + blue gradient sine wave + amber crest dot
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = 112
$path.AddArc(4, 4, $d, $d, 180, 90)
$path.AddArc(248 - $d, 4, $d, $d, 270, 90)
$path.AddArc(248 - $d, 248 - $d, $d, $d, 0, 90)
$path.AddArc(4, 248 - $d, $d, $d, 90, 90)
$path.CloseFigure()

$rect = New-Object System.Drawing.RectangleF 4, 4, 248, 248
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $rect, ([System.Drawing.Color]::FromArgb(255, 16, 26, 46)), ([System.Drawing.Color]::FromArgb(255, 10, 15, 27)), 90
$g.FillPath($bgBrush, $path)

$edgePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(28, 255, 255, 255)), 2
$edgePen.Alignment = [System.Drawing.Drawing2D.PenAlignment]::Inset
$g.DrawPath($edgePen, $path)

$pts = @()
for ($x = 56; $x -le 200; $x += 2) {
  $y = 128 - 42 * [Math]::Sin(2 * [Math]::PI * ($x - 56) / 144)
  $pts += New-Object System.Drawing.PointF ($x, $y)
}

$c1 = [System.Drawing.Color]::FromArgb(255, 96, 165, 250)
$c2 = [System.Drawing.Color]::FromArgb(255, 139, 146, 248)
$p1 = New-Object System.Drawing.PointF 56, 86
$p2 = New-Object System.Drawing.PointF 200, 170
$gp = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $p1, $p2, $c1, $c2

$glow = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(46, 96, 165, 250)), 24
$glow.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$glow.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$glow.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLines($glow, $pts)

$pen = New-Object System.Drawing.Pen -ArgumentList $gp, 12
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLines($pen, $pts)

$dotX = 92; $dotY = 86
$halo = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 251, 191, 36))
$g.FillEllipse($halo, $dotX - 17, $dotY - 17, 34, 34)
$dot = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 251, 191, 36))
$g.FillEllipse($dot, $dotX - 8, $dotY - 8, 16, 16)
$dotHi = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 236, 179))
$g.FillEllipse($dotHi, $dotX - 4, $dotY - 4, 8, 8)

$g.Dispose()
$bmp.Save((Join-Path $OutputDirectory 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$h = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($h)
$fs = [System.IO.File]::Create((Join-Path $OutputDirectory 'icon.ico'))
$icon.Save($fs)
$fs.Close()
Write-Host 'icon saved'
