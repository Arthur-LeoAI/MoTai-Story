Option Explicit

Dim shell, fso, root, psPath, psFile, bundledNodePath, codexNodePath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
bundledNodePath = root & "\tools\node\node.exe"
codexNodePath = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
psPath = shell.ExpandEnvironmentStrings("%TEMP%") & "\motai-launch.ps1"

Set psFile = fso.CreateTextFile(psPath, True, False)
psFile.WriteLine "$ErrorActionPreference = 'SilentlyContinue'"
psFile.WriteLine "$root = '" & Replace(root, "'", "''") & "'"
psFile.WriteLine "$command = Get-Command node.exe -ErrorAction SilentlyContinue"
psFile.WriteLine "$node = if ($command) { $command.Source } else { '' }"
psFile.WriteLine "$bundledNode = '" & Replace(bundledNodePath, "'", "''") & "'"
psFile.WriteLine "$codexNode = '" & Replace(codexNodePath, "'", "''") & "'"
psFile.WriteLine "if (-not $node -and (Test-Path -LiteralPath $bundledNode)) { $node = $bundledNode }"
psFile.WriteLine "if (-not $node -and (Test-Path -LiteralPath $codexNode)) { $node = $codexNode }"
psFile.WriteLine "if (-not $node) { $node = 'node.exe' }"
psFile.WriteLine "$port = 5177"
psFile.WriteLine "$pidFile = Join-Path $root '.motai.pid'"
psFile.WriteLine "$ids = [System.Collections.Generic.HashSet[int]]::new()"
psFile.WriteLine "if (Test-Path -LiteralPath $pidFile) { $raw = [IO.File]::ReadAllText($pidFile).Trim(); $serverId = 0; if ([int]::TryParse($raw, [ref]$serverId)) { [void]$ids.Add($serverId) } }"
psFile.WriteLine "try { $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; foreach ($c in @($connections)) { if ($c.OwningProcess) { [void]$ids.Add([int]$c.OwningProcess) } } } catch {}"
psFile.WriteLine "try { $pattern = '^\s*TCP\s+\S+:' + $port + '\s+\S+\s+LISTENING\s+(\d+)\s*$'; foreach ($line in (& netstat -ano)) { if ($line -match $pattern) { [void]$ids.Add([int]$matches[1]) } } } catch {}"
psFile.WriteLine "foreach ($id in $ids) { try { $p = Get-Process -Id $id -ErrorAction Stop; if ($p.ProcessName -eq 'node') { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } } catch {} }"
psFile.WriteLine "Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue"
psFile.WriteLine "$args = @('--env-file-if-exists=.env.local', '--use-env-proxy', 'server.js')"
psFile.WriteLine "$psi = [Diagnostics.ProcessStartInfo]::new()"
psFile.WriteLine "$psi.FileName = $node"
psFile.WriteLine "$psi.Arguments = [string]::Join(' ', $args)"
psFile.WriteLine "$psi.WorkingDirectory = $root"
psFile.WriteLine "$psi.UseShellExecute = $false"
psFile.WriteLine "$psi.CreateNoWindow = $true"
psFile.WriteLine "$proc = [Diagnostics.Process]::Start($psi)"
psFile.WriteLine "[IO.File]::WriteAllText($pidFile, [string]$proc.Id)"
psFile.WriteLine "$url = 'http://127.0.0.1:' + $port"
psFile.WriteLine "$ready = $false"
psFile.WriteLine "for ($i = 0; $i -lt 40 -and -not $ready; $i++) { Start-Sleep -Milliseconds 300; if ($proc.HasExited) { break }; try { Invoke-RestMethod -Uri ($url + '/api') -TimeoutSec 1 | Out-Null; $ready = $true } catch {} }"
psFile.WriteLine "$message = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5aKo5Y+w5ZCv5Yqo5aSx6LSl77yM6K+35qOA5p+lIE5vZGUg6L+Q6KGM546v5aKD44CC'))"
psFile.WriteLine "$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5aKo5Y+w'))"
psFile.WriteLine "if ($ready) { Start-Process $url } else { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($message, $title) | Out-Null }"
psFile.WriteLine "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue"
psFile.Close

shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & psPath & Chr(34), 0, False
