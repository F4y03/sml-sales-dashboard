param(
    [Parameter(Mandatory=$true)]
    [string]$CsvPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

function Convert-ToSafeName {
    param([string]$Value, [string]$Fallback = "item")

    $name = if ([string]::IsNullOrWhiteSpace($Value)) { $Fallback } else { $Value.Trim() }
    $invalid = [System.IO.Path]::GetInvalidFileNameChars() + [char[]]@('<','>',':','"','/','\','|','?','*')
    foreach ($ch in $invalid) {
        $name = $name.Replace([string]$ch, "-")
    }
    $name = ($name -replace '\s+', ' ').Trim(' ', '.')
    if ($name.Length -gt 120) {
        $name = $name.Substring(0, 120).Trim(' ', '.')
    }
    if ([string]::IsNullOrWhiteSpace($name)) { return $Fallback }
    return $name
}

function Get-ExtensionFromUrl {
    param([string]$Url)
    try {
        $path = ([System.Uri]$Url).AbsolutePath
        $ext = [System.IO.Path]::GetExtension($path)
        if ($ext -match '^\.[A-Za-z0-9]{2,5}$') { return $ext.ToLowerInvariant() }
    } catch {}
    return ".jpg"
}

function Escape-XmlText {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value) { return "" }
    return [System.Security.SecurityElement]::Escape($Value)
}

function Add-ZipEntryText {
    param(
        [System.IO.Compression.ZipArchive]$Zip,
        [string]$Path,
        [string]$Text
    )
    $entry = $Zip.CreateEntry($Path)
    $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
    try { $writer.Write($Text) } finally { $writer.Dispose() }
}

function New-Xlsx {
    param(
        [Parameter(Mandatory=$true)]
        [object[]]$Rows,
        [Parameter(Mandatory=$true)]
        [string[]]$Headers,
        [Parameter(Mandatory=$true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew)
    $zip = [System.IO.Compression.ZipArchive]::new($fs, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Add-ZipEntryText $zip "[Content_Types].xml" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'
        Add-ZipEntryText $zip "_rels/.rels" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
        Add-ZipEntryText $zip "xl/_rels/workbook.xml.rels" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
        Add-ZipEntryText $zip "xl/workbook.xml" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>'
        Add-ZipEntryText $zip "xl/styles.xml" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
        Add-ZipEntryText $zip "docProps/app.xml" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Codex</Application></Properties>'
        Add-ZipEntryText $zip "docProps/core.xml" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Codex</dc:creator><cp:lastModifiedBy>Codex</cp:lastModifiedBy></cp:coreProperties>'

        $sheetEntry = $zip.CreateEntry("xl/worksheets/sheet1.xml")
        $writer = [System.IO.StreamWriter]::new($sheetEntry.Open(), [System.Text.UTF8Encoding]::new($false))
        try {
            $writer.Write('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>')
            $rowNum = 1
            $writer.Write('<row r="1">')
            for ($i = 0; $i -lt $Headers.Count; $i++) {
                $cellRef = Convert-ToCellRef ($i + 1) $rowNum
                $writer.Write('<c r="' + $cellRef + '" t="inlineStr"><is><t>' + (Escape-XmlText $Headers[$i]) + '</t></is></c>')
            }
            $writer.Write('</row>')

            foreach ($row in $Rows) {
                $rowNum++
                $writer.Write('<row r="' + $rowNum + '">')
                for ($i = 0; $i -lt $Headers.Count; $i++) {
                    $value = [string]($row[$Headers[$i]])
                    if ($value.Length -gt 32767) { $value = $value.Substring(0, 32767) }
                    $cellRef = Convert-ToCellRef ($i + 1) $rowNum
                    $writer.Write('<c r="' + $cellRef + '" t="inlineStr"><is><t xml:space="preserve">' + (Escape-XmlText $value) + '</t></is></c>')
                }
                $writer.Write('</row>')
            }
            $writer.Write('</sheetData></worksheet>')
        } finally {
            $writer.Dispose()
        }
    } finally {
        $zip.Dispose()
        $fs.Dispose()
    }
}

function Convert-ToCellRef {
    param([int]$Column, [int]$Row)
    $name = ""
    while ($Column -gt 0) {
        $Column--
        $name = [char](65 + ($Column % 26)) + $name
        $Column = [math]::Floor($Column / 26)
    }
    return "$name$Row"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$downloadDir = Join-Path $OutputDir "downloads"
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null

$rows = Import-Csv -LiteralPath $CsvPath -Encoding UTF8
$headers = @($rows[0].PSObject.Properties.Name)
$nameCol = $headers[4]
$skuCol = $headers[2]
$categoryCol = $headers[27]
$imageCol = $headers[30]

$manifest = New-Object System.Collections.Generic.List[object]
$preparedRows = New-Object System.Collections.Generic.List[object]
$lastCategory = ""
$urlMap = @{}
$client = [System.Net.WebClient]::new()
$client.Headers.Add("User-Agent", "Mozilla/5.0")

$rowIndex = 0
foreach ($row in $rows) {
    $rowIndex++
    $name = [string]$row.$nameCol
    $sku = [string]$row.$skuCol
    $rawCategory = [string]$row.$categoryCol
    if (-not [string]::IsNullOrWhiteSpace($rawCategory)) { $lastCategory = $rawCategory }
    $effectiveCategory = if ([string]::IsNullOrWhiteSpace($rawCategory)) { $lastCategory } else { $rawCategory }
    $categoryPath = (($effectiveCategory -split ',')[0] -split '>') | ForEach-Object { Convert-ToSafeName $_ "Uncategorized" }
    if ($categoryPath.Count -eq 0 -or [string]::IsNullOrWhiteSpace(($categoryPath -join ""))) { $categoryPath = @("Uncategorized") }

    $urls = @()
    if (-not [string]::IsNullOrWhiteSpace($row.$imageCol)) {
        $urls = @($row.$imageCol -split ',\s*' | Where-Object { $_ -match '^https?://' })
    }

    $driveLinks = New-Object System.Collections.Generic.List[string]
    $imageFiles = New-Object System.Collections.Generic.List[string]
    $imageNumber = 0
    foreach ($url in $urls) {
        $imageNumber++
        if (-not $urlMap.ContainsKey($url)) {
            $ext = Get-ExtensionFromUrl $url
            $baseParts = @()
            if (-not [string]::IsNullOrWhiteSpace($sku)) { $baseParts += (Convert-ToSafeName $sku "sku") }
            $baseParts += (Convert-ToSafeName $name "product")
            if ($urls.Count -gt 1) { $baseParts += ("image-" + $imageNumber) }
            $fileName = (($baseParts -join " - ") + $ext)
            if ($fileName.Length -gt 180) { $fileName = $fileName.Substring(0, 180 - $ext.Length).Trim(' ','.') + $ext }
            $folderRel = Join-Path -Path $downloadDir -ChildPath ($categoryPath -join [System.IO.Path]::DirectorySeparatorChar)
            New-Item -ItemType Directory -Force -Path $folderRel | Out-Null
            $localPath = Join-Path $folderRel $fileName
            $dedupe = 1
            while (Test-Path -LiteralPath $localPath) {
                $dedupe++
                $stem = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
                $localPath = Join-Path $folderRel (($stem + " (" + $dedupe + ")" + $ext))
            }
            $status = "downloaded"
            $errorMessage = ""
            try {
                $client.DownloadFile($url, $localPath)
            } catch {
                $status = "download_failed"
                $errorMessage = $_.Exception.Message
            }
            $urlMap[$url] = [ordered]@{
                source_url = $url
                local_path = $localPath
                drive_url = ""
                drive_id = ""
                drive_folder_id = ""
                file_name = [System.IO.Path]::GetFileName($localPath)
                category_path = ($categoryPath -join " / ")
                product_name = $name
                sku = $sku
                row_index = $rowIndex
                status = $status
                error = $errorMessage
            }
        }
        $info = $urlMap[$url]
        $imageFiles.Add([string]$info.file_name) | Out-Null
        if (-not [string]::IsNullOrWhiteSpace([string]$info.drive_url)) {
            $driveLinks.Add([string]$info.drive_url) | Out-Null
        }
    }

    $out = [ordered]@{}
    foreach ($h in $headers) { $out[$h] = [string]$row.$h }
    $out["Drive Image Links"] = ($driveLinks -join ", ")
    $out["Drive Image Files"] = ($imageFiles -join ", ")
    $out["Effective Category"] = $effectiveCategory
    $preparedRows.Add($out) | Out-Null
}

foreach ($entry in $urlMap.Values) { $manifest.Add([pscustomobject]$entry) | Out-Null }

$manifestPath = Join-Path $OutputDir "image-manifest.json"
$rowsPath = Join-Path $OutputDir "rows-prepared.json"
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$preparedRows | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $rowsPath -Encoding UTF8

$xlsxPath = Join-Path $OutputDir "products-with-drive-links.xlsx"
$finalHeaders = @($headers + @("Drive Image Links", "Drive Image Files", "Effective Category"))
New-Xlsx -Rows $preparedRows -Headers $finalHeaders -Path $xlsxPath

[pscustomobject]@{
    rows = $rows.Count
    original_columns = $headers.Count
    unique_images = $manifest.Count
    downloaded = @($manifest | Where-Object { $_.status -eq "downloaded" }).Count
    failed = @($manifest | Where-Object { $_.status -ne "downloaded" }).Count
    manifest = $manifestPath
    prepared_rows = $rowsPath
    xlsx = $xlsxPath
    downloads = $downloadDir
} | ConvertTo-Json -Depth 4

