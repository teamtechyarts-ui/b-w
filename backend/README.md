# Bright & White Backend

Clean modular NestJS/TypeScript monolith for the Bright & White Laundry Management Platform, backed by Supabase PostgreSQL, PostGIS, Supabase Auth, Supabase Storage, and direct external integrations (Razorpay, Google Maps, Firebase Cloud Messaging).

## Quick Start

```bash
cp .env.example .env
npm install
npm run start:dev
```

Open Swagger documentation at `http://localhost:3000/docs`.

## Architecture & Technology Stack

* **Core Framework**: NestJS with Fastify adapter (`@nestjs/platform-fastify`)
* **Database & Auth**: PostgreSQL with PostGIS via Supabase (`@supabase/supabase-js`)
* **Storage**: Supabase Storage for operational photos (proof of delivery, claims)
* **Authentication**: Single authoritative OTP login flow via Supabase Auth (SMS provider configured in Supabase)
* **Operational OTP**: Secure server-side hashed pickup and delivery handoff OTPs in PostgreSQL (`order_otps`)
* **Payments**: Direct Razorpay integration with HMAC-SHA256 signature verification, webhook idempotency, and refund lifecycle
* **Maps & Navigation**: Google Maps Routes/Places API for road routing and ETA, combined with PostGIS for spatial driver candidate discovery
* **Push Notifications**: Firebase Cloud Messaging (FCM) direct dispatch

## Commands

```bash
# Run in development mode
npm run start:dev

# Build production bundle
npm run build

# Run unit and integration tests
npm test

# Run end-to-end tests
npm run test:e2e

# Run linter
npm run lint
```
