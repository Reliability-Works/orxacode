# Engineering TODO

## 1) Performance and Responsiveness

- [x] Move Orxa bootstrap off the startup critical path.
- [x] Skip duplicate mode switch work when mode is unchanged.
- [x] Defer macOS dock icon setup so it does not block first paint.
- [x] Reduce renderer refresh churn by avoiding duplicate message loads during refresh cycles.
- [x] Add polling backoff for active response tracking.
- [x] Batch PTY output events before IPC delivery.
- [x] Replace repeated sidebar session filtering with a single computed list.
- [x] Add telemetry message caching + batched loading for dashboard aggregates.
- [ ] Add startup/runtime timing instrumentation (first paint, bootstrap complete, dashboard complete).
- [ ] Add profiling benchmark fixtures for large-session projects.

## 2) Auto-Update Reliability

- [x] Integrate `electron-updater` with user prompts for download and restart.
- [x] Configure Electron Builder GitHub publish metadata.
- [x] Add periodic update checks for packaged builds.
- [x] Add a settings toggle for auto-update checks.
- [x] Add “Check for updates” manual action in settings/help menu.
- [x] Add release-channel support (stable/prerelease).
- [x] Add telemetry for update-check success/failure/download timing.

## 3) CI/CD and Release Process

- [x] Create CI workflow for lint/typecheck/coverage.
- [x] Create tag-driven release workflow for GitHub Releases publishing.
- [x] Document tag-based release process in README.
- [x] Add signed macOS builds + notarization pipeline.
- [x] Add Windows target packaging and publishing.
- [ ] Add changelog generation from conventional commits.
- [x] Add release smoke-test job (launch app artifact, sanity checks).

## 4) Documentation

- [x] Rewrite README to reflect current architecture/features.
- [x] Add explicit homage and “powered by OpenCode” attribution.
- [x] Document auto-update behavior and release flow.
- [x] Add architecture diagram (main/preload/renderer + IPC + runtime).
- [x] Add troubleshooting guide for runtime/plugin/update failures.

## 5) Testing and Coverage

- [x] Add coverage script and CI enforcement.
- [x] Add/expand tests for core model/format/agent selection logic.
- [x] Enforce 80%+ coverage gate for core shared logic modules.
- [x] Expand coverage gate to include hooks and renderer integration paths.
- [x] Add tests for updater service behavior with mocked Electron APIs.
- [x] Add tests for startup/bootstrap sequencing in main process.
- [x] Add integration test harness for IPC event flow under load.
- [ ] Reach 80%+ coverage across the full renderer code surface.

## 6) Security and Hardening

- [x] Keep context isolation and sandbox defaults in BrowserWindow.
- [x] Keep external-link opening constrained via `shell.openExternal`.
- [ ] Add dependency vulnerability scan in CI (`pnpm audit` policy + allowlist flow).
- [x] Add secret scanning workflow.
- [x] Add stricter schema validation for high-risk IPC payloads.
