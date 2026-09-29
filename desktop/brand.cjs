const path = require('node:path');
const fs = require('node:fs');
const DISPLAY_NAME = 'Any Bot';
const APP_ID = 'dev.anybot.desktop';
const BRAND_DIR = path.join(__dirname, '../assets/brand');

function applyBrand(app) {
  // A display-name change must never create an empty profile beside the old one.
  const previous = app.getPath('userData');
  const session = app.getPath('sessionData');
  const renamedDefault = path.join(app.getPath('appData'), DISPLAY_NAME);
  // Running from source (npm start) gets its own profile, so a checkout never
  // migrates, runs, or re-registers the installed app's live data.
  // ANYBOT_USER_DATA picks another folder (the live one, deliberately).
  // Scripts that set their own profile before loading this keep it.
  const devDefault = path.join(app.getPath('appData'), 'anybot-desktop');
  const profile = app.isPackaged && path.resolve(previous) === path.resolve(renamedDefault)
    ? path.join(app.getPath('appData'), 'anyBot')
    : !app.isPackaged && path.resolve(previous) === path.resolve(devDefault)
      ? process.env.ANYBOT_USER_DATA || path.join(app.getPath('appData'), 'anybot-desktop-dev')
      : previous;
  app.setName(DISPLAY_NAME);
  app.setPath('userData', profile);
  app.setPath('sessionData', session === previous ? profile : session);
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
}

function trayIcon(nativeImage) {
  const icon = nativeImage.createFromPath(path.join(BRAND_DIR, 'scout-16.png'));
  icon.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(BRAND_DIR, 'scout-32.png')) });
  return icon;
}

module.exports = { DISPLAY_NAME, APP_ID, BRAND_DIR, applyBrand, trayIcon };
