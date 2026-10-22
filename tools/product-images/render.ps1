# Step 3: render the chosen pictures as 1200x1200 white-background JPEGs (trims empty margins).
# Manifest: JSON array of { code, src, out, rect? }  (rect = [x, y, w, h] crop in source pixels, e.g. from a catalogue page)
# out is the final Drive path (G:/My Drive/wed/product/Lim 2026/<code>/<file>.jpg). -Root renders to a review folder
# instead; copy that folder into the Drive folder after checking the contact sheet. Existing outputs are skipped.
# Usage: powershell -File tools\product-images\render.ps1 -Manifest test-results\x-manifest.json -Root <scratch>\x\ [-Whiten]
#   -Whiten  turns near-white page background (catalogue crops) into pure white
param([Parameter(Mandatory)][string]$Manifest, [Parameter(Mandatory)][string]$Root, [switch]$Whiten)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class ProductImg {
  public static Rectangle Bounds(Image src, Rectangle r) {
    var b = new Bitmap(r.Width, r.Height, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(b)) { g.Clear(Color.White); g.DrawImage(src, new Rectangle(0,0,r.Width,r.Height), r, GraphicsUnit.Pixel); }
    var d = b.LockBits(new Rectangle(0,0,b.Width,b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var px = new byte[d.Stride*b.Height]; Marshal.Copy(d.Scan0, px, 0, px.Length); b.UnlockBits(d);
    int x0=b.Width,y0=b.Height,x1=-1,y1=-1;
    for (int y=0;y<b.Height;y++) for (int x=0;x<b.Width;x++){ int i=y*d.Stride+x*4;
      if (px[i]<232||px[i+1]<232||px[i+2]<232){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
    b.Dispose(); return x1<0 ? r : new Rectangle(r.X+x0, r.Y+y0, x1-x0+1, y1-y0+1);
  }
  public static void Whiten(Bitmap b) {
    var d = b.LockBits(new Rectangle(0,0,b.Width,b.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    var px = new byte[d.Stride*b.Height]; Marshal.Copy(d.Scan0, px, 0, px.Length);
    for (int i=0;i<px.Length;i+=4) if (px[i]>=226&&px[i+1]>=226&&px[i+2]>=226){px[i]=px[i+1]=px[i+2]=255;}
    Marshal.Copy(px,0,d.Scan0,px.Length); b.UnlockBits(d);
  }
}
'@
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$p = New-Object System.Drawing.Imaging.EncoderParameters 1
$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
$items = Get-Content $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($it in $items) {
  $out = $it.out.Replace('G:/My Drive/wed/product/Lim 2026/', $Root)
  if (Test-Path -LiteralPath $out) { continue }
  New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
  $img = [System.Drawing.Image]::FromFile($it.src)
  $r = if ($it.rect) { New-Object System.Drawing.Rectangle($it.rect[0], $it.rect[1], $it.rect[2], $it.rect[3]) } else { New-Object System.Drawing.Rectangle(0, 0, $img.Width, $img.Height) }
  $r = [ProductImg]::Bounds($img, $r)
  $size = 1200; $side = [Math]::Max($r.Width, $r.Height) * 1.12; $s = $size / $side
  $w = $r.Width * $s; $h = $r.Height * $s
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::White); $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($img, (New-Object System.Drawing.RectangleF((($size - $w) / 2), (($size - $h) / 2), $w, $h)), (New-Object System.Drawing.RectangleF($r.X, $r.Y, $r.Width, $r.Height)), 'Pixel')
  $g.Dispose(); if ($Whiten) { [ProductImg]::Whiten($bmp) }
  $bmp.Save($out, $enc, $p); $bmp.Dispose(); $img.Dispose()
}
# Contact sheet for review: <Root>-sheet.png
$files = Get-ChildItem $Root -Recurse -Filter *.jpg | Sort-Object FullName
$cols = 7; $t = 180; $rows = [Math]::Max(1, [Math]::Ceiling($files.Count / $cols))
$sheet = New-Object System.Drawing.Bitmap ($cols * $t), ($rows * ($t + 18)); $g = [System.Drawing.Graphics]::FromImage($sheet); $g.Clear([System.Drawing.Color]::LightGray)
$font = New-Object System.Drawing.Font 'Arial', 8
for ($i = 0; $i -lt $files.Count; $i++) { $x = ($i % $cols) * $t; $y = [Math]::Floor($i / $cols) * ($t + 18)
  $im = [System.Drawing.Image]::FromFile($files[$i].FullName); $g.DrawImage($im, $x + 2, $y + 2, $t - 4, $t - 4); $im.Dispose()
  $g.DrawString($files[$i].BaseName, $font, [System.Drawing.Brushes]::Black, $x + 2, $y + $t) }
$sheetPath = $Root.TrimEnd('\', '/') + '-sheet.png'; $sheet.Save($sheetPath)
"rendered " + $files.Count + " | contact sheet: " + $sheetPath
