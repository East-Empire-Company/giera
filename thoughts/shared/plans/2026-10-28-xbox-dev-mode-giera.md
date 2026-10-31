---
date: 2026-10-28
commit: 953a3d9c9b362b182eb1a69c75ce59dc74cf99eb
branch: feat/giera-voxel-mvp
ticket: none
status: draft
---
# Plan: Run Giera on Xbox Series X|S in Developer Mode

## Summary

First unblock the Xbox Dev Mode app installation. Then prove the Xbox UWP WebView can run Giera's WebGL2 renderer and controller/audio paths before building a wrapper. This plan targets Developer Mode testing only; it does not publish a Retail Mode Store app.

## Scope and assumptions

- Target: user's Xbox Series X|S and existing Giera Three.js game.
- Target outcome: launch the game from a console UWP package in Developer Mode and verify rendering, controller input, audio, offline loading, split-screen, and gameplay performance.
- Offline NPC interactions use canned replies and browser speech; live `/npc` services are unavailable without the game server.
- Microphone speech input is out of scope for the first package; WebView microphone support remains unverified.
- This repository contains Giera's game and PWA source: `index.html`, `src/main.ts`, `src/style.css`, `public/manifest.webmanifest`, and `public/sw.js`. The user identifies this repository as the source for the reported `Giera.sikora` app.
- The PWA manifest calls the app `Giera`; the repository has no identified Xbox UWP/MSIX packaging project. `vite.config.ts` builds for ES2022; `package.json` uses Three.js `^0.186.1`.
- Requires Windows 10/11 client, Visual Studio UWP tools, and Windows 10 SDK build 14393+ for builds. Windows and Xbox must share a subnet only for Visual Studio remote deployment; package upload can use Xbox Device Portal from a browser on the Xbox LAN. The Xbox setup guide is archived and lists VS 2019; VS 2022 lists Xbox One targeting, not explicit Series X|S deployment. Verify the installed target and console probe.
- Do not use a Scaleway Windows VM: its catalog offers Server 2022/2025, and Microsoft excludes full UWP development on Server. Xbox Device Portal package upload is documented but needs Dev Mode and a browser on the Xbox LAN; no Windows client image, license, or console subnet is verified.
- Package the game source from this repository. Create a small Xbox UWP host only because no such host exists here; do not search for a separate game source.
- Per user instruction, prepare source code while console access is deferred. Do not treat local checks as Xbox compatibility proof.
- Developer Mode excludes Retail games and apps; switching back restarts the console. Activation count is limited, and Partner Center shows usage.
- Stop if the Xbox UWP WebView cannot provide WebGL2 or the required game APIs. Do not build a production wrapper around a failed probe.

## Research References

- Existing architecture research: `thoughts/shared/research/2026-10-24-web-voxel-sandbox.md`.
- [Xbox Developer Mode activation](https://learn.microsoft.com/en-us/previous-versions/windows/uwp/xbox-apps/devkit-activation).
- [UWP development environment setup for Xbox](https://learn.microsoft.com/en-us/previous-versions/windows/uwp/xbox-apps/development-environment-setup).
- [UWP WebView API](https://learn.microsoft.com/en-us/uwp/api/windows.ui.xaml.controls.webview).
- [Xbox Developer Mode agreement](https://learn.microsoft.com/en-us/legal/windows/agreements/xbox-one-developer-mode-activation).
- [Visual Studio 2022 compatibility](https://learn.microsoft.com/en-us/visualstudio/releases/2022/compatibility).
- [Scaleway Marketplace image catalog](https://api.scaleway.com/marketplace/v2/images?page_size=100).
- [Xbox service status](https://support.xbox.com/en-us/xbox-live-status).
- [Windows Update Agent networking error codes](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/aa387293(v=vs.85)); `0x80244022` maps to HTTP 503 in that error-code namespace. This does not by itself identify which Xbox Store service returned the error.

- [Xbox Device Portal setup for Xbox](https://learn.microsoft.com/en-us/previous-versions/windows/uwp/xbox-apps/introduction-to-xbox-tools).
- [Xbox Dev Home network-share support](https://learn.microsoft.com/en-us/previous-versions/windows/uwp/xbox-apps/dev-home).
- [Device Portal app deployment API](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/device-portal-api-core).
- [Device Portal Apps manager upload flow](https://learn.microsoft.com/en-us/windows/advanced-settings/device-portal).
- [UWP device-family targeting](https://learn.microsoft.com/en-us/uwp/extension-sdks/device-families-overview).
- [Xbox media app development options](https://learn.microsoft.com/en-us/windows/uwp/apps-for-xbox/development-options).

## Phase 1: Unblock Developer Mode app installation

### Changes

No repository changes.

#### Xbox console and Microsoft Store
- **What**: Check Xbox service status, restart the console, retry Store installation, and compare another network if available. If the error persists while services are up, collect timestamp, system version, other-app install results, and network used; escalate to Xbox Support rather than retrying indefinitely.
- **Where**: User's Xbox Store and Xbox Dev Mode app.
- **Rationale**: The screenshot shows Store installation failed with `0x80244022`; the code maps to HTTP 503 in the Windows Update Agent networking table, but the affected Xbox Store service is not yet identified.
- **Code sketch**: Not applicable.

#### Developer Mode activation, mode switching, and pairing
- **What**: Before activation, review the Retail Mode tradeoff and remaining activation count in Partner Center. After activation, verify the console's remote-management address/PIN pairing flow with the Windows development host.
- **Where**: Xbox Dev Mode app, Partner Center, and Visual Studio deployment environment.
- **Rationale**: Retail games/apps do not run in Developer Mode; returning to Retail Mode restarts the console. Activation count is limited.
- **Code sketch**: Not applicable.

### Success Criteria

#### Automated Verification
- [ ] None; this phase is console/account setup.

#### Manual Verification
- [ ] Dev Mode app installs and opens without `0x80244022`.
- [ ] Before activation, user confirms the console can leave Retail Mode; Partner Center shows an available activation.
- [ ] Console enters Developer Mode and displays its development/remote-management connection details.
- [ ] Xbox Device Portal is enabled and reachable from a browser on the console's local network; use its Apps manager to upload the signed package.
- [ ] Switching back to Retail Mode restarts the console; retail apps and games return after restart.
- [ ] If `0x80244022` persists, test another network if available; correlate Xbox status and escalate with the captured evidence. Keep Phase 2 blocked until installation succeeds.

### Dependencies
- Requires: Xbox Series X|S, eligible developer account, successful Dev Mode app install, and Windows 10/11 UWP build host. Browser deployment requires a Mac browser on the Xbox LAN.
- Blocks: Phase 2.

## Phase 2: Prove Xbox UWP WebView runtime compatibility

### Changes

#### Files: `scripts/serve-xbox-probe.ts`, `playwright.xbox-probe.config.ts`, and `tests/e2e/xbox-probe.spec.ts`
- **What**: Serve raw package assets locally and test module, worker, gamepad, audio, rendering, frame rate, and root-relative resources.
- **Where**: Dedicated static probe server and Playwright test.
- **Rationale**: Vite development transforms would not match packaged files.

#### File: `platform/xbox-uwp-probe/Giera.XboxProbe.csproj` (new)
- **What**: Create an x64 `Windows.Universal` UWP host from the documented Blank UWP template; verify Xbox installation separately.
- **Where**: New isolated probe project in this repository.
- **Rationale**: Giera's game/PWA source is here; this repository has no Xbox UWP host.

#### File: `platform/xbox-uwp-probe/Package.appxmanifest` and `Assets/` (new)
- **What**: Declare the Universal family, entry point, package identity, and required logo assets; create a signed development package on Windows.
- **Where**: Probe package metadata and package logos.
- **Rationale**: The archived Xbox setup guide starts with a Blank Universal UWP app; Xbox package deployment still needs console verification.

#### Files: `platform/xbox-uwp-probe/App.xaml`, `App.xaml.cs`, and `Properties/Default.rd.xml` (new)
- **What**: Add UWP activation startup and .NET Native metadata rules.
- **Where**: Probe app startup and release build metadata.
- **Rationale**: The packaged C# host needs an application entry point.

#### File: `platform/xbox-uwp-probe/MainPage.xaml` (new)
- **What**: Host the classic XAML `WebView`; do not assume WebView2 support.
- **Where**: Probe app's main page.
- **Rationale**: Microsoft directs Xbox UWP apps to classic `WebView`.
- **Code sketch**:
  ```xml
  <Grid>
    <WebView x:Name="ProbeView" />
  </Grid>
  ```

#### File: `platform/xbox-uwp-probe/MainPage.xaml.cs` (new)
- **What**: Navigate through `PackagedAssetResolver` with `NavigateToLocalStreamUri`.
- **Where**: Probe host startup/navigation.
- **Rationale**: The local URI mapping must support root-absolute resource requests.
- **Code sketch**:
  ```csharp
  ProbeView.NavigateToLocalStreamUri(probeUri, new PackagedAssetResolver());
  ```

#### File: `platform/xbox-uwp-probe/PackagedAssetResolver.cs` (new)
- **What**: Resolve canonical local paths to files under the package's `Assets/` directory.
- **Where**: `Windows.Web.IUriToStreamResolver` implementation.
- **Rationale**: Every probe resource must load from packaged content without a server.

#### File: `platform/xbox-uwp-probe/Assets/probe.html`, `probe-main.js`, and `probe-worker.js` (new)
- **What**: Probe WebGL2, ES2022 syntax, gamepad API, gesture-started audio, page rAF, root-absolute fetch/texture/CSS URLs, ES module execution, and module-worker startup/message delivery.
- **Where**: Local probe page and its module scripts.
- **Rationale**: Giera uses Three.js `^0.186.1`, runtime slash-prefixed URLs, an ES module entry, and an ES module chunk worker.
- **Code sketch**:
  ```js
  new Worker(new URL("./probe-worker.js", import.meta.url), { type: "module" });
  ```

### Success Criteria

- [ ] Windows 10/11 UWP tools build and sign the x64 Universal probe with SDK build 14393+. Xbox installation remains unverified until the console probe runs.
- [ ] Probe page reports WebGL2, ES2022, gamepad API, gesture audio, page rAF baseline, and root-absolute resource results.
- [ ] Probe module executes and its module worker returns a message; packaged assets resolve without a network server.

#### Manual Verification
- [ ] Deploy and launch probe on the user's Xbox Series X|S in Developer Mode.
- [ ] WebGL2 context succeeds; ES2022 constructs parse and execute.
- [ ] A connected controller is detected and button/axis values change on real input.
- [ ] Audio plays after a controller/button gesture.
- [ ] Record page rAF as a loop baseline only; assess full-game performance in Phase 3.
- [ ] If WebGL2 fails, stop. Report the blocker and request a route decision; do not silently downgrade Three.js or switch to Store distribution.

### Dependencies
- Source authoring can proceed now. Build/sign requires Windows 10/11 UWP tools and SDK 14393+. Visual Studio deployment requires the same subnet; Device Portal upload requires the Mac browser on Xbox's subnet.
- Blocks: Phase 3 only if all required probes pass.

## Phase 3: Package and test the existing game

### Changes

#### File: `platform/xbox-uwp/Giera.Xbox.csproj`, `Package.appxmanifest`, and `Assets/` (new; conditional on Phase 2 passing)
- **What**: Create the Xbox UWP package, declare the app identity and required logo assets, sign with a development certificate, and include this repository's production Vite output.
- **Where**: New platform-specific project in this repository.
- **Rationale**: The game/PWA source exists here; an Xbox-compatible package host does not.

#### File: `platform/xbox-uwp/MainPage.xaml` and `platform/xbox-uwp/MainPage.xaml.cs` (new)
- **What**: Load the packaged Giera entry page through the proven `IUriToStreamResolver`; keep only required WebView host logic.
- **Where**: New UWP host page.
- **Rationale**: The WebView's local URI mapping must support Giera's absolute asset paths.
- **Code sketch**:
  ```csharp
  NavigateToPackagedGame("index.html", new PackagedAssetResolver());
  ```

#### File: `vite.config.ts` and runtime asset references (modify only if the output audit requires it)
- **What**: Audit root-absolute URLs, the `index.html` module entry, and the emitted module worker. Change Vite's top-level `base` only if emitted paths require it; it does not rewrite runtime literals.
- **Where**: `vite.config.ts`, `index.html`, and the asset/worker callsites listed below.
- **Rationale**: Package-local URI resolution can break slash-prefixed resources, module entry loading, or worker loading.
- **Audit callsites**: `index.html:26`, `src/client/render/renderer.ts:74-89`, `src/client/audio/sound.ts:16-31,68`, `src/main.ts:149`, `src/client/render/ground-decor.ts:20`, `src/client/game/hud.ts:6-26`, `src/style.css:1,71`, `src/client/render/worldRenderer.ts:136`, and emitted entry/worker chunks.
### Success Criteria

#### Automated Verification
- [ ] `bun run build` succeeds and emits the complete static game build.
- [ ] `bun run test` passes without changing tests to accommodate Xbox behavior.
- [ ] Audit code-level asset URL literals, `index.html`, emitted module entry, and worker chunks; verify each resolves through the selected package URI resolver.

#### Manual Verification
- [ ] Deploy the UWP package to the user's Series X|S through the Dev Mode workflow.
- [ ] Giera boots from packaged content without a network host; offline world generation and gameplay work with the console disconnected.
- [ ] Offline NPC behavior uses canned replies and browser speech; live `/npc/reason` and `/npc/tts` services are not expected.
- [ ] Xbox controller moves, looks, jumps, mines, and places blocks; no Edge-specific View-button activation is needed unless probe results require it.
- [ ] In split-screen, 2 connected controllers control separate players without cross-binding.
- [ ] Audio unlocks after controller interaction and continues through the tested play loop.
- [ ] Solo play holds at least the existing manual Xbox target of 30 FPS while walking through loaded chunks; record the measurement method and result.
- [ ] Complete applicable Xbox controller/performance checks in `tests/MANUAL-CHECKLIST.md`; microphone speech input remains out of scope.

### Dependencies
- Requires: Phase 2 passing; Windows 10/11 UWP tooling. Deploy through same-subnet VS or Device Portal in a browser on the Xbox LAN.
- Blocks: None.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Xbox Store service still returns `0x80244022` | Medium | High | Compare Xbox status and a second network; escalate with timestamp/system evidence if persistent. Keep Phase 2 blocked. |
| Xbox classic WebView lacks WebGL2 or required JavaScript/runtime APIs | High | High | Run Phase 2 probe first; stop on failed core capability and request a route decision. |
| Developer Mode interrupts Retail use and activation is limited | Medium | Medium | Explain mode switching/restart and retail-app unavailability; check activation availability before switching. |
| This repository has no Xbox UWP host project | High | Medium | Create only the minimal host needed after the compatibility probe passes. |
| No Windows 10/11 host with Xbox UWP target is available | High | High | Confirm the installed target before platform builds; confirm Mac Device Portal access before package upload. Windows need not share Xbox's subnet when using Device Portal. |
| Visual Studio 2022 deployment to Series X|S is not explicitly documented | Medium | High | Verify target availability and deploy the compatibility probe on the console before full packaging. |
| Packaged URI scheme breaks absolute-root asset paths | High | High | Probe representative absolute fetch, texture, and CSS URLs first; audit all path literals and verify the resolver mapping. |
| Split-screen or offline behavior differs in the WebView host | Medium | Medium | Test 2-controller assignment and disconnected-network gameplay before accepting the package. |

## Rollback Strategy

Keep the Xbox probe and host isolated under `platform/`. Revert any conditional runtime asset-path changes without changing the current web/PWA behavior. Preserve the game and PWA source files.

## File Ownership Summary

| File | Phase | Change Type |
|------|-------|-------------|
| Xbox Dev Mode app / console configuration | 1 | External setup; no repository edit |
| `index.html`, `src/main.ts`, `src/style.css`, `public/manifest.webmanifest`, `public/sw.js` | Source | Package input |
| `platform/xbox-uwp-probe/Giera.XboxProbe.csproj` | 2 | Create |
| `platform/xbox-uwp-probe/Package.appxmanifest` and `Assets/` | 2 | Create |
| `platform/xbox-uwp-probe/MainPage.xaml` | 2 | Create |
| `platform/xbox-uwp-probe/MainPage.xaml.cs` | 2 | Create |
| `platform/xbox-uwp-probe/Assets/probe.html`, `probe-main.js`, `probe-worker.js` | 2 | Create |
| `platform/xbox-uwp/Giera.Xbox.csproj` | 3 | Create, conditional |
| `platform/xbox-uwp/Package.appxmanifest` and `Assets/` | 3 | Create, conditional |
| `platform/xbox-uwp/MainPage.xaml` and `MainPage.xaml.cs` | 3 | Create, conditional |
| `vite.config.ts` and audited asset/worker callsites | 3 | Conditional modification |
