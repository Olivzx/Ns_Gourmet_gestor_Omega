param(
  [Parameter(Mandatory = $true)]
  [string]$OmegaPath
)

$ErrorActionPreference = 'Stop'
$sourcePath = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetPath = (Resolve-Path -LiteralPath $OmegaPath).Path

$serverFile = Join-Path $targetPath 'server.js'
if (-not (Test-Path -LiteralPath $serverFile -PathType Leaf)) {
  throw "Não encontrei server.js em '$targetPath'. Informe a pasta raiz do Gestor Omega."
}

$files = @('pedido.html', 'pedido.css', 'pedido.js')
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourcePath $file) -PathType Leaf)) {
    throw "Arquivo de origem ausente: $file"
  }
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $targetPath "backups/ns-gourmet-public-$timestamp"
New-Item -ItemType Directory -Force -Path $backupPath | Out-Null

foreach ($file in $files) {
  $existing = Join-Path $targetPath $file
  if (Test-Path -LiteralPath $existing -PathType Leaf) {
    Copy-Item -LiteralPath $existing -Destination (Join-Path $backupPath $file) -Force
  }
}

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $sourcePath $file) -Destination (Join-Path $targetPath $file) -Force
}

Write-Host ''
Write-Host 'Cardápio público copiado para o Gestor Omega.' -ForegroundColor Green
Write-Host "Arquivos anteriores foram guardados em: $backupPath"
Write-Host 'Nenhum arquivo server.js, .env, banco de dados ou configuração da Vercel foi alterado.' -ForegroundColor Cyan
