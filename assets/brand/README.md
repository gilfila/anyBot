# Any Bot — Sage Scout

Approved identity: sculptural Scout helmet, deeper sage material `#8FAA88`, coral accent `#F46B4E`, charcoal faceplate, warm ivory eyes. Product name is **Any Bot**, with a space and title case.

`scout-master.png` is the transparent source artwork derived from the user-approved concept through the built-in image-generation tool. All desktop, tray, browser, and mobile sizes come from this one master; do not introduce separate robot marks. Run `npm run brand:export` on Windows to regenerate PNG/ICO/mobile exports. The export script only resizes and applies platform-required safe areas/backgrounds; it does not recolor or redraw the approved character.

Windows ICO contains 16/24/32/48/64/128/256 px frames. Tray uses 16/32 px. App header uses the 128 px export at 38 CSS px. Android adaptive foregrounds respect the central safe area; iOS and PWA maskable variants have opaque paper backgrounds.

The legacy `anyBot.exe`, installer artifact prefix, `dev.anybot.desktop` app ID, and installed user-data path are deliberately preserved. Display labels, shortcut name, file metadata, and product icons use the new brand. Keep executable resource editing enabled; `signExecutable: false` disables signing without dropping the embedded icon.

Master generation: preserve the approved helmet silhouette, same slight three-quarter perspective, sage material, coral earpiece, recessed charcoal face and two ivory eyes; isolate one helmet on true transparency, without typography, a tile, or external cast shadow.
