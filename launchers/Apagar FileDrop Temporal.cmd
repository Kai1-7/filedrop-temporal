@echo off
title Apagar FileDrop temporal
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = Resolve-Path '..'; $escaped = [regex]::Escape($root.Path); $procs = Get-CimInstance Win32_Process | Where-Object { (($_.Name -eq 'node.exe' -or $_.Name -eq 'electron.exe' -or $_.Name -eq 'cloudflared.exe') -and $_.CommandLine -match $escaped) }; foreach ($proc in $procs) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }; Remove-Item -Force '..\public-origin.txt' -ErrorAction SilentlyContinue; Write-Host 'FileDrop temporal apagado.'"
pause
