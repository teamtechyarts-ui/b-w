# Bright & White Laundry — Google Play Console Compliance Checklist

**Application ID:** `com.brightwhitemobile`  
**Version:** `1.0.0` (VersionCode: `1`)  
**Target SDK:** `36` (Android 16 Ready)  
**Min SDK:** `24` (Android 7.0+)  
**Policy Baseline:** Google Play Developer Program Policies (2025/2026 Edition)  

---

## 1. Technical & Architecture Compliance (Code-Level)

| Policy Requirement | Requirement Detail | Implementation Status | Evidence / Location |
|:---|:---|:---:|:---|
| **Target API Level** | Must target Android 14 (API 34) or higher | **PASS (API 36)** | `mobile/android/app/build.gradle`: `targetSdkVersion = 36` |
| **64-bit Architecture** | All native libraries must include 64-bit architectures | **PASS** | `ndk.abiFilters 'armeabi-v7a', 'arm64-v8a', 'x86_64'` |
| **App Bundle Format** | New apps must publish using Android App Bundle (`.aab`) | **PASS** | `mobile/android/app/build/outputs/bundle/release/app-release.aab` |
| **Network Security** | Must disable cleartext HTTP traffic across all environments | **PASS** | `AndroidManifest.xml`: `android:usesCleartextTraffic="false"` |
| **Payment Policy (Section 3.1)** | Physical laundry services exempt from Google Play Billing | **PASS** | Uses Razorpay for physical goods/services delivery |
| **Account Deletion (In-App)** | Must provide prominent in-app account deletion flow | **PASS** | `ProfileScreen.tsx` $\rightarrow$ "Delete Account" button $\rightarrow$ `DELETE /customers/account` |
| **Account Deletion (External)** | Must provide public web link for deletion requests | **PASS** | Configured web endpoint on official domain |
| **Crash-Free Stability** | Zero fatal crashes on launch or core workflows | **PASS** | `BrandLogo.tsx` white screen fixed; 436 tests passing |

---

## 2. Runtime Permissions & Policy Justifications

| Permission | Android Name | User Facing Justification | Prompt Location |
|:---|:---|:---|:---|
| **Precise Location** | `ACCESS_FINE_LOCATION` | Required to accurately pinpoint pickup & delivery addresses on the map, and for drivers to navigate routes. | `LocationPickerScreen`, `DriverDashboardScreen` |
| **Approximate Location** | `ACCESS_COARSE_LOCATION` | Provides general area localization when GPS satellite lock is unavailable. | Fallback on address selector |
| **Push Notifications** | `POST_NOTIFICATIONS` | Alerts customers when laundry status changes (Picked up, Washing, Out for Delivery) and delivers pickup OTPs. | On first login / session initialization |
| **Camera Access** | `CAMERA` | Enables scanning QR codes on laundry bags at facility intake, and allows drivers to capture Proof of Delivery. | `FacilityVerificationScreen`, Driver POD screen |
| **Photo Library** | `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` | Allows customers to upload photos of garments when submitting stain notices or damage claims. | `ClaimsRefundsScreen.tsx` |

> [!NOTE]
> All runtime permissions are requested dynamically in context with clear rationales. The application gracefully degrades if the user chooses not to grant optional permissions.

---

## 3. Google Play Console Manual Actions (Play Console UI)

These actions require administrative access to the Google Play Console:

### 3.1 Store Listing & Categorization
- **App Category:** Shopping / Lifestyle / On-Demand Services.
- **Short Description (Max 80 chars):** Premium door-to-door laundry, dry cleaning, and garment care services.
- **Full Description:** Comprehensive overview of washing, steam pressing, sanitization, live tracking, and scheduled pickups.
- **Graphic Assets:**
  - App Icon: 512 x 512 px PNG (32-bit color, no transparency).
  - Feature Graphic: 1024 x 500 px JPG or PNG.
  - Phone Screenshots: Minimum 4 screenshots (1080 x 2400 px or 9:16 aspect ratio).

### 3.2 Privacy Policy URL
- Set to public HTTPS URL: `https://brightandwhite.com/privacy-policy` (must be accessible worldwide without authentication).

### 3.3 Data Safety Section
- Complete the questionnaire using the companion document: [DATA_SAFETY_DRAFT.md](file:///d:/techyArts/B-W/DATA_SAFETY_DRAFT.md).

### 3.4 Reviewer Access Credentials
Provide the following test credentials in **App Access $\rightarrow$ Restricted Access**:

```
Role: Customer
Email: qa.customer@brightandwhite.test
Password: TestPassword!2026
Notes: Account has preloaded addresses and order history.

Role: Driver
Email: qa.driver@brightandwhite.test
Password: DriverPassword!2026
Notes: Accesses driver dashboard and assigned job queue.

Role: Facility Staff
Email: qa.facility@brightandwhite.test
Password: FacilityPassword!2026
Notes: Accesses intake QR scanner and processing queue.
```

### 3.5 App Content Declarations
- **Target Age:** 18 and older.
- **Ads:** Select "No, my app does not contain ads".
- **Financial Features:** Select "No personal loan or financial investment services".
- **Government Services:** Select "No government agency affiliation".
