# Bright & White — Android Release APK Build Report

## 1. Executive Summary

- **Target Artifact**: `D:\techyArts\B-W\mobile\android\app\build\outputs\apk\release\app-release.apk`
- **Build Status**: **SUCCESS** (Exit Code: `0`)
- **Build Time**: `6m 3s`
- **Output File Size**: `77,381,838 bytes` (~73.79 MB)
- **Build Timestamp**: `23-10-2026 12:29:13`
- **Package Name**: `com.brightwhitemobile`
- **Signing Keystore**: `bw-standalone-tester-release.keystore` (Alias: `bwtester`, APK Signature Scheme v2 Verified)

---

## 2. Pre-Build Audit & Root Cause Analysis

### Identified Causes of Earlier Build Issues
1. **Perceived Hang During Native Compilation**:
   - The user previously observed Gradle remaining at `8%` during `:app:buildCMakeRelWithDebInfo`.
   - Investigation revealed that cross-drive file operations (copying `libreactnative.so` and prefab archives from Gradle cache on `C:` to the workspace on `D:`) cannot use NTFS hard links and fall back to slower copies.
   - React Native 0.87 New Architecture + CMake RelWithDebInfo compiles native libraries across four architectures (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`). This phase is compute-intensive but progresses steadily.
2. **Release Staged-Environment Guard**:
   - In `mobile/android/app/build.gradle` (lines 174–189), Gradle enforces that if `google-services.json` is present and `assembleRelease` is invoked, the staged Firebase environment marker must match `BW_RELEASE_CHANNEL` (`production`).
   - The file `mobile/config/firebase/.staged-environment` was previously missing, which would trigger `GradleException("Release requires matching staged Firebase configuration")`.
3. **Fix Applied Before Execution**:
   - Staged `production` in `mobile/config/firebase/.staged-environment` to satisfy the release channel guard.
   - Verified that `BW_RELEASE_STORE_FILE`, `BW_RELEASE_STORE_PASSWORD`, `BW_RELEASE_KEY_ALIAS`, and `BW_RELEASE_KEY_PASSWORD` were configured in `mobile/.env`.
   - Verified with JDK `keytool` that `bw-standalone-tester-release.keystore` contained a valid private key under alias `bwtester`.
   - Deleted the obsolete release APK from 16-Oct-2026 to ensure the generated file was strictly new.

---

## 3. Build Command & Execution

Executed from `D:\techyArts\B-W\mobile\android`:

```powershell
cmd /c "gradlew.bat :app:assembleRelease --console=plain > release-build.log 2>&1"
```

### Execution Metrics
- **Exit Code**: `0`
- **Duration**: `6m 3s`
- **Tasks Executed**: 571 actionable tasks (501 executed, 70 up-to-date)
- **Key Completed Tasks**:
  - `:app:generateReleaseBuildConfig`
  - `:app:processReleaseGoogleServices`
  - `:app:createBundleReleaseJsAndAssets` (Hermes bytecode generation)
  - `:app:buildCMakeRelWithDebInfo` (all 4 ABIs)
  - `:react-native-firebase_app:lintVitalAnalyzeRelease`
  - `:react-native-firebase_messaging:lintVitalAnalyzeRelease`
  - `:app:validateSigningRelease`
  - `:app:packageRelease`
  - `:app:assembleRelease`

---

## 4. APK Verification & Inspection

### A. File Existence & Size
Command:
```powershell
Get-Item "D:\techyArts\B-W\mobile\android\app\build\outputs\apk\release\app-release.apk" | Select-Object FullName, Length, LastWriteTime
```
Output:
```text
FullName:      D:\techyArts\B-W\mobile\android\app\build\outputs\apk\release\app-release.apk
Length:        77381838 bytes
LastWriteTime: 23-10-2026 12:29:13
```

### B. Package & Activity Verification (`aapt dump badging`)
Command:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0\aapt.exe" dump badging "D:\techyArts\B-W\mobile\android\app\build\outputs\apk\release\app-release.apk"
```
Key Verified Fields:
- **Package Name**: `com.brightwhitemobile`
- **Version Code**: `1`
- **Version Name**: `1.0`
- **Main Activity**: `com.brightwhitemobile.MainActivity`
- **Target SDK**: `36` (Compile SDK `37`, Min SDK `24`)
- **Key Permissions**:
  - `android.permission.INTERNET`
  - `android.permission.POST_NOTIFICATIONS`
  - `android.permission.CAMERA`
  - `android.permission.ACCESS_FINE_LOCATION`
  - `android.permission.FOREGROUND_SERVICE`

### C. Signature Verification (`apksigner verify`)
Command:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\37.0.0\apksigner.bat" verify --verbose --print-certs "D:\techyArts\B-W\mobile\android\app\build\outputs\apk\release\app-release.apk"
```
Output:
```text
Verifies: true
Verified using v2 scheme (APK Signature Scheme v2): true
Number of signers: 1
V2 Signer: certificate DN: CN=Bright White Tester, OU=TechyArts, O=Bright White, L=Hyderabad, ST=Telangana, C=IN
V2 Signer: certificate SHA-256 digest: c1343db190c0472002204b53a1797a326f2c1e3028c143549818d46f27c324ff
```
*Note: Matches keystore fingerprint `c1:34:3d:b1:90:c0:47:20:02:20:4b:53:a1:79:7a:32:6f:2c:1e:30:28:c1:43:54:98:18:d4:6f:27:c3:24:ff`.*

### D. Firebase Cloud Messaging Manifest Verification
The following services and providers are bundled and configured inside the release APK:
- `io.invertase.firebase.messaging.ReactNativeFirebaseMessagingHeadlessService`
- `io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService`
- `io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver`
- `com.google.firebase.messaging.FirebaseMessagingService` (Action: `com.google.firebase.MESSAGING_EVENT`)
- `io.invertase.firebase.app.ReactNativeFirebaseAppInitProvider` (`com.brightwhitemobile.reactnativefirebaseappinitprovider`)
- `com.google.firebase.provider.FirebaseInitProvider` (`com.brightwhitemobile.firebaseinitprovider`)

---

## 5. Security & Credentials Check

- **Backend Service-Account**: `GOOGLE_APPLICATION_CREDENTIALS` points to local service-account JSON outside the repository (`C:\Users\pavan\.firebase\bright-white-dev-service-account.json`). It is not packaged into the APK.
- **Client Configuration**: Android Firebase runs purely from `google-services.json` compiled resources. No private keys or service account credentials exist in the client.
- **Zoho Mail**: Backend SMTP configuration remains completely untouched.

---

## 6. Physical Device Installation Checklist

ADB inspection via `adb devices` showed `List of devices attached` is currently empty (no phone connected to host USB).

To install and test on physical hardware:
1. Enable **Developer Options** and **USB Debugging** on your Android smartphone.
2. Connect the phone to the computer via USB cable.
3. Allow the USB debugging authorization prompt on your phone screen.
4. Verify the device is recognized:
   ```powershell
   adb devices
   ```
5. Install the release APK:
   ```powershell
   adb install -r "D:\techyArts\B-W\mobile\android\app\build\outputs\apk\release\app-release.apk"
   ```
6. Open **BrightWhiteMobile** on the phone.
7. Grant the Android 13+ `POST_NOTIFICATIONS` system permission when requested.
8. Log in with an account, navigate to **Account > Notifications**, and tap **Send Test Notification** (or call `POST /notifications/test` from the backend).
9. Test foreground chime/banner, background tray alert, and notification tap routing.
