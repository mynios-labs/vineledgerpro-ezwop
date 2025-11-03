# eBay Resale & Bookkeeping Platform

## Overview

This is a privacy-first eBay resale platform designed for Amazon Vine reviewers to list products while maintaining compliance with Amazon's terms of service. The application automates the entire workflow from importing Vine item data to publishing eBay listings, managing orders, generating shipping labels, and producing CPA-ready tax reports.

**Core Features:**
- Import and deduplicate Vine product data from XLSX files
- Automated eBay listing creation with privacy enforcement
- AI-generated unique titles and descriptions to avoid Amazon TOS violations
- Order management with automated shipping label generation
- Double-entry accounting ledger for tax compliance
- Messaging and return case handling

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework:** React 18 with Vite as the build tool

**UI Component System:** shadcn/ui (Radix UI primitives) with Tailwind CSS for styling

**Design Philosophy:** Modern business application inspired by Linear, Vercel Dashboard, and Stripe Dashboard. Prioritizes clarity over decoration, data visibility, error prevention, and workflow efficiency.

**State Management:** TanStack Query (React Query) for server state management and caching

**Routing:** Wouter for lightweight client-side routing

**Key Pages:**
- Inventory page with typeahead search for product selection
- Draft listing creation with AI-powered content generation
- Orders page with shipping label purchase
- Messages & Returns for customer communication
- Money & Ledger for accounting with CSV/PDF exports
- Health dashboard for monitoring policy compliance

### Backend Architecture

**Runtime:** Node.js 20 with TypeScript

**Framework:** Express.js for HTTP server and API routing

**Database ORM:** Drizzle ORM with PostgreSQL (Neon serverless)

**API Design:** RESTful API endpoints under `/api/*` prefix

**Background Jobs:** Intended for BullMQ or cron-based polling for eBay webhooks and scheduled tasks

**File Uploads:** Multer middleware for handling XLSX imports and photo uploads

**Image Processing:** Sharp for photo manipulation (EXIF scrubbing, resolution validation)

### Data Model

**Core Entities:**

1. **Vine Item Management:** `imports`, `import_rows`, `vine_items` - Tracks imported products with deduplication via SHA-256 hashing
2. **Inventory & Listings:** `inventory_items`, `listings`, `photo_sets` - Manages physical inventory and eBay listing lifecycle
3. **Order Fulfillment:** `orders`, `buyers` - Tracks sales and customer information
4. **Financial Tracking:** `accounting_ledger` - Double-entry bookkeeping with event types for basis, sales, fees, shipping, payouts
5. **Configuration:** `address_profiles`, `business_policies` - Manages shipping addresses and eBay business policy templates
6. **Monitoring:** `health_events` - Logs policy violations, late shipments, and system issues

**Key Design Decisions:**
- Unique constraint on `vine_items` using composite key (ASIN + received_date + ETV + serial) to prevent duplicate inventory
- Row-level hashing (SHA-256) for deduplication during imports
- Separate `inventory_items` table to track physical condition, location, and photos independent of Vine data
- Ledger uses event-based accounting with explicit event types for different transaction categories
- **Defective Item Tracking:** `vine_items` includes `defective` boolean and `defectiveNotes` text fields for tax reporting
  - Items can be manually marked as defective from the inventory page
  - Returns automatically mark items as defective with "Returned by buyer" note
  - Defective status appears in accounting CSV exports alongside transaction data
  - Tax benefit: Defective items can be excluded from taxable income calculations by your CPA

### Authentication & Authorization

**Current Implementation:** Simple in-memory user storage (`MemStorage` class) for single-user mode

**Intended Approach:** Email magic link or local password authentication

**Future Consideration:** The codebase is structured for multi-tenant expansion but currently focuses on single-user deployment

### External Dependencies

#### eBay APIs
- **Taxonomy API:** Category suggestions for product classification
- **Inventory API:** SKU and inventory item management
- **Offer API:** Listing creation and price management
- **Fulfillment API:** Order retrieval and tracking upload
- **Post Order API:** Return case handling
- **Messaging API:** Buyer communication
- **Picture Services:** Photo hosting

**OAuth Configuration:** Requires `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, scopes for Sell API and Messaging

**Environment Toggle:** `EBAY_ENV` switches between sandbox and production endpoints

#### Shipping Services
**Primary Integration:** Shippo API (alternative: EasyPost)

**Functionality:** Rate calculation, label purchase, tracking number generation

**Configuration:** `SHIPPO_API_KEY` environment variable

#### AI Services
**Provider:** OpenAI-compatible API via Replit AI Integrations

**Use Cases:** 
- Title rewriting (3 variations per listing)
- Description generation
- Message triage and reply drafting

**Cost Optimization:** AI is used only for text generation; all policy checks and calculations are deterministic

**Model:** GPT-4.1-mini via `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`
- **Note:** GPT-5 was initially specified but uses reasoning tokens (like o1) which resulted in empty outputs
- GPT-4.1-mini is cost-efficient, reliable, and produces excellent eBay-friendly content
- Fallback to gpt-4.1-nano if primary model fails

#### Database
**Service:** Neon Serverless PostgreSQL

**Connection:** WebSocket-based connection pooling via `@neondatabase/serverless`

**Schema Management:** Drizzle Kit for migrations and schema pushing

**Configuration:** `DATABASE_URL` environment variable

### Privacy & Compliance

**Privacy Enforcement:**
- Forbidden word list blocks terms like "Vine", "received for review", "promo unit", ASIN references in public listings
- Cosine similarity calculation prevents listings that are too similar to Amazon product descriptions
- EXIF data scrubbing from uploaded photos
- Dual address profiles: PO Box for returns, street address for label generation

**Validation Flow:**
1. AI generates listing content
2. System checks for forbidden words
3. Similarity score calculated against Amazon source text
4. Warnings displayed to user before publication
5. Safe return address automatically selected based on profile type

### Development & Build

**Development Mode:** Vite dev server with HMR, Express API proxy

**Production Build:** 
- Frontend: Vite bundles to `dist/public`
- Backend: esbuild bundles server to `dist/index.js`

**Type Safety:** Shared TypeScript types between client and server via `@shared/schema`

**Code Quality:** TSConfig with strict mode, ESM modules throughout