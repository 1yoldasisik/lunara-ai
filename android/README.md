# Lunara Android (Capacitor) — isolated development

This branch contains the Android-wrapper groundwork. It does not change the live deployment.

## Architecture
- Capacitor Android shell; existing Lunara backend and website remain hosted.
- Android WebView loads the HTTPS Lunara web app; authenticated API requests remain same-origin.
- APK packaging, app permissions, icon, camera/file-picker behavior and signing are tested separately before release.

## Safety and release
- Do not merge this branch or deploy it to the production web app as part of Android testing.
- The first prototype is a remote-web wrapper and therefore requires internet access.
- Use a dedicated preview URL when one is available. Do not sign or distribute an APK pointing at a preview/test backend.
- Before store distribution, review Google Play policy, privacy disclosures, app navigation, camera/photo permissions, secure session behavior and signing key custody.

## Planned steps
1. Confirm preview web URL and package identifier.
2. Configure Capacitor and generate Android project.
3. Install/build on Android device/emulator.
4. Validate login, account, credit balance, analysis flows, coffee image upload/camera, history and navigation.
5. Fix issues in this branch and create a preview build.
6. Only after explicit approval, prepare production release artifacts.
