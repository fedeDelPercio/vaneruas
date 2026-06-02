# Test runner para los escenarios de Mica.
# Crea una conversación nueva por test, envía mensajes y espera la respuesta.

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$base = "http://localhost:3102"
$pollTimeoutSec = 240
$pollIntervalMs = 1500

function New-Conversation($name) {
  $body = (@{ display_name = $name } | ConvertTo-Json)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $r = Invoke-RestMethod -Uri "$base/api/conversations" -Method Post -Body $bytes -ContentType "application/json; charset=utf-8"
  return $r.conversation.id
}

function Get-Messages($convId) {
  $r = Invoke-RestMethod -Uri "$base/api/messages/$convId" -Method Get
  return $r.messages
}

function Send-UserMessage($convId, $content) {
  $msgs = Get-Messages $convId
  $before = if ($msgs) { $msgs.Count } else { 0 }
  $body = (@{ conversationId = $convId; content = $content; source = "panel" } | ConvertTo-Json)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  Invoke-RestMethod -Uri "$base/api/webhooks/incoming" -Method Post -Body $bytes -ContentType "application/json; charset=utf-8" | Out-Null
  $deadline = (Get-Date).AddSeconds($pollTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds $pollIntervalMs
    $msgs = Get-Messages $convId
    if ($msgs.Count -gt ($before + 1)) {
      # Esperar un poco más por si vienen más segments del mismo turno
      Start-Sleep -Milliseconds 2500
      $msgs = Get-Messages $convId
      $last = $msgs[-1]
      if ($last.role -ne "user") {
        return ($msgs | Select-Object -Skip ($before + 1))
      }
    }
  }
  throw "timeout esperando respuesta para conv $convId tras mensaje: $content"
}

function Run-Test($name, $turns) {
  Write-Host ""
  Write-Host "==========================================" -ForegroundColor Green
  Write-Host "TEST: $name" -ForegroundColor Green
  Write-Host "==========================================" -ForegroundColor Green
  try {
    $convId = New-Conversation "TEST · $name"
    Write-Host "conv=$convId"
    foreach ($t in $turns) {
      Write-Host ""
      Write-Host "[USER] $t" -ForegroundColor Magenta
      $new = Send-UserMessage $convId $t
      foreach ($m in $new) {
        if ($m.role -eq "user") { continue }
        Write-Host "[$($m.role.ToUpper())]" -ForegroundColor Yellow
        Write-Host $m.content
      }
    }
    Write-Host ""
    Write-Host "FIN test $name. conv=$convId" -ForegroundColor Green
    return $convId
  } catch {
    Write-Host ""
    Write-Host "ERROR en $name : $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}

# === Ejecutar ===
$results = [ordered]@{}

$results["T1_apertura"] = Run-Test "T1 apertura" @("Quiero más información")

$results["T2_tipologia"] = Run-Test "T2 define tipologia" @(
  "Quiero hablar con un asesor",
  "Busco un 2 ambientes"
)

$results["T3_precio_puntual"] = Run-Test "T3 precio puntual" @(
  "Quiero más información",
  "Cuánto sale un monoambiente en piso 3?"
)

$results["T4_acepta_llamada"] = Run-Test "T4 acepta llamada" @(
  "Quiero más información",
  "Busco un 2 ambientes",
  "Dale, que me llamen",
  "Tarde mejor"
)

$results["T5_fuera_kb_bot"] = Run-Test "T5 fuera kb + bot" @(
  "Quiero más información",
  "Cuándo entregan? Sos un bot o una persona real?"
)

$results["T6_rechaza_reenganche"] = Run-Test "T6 rechaza y reengancha" @(
  "Quiero más información",
  "Busco un 2 ambientes",
  "No, llamada no, contame por acá",
  "Qué amenities tiene?",
  "Quiero reservar el 4°A"
)

$results["T7_visita_obra"] = Run-Test "T7 visita obra" @(
  "Quiero más información",
  "Se puede ir a ver el edificio?"
)

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "RESUMEN" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
foreach ($k in $results.Keys) {
  $status = if ($results[$k]) { "OK" } else { "ERROR" }
  Write-Host "$k → $status (conv=$($results[$k]))"
}
