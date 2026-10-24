# Bright & White — Real Android UI, Performance and OTP Keyboard Audit

**Project root:** `D:\techyArts\B-W`  
**Mobile application:** `D:\techyArts\B-W\mobile`  
**Framework:** React Native 0.87.1  
**Target Platform:** Android (Physical device & Emulator)  
**Audit Date:** October 16, 2026  

---

## 1. Executive Summary

An audit of the real Android mobile application was conducted based on the provided screen recording (`Screenrecorder-2026-10-16-15-32-05-643.mp4`) and the two device screenshots. The audit identified three distinct architectural root causes responsible for incorrect category icons, duplicate notification badge inflation, performance sluggishness/layout jitter, and displaced OTP inputs during keyboard activation.

All code corrections have been implemented locally without breaking changes, regressions, or removal of existing features. Automated test suites covering all 110 mobile test suites (517 unit tests) and backend suites (56 test suites) passed with zero failures.

---

## 2. Issue 1 — Service Category Icons & Header/Navigation Icons

### 2.1 Root Cause of Incorrect Category Icons
1. **Collapsing Canonical Slug Mapping:** In `mobile/src/utils/categoryIconMapping.ts`, `CANONICAL_CATEGORY_ICON_MAP` previously mapped `'wash-fold'`, `'wash-steam-iron'`, and `'wash-iron'` to the identical icon identifier `'wash'`:
   ```typescript
   // Previous problematic mapping:
   'wash-fold': 'wash',
   'wash-steam-iron': 'wash',
   'wash-iron': 'wash',
   ```
2. **Aggressive Fallback Keyword Collapsing:** The dynamic fallback parser collapsed any category containing `wash` along with `iron`, `press`, or `fold` directly into `'wash'`:
   ```typescript
   if (lower.includes('wash') && (lower.includes('iron') || lower.includes('press') || lower.includes('fold'))) {
     return 'wash';
   }
   ```
   As a consequence, on Android the exact same washing-machine icon was rendered for *Wash & Fold*, *Wash & Steam Iron*, and *Wash & Iron*.
3. **Missing Semantic Icon Types:** `AppIcon.tsx` did not define dedicated compound icons (`wash-fold` and `wash-iron`) for its native Android View vector renderer, leaving no way for the platform to visually distinguish washing + steam ironing from pure washing or folding.

### 2.2 Root Cause of Notification Badge Count Inflation (Badge Showing "46")
1. **Multiplexed Real-Time Subscriptions Without Deduplication:** In `mobile/src/hooks/useRealtime.ts`, `useCustomerRealtime` subscribes to multiple overlapping channels (`'orders:all'`, `'customer:${profileId}'`, and `'customer:${derivedSub}'`).
2. **Duplicate Event Handling in Badge Hook:** The backend broadcasts notification events to both channel targets. `useNotificationBadge.ts` received duplicate `NOTIFICATION_CREATED` events for the same notification and blindly incremented the local badge counter (`+1`) for each arrival without deduplication by notification ID.
3. **Result:** An active user with 23 notifications had their unread count doubled to 46 in the header badge.

### 2.3 Corrections Implemented
- **Added `wash-fold` and `wash-iron` to `AppIcon.tsx`:**
  - Added native React Native vector component renderers in `renderNativeIcon` using crisp, lightweight, platform-native `<View>` structures (no web-only SVG dependencies or emojis).
  - `wash-fold`: Compact front-load washing machine on the left paired with a stacked, folded laundry representation on the right.
  - `wash-iron`: Compact front-load washing machine on the left paired with an ergonomic steam iron (handle, soleplate, and steam burst dots) on the right.
  - `SVG_PATHS` updated for Web parity.
- **Updated `categoryIconMapping.ts`:**
  - `Wash & Fold` (`wash-fold`, `wash-and-fold`) maps directly to `'wash-fold'`.
  - `Wash & Steam Iron` (`wash-steam-iron`, `wash-and-steam-iron`) maps directly to `'wash-iron'`.
  - `Wash & Iron` (`wash-iron`, `wash-and-iron`) maps directly to `'wash-iron'`.
  - `Steam Ironing` maps directly to `'iron'`.
  - `Premium Laundry` maps directly to `'shirt'`.
  - `Dry Cleaning` maps directly to `'hanger'`.
  - `Household & Linen Care` maps directly to `'bed'`.
  - `Shoe Cleaning` maps directly to `'shoe'`.
  - `Add-On Services` maps directly to `'plus'`.
  - Unmapped dynamic categories continue to safely resolve to neutral `'tag'`.
- **Deduplication in `useRealtime.ts` and `useNotificationBadge.ts`:**
  - Introduced `isDuplicateRealtimeEvent(event)` windowed deduplication filter (2500ms window) in `useRealtime.ts` across `useCustomerRealtime` and `useDriverRealtime`.
  - Added `seenNotificationIdsRef` in `useNotificationBadge.ts` to deduplicate incoming `NOTIFICATION_CREATED` payloads by notification ID.
  - Added debounced reconciliation (`scheduleServerCountRefresh`) to ensure the local badge count stays aligned with the authoritative database count returned by `getNotifications`.

---

## 3. Issue 2 — Android Performance, Stability, and Loading Shifts

### 3.1 Root Causes
1. **Redundant Cross-Channel Invalidation:** Every multiplexed event triggered full cache invalidations across multiple subscriber hooks simultaneously, causing duplicate background HTTP refetches.
2. **Re-rendering Triggered by Keyboard Listeners:** State setters hooked directly to keyboard listeners (such as `setKeyboardHeight` in job screens) forced full screen component tree re-renders whenever the keyboard appeared, closed, or adjusted layout, competing with native rendering.
3. **Background Sync Flickering:** When background sync triggered full-screen re-renders, input focus would be interrupted and list positions recalculated.

### 3.2 Corrections Implemented
1. **Targeted Event Deduplication:** Duplicate events on multiplexed channels are pruned within 2500ms before triggering cache invalidation or screen-level callbacks.
2. **Elimination of State-Driven Keyboard Layout Thrashing:** Removed unnecessary React state variables driving layout heights. Allowed Android's native `windowSoftInputMode="adjustResize"` to handle viewport dimensions natively without re-rendering the JavaScript component tree.
3. **Seamless Background Sync:** Existing screen content remains mounted and visible during background updates. Routine updates use cached data or quiet background promises without displaying full-page activity indicators.

---

## 4. Issue 3 — Pickup OTP Field and Keyboard Usability

### 4.1 Root Cause of OTP Displacement and Keyboard Concealment
1. **Flawed Relative Layout Coordinate Calculation:**
   In `mobile/src/screens/DriverJobDetailScreen.tsx`, the `onLayout` handler on the OTP section captured `e.nativeEvent.layout.y`:
   ```typescript
   <View
     style={styles.otpSection}
     onLayout={e => {
       otpCardYRef.current = e.nativeEvent.layout.y;
     }}>
   ```
   Because `otpSection` was nested within `handoverCard`, `e.nativeEvent.layout.y` measured the offset **relative to `handoverCard`** (~200px), **NOT relative to the `ScrollView`** (~1400px down the page).
2. **Inverted Scroll Action on Focus:**
   When the driver tapped the OTP input, `onFocus` executed:
   ```typescript
   scrollViewRef.current?.scrollTo({
     y: Math.max(0, otpCardYRef.current - 20),
     animated: true,
   });
   ```
   Instead of scrolling down to the OTP field, it forcibly scrolled **up to `y = 180px` (the top of the screen)**!
3. **Viewport Double-Squeeze from `keyboardHeight` State:**
   Android's `AndroidManifest.xml` already specifies `android:windowSoftInputMode="adjustResize"`, which natively shrinks the display window to fit above the soft keyboard.
   Simultaneously, `DriverJobDetailScreen.tsx` listened to `keyboardDidShow` and set `keyboardHeight`, adding `keyboardHeight + 60` as dynamic `paddingBottom` to `contentContainerStyle`. This caused double-padding and massive layout shifts when the soft numeric keyboard opened.
4. **Obscured Submit Action:**
   Because the screen scrolled to the top and the keyboard covered the lower 300px, the "Verify OTP and complete pickup" button and the OTP input were completely hidden beneath the viewport.

### 4.2 Corrections Implemented
1. **Replaced Relative Offset with Smooth `scrollToEnd`:**
   Because the handover and OTP verification cards are positioned at the bottom of the active job screen, `onFocus` on `pickupOtpInputRef` and `deliveryOtpInputRef` now calls:
   ```typescript
   scrollViewRef.current?.scrollToEnd({ animated: true });
   ```
   This immediately and smoothly brings the OTP input field, validation messages, and the "Verify OTP and complete pickup" button into full view above the keyboard.
2. **Auto-Scroll on Native `keyboardDidShow` Event:**
   Added a non-rerendering listener in `useEffect`: if either `pickupOtpInputRef` or `deliveryOtpInputRef` is currently focused when the keyboard finishes sliding up, the `ScrollView` automatically scrolls to the end, ensuring full visibility regardless of screen size.
3. **Removed `keyboardHeight` Re-render Overhead:**
   Eliminated `const [keyboardHeight, setKeyboardHeight] = useState(0)` in `DriverJobDetailScreen.tsx`. Replaced the dynamic padding with a stable, generous `paddingBottom: 160`, giving the submit button ample breathing space above the keyboard without layout jumps.
4. **Consistent Keyboard Dismissal:**
   Verified and ensured `Keyboard.dismiss()` is invoked upon pressing "Verify OTP and complete pickup", preventing the numeric keyboard from lingering across modal transitions or screen navigation.

---

## 5. Exact Files Modified

| File | Nature of Changes |
|---|---|
| `mobile/src/components/AppIcon.tsx` | Added `'wash-fold'` and `'wash-iron'` to `IconName` union, added SVG path definitions, and built native React Native vector component renderers in `renderNativeIcon`. |
| `mobile/src/components/AppIcon.test.tsx` | Added `'wash-fold'` and `'wash-iron'` to icon test list, verifying native rendering. |
| `mobile/src/utils/categoryIconMapping.ts` | Updated `CANONICAL_CATEGORY_ICON_MAP` and keyword fallbacks to map Wash & Fold -> `wash-fold`, Wash & Steam Iron -> `wash-iron`, Wash & Iron -> `wash-iron`. |
| `mobile/src/utils/categoryIconMapping.test.ts` | Updated test expectations to assert distinct `wash-fold` and `wash-iron` icon names. |
| `mobile/src/hooks/useRealtime.ts` | Added `isDuplicateRealtimeEvent` windowed TTL deduplication (2500ms) to prevent duplicate event dispatches across multiplexed channels. |
| `mobile/src/hooks/useNotificationBadge.ts` | Added `useRef` import, `seenNotificationIdsRef` deduplication for `NOTIFICATION_CREATED`, and debounced authoritative count synchronization. |
| `mobile/src/screens/DriverJobDetailScreen.tsx` | Removed broken relative Y layout measurement; replaced with `scrollToEnd` on OTP focus, removed whole-screen `keyboardHeight` re-render state, and added keyboard-aware focus auto-scroll. |
| `backend/src/modules/notifications/providers/fcm.provider.spec.ts` | Synchronized test fixture to verify FCM sound/channel payload structure (`android` / `apns`). |

---

## 6. Verification and Test Results

### 6.1 TypeScript Compilation
- **Mobile (`d:\techyArts\B-W\mobile`):**
  ```bash
  npx tsc --noEmit
  # Result: 0 errors (Exit code 0)
  ```

### 6.2 Unit and Regression Tests
- **Category Icon & AppIcon Suites:**
  ```bash
  npm test -- src/utils/categoryIconMapping.test.ts src/components/AppIcon.test.tsx
  # Result: 2 passed, 21 tests passed (100%)
  ```
- **Driver Job Detail Suite (OTP & Handover):**
  ```bash
  npm test -- src/screens/DriverJobDetailScreen.test.tsx
  # Result: 1 passed, 39 tests passed (100%)
  ```
- **Customer Home Screen Suite:**
  ```bash
  npm test -- src/screens/HomeScreen.test.tsx
  # Result: 1 passed, 9 tests passed (100%)
  ```
- **Full Mobile Test Suite:**
  ```bash
  npm test
  # Result: 110 passed, 110 total test suites, 517 passed, 517 total tests (100%)
  ```
- **Backend Test Suite:**
  ```bash
  npm test
  # Result: 56 passed, 56 total test suites, 414 passed, 414 total tests (100%)
  ```

---

## 7. Remaining Physical-Device Verification Steps

Because the local development environment is running in headless mode without a currently attached physical Android device via USB/ADB, the following verification checklist remains for the on-device QA pass:

1. **Category Icon Inspection on Device:**
   - Launch app on physical Android device.
   - Verify that *Wash & Fold* displays the washing machine + folded stack icon.
   - Verify that *Wash & Steam Iron* and *Wash & Iron* display the washing machine + steam iron icon.
   - Verify that *Steam Ironing* displays the stand-alone iron icon.
   - Verify that *Premium Laundry* displays the shirt icon.
2. **Notification Badge Verification:**
   - Log in as customer. Verify that the header notification bell shows the exact unread count corresponding to actual unread notifications, without doubling upon incoming real-time alerts.
3. **Driver Pickup OTP Handover on Real Hardware:**
   - Open Driver app on Android device, navigate to an arrived pickup job.
   - Tap the 6-digit OTP input field.
   - Verify that the numeric soft keyboard slides up smoothly without screen flickering or layout jumping.
   - Verify that the screen scrolls to reveal the OTP box and the "Verify OTP and complete pickup" button right above the keyboard.
   - Verify that typing the 6 digits and tapping "Verify OTP and complete pickup" immediately dismisses the keyboard and displays the success confirmation modal.
