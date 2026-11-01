# Windows Desktop Setup for Forgejo Xbox Build CI

The Forgejo workflow `build-xbox.yml` SSHes into the Windows desktop to build the Xbox MSIX package. This needs a one-time physical setup on the Windows desktop.

## 1. Add SSH public key

Open PowerShell as the user (jakubsikora) and run:

```powershell
# Create .ssh directory if it doesn't exist
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.ssh"

# Add the Forgejo CI deploy key
Add-Content "$env:USERPROFILE\.ssh\authorized_keys" "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDyKeTOiIQgcrh7wteugBlASh1fGgckbZZ2XaoudrUJA forgejo-ci-deploy"

# Fix permissions (Windows OpenSSH requires strict ACLs)
icacls "$env:USERPROFILE\.ssh\authorized_keys" /inheritance:r /grant:r "$env:USERNAME:F"
```

If jakubsikora is in the Administrators group, Windows OpenSSH ignores `~/.ssh/authorized_keys` and uses `C:\ProgramData\ssh\administrators_authorized_keys` instead:

```powershell
# Check if user is admin
net localgroup Administrators

# If jakubsikora is listed, add key to administrators_authorized_keys instead
Add-Content "C:\ProgramData\ssh\administrators_authorized_keys" "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDyKeTOiIQgcrh7wteugBlASh1fGgckbZZ2XaoudrUJA forgejo-ci-deploy"
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant:r "SYSTEM:F" /grant:r "Administrators:F"
```

## 2. Clone the repo

```powershell
mkdir C:\Users\jakubsikora\Repos\personal -Force
cd C:\Users\jakubsikora\Repos\personal
git clone https://github.com/East-Empire-Company/giera
```

## 3. Install prerequisites

### Bun
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

### Visual Studio Build Tools + Windows 10 SDK 19041

Run `platform/xbox-uwp-giera/tools/install-vs-buildtools.cmd` from the repo, or install manually:
- Visual Studio Build Tools 2022 with UWP workload
- Windows 10 SDK 19041

## 4. Verify SSH access from Mac Studio

```bash
ssh -i ~/.ssh/forgejo-ci-deploy jakubsikora@desktop-fjvada8.tail5d39b4.ts.net "echo connected && hostname"
```

## 5. Trigger a test build

Push to main or manually trigger the `build-xbox` workflow on Forgejo:
```
https://forgejo.tail5d39b4.ts.net/jakub/giera/actions
```
