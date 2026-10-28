<#
.SYNOPSIS
  Install REA (rea-agents) for THIS project only and register it with Claude Code at local scope.

.DESCRIPTION
  1. Checks that Node satisfies rea-agents' engines range (^22.23.4 || ^24.22.1 || >=26.12.1).
  2. npm-installs the pinned rea-agents package into tools/rea-agents (node_modules is gitignored).
  3. Syncs the packaged skill into .claude/skills/reverse-engineer-anything so skill and server match.
  4. Registers "rea" as a local-scope MCP server (stored under this folder's path in ~/.claude.json).
  Re-runnable. From the repo root:
    powershell -ExecutionPolicy Bypass -File scripts\setup-rea.ps1
  See docs/adr/0005-rea-project-scoped.md.
#>
param(
  [string]$ReaVersion = '6.8.0',
  [switch]$SkipSkillSync
)

$ErrorActionPreference = 'Stop'
$root     = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $root 'tools\rea-agents'
$skillDst = Join-Path $root '.claude\skills\reverse-engineer-anything'

function Test-NodeVersion {
  param([string]$Raw)
  $v = [version]($Raw.TrimStart('v'))
  if ($v.Major -eq 22) { return ($v -ge [version]'22.23.4') }
  if ($v.Major -eq 24) { return ($v -ge [version]'24.22.1') }
  if ($v.Major -ge 26) { return ($v -ge [version]'26.12.1') }
  return $false
}

# 1. Node
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
  throw 'node was not found on PATH. Install Node.js 24 LTS (>= 24.22.1): winget install OpenJS.NodeJS.LTS'
}
$nodeRaw = (& node --version).Trim()
if (-not (Test-NodeVersion $nodeRaw)) {
  throw "Node $nodeRaw does not satisfy rea-agents engines (^22.23.4 || ^24.22.1 || >=26.12.1). Upgrade with 'winget upgrade OpenJS.NodeJS.LTS' (or nodejs.org), open a NEW terminal, then rerun this script."
}
Write-Host "Node $nodeRaw OK"

$claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
if ($null -eq $claudeCmd) { throw 'claude CLI was not found on PATH.' }

# 2. Install the pinned package into tools/rea-agents
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
Push-Location $toolsDir
try {
  if (-not (Test-Path 'package.json')) {
    Set-Content -Path 'package.json' -Encoding utf8 -Value '{ "name": "mc-kalshi-tools-rea", "private": true }'
  }
  & npm install --no-audit --no-fund --save-exact "rea-agents@$ReaVersion"
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$entry = Join-Path $toolsDir 'node_modules\rea-agents\scripts\rea.mjs'
if (-not (Test-Path $entry)) { throw "REA entry script not found at $entry" }

# 3. Sync the packaged skill (keeps skill text and server version aligned)
if (-not $SkipSkillSync) {
  $skillSrc = Join-Path $toolsDir 'node_modules\rea-agents\skills\reverse-engineer-anything'
  if (Test-Path $skillSrc) {
    if (Test-Path $skillDst) { Remove-Item -Recurse -Force $skillDst }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skillDst) | Out-Null
    Copy-Item -Recurse -Force -Path $skillSrc -Destination $skillDst
    Write-Host "Skill synced from rea-agents@$ReaVersion to $skillDst"
  } else {
    Write-Warning "Packaged skill not found at $skillSrc; keeping the existing copy at $skillDst"
  }
}

# 4. Register at LOCAL scope in the default Claude profile (CLAUDE_CONFIG_DIR must be unset)
$prevCfg = $env:CLAUDE_CONFIG_DIR
Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue
Push-Location $root
try {
  $ErrorActionPreference = 'Continue'
  & claude mcp remove --scope local rea     # idempotent: ignore failure when not registered yet
  $ErrorActionPreference = 'Stop'
  & claude mcp add --scope local rea -- $nodeCmd.Source $entry mcp
  if ($LASTEXITCODE -ne 0) { throw "claude mcp add failed with exit code $LASTEXITCODE" }
  & claude mcp list
} finally {
  Pop-Location
  if ($null -ne $prevCfg) { $env:CLAUDE_CONFIG_DIR = $prevCfg }
}

Write-Host ''
Write-Host "Done. Restart Claude Code from $root so the rea server and skill load."
Write-Host 'Verify with /status (project settings) and by asking Claude to list REA tools.'
