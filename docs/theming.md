# Appearance

This file keeps the older `theming.md` path, but the current product surface is much simpler than the old theme-system doc described.

## Theme options

Orxa Code currently supports three theme modes:

- System
- Light
- Dark

The setting is stored locally and synced to the desktop shell so the Electron window stays aligned with the renderer.

## Where to change it

Open `Settings -> General` and change the `Theme` row.

The same page also holds other appearance-adjacent options such as time format and default diff wrapping.

## Implementation notes

- Renderer theme state lives in `apps/web/src/hooks/useTheme.ts`.
- The current theme is saved in local storage under `orxa:theme`.
- The desktop bridge receives the chosen mode so the shell can stay in sync.

## Why this doc changed

The old document described a larger custom theme system with named packs such as Glass, Terminal, Midnight, Ember, and Arctic. That is not the current app state, so those instructions were removed instead of leaving a dead configuration guide in the repo.
