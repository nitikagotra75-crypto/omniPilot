// Windows UI Automation: lists named, visible controls of the foreground window with their screen centres.
// Runs a CONSTANT PowerShell script (no model-supplied text reaches the shell). Windows only.
import { run } from "../utils/exec.js";

export const UIA_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public class OPWin { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[void][OPWin]::SetProcessDPIAware()
$h = [OPWin]::GetForegroundWindow()
$w = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$out = New-Object System.Collections.ArrayList
foreach ($e in $all) {
  $c = $e.Current
  if ($c.IsOffscreen -or $c.IsPassword -or -not $c.Name) { continue }
  $r = $c.BoundingRectangle
  if ($r.Width -le 0 -or $r.Height -le 0) { continue }
  [void]$out.Add([pscustomobject]@{ name = $c.Name; type = $c.ControlType.ProgrammaticName.Replace('ControlType.',''); x = [int]($r.X + $r.Width / 2); y = [int]($r.Y + $r.Height / 2); w = [int]$r.Width; h = [int]$r.Height })
  if ($out.Count -ge 150) { break }
}
ConvertTo-Json -InputObject @($out) -Compress
`;

export function parseUia(stdout) {
  const text = String(stdout).trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((e) => e && typeof e.name === "string");
}

export async function listUiElements({ runner = run, signal } = {}) {
  const encoded = Buffer.from(UIA_SCRIPT, "utf16le").toString("base64");
  const { stdout } = await runner("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { timeout: 20_000, signal });
  return parseUia(stdout);
}
