export const PRIVACY_POLICY_VERSION = '2026.10.12';
export const PRIVACY_POLICY_LAST_UPDATED = 'October 12, 2026';

export type PolicySection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  subsections?: {
    subtitle: string;
    paragraphs?: string[];
    bullets?: string[];
  }[];
};

export const PRIVACY_POLICY_INTRO =
  'Bright & White Laundry ("Bright & White", "we", "us", or "our") respects your privacy and is committed to protecting the personal data of customers, drivers, and users of our mobile application (com.brightwhitemobile), website, and on-demand laundry and dry-cleaning services. This Privacy Policy explains what personal information we collect, how we use and store it, the third-party services we integrate with, and your rights, including how to request account deletion.';

export const PRIVACY_POLICY_SECTIONS: PolicySection[] = [
  {
    id: 'scope',
    title: '1. Scope and Application',
    paragraphs: [
      'This Privacy Policy applies to all users of the Bright & White mobile application on Android and iOS (Package ID: com.brightwhitemobile), our web platform, and related garment-care, door-to-door pickup, washing, dry-cleaning, ironing, and delivery services.',
      'By creating an account, accessing our application, or scheduling a laundry pickup, you acknowledge the collection and processing of your personal information as described in this policy.',
    ],
  },
  {
    id: 'identity',
    title: '2. Identity of the Developer and Privacy Contact',
    paragraphs: [
      'The application and services are operated by Bright & White Laundry, operating in Hyderabad, Telangana, India.',
      'For any privacy inquiries, data access requests, or questions regarding our data practices, you may contact our privacy team at:',
    ],
    bullets: [
      'Privacy & Support Email: brightandwhiteofficial@gmail.com',
      'Customer Support Phone: +91 87124 35442',
      'Operating Region: Hyderabad, Telangana, India',
      '[UNRESOLVED REGISTERED BUSINESS DETAILS]: Legal registered corporate entity name and registered office address are pending final regulatory filing confirmation and will be published upon corporate registry issuance.',
    ],
  },
  {
    id: 'data-collected',
    title: '3. Information We Collect',
    paragraphs: [
      'We collect only the personal information necessary to deliver, coordinate, and fulfill laundry and dry-cleaning services. We do not sell your personal data.',
    ],
    subsections: [
      {
        subtitle: 'A. Personal Identification & Contact Details',
        bullets: [
          'Full Name: Collected during signup and profile editing to identify customers and personalize order receipts.',
          'Email Address: Collected for authentication, password recovery, email verification OTPs, and electronic invoices.',
          'Phone Number: Collected in verified Indian mobile format (+91) for order coordination, driver pickup/delivery communications, and security verification.',
        ],
      },
      {
        subtitle: 'B. Addresses & Geolocation Data',
        bullets: [
          'Physical Addresses: Saved pickup and delivery locations including street name, apartment/house number, landmark, area, and pincode.',
          'Precise Geocoordinates (Latitude & Longitude): Obtained when you pinpoint your address using the in-app Google Maps location selector (ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION). For customers, location is used solely to verify delivery coverage and guide drivers to your door.',
          'Driver Trip Location: For active delivery personnel, background and foreground location data is collected during active pickup and delivery trips via DriverTripLocationService to provide live dispatching and customer delivery tracking.',
        ],
      },
      {
        subtitle: 'C. Order, Garment & Transaction Records',
        bullets: [
          'Order Details: Garment categories, service types (Wash & Fold, Wash & Steam Iron, Dry Cleaning, etc.), item counts, special care instructions, and pickup/delivery time slots.',
          'Garment Photographs: When you submit stain alerts, special garment-care notes, or damage claims (ClaimsRefundsScreen), you may upload garment photos. Similarly, drivers or facility staff may capture intake or proof-of-delivery photos.',
          'Payment Metadata: Razorpay transaction IDs, payment status (captured, failed, refunded), payment method type, and order timestamps. Note: Bright & White servers NEVER collect, transmit, or store raw credit/debit card numbers, CVVs, or UPI PINs.',
        ],
      },
      {
        subtitle: 'D. Technical & Device Identifiers',
        bullets: [
          'Push Notification Tokens: Firebase Cloud Messaging (FCM) registration tokens to notify you about order progress and pickup/delivery OTPs.',
          'Device & App Information: Operating system version, app version (com.brightwhitemobile), and device platform to diagnose crashes and ensure compatibility.',
          'Authentication Tokens: Cryptographic session tokens stored securely in your device encrypted keychain/keystore.',
        ],
      },
    ],
  },
  {
    id: 'data-use',
    title: '4. How We Use Your Information',
    paragraphs: [
      'We process your personal information strictly for legitimate service delivery, contractual performance, safety, and legal compliance purposes:',
    ],
    bullets: [
      'Account Management: To register, verify (via email OTP), authenticate, and maintain your customer profile.',
      'Order Fulfillment: To schedule pickups, clean garments according to requested specifications, and deliver finished orders to your address.',
      'Driver Logistics & Dispatch: To route drivers to your address and enable direct customer-driver handoff via secure OTP verification.',
      'Payment & Billing: To generate itemized invoices, apply eligible coupons/packages, process payments through Razorpay, and issue authorized refunds.',
      'Order Notifications: To send real-time push notifications regarding order lifecycle milestones (Picked Up, In Facility, Processing, Packed, Out for Delivery, Delivered).',
      'Claims & Customer Support: To investigate garment damage or loss claims, verify condition photos, and resolve service inquiries.',
      'Fraud Prevention & Platform Security: To detect fraudulent transactions, prevent unauthorized account takeovers, and maintain system integrity.',
      'Statutory & Tax Compliance: To maintain invoicing, accounting, and transaction records required under Indian taxation laws (GST/Income Tax).',
    ],
  },
  {
    id: 'third-parties',
    title: '5. Third-Party Service Providers and Data Sharing',
    paragraphs: [
      'We do not sell, rent, or trade your personal data to advertisers or data brokers. We share data only with trusted infrastructure and service providers bound by strict confidentiality and security obligations:',
    ],
    bullets: [
      'Supabase Inc.: Cloud database, user authentication (Supabase Auth), and encrypted file storage (Supabase Storage). User profiles, orders, and claim photos are stored in secure Supabase infrastructure.',
      'Razorpay Software Pvt. Ltd.: Secure payment processing. Payment checkout occurs directly via Razorpay SDK. Razorpay is certified PCI-DSS Level 1 compliant. We receive only transaction confirmations and payment IDs.',
      'Google Maps Platform (Google LLC): Geocoding, map display, and address autocomplete services to help you select your pickup and delivery location.',
      'Firebase Cloud Messaging (Google LLC): Delivery of real-time push notifications to your mobile device.',
      'Transactional Email Service (Nodemailer via SMTP): Delivery of account verification OTP codes and password reset challenges.',
      'Legal & Law Enforcement: We may disclose information if required by applicable Indian law, court order, or governmental regulation to protect life, property, or legal rights.',
    ],
  },
  {
    id: 'security',
    title: '6. Data Storage and Security Practices',
    paragraphs: [
      'We maintain industry-standard administrative, physical, and technical safeguards to protect your personal information against unauthorized access, loss, or alteration:',
    ],
    bullets: [
      'Encryption in Transit: All network communications between the mobile application and backend APIs use Transport Layer Security (HTTPS / TLS 1.3). Cleartext HTTP traffic is explicitly blocked (usesCleartextTraffic="false").',
      'Encryption at Rest: Sensitive database records and uploaded claim photos are stored with storage-level encryption in Supabase.',
      'On-Device Security: Sensitive authentication sessions are stored in Android Keystore / iOS Keychain via react-native-keychain rather than unencrypted storage.',
      'Role-Based Access Control (RBAC): Strict server-side access controls ensure customer profiles, addresses, and orders can only be accessed by the verified owner or authorized staff on a need-to-know basis.',
    ],
  },
  {
    id: 'retention',
    title: '7. Data Retention and Lifecycle',
    paragraphs: [
      'We retain your personal data for as long as your account remains active and as necessary to fulfill the purposes outlined in this policy:',
    ],
    bullets: [
      'Active Accounts: Account profile, saved addresses, and active preferences are retained while your account is in use.',
      'Push Notification Tokens: Device registration tokens are purged upon account logout or account deletion.',
      'Garment Claim Photos: Photos uploaded for garment claims or inspection are retained until the claim resolution period expires, after which they are scheduled for deletion.',
      'Statutory Invoices: Completed order invoices and financial records are retained for statutory retention periods mandated by Indian tax and accounting regulations (typically up to 7 years), after which personal identifiers are permanently scrubbed.',
    ],
  },
  {
    id: 'deletion',
    title: '8. Account Deletion and User Rights',
    paragraphs: [
      'You have full control over your personal data and may request account deletion at any time:',
    ],
    subsections: [
      {
        subtitle: 'A. How to Delete Your Account In-App',
        bullets: [
          'Step 1: Open the Bright & White app and sign in.',
          'Step 2: Tap the Account tab, then tap Profile.',
          'Step 3: Scroll to the bottom and tap "Delete Account".',
          'Step 4: Confirm your deletion request in the confirmation prompt.',
        ],
      },
      {
        subtitle: 'B. Deletion Conditions and Verification',
        bullets: [
          'Active Orders Restriction: To protect both customer property and pending service payments, an account cannot be deleted while an order is currently active (placed, picked up, in facility, processing, or out for delivery). You must wait until all active orders are completed or cancelled.',
          'Authentication Deletion: Upon confirmation, your authentication account is immediately deleted from Supabase Auth.',
          'Push Device Purge: All registered push notification device tokens are immediately and irreversibly deleted.',
          'Address Removal: Saved addresses not linked to completed orders are hard-deleted.',
          'Profile Anonymization: Profile records are stripped of your name, phone number, and avatar, and marked inactive.',
          'Completed Order Archival: Historical order amounts and tax invoices are retained in anonymized format solely to satisfy mandatory statutory accounting and tax compliance.',
        ],
      },
      {
        subtitle: 'C. External Account Deletion Request',
        bullets: [
          'If you cannot access the mobile application, you may submit an external deletion request by emailing brightandwhiteofficial@gmail.com with your registered email and phone number.',
          'External deletion requests are verified and processed within 7 business days.',
        ],
      },
    ],
  },
  {
    id: 'permissions',
    title: '9. Device Permissions and Why We Need Them',
    paragraphs: [
      'The application requests device permissions only when required to provide specific features. You can grant or revoke these permissions at any time in your Android system settings:',
    ],
    bullets: [
      'Location (ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION): Used to detect your current location on the map when adding a pickup/delivery address. For drivers, used to coordinate pickups and provide route navigation.',
      'Camera (CAMERA): Optional. Used by facility staff to scan laundry bag QR codes and by drivers to capture proof-of-delivery images.',
      'Photos & Storage (READ_MEDIA_IMAGES / READ_EXTERNAL_STORAGE): Optional. Used if you choose to attach photos of garments for stain alerts or damage claims.',
      'Notifications (POST_NOTIFICATIONS): Used to deliver order status updates, pickup arrival alerts, and delivery OTPs.',
    ],
  },
  {
    id: 'children',
    title: "10. Children's Privacy",
    paragraphs: [
      'Bright & White Laundry services and the application are strictly intended for adults (18 years of age or older) capable of entering into legally binding contracts under Indian law.',
      'We do not knowingly collect, solicit, or maintain personal information from individuals under the age of 18. If we learn that a user under 18 has provided us with personal information, we will promptly delete that data.',
    ],
  },
  {
    id: 'changes',
    title: '11. Changes to This Privacy Policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time to reflect changes in our legal obligations, technology, or service offerings. When updates occur, we will revise the "Last Updated" date at the top of this policy.',
      'For significant changes that materially affect your rights, we will notify you through an in-app notice, push notification, or email before the changes become effective. Your continued use of the application after the revised policy is published constitutes your acknowledgment of the updated terms.',
    ],
  },
  {
    id: 'grievance',
    title: '12. Grievance Officer and Redressal Mechanism',
    paragraphs: [
      'In accordance with the Information Technology Act, 2000 and the Consumer Protection (E-Commerce) Rules, 2020, you may address any concerns, grievances, or complaints regarding data privacy to our designated Grievance Contact:',
    ],
    bullets: [
      'Grievance Contact: Customer Support & Privacy Desk',
      'Organization: Bright & White Laundry',
      'Email: brightandwhiteofficial@gmail.com',
      'Support Phone: +91 87124 35442',
      'Operating Hours: Monday – Saturday, 9:00 AM – 7:00 PM IST',
      'Response Time: Complaints are acknowledged within 48 hours and addressed within 15 business days.',
    ],
  },
];
