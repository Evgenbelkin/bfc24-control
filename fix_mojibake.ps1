$cp1251 = [System.Text.Encoding]::GetEncoding(1251)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

$targets = @(
    "public\index.html",
    "public\incoming.html",
    "public\movements.html",
    "public\clients.html",
    "public\login.html",
    "public\owner-dashboard.html"
)

foreach ($rel in $targets) {
    $path = Join-Path (Get-Location) $rel

    if (-not (Test-Path $path)) {
        Write-Host "SKIP $rel (not found)"
        continue
    }

    $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

    $fixed = [System.Text.Encoding]::UTF8.GetString(
        $cp1251.GetBytes($text)
    )

    [System.IO.File]::WriteAllText($path, $fixed, $utf8NoBom)
    Write-Host "FIXED $rel"
}