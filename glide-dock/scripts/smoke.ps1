# CI smoke test: start the built dock, check it stays up, measure memory and idle CPU, test that the taskbar
# setting is put back after a crash and by --cleanup.
param([string]$Exe = "src-tauri/target/release/glide-dock.exe")
$ErrorActionPreference = "Stop"
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class AB {
  [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint cb; public uint edge; public int l,t,r,b; public IntPtr lParam; }
  [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
  public static uint State() { var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d); return (uint)SHAppBarMessage(4, ref d); }
}
"@
function Tree($id) {
  $all = Get-CimInstance Win32_Process
  $ids = @($id); $i = 0
  while ($i -lt $ids.Count) { $ids += ($all | Where-Object { $_.ParentProcessId -eq $ids[$i] }).ProcessId; $i++ }
  Get-Process -Id $ids -ErrorAction SilentlyContinue
}
$before = [AB]::State()
"Taskbar auto-hide before: $($before -band 1)"
$p = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 20
if ($p.HasExited) { throw "Glide Dock exited early with code $($p.ExitCode)" }
$procs = Tree $p.Id
$ws = ($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB
$priv = ($procs | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB
$own = (Get-Process -Id $p.Id).WorkingSet64 / 1MB
"Processes: $($procs.Count) ($((($procs | ForEach-Object Name) | Sort-Object -Unique) -join ', '))"
"Memory, whole tree (dock + WebView2): working set {0:N0} MB, private {1:N0} MB" -f $ws, $priv
"Memory, dock process alone: {0:N0} MB" -f $own
$cpu = ($procs | Measure-Object CPU -Sum).Sum
Start-Sleep -Seconds 60
$cpu2 = ((Tree $p.Id) | Measure-Object CPU -Sum).Sum
"Idle CPU over 60 s: {0:N2} s of CPU time = {1:N2}% of one core" -f ($cpu2 - $cpu), (($cpu2 - $cpu) / 60 * 100)
"Taskbar auto-hide while running: $([AB]::State() -band 1)"

Stop-Process -Id $p.Id -Force
Start-Sleep -Seconds 2
"Taskbar auto-hide after hard kill (expected still on): $([AB]::State() -band 1)"
$p2 = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds 10
"Taskbar auto-hide after restart (on again by the new run): $([AB]::State() -band 1)"
Stop-Process -Id $p2.Id -Force
Start-Sleep -Seconds 2
Start-Process -FilePath $Exe -ArgumentList "--cleanup" -Wait
Start-Sleep -Seconds 2
$after = [AB]::State()
"Taskbar auto-hide after --cleanup: $($after -band 1) (before the test: $($before -band 1))"
if (($after -band 1) -ne ($before -band 1)) { throw "taskbar setting was not restored" }
"ok"
