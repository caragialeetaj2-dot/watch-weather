/**
 * Applies the native Android settings this app needs. Idempotent: safe to run many times.
 * Runs automatically after `npx cap sync android` (package.json hook "capacitor:sync:after"),
 * or manually with `npm run android:configure`.
 *
 *  - Landscape only (sensorLandscape) on MainActivity
 *  - INTERNET + ACCESS_NETWORK_STATE permissions
 *  - Keep screen on + immersive full screen (MainActivity.java)
 *  - Optional HOME launcher intent filter (kiosk / auto-start after reboot),
 *    controlled by package.json -> "watchWeather": { "kioskLauncher": true|false }
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.CAPACITOR_ROOT_DIR || process.cwd();
const platform = process.env.CAPACITOR_PLATFORM_NAME;
if (platform && platform !== 'android') process.exit(0);

const androidDir = path.join(root, 'android');
const mainDir = path.join(androidDir, 'app', 'src', 'main');
const manifestPath = path.join(mainDir, 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.log('[configure-android] android/ not found yet - run "npx cap add android" first. Skipping.');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const kioskLauncher = pkg.watchWeather?.kioskLauncher === true;

/* ---------- AndroidManifest.xml ---------- */
let manifest = fs.readFileSync(manifestPath, 'utf8');
const original = manifest;

const activityRe = /<activity\b[^>]*android:name="(?:[\w.]*)?\.?MainActivity"[\s\S]*?<\/activity>/;
const match = manifest.match(activityRe);
if (!match) {
  console.error('[configure-android] MainActivity not found in AndroidManifest.xml');
  process.exit(1);
}
let activity = match[0];

// Landscape only
if (/android:screenOrientation="[^"]*"/.test(activity)) {
  activity = activity.replace(/android:screenOrientation="[^"]*"/, 'android:screenOrientation="sensorLandscape"');
} else {
  activity = activity.replace('<activity', '<activity\n            android:screenOrientation="sensorLandscape"');
}

// Optional HOME launcher filter (lets the app be the device's home screen => starts after reboot)
const homeMarker = '<!-- watch-weather:home-launcher -->';
const homeFilter = `${homeMarker}
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.HOME" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>`;
const homeRe = new RegExp(`\\s*${homeMarker}\\s*<intent-filter>[\\s\\S]*?<\\/intent-filter>`);
activity = activity.replace(homeRe, '');
if (kioskLauncher) {
  activity = activity.replace(/\s*<\/activity>$/, `\n\n            ${homeFilter}\n\n        </activity>`);
}
manifest = manifest.replace(activityRe, activity);

// Permissions
for (const perm of ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE']) {
  if (!manifest.includes(`android:name="${perm}"`)) {
    manifest = manifest.replace(/<\/manifest>\s*$/, `    <uses-permission android:name="${perm}" />\n</manifest>\n`);
  }
}

if (manifest !== original) {
  fs.writeFileSync(manifestPath, manifest);
  console.log(`[configure-android] AndroidManifest.xml updated (landscape, permissions, kioskLauncher=${kioskLauncher}).`);
} else {
  console.log('[configure-android] AndroidManifest.xml already configured.');
}

/* ---------- MainActivity.java ---------- */
function findFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    } else if (entry.name === name) {
      return p;
    }
  }
  return null;
}

const activityPath = findFile(path.join(mainDir, 'java'), 'MainActivity.java');
if (!activityPath) {
  console.warn('[configure-android] MainActivity.java not found - skipping keep-screen-on / immersive setup.');
  process.exit(0);
}
const src = fs.readFileSync(activityPath, 'utf8');
const marker = '// watch-weather:configured';
if (src.includes(marker)) {
  console.log('[configure-android] MainActivity.java already configured.');
  process.exit(0);
}
const pkgName = (src.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1];
if (!pkgName) {
  console.error('[configure-android] Could not read package name from MainActivity.java');
  process.exit(1);
}

const activitySource = `package ${pkgName};

${marker}
import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Weather station: never let the screen sleep while the app is in front.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    private void enterImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
`;
fs.writeFileSync(activityPath, activitySource);
console.log('[configure-android] MainActivity.java updated (keep screen on, immersive full screen).');
