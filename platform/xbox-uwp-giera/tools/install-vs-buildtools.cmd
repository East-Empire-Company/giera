@echo off
setlocal
curl.exe -L -o C:\vs_buildtools.exe https://aka.ms/vs/17/release/vs_buildtools.exe
C:\vs_buildtools.exe --quiet --wait --norestart --nocache ^
  --add Microsoft.VisualStudio.Workload.UniversalBuildTools ^
  --add Microsoft.VisualStudio.ComponentGroup.UWP.NetCoreAndStandard ^
  --add Microsoft.VisualStudio.Component.Windows10SDK.19041 ^
  --includeRecommended
echo %ERRORLEVEL% > C:\xbox-uwp-giera\vs-install.exit