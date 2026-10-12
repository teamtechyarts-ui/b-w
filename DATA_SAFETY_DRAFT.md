# Bright & White Laundry — Google Play Data Safety Declaration Draft

**Application ID:** `com.brightwhitemobile`  
**Purpose:** Official responses for Google Play Console **Policy $\rightarrow$ Data Safety** questionnaire.

---

## 1. Overview Questions

| Question | Answer | Rationale |
|:---|:---:|:---|
| **Does your app collect or share any of the required user data types?** | **Yes** | Collects user profile, order addresses, and push notification tokens. |
| **Is all of the user data collected by your app encrypted in transit?** | **Yes** | All network communication uses HTTPS (TLS 1.3) with `usesCleartextTraffic="false"`. |
| **Do you provide a way for users to request that their data be deleted?** | **Yes** | In-app under Profile $\rightarrow$ Delete Account and via web URL. |

---

## 2. Data Types Collected & Declared

### 2.1 Personal Info

#### Name
- **Collected:** Yes
- **Shared:** No (Kept within Bright & White platform)
- **Processed ephemerally:** No (Stored in Supabase user profile)
- **Is this data required or optional?** Required
- **Purposes:**
  - App functionality (Personalized order handling, driver-customer identification)
  - Account management

#### Email Address
- **Collected:** Yes
- **Shared:** No
- **Processed ephemerally:** No
- **Is this data required or optional?** Required
- **Purposes:**
  - App functionality (Account login, OTP verification via Nodemailer)
  - Account management (Password reset, receipts)

#### Phone Number
- **Collected:** Yes (Indian Mobile format `+91`)
- **Shared:** No
- **Processed ephemerally:** No
- **Is this data required or optional?** Required
- **Purposes:**
  - App functionality (Pickup/delivery coordination, driver OTP exchange)
  - Fraud prevention & security

#### Physical Address
- **Collected:** Yes (Street, landmark, pincode, geocoordinates)
- **Shared:** No
- **Processed ephemerally:** No
- **Is this data required or optional?** Required
- **Purposes:**
  - App functionality (Pickup and delivery of laundry items)

---

### 2.2 Location Data

#### Approximate Location & Precise Location
- **Collected:** Yes (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`)
- **Shared:** No
- **Processed ephemerally:** Ephemeral for customers (geocoding lookup during address selection); Stored temporarily for drivers during active pickup/delivery trips
- **Is this data required or optional?** Optional for customers (can enter address manually); Required for drivers during active duty
- **Purposes:**
  - App functionality (Address pinpointing, driver route optimization)

---

### 2.3 Financial Info

#### Purchase History
- **Collected:** Yes (Order records, services selected, amounts paid)
- **Shared:** No
- **Processed ephemerally:** No
- **Is this data required or optional?** Required
- **Purposes:**
  - App functionality (Order history, invoices, re-ordering)
  - Fraud prevention & legal accounting

#### Payment Info (Credit Cards / UPI)
- **Collected:** **No** (Processed directly by Razorpay SDK)
- **Shared:** No
- **Note:** Bright & White servers never receive or store raw credit card numbers, CVVs, or UPI PINs. Razorpay is a certified PCI-DSS Level 1 payment processor.

---

### 2.4 Photos and Videos

#### Photos
- **Collected:** Yes
- **Shared:** No
- **Processed ephemerally:** No (Stored in private Supabase Storage buckets with signed URL access)
- **Is this data required or optional?** Optional
- **Purposes:**
  - App functionality (Customer garment damage claims, driver Proof of Delivery photos, facility intake damage documentation)

---

### 2.5 Device or Other Identifiers

#### Device or other identifiers (FCM Token)
- **Collected:** Yes (Firebase Cloud Messaging registration token)
- **Shared:** No
- **Processed ephemerally:** No
- **Is this data required or optional?** Required for notifications
- **Purposes:**
  - App functionality (Push notifications for order lifecycle updates and driver alerts)

---

## 3. Data Deletion Mechanism

1. **In-App Deletion:**
   - Navigating to **Profile $\rightarrow$ Delete Account** initiates the deletion sequence.
   - Deletes customer authentication identity and customer profile.
   - Addresses and personal identifiers are hard-deleted.
   - Historical invoices are anonymized and retained only to comply with statutory taxation requirements.
2. **Web Deletion Resource:**
   - External URL: `https://brightandwhite.com/account-deletion`
   - Form accepts registered email address and sends a verification link to confirm ownership before triggering the backend deletion workflow.
