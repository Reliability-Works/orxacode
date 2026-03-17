import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const appName = "Orxa Code";
const sourceIconPath = path.join(repoRoot, "build", "icon.icns");
const electronAppPath = path.join(repoRoot, "node_modules", "electron", "dist", "Electron.app");
const targetIconPath = path.join(electronAppPath, "Contents", "Resources", "electron.icns");
const plistPath = path.join(electronAppPath, "Contents", "Info.plist");

function runPlistBuddy(command) {
  execFileSync("/usr/libexec/PlistBuddy", ["-c", command, plistPath], {
    stdio: "ignore",
  });
}

function syncMacDevIcon() {
  if (process.platform !== "darwin") {
    console.log("sync-macos-dev-icon: skipped (non-macOS platform)");
    return;
  }

  if (!existsSync(sourceIconPath)) {
    throw new Error(`Missing source icon: ${sourceIconPath}`);
  }
  if (!existsSync(targetIconPath)) {
    throw new Error(`Missing Electron dev icon target: ${targetIconPath}`);
  }
  if (!existsSync(plistPath)) {
    throw new Error(`Missing Electron Info.plist: ${plistPath}`);
  }

  copyFileSync(sourceIconPath, targetIconPath);

  // Make App Switcher label match dev identity.
  runPlistBuddy(`Set :CFBundleDisplayName ${appName}`);
  runPlistBuddy(`Set :CFBundleName ${appName}`);

  console.log("sync-macos-dev-icon: updated Electron dev bundle icon and name");
}

try {
  syncMacDevIcon();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sync-macos-dev-icon: failed - ${message}`);
  process.exit(1);
}
