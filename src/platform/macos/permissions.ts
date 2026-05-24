import { systemPreferences } from "electron";
import type { PermissionStatus } from "../index";

export async function checkPermissions(): Promise<PermissionStatus> {
  const mic    = systemPreferences.getMediaAccessStatus("microphone");
  const screen = systemPreferences.getMediaAccessStatus("screen");
  return {
    microphone: mic === "granted",
    // Eingabeüberwachung: kein direktes Electron-API — uiohook-napi schlägt
    // lautlos fehl, wenn die Berechtigung fehlt (kein Absturz).
    inputMonitoring: true,
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screenRecording: screen === "granted",
  };
}

export async function requestMicrophonePermission(): Promise<boolean> {
  return systemPreferences.askForMediaAccess("microphone");
}
