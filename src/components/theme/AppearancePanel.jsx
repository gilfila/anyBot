import React from "react";
import { Check, Palette } from "lucide-react";
import { THEMES } from "../../themes/themes.js";
import { setMotion, setTheme, useThemeState } from "../../lib/theme.js";

// Settings → Appearance. Each card previews its theme in that theme's own
// tokens, so every option is visible no matter which one is active.
export function AppearancePanel() {
  const { theme: active, motion } = useThemeState();
  return (
    <section className="appearance" aria-labelledby="appearance-title">
      <h2 id="appearance-title" className="settings-section-title">
        Appearance
      </h2>
      <p>Pick a look for the whole app. Themes change colors, type, backgrounds, and chat boxes; your work stays exactly where it is.</p>
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {THEMES.map((theme) => {
          const selected = theme.id === active.id;
          const vars = { "--font-ui": theme.font };
          for (const [key, value] of Object.entries(theme.tokens)) vars[`--${key}`] = value;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              key={theme.id}
              className={`theme-card${selected ? " is-selected" : ""}`}
              onClick={() => setTheme(theme.id)}
            >
              <span className="theme-preview" data-backdrop={theme.decor.backdrop} style={vars} aria-hidden="true">
                <span className="theme-preview-side">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="theme-preview-main">
                  <span className="theme-preview-bot">Draft is ready</span>
                  <span className="theme-preview-you">Ship it</span>
                  <span className="theme-preview-composer">
                    <i />
                  </span>
                </span>
              </span>
              <span className="theme-card-text">
                <strong>
                  {theme.name}
                  {selected && (
                    <span className="theme-card-check">
                      <Check size={13} />
                    </span>
                  )}
                </strong>
                <small>{theme.description}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="appearance-options">
        <div>
          <strong>Animated backgrounds and effects</strong>
          <small>Falling code, drifting clouds, neon borders, and hologram fades. Turned off automatically when Windows asks for less motion.</small>
        </div>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={motion !== "off"}
          aria-label="Animated backgrounds and effects"
          onClick={() => setMotion(motion === "off" ? "on" : "off")}
        />
      </div>
      <div className="appearance-custom">
        <Palette size={18} />
        <div>
          <strong>Your own themes are coming.</strong> You'll be able to import a theme file with your own colors and font, and
          pick a background and chat style from the ones above. Any Bot checks every theme for readable contrast before
          applying it, and themes can't run code.
        </div>
      </div>
    </section>
  );
}
