# Registers the NEXORA LAN agent to start at logon and restart after failures.
# Run from an elevated PowerShell in the repository root:
#   powershell -ExecutionPolicy Bypass -File scripts/install-agent.ps1

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node.exe).Source
$agent = Join-Path $repo 'scripts\nexora-agent.mjs'
$taskName = 'NEXORA POS Agent'

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$agent`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -RunLevel Highest `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "Installed and started scheduled task: $taskName"
Write-Host "Logs: $repo\.nexora-agent.log"
