param(
    [Parameter(Mandatory=$false)]
    [string]$PreparedRowsJson,

    [Parameter(Mandatory=$false)]
    [string]$CsvPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputXlsx,

    [Parameter(Mandatory=$true)]
    [string]$ArchiveUrl
)

$ErrorActionPreference = "Stop"

function Escape-XmlText {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value) { return "" }
    return [System.Security.SecurityElement]::Escape($Value)
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

function Add-ZipEntryText {
    param([System.IO.Compression.ZipArchive]$Zip, [string]$Path, [string]$Text)
    $entry = $Zip.CreateEntry($Path)
    $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
    try { $writer.Write($Text) } finally { $writer.Dispose() }
}

function New-Xlsx {
    param([object[]]$Rows, [string[]]$Headers, [string]$Path)

    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew)
    $zip = [System.IO.Compression.ZipArchive]::new($fs, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Add-ZipEntryText $zip "[Content_Types].xml" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
        Add-ZipEntryText $zip "_rels/.rels" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
        Add-ZipEntryText $zip "xl/_rels/workbook.xml.rels" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
        Add-ZipEntryText $zip "xl/workbook.xml" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>'
        Add-ZipEntryText $zip "xl/styles.xml" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'

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

if (-not [string]::IsNullOrWhiteSpace($CsvPath)) {
    $rows = @(Import-Csv -LiteralPath $CsvPath -Encoding UTF8)
    $sourceHeaders = @($rows[0].PSObject.Properties.Name)
    $imageHeader = $sourceHeaders[30]
    $headers = @($sourceHeaders + "Image Links" + "Drive Archive Link")
    $outRows = foreach ($row in $rows) {
        $item = [ordered]@{}
        foreach ($h in $sourceHeaders) { $item[$h] = [string]$row.$h }
        $hasImages = -not [string]::IsNullOrWhiteSpace([string]$row.$imageHeader)
        $item["Image Links"] = if ($hasImages) { [string]$row.$imageHeader } else { "" }
        $item["Drive Archive Link"] = if ($hasImages) { $ArchiveUrl } else { "" }
        $item
    }
} else {
    $rows = @(Get-Content -LiteralPath $PreparedRowsJson -Raw | ConvertFrom-Json)
    $headers = @($rows[0].PSObject.Properties.Name)
    if ($headers -notcontains "Image Links") {
        $headers = @($headers + "Image Links")
    }
    if ($headers -notcontains "Drive Archive Link") {
        $headers = @($headers + "Drive Archive Link")
    }

    $outRows = foreach ($row in $rows) {
        $item = [ordered]@{}
        foreach ($h in $headers) {
            if ($h -eq "Drive Archive Link") {
                $hasImages = -not [string]::IsNullOrWhiteSpace([string]$row."Drive Image Files")
                $item[$h] = if ($hasImages) { $ArchiveUrl } else { "" }
            } elseif ($h -eq "Image Links") {
                $item[$h] = [string]$row.PSObject.Properties['ไฟล์รูปภาพ'].Value
            } else {
                $item[$h] = [string]$row.$h
            }
        }
        $item
    }
}

New-Xlsx -Rows $outRows -Headers $headers -Path $OutputXlsx
[pscustomobject]@{ xlsx = $OutputXlsx; rows = $outRows.Count; columns = $headers.Count } | ConvertTo-Json
