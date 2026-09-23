# Themes

anyBot ships four themes: **Studio paper** (the default), **Matrix**, **Solarpunk**, and **Cyberpunk**. Pick one under **Settings → Appearance**. The choice is saved on this computer. A switch there turns off animated backgrounds and effects, and they are always off when Windows asks for reduced motion.

## How a theme works

A theme is data (`src/themes/themes.js`), not CSS:

| Field | What it is |
|---|---|
| `id`, `name`, `description` | Identity and the text on its Settings card. |
| `scheme` | `light` or `dark`. Native controls and scrollbars follow it. |
| `font` | A CSS font stack. It should list fonts installed on Windows; nothing is downloaded. |
| `tokens` | Every design token as an `oklch()` color, using the same names as `:root` in `src/style.css`: paper, ink, rules, accent, status, code blocks, and the knowledge-graph categories. Optional `glass` and `glass-2` are translucent surfaces that let a backdrop show through. Optional `neon-1` to `neon-3` are glow colors. |
| `decor` | Named presets. `backdrop`: `none`, `rain`, `meadow`, `grid`. `chrome`: `none`, `terminal`, `glass`, `neon`. `bubbles`: `none`, `terminal`, `leaf`, `hologram`. |

Applying a theme (`src/lib/theme.js`) sets the tokens as custom properties on `<html>`. It also sets the decoration presets as `data-backdrop`, `data-chrome`, and `data-bubbles`, which `src/themes/themes.css` styles. `ThemeBackdrop` renders the backdrop layer behind the app. Because every color in the app is a token, a theme reaches every screen without per-component work.

### Readability checks

`validateTheme()` rejects a theme when:

- a token is missing, isn't an opaque `oklch()` color, or isn't a known token
- a decoration isn't one of the presets
- any text pairing falls below its contrast floor (`CONTRAST_RULES`):
  - primary text: 7:1 on paper and on cards
  - secondary text: 4.5:1
  - muted text, status colors, and text on accent-colored buttons: 3:1
  - code: 7:1

The knowledge-graph category colors are checked separately, as a set, for color-vision deficiency on each theme's surface. `tests/themes.test.mjs` runs all of these checks against the built-in themes.

## Custom themes (designed, not built yet)

The plan is to let owners add their own themes without opening a hole in the app's security model.

1. **The format is the same data as the built-ins.** A theme file is JSON: `{ "id", "name", "description", "scheme", "font", "tokens", "decor" }`. It can't contain CSS, scripts, URLs, images, or web fonts. Decorations come only from the named presets, so a theme can restyle the app but never run code or load anything remote.
2. **Import:** Settings → Appearance → **Import theme** reads a `.anybot-theme.json` file.
   - anyBot runs `validateTheme()` and shows each problem in plain language, for example "Secondary text is 3.1:1 on paper; needs 4.5:1".
   - A theme that fails can't be applied.
   - A theme that passes is saved to `<userData>/themes/` and appears as a card next to the built-ins.
3. **Create from an existing theme:** "Duplicate and edit" opens an editor with a live preview.
   - It has color pickers for paper, ink, and accent.
   - Derived tokens (paper-2 and -3, ink-2 to -4, rules, soft and wash variants) are computed from those three, and can each be overridden.
   - A contrast meter shows each rule passing or failing as you pick.
   - A backdrop, chrome, and bubble preset are chosen from dropdowns.
4. **Share:** "Export" writes the same JSON file, so a theme can be sent to someone else and imported there.
5. **Later presets:** new backdrops (for example starfield or ocean) and chat styles ship as named presets in app updates. Custom themes pick them up by name.

Open questions for when this is built:

- Should themes sync to the mobile companion?
- Should a project be able to pin its own theme?
- Should imported themes be allowed to raise contrast floors (never lower them) for accessibility needs?
