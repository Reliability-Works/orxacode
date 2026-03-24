# Theming

Orxa Code ships with five built-in themes. You can switch between them in **Settings > Appearance**, or create your own by editing `src/styles/themes.css`.

## Built-in themes

| Theme               | Base colour                    | Accent               | Style                                      |
| ------------------- | ------------------------------ | -------------------- | ------------------------------------------ |
| **Glass** (default) | `#0A0A14` with gradient glows  | `#6C7BFF` periwinkle | Frosted surfaces over atmospheric gradient |
| **Terminal**        | `#111111` opaque dark          | `#22C55E` green      | Classic terminal look                      |
| **Midnight**        | `#0B0E1A` deep navy            | `#818CF8` indigo     | Blue-black with purple accents             |
| **Ember**           | `#141110` warm dark            | `#F59E0B` amber      | Warm tones with orange accents             |
| **Arctic**          | `#F4F6FA` light                | `#2563EB` blue       | Clean light mode                           |

## How themes work

Themes are CSS custom property overrides applied via a `[data-theme]` attribute on the `<html>` element. The active theme is stored in `AppPreferences` and applied in `App.tsx`:

```typescript
document.documentElement.setAttribute("data-theme", appPreferences.theme);
```

Each theme block in `src/styles/themes.css` overrides the design tokens defined in `src/styles/base.css`:

```css
[data-theme="your-theme"] {
  --bg-page: #111111;
  --bg-sidebar: #161616;
  --bg-surface: #1C1C1C;
  --bg-input: #222222;
  /* ... all other tokens */
}
```

## Creating a new theme

### 1. Add the theme ID

In `src/types/app.ts`, add your theme ID to the `ThemeId` union:

```typescript
export type ThemeId = "glass" | "terminal" | "midnight" | "ember" | "arctic" | "your-theme";
```

### 2. Define the CSS tokens

Add a new `[data-theme="your-theme"]` block in `src/styles/themes.css`. You need to define all of these tokens:

#### Backgrounds

```css
--bg-page: #...;        /* Main page/app background */
--bg-sidebar: #...;     /* Left sidebar background */
--bg-surface: #...;     /* Cards, panels, elevated surfaces */
--bg-input: #...;       /* Input fields, buttons */
--bg-app: var(--bg-page);
--bg-raised: var(--bg-input);
--bg-terminal: #...;    /* Terminal/code output background */
```

#### Text colours

```css
--text-primary: #...;    /* Main text — headings, body */
--text-main: var(--text-primary);
--text-secondary: #...;  /* Secondary labels, descriptions */
--text-tertiary: #...;   /* Muted labels */
--text-muted: #...;      /* Placeholders, hints */
--text-dim: var(--text-muted);
```

#### Accent colours

```css
--accent-green: #...;        /* Primary accent — buttons, active states, send */
--accent-interactive: #...;  /* Focus rings, interactive highlights */
--accent-error: #...;        /* Error states */
--accent-warning: #...;      /* Warning states */
--accent-info: #...;         /* Info states */
--accent-neutral: #...;      /* Neutral badges */
```

#### Accent backgrounds (for hover/active states)

These are semi-transparent versions of your accent colour used for button hovers, active tab backgrounds, etc:

```css
--accent-bg-subtle: rgba(R, G, B, 0.06);
--accent-bg-light: rgba(R, G, B, 0.08);
--accent-bg-medium: rgba(R, G, B, 0.12);
--accent-bg-strong: rgba(R, G, B, 0.25);
--accent-border-subtle: rgba(R, G, B, 0.25);
--accent-border-medium: rgba(R, G, B, 0.45);
--accent-border-strong: rgba(R, G, B, 0.55);
```

Replace `R, G, B` with your accent colour's RGB values.

#### Borders

```css
--border: rgba(255, 255, 255, 0.08);
--border-secondary: rgba(255, 255, 255, 0.12);
--border-hover: rgba(255, 255, 255, 0.16);
--border-active: var(--accent-interactive);
--border-primary: var(--border);
```

For light themes, use `rgba(0, 0, 0, ...)` instead.

#### Other tokens

```css
--bg-hover: #...;
--bg-active: #...;
--shadow: 0 16px 45px rgba(0, 0, 0, 0.55);
--scrollbar-track: ...;
--scrollbar-thumb: ...;
--scrollbar-thumb-hover: ...;
--glass-blur: 0px;      /* Set > 0 only for frosted glass themes */
--glass-saturation: 1;
```

### 3. Add the theme to the picker

In `src/components/settings-drawer/core-sections-appearance.tsx`, add an entry to the `THEMES` array:

```typescript
{
  id: "your-theme",
  label: "Your Theme",
  description: "Short description",
  swatches: ["#bg-page", "#accent-1", "#accent-2", "#text-primary"],
},
```

The `swatches` array defines the four colour dots shown in the theme picker card.

### 4. Add the canvas preset (optional)

If you want a matching canvas background, add a preset in `src/components/CanvasThemePicker.tsx`:

```typescript
{ id: "your-theme", label: "your theme", background: "#...", tileBorder: "#...", accent: "#..." },
```

## Customising the Glass theme

The Glass theme uses a unique approach — a deep dark base (`#0A0A14`) with radial gradient glows and white-alpha surfaces.

### Changing the accent colour

The Glass accent is `#6C7BFF` (periwinkle blue). To change it, update these values in the `[data-theme="glass"]` block:

```css
--accent-green: #YOUR_COLOR;
--accent-interactive: #YOUR_COLOR;
```

And update the accent background tokens with your colour's RGB values:

```css
--accent-bg-subtle: rgba(R, G, B, 0.06);
--accent-bg-light: rgba(R, G, B, 0.08);
/* ... etc */
```

### Changing the gradient glows

The atmospheric background is defined in the `[data-theme="glass"] .app-shell` rule:

```css
[data-theme="glass"] .app-shell {
  background:
    radial-gradient(700px at 15% 20%, rgba(108, 123, 255, 0.13), transparent),
    radial-gradient(450px at 5% 80%, rgba(168, 85, 247, 0.08), transparent),
    radial-gradient(600px at 75% 70%, rgba(124, 58, 237, 0.10), transparent),
    radial-gradient(500px at 85% 15%, rgba(14, 165, 233, 0.09), transparent),
    #0A0A14;
}
```

Each `radial-gradient` is a coloured glow blob. Adjust:
- **Colour** — the `rgba()` values control the hue
- **Opacity** — the alpha channel (0.08–0.13) controls intensity
- **Size** — the first value (e.g. `700px`) controls the blob radius
- **Position** — the `at X% Y%` controls where the glow sits

### How Glass surfaces work

Glass surfaces use white-alpha backgrounds (`rgba(255, 255, 255, 0.03–0.07)`) layered on the gradient base. The entire `.workspace` gets `backdrop-filter: blur(40px)` which frosts the gradient underneath.

Key surface tokens:
- `--bg-sidebar: rgba(255, 255, 255, 0.04)` — very subtle
- `--bg-surface: rgba(255, 255, 255, 0.025)` — nearly invisible
- `--bg-input: rgba(255, 255, 255, 0.035)` — inputs and buttons
- `--bg-raised: rgba(255, 255, 255, 0.07)` — elevated elements

Increase the alpha values for more visible surface separation. Decrease them for a flatter look.

### Making chat content transparent

The Glass theme overrides many component backgrounds to `transparent !important` so the gradient shows through the chat feed. These overrides are in `themes.css` under the `/* Glass: remove opaque backgrounds */` section. If you add new UI components, you may need to add them to this list.

## UI font

The UI font can be changed independently of the theme in Settings > Appearance. Available options:

- **Inter** (default)
- **System** (native OS font)
- **DM Sans**
- **IBM Plex Sans**

The font is applied by updating the `--font-sans` CSS variable. Code blocks and terminal output always use the code font (`--font-mono`), which is configurable separately in Settings > Preferences.
