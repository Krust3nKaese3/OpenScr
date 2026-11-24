const { withInfoPlist } = require('@expo/config-plugins');

// Runs after expo-camera because this file is listed earlier in app.json plugins.
// iOS only. Android keeps the cameraPermission string from the expo-camera plugin.
const IOS_CAMERA =
  'OpenScr uses the camera to scan a QR code when you install an OpenScrapp from a repository you own, and when an OpenScrapp you wrote asks to take a photo or scan a QR code. Photos are not saved to your photo library. The microphone is not used.';

module.exports = function withIosCameraPurpose(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.NSCameraUsageDescription = IOS_CAMERA;
    return config;
  });
};
