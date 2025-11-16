# eBay Resale & Bookkeeping Platform

## Overview
This platform is a privacy-first eBay resale application designed for Amazon Vine reviewers. Its primary purpose is to automate the entire resale workflow, from importing Vine item data and creating privacy-compliant eBay listings to managing orders, generating shipping labels, and producing CPA-ready tax reports. The project aims to streamline the selling process, ensure compliance with Amazon's terms of service, and provide comprehensive financial tracking for tax purposes.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18 with Vite, styled with shadcn/ui (Radix UI primitives) and Tailwind CSS. The design is inspired by modern business applications like Linear and Stripe Dashboard, emphasizing clarity, data visibility, error prevention, and workflow efficiency. Key pages include Inventory, Draft Listing creation, Orders, Messages & Returns, Money & Ledger, and a Health dashboard.

### Critical eBay API Configuration
**IMPORTANT**: eBay Sell APIs require Accept-Language and Content-Language headers to be valid BCP47 locales. Setting these headers to empty strings causes 400 errors because eBay rejects blank values.

**Solution**: Set these headers to a valid locale (e.g., "en-US") in all eBay API requests:
```typescript
headersObj.set('Accept-Language', 'en-US');
headersObj.set('Content-Language', 'en-US');
```

This ensures eBay accepts the requests and prevents 400 "Invalid value for header Content-Language" errors. All eBay API calls are centralized through the EbayClient class (server/lib/EbayClient.ts) which handles proper header configuration.

### Technical Implementations

#### Frontend
-   **Framework:** React 18, Vite
-   **UI:** shadcn/ui, Tailwind CSS
-   **State Management:** TanStack Query
-   **Routing:** Wouter
-   **Key Features:**
    -   Inventory management with status tabs (Available, Do Not Sell, Sold/Live, Personal Use) and search/sort.
    -   Item-centric Money & Ledger page with financial statistics and lifecycle view.
    -   Comprehensive Tax Report page with Amazon and eBay 1099 reconciliation, including smart validation before printing.
    -   Draft listing workflow for manual price and dimension entry, with UPS shipping estimates.

#### Backend
-   **Runtime:** Node.js 20, TypeScript
-   **Framework:** Express.js
-   **Database ORM:** Drizzle ORM with PostgreSQL
-   **API Design:** RESTful
-   **File Uploads:** Multer
-   **Image Processing:** Sharp

#### Data Model
Core entities include Vine Item Management, Inventory & Listings, Order Fulfillment, Financial Tracking (double-entry ledger with detailed event types), Amazon and eBay 1099 Tracking, Configuration, and Monitoring. Key design decisions include SHA-256 hashing for deduplication, separate inventory tracking, event-based accounting, and tracking defective items for tax benefits.

### Privacy & Compliance
Features include a forbidden word list, cosine similarity checks to prevent Amazon TOS violations, EXIF data scrubbing, and dual address profiles for returns and shipping. Listings undergo a validation flow before publication.

### System Design Choices
-   **Listings Sync System:** Implements eBay-first synchronization for listing data with drift detection:
    -   **Sync Endpoints:** POST /api/listings/sync-from-ebay (bulk), POST /api/listings/:id/sync-from-ebay (single)
    -   **Drift Detection:** Compares local cached values (title, priceCents, categoryId) against eBay offer data before updating. Drift is stored in driftSnapshot JSON field with structure { fieldName: { local: value, ebay: value } }.
    -   **Price Validation:** Defensive parsing with explicit null/undefined/empty string checks, Number.isFinite() validation, and fallback to existing price when eBay omits or corrupts price data.
    -   **Zod Validation:** ebayOfferSchema validates eBay API responses before database updates to prevent injection.
    -   **Image Syncing:** During sync operations, fetches product images from eBay Inventory API and stores in photoSets table with O(n) deduplication (prefetch all photoSets once, compare URL arrays, reuse existing sets). Only works for Inventory API listings; Trading API listings (old workflow) cannot fetch images.
    -   **UI Features:** Sync now button, last synced timestamp, per-listing pull fresh buttons, status/drift filters (defaults to 'live'), drift details drawer showing local vs eBay values side-by-side. Edit button uses Wouter routing to navigate to draft page with full pre-population from eBay data.
    -   **Edit Mode:** Draft page supports editing existing listings with relaxed validation (photos optional since already on eBay, privacy checks bypassed). Uses listingId query parameter to fetch and pre-populate all fields.
    -   **Known Limitations:** Current drift tracking overwrites previous drift history (snapshot-based, not append-only). Field coverage limited to title, priceCents, categoryId, and status (does not sync quantity, fulfillment policies, or shipping profiles).
-   **eBay Orders Sync System:** Implements complete eBay orders synchronization with drift detection, a 2-step shipping workflow, and background sync every 15 minutes. It handles 429 retries with exponential backoff and tracks shipping statuses.
-   **2-Step Shipping Workflow:** Production-ready workflow with complete error handling and data validation:
    -   **Quote Rates (POST /api/orders/:id/rates):** Fetches Shippo rates with address validation, persists chosen rate with defensive validation, NaN guards, and array cloning for immutability. Returns structured ADDRESS_VALIDATION_FAILED errors with validation messages when ship-to or ship-from addresses fail Shippo validation.
    -   **Buy Label (POST /api/orders/:id/buy):** Idempotent label purchase with atomic transactions, normalized carrier/service/cost extraction, and comprehensive error handling. Sets `shippingStatus=label_purchased`.
    -   **Confirm Shipped (POST /api/orders/:id/confirm-shipped):** Posts tracking to eBay fulfillment API with Zod validation, atomic transactions, defensive filtering, short-circuit logic for invalid cache, and legacyItemId fallback support. Uses compensation-friendly transaction pattern (external API calls first, then DB updates in transaction) to keep locks short while maintaining consistency.
    -   **Void Label (POST /api/orders/:id/void-label):** Voids shipping label via Shippo refund API, clears label data, resets shippingStatus to unshipped, and creates timeline events for audit trail.
    -   **Zod Validation:** `ebayOrderSchema` and `ebayOrderLineItemSchema` validate eBay order data with support for legacy orders (refine requires lineItemId OR legacyItemId). Both cached and fresh-fetch paths filter items and use fallback logic consistently.
    -   **Timeline Events:** All shipping actions write detailed timeline events with metadata for audit trails.
    -   **Shipping Settings:** Configurable automation settings (autoMarkShipped, autoBuyLabels, signatureThreshold, insuranceCap, shipCutoffTime) with Zod-validated GET/POST endpoints.
    -   **Orders UI:** Tab-based interface (Unshipped, Label Purchased, Shipped) with card layouts, status-specific actions (Get Rates, Buy Label, Print Label, Confirm Shipped, Void Label), and timeline drawer for workflow visibility.
-   **Listing Management System:** Provides comprehensive editing for published eBay listings including title, description, price, category, fulfillment policy, dimensions, weight, and quantity. It ensures quantity persistence and eBay-first updates to prevent data drift.
-   **eBay Fulfillment Policy Integration:** Fetches and manages eBay fulfillment policies with UI selection and validation during listing creation.
-   **Image Hosting:** Implemented a filesystem-based image hosting solution with Express static serving for publicly accessible HTTPS URLs, resolving eBay image rejection issues.
-   **eBay Category Search:** Fixed authentication for the Taxonomy API, ensuring only leaf categories are returned and implementing request-level memoization for performance.
-   **eBay-Compliant Listing Creation:** Overhauled draft listing creation with AI-generated structured descriptions, 80-character title truncation with real-time indicators, a category search interface, and pre-flight validation.
-   **Cancellation Tracking System:** Implemented comprehensive tracking for cancelled Amazon Vine orders, including a `cancelled` status, `orderNumber` for precise matching, and exclusion from active inventory totals for tax reconciliation.
-   **Inventory Constraint:** Enforced a one-to-one relationship between Vine Items and Inventory Items.
-   **Production OAuth:** Implemented refresh token support for eBay API with automatic token renewal.
-   **SKU Auto-Generation System:** Implemented automatic SKU generation across both draft listing creation and eBay sync operations:
    -   **Format:** `{PREFIX}-{FULL_UNIQUE_ID}` where PREFIX is first 4 letters of title (uppercase, letters only) and FULL_UNIQUE_ID is the complete vineItemId/offerId (hyphens removed, ~32 chars)
    -   **Uniqueness Strategy:** Uses complete unique IDs directly (no truncation, no hashing/compression) - full vineItemId for drafts, full offerId for synced listings. This provides strong uniqueness guarantees when source IDs are available and unique.
    -   **Draft Page (client/src/pages/draft.tsx):** Auto-generates SKU when user selects or edits a title, using the complete 32-character vineItemId. Includes manual override capability with `userEditedSku` flag to prevent auto-generation after user customization. Features include input field with auto-generation indicator, helper text, and fallback title loading when AI generation fails.
    -   **Sync Route (server/routes.ts):** Generates SKUs for eBay listings that lack them during sync operations. Priority order: (1) EBAY-{listingId} if listingId available, (2) {PREFIX}-{fullOfferId} if title available, (3) OFFER-{fullOfferId} as fallback. All use complete unique IDs directly to ensure same listing always gets same SKU.
    -   **Publish Integration:** SKU is included in publish mutation FormData and sent to backend when creating new listings.
    -   **Production Hardening Recommendations:** For production deployment, consider adding: (1) database uniqueness constraint on `listings.sku` column, (2) collision detection with retry logic during SKU generation, (3) fallback UUID generation when source IDs are unavailable.

## External Dependencies

### eBay APIs
-   **Used for:** Taxonomy, Inventory, Offer, Fulfillment, Post Order, Messaging, Picture Services.
-   **Authentication:** Requires Client Credentials Flow (public APIs) and User Access Token (inventory/listing operations).

### Shipping Services
-   **Primary:** Shippo API
-   **Carrier:** UPS (exclusively)
-   **Functionality:** Rate calculation, label purchase, tracking number generation.

### AI Services
-   **Provider:** OpenAI-compatible API via Replit AI Integrations.
-   **Use Cases:** Title rewriting, description generation, message triage, reply drafting.
-   **Model:** GPT-4.1-mini (with fallback to gpt-4.1-nano).

### Database
-   **Service:** Neon Serverless PostgreSQL.
-   **Connection:** WebSocket-based via `@neondatabase/serverless`.
-   **Schema Management:** Drizzle Kit.