// Ad-hoc-Signierung nach dem Packen.
//
// Hintergrund: macOS auf Apple Silicon weigert sich, unsignierte arm64-Binaries
// auszuführen ("killed: 9"). Ein Ad-hoc-Signatur (Identität "-") erfüllt die
// Mindestanforderung — Apple Developer-Account ist nicht nötig. Damit läuft
// die App lokal; für Verteilung an Dritte ist eine echte Signatur + Notarisierung
// weiterhin Pflicht.

const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`afterPack: Ad-hoc-Signierung ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
};
