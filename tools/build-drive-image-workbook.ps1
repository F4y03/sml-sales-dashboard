param([string]$CsvPath, [string]$ManifestPath, [string]$OutputXlsx)
& node (Join-Path $PSScriptRoot 'replace-product-image-links.mjs') $CsvPath $ManifestPath $OutputXlsx
exit $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$definition = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'create-final-products-xlsx.ps1'), [ref]$null, [ref]$null)
foreach ($fn in $definition.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
    Invoke-Expression $fn.Extent.Text
}
function Escape-XmlText {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value) { return '' }
    return [System.Security.SecurityElement]::Escape($Value).Replace("`r", '&#13;')
}
$rows = @(Import-Csv -LiteralPath $CsvPath -Encoding UTF8)
$original = @($rows[0].PSObject.Properties.Name)
$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$lookup = @{}
foreach ($image in $manifest) { $lookup[$image.source_url] = $image }
$max = 0
foreach ($row in $rows) {
    $urls = @([regex]::Matches([string]$row.($original[30]), 'https?://[^,\s]+') | ForEach-Object { $_.Value })
    $max = [math]::Max($max, $urls.Count)
}
$extra = @(1..$max | ForEach-Object { "Drive Image $_" })
$headers = @($original) + $extra + @('Image Upload Status')
$outRows = foreach ($row in $rows) {
    $item = [ordered]@{}
    foreach ($h in $original) { $item[$h] = [string]$row.$h }
    $urls = @([regex]::Matches([string]$row.($original[30]), 'https?://[^,\s]+') | ForEach-Object { $_.Value })
    $missing = @()
    for ($i=0; $i -lt $max; $i++) {
        $link = ''
        if ($i -lt $urls.Count) {
            $entry = $lookup[$urls[$i]]
            if ($entry.drive_url) { $link = $entry.drive_url } else { $missing += $urls[$i] }
        }
        $item[$extra[$i]] = $link
    }
    $item['Image Upload Status'] = if ($missing.Count) { 'Missing: ' + ($missing -join ', ') } elseif ($urls.Count) { 'Uploaded' } else { 'No images' }
    $item
}
New-Xlsx -Rows $outRows -Headers $headers -Path $OutputXlsx
$zip = [System.IO.Compression.ZipFile]::Open($OutputXlsx, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $entry = $zip.GetEntry('xl/worksheets/sheet1.xml')
    $reader = [System.IO.StreamReader]::new($entry.Open())
    $xml = $reader.ReadToEnd()
    $reader.Dispose()
    $links = [System.Text.StringBuilder]::new('<hyperlinks>')
    $rels = [System.Text.StringBuilder]::new('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">')
    $count = 0
    for ($r=0; $r -lt $outRows.Count; $r++) {
        for ($c=0; $c -lt $extra.Count; $c++) {
            $url = $outRows[$r][$extra[$c]]
            if (-not $url) { continue }
            $count++
            $ref = Convert-ToCellRef ($original.Count+$c+1) ($r+2)
            [void]$links.Append('<hyperlink ref="'+$ref+'" r:id="link'+$count+'"/>')
            [void]$rels.Append('<Relationship Id="link'+$count+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="'+(Escape-XmlText $url)+'" TargetMode="External"/>')
        }
    }
    [void]$links.Append('</hyperlinks>')
    [void]$rels.Append('</Relationships>')
    $xml = $xml.Replace('<worksheet xmlns=', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns=')
    $xml = $xml.Replace('</worksheet>', $links.ToString()+'</worksheet>')
    $entry.Delete()
    Add-ZipEntryText $zip 'xl/worksheets/sheet1.xml' $xml
    Add-ZipEntryText $zip 'xl/worksheets/_rels/sheet1.xml.rels' $rels.ToString()
} finally { $zip.Dispose() }
[pscustomobject]@{rows=$rows.Count; original_columns=$original.Count; columns=$headers.Count; hyperlinks=$count; output=$OutputXlsx} | ConvertTo-Json
