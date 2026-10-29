param(
  [string]$Password = 'probe-dev-pass'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  $pfx = Join-Path $root 'Giera.XboxProbe_TemporaryKey.pfx'
  if (-not (Test-Path $pfx)) {
    $cert = New-SelfSignedCertificate `
      -Type Custom `
      -Subject 'CN=Giera Xbox Probe' `
      -KeyUsage DigitalSignature `
      -FriendlyName 'Giera Xbox Probe' `
      -CertStoreLocation 'Cert:\CurrentUser\My' `
      -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
    $secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $secure | Out-Null
    Write-Output ("created " + $pfx)
  }

  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) { throw 'vswhere not found; Visual Studio is not installed' }
  $msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
  if (-not $msbuild) { throw 'MSBuild not found' }
  Write-Output ("msbuild " + $msbuild)

  & $msbuild 'Giera.XboxProbe.csproj' /restore /t:Build `
    /p:Configuration=Release `
    /p:Platform=x64 `
    /p:AppxBundle=Never `
    /p:AppxPackageSigningEnabled=true `
    "/p:PackageCertificatePassword=$Password" `
    /v:m
  if ($LASTEXITCODE -ne 0) { throw ("build failed with exit code " + $LASTEXITCODE) }

  Get-ChildItem -Recurse -Path 'AppPackages' -Filter '*.appx' | Select-Object -ExpandProperty FullName
}
finally {
  Pop-Location
}