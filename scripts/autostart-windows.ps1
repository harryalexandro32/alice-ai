<#
  Menyalakan bot otomatis setiap kali Anda masuk ke Windows.

  Pasang  :  powershell -ExecutionPolicy Bypass -File scripts\autostart-windows.ps1
  Lepas   :  powershell -ExecutionPolicy Bypass -File scripts\autostart-windows.ps1 -Remove
  Periksa :  Get-ScheduledTask -TaskName "Alice AI Bot"

  Yang dibuat hanyalah satu tugas di Task Scheduler milik akun Anda sendiri
  (tidak butuh hak administrator). Tugas itu menjalankan `npm start` di folder
  proyek ini; pengawas di dalamnya yang menyalakan ulang bot kalau mati, dan
  Task Scheduler menyalakan ulang pengawasnya kalau ia sendiri berhenti.

  Catatan: bot hanya jalan selama komputernya menyala dan Anda sudah masuk.
  Matikan mode tidur (Settings > System > Power) kalau bot harus jalan terus.
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$name = 'Alice AI Bot'
$repo = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host "Tugas '$name' dihapus. Bot tidak lagi menyala otomatis."
  } else {
    Write-Host "Tugas '$name' memang tidak ada."
  }
  return
}

if (-not (Test-Path (Join-Path $repo 'package.json'))) { throw "Folder proyek tidak ditemukan di $repo" }
if (-not (Test-Path (Join-Path $repo '.env'))) { throw "Berkas .env belum ada di $repo — bot tidak akan bisa jalan." }
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw 'npm tidak ditemukan. Pasang Node.js dulu.' }

# Jendela dikecilkan supaya tidak mengganggu, tapi tetap ada untuk dilihat.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c start `"Alice AI Bot`" /min cmd /c `"`"$npm`" start`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Menyalakan bot WhatsApp Alice AI saat masuk ke Windows.' -Force | Out-Null

Write-Host "Terpasang. Bot akan menyala otomatis setiap kali $env:USERNAME masuk ke Windows."
Write-Host "Folder : $repo"
Write-Host "Log    : $(Join-Path $repo 'logs')"
Write-Host ''
Write-Host 'PENTING: jangan jalankan `npm start` kedua secara manual selama tugas ini aktif -'
Write-Host 'dua bot di satu nomor akan saling merebut sesi WhatsApp.'
