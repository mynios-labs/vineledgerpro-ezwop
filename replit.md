# eBay Resale & Bookkeeping Platform

## Overview
This platform is a privacy-first eBay resale application designed for Amazon Vine reviewers. Its primary purpose is to automate the entire resale workflow, from importing Vine item data and creating privacy-compliant eBay listings to managing orders, generating shipping labels, and producing CPA-ready tax reports. The project aims to streamline the selling process, ensure compliance with Amazon's terms of service, and provide comprehensive financial tracking for tax purposes.

## Recent Updates (November 2025)
- **eBay Category Search Authentication Fix** (Nov 11): Fixed 403 Forbidden errors in category search
  - **Root Cause**: Taxonomy API requires client credentials token (basic oauth scope), not user refresh token (sell.* scopes)
  - **Solution**: Created `getPublicAccessToken()` function with separate token cache for public APIs
  - **Leaf Validation**: Category search endpoint now validates and returns only leaf categories (valid for listing creation)
  - **Performance**: Added request-level memoization to avoid duplicate `isLeafCategory()` API calls
  - **Result**: Category search now works correctly with debounced input, loading states, and proper error handling
- **eBay-Compliant Listing Creation** (Nov 11): Complete overhaul of draft listing creation workflow
  - **Structured Descriptions**: AI now generates intro paragraph + bullet points + closing paragraph format (eBay compliance)
  - **Title Truncation**: Automatic 80-character limit with word-boundary truncation to prevent eBay errors
  - **Category Selection**: Added search interface for eBay categories with async dropdown results
  - **Title Length Indicators**: Real-time character count (0-70: normal, 71-79: warning, 80+: error) with truncation badges
  - **Editable Structured Editor**: Users can edit intro/bullets/closing independently with add/remove bullet controls
  - **Regeneration Fix**: Clicking regenerate now refreshes both titles AND description with new AI suggestions
  - **Pre-flight Validation**: Validates title length, photo count (min 2), category selection, numeric fields before eBay API calls
  - **Field-level Error Parsing**: Surfaces specific eBay validation errors inline instead of generic failures
- **AI Title Generation**: Updated prompt to avoid generic marketing words ("superior", "innovative", "reliable") and generate more creative, varied eBay listing titles
- **Draft Pricing Fix**: Fixed total price calculation - users can now type freely in the Total Price field without input interference
- **Cancellation Tracking System**: Implemented comprehensive tracking for cancelled Amazon Vine orders
  - Added `cancelled` status to vine_item_status enum with cancelledAt timestamp and cancelledImportId tracking
  - Added `orderNumber` field to vine_items for precise order matching (prevents duplicate entries)
  - Updated import logic to match cancellations by order number instead of ASIN+date (eliminates duplicate items in inventory)
  - Fixed XLSX column mapping bug (Amazon title row offset)
  - Cancelled items excluded from active inventory total but tracked separately for tax reconciliation
  - Stats endpoint returns `cancelled` count for CPA-ready tax reports (reduces taxable income by cancelled ETVs)
- **Data Model Cleanup**: Removed "sold" and "reserved" from vine_item_status enum - these are now tracked via Listings (draft/live/ended) and Orders tables respectively
- **1:1 Inventory Constraint**: Enforced one-to-one relationship between Vine Items and Inventory Items (cleaned up 99 duplicate records, added unique constraint)
- **Production OAuth**: Implemented refresh token support for eBay API with proper scope handling and automatic token renewal (18-month refresh token lifecycle)

## GitHub Repository
- **Repository**: https://github.com/mynios-labs/vineledgerpro-ezwop
- **Note**: Replit's git system prevents direct git operations via command line. To push code changes:
  1. Use Replit's built-in Git interface in the left sidebar (Version Control tab)
  2. Or manually use the Shell tool and perform git operations when locks are released
  3. GIT_TOKEN secret is configured for authentication

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React 18 with Vite, styled with shadcn/ui (Radix UI primitives) and Tailwind CSS. The design is inspired by modern business applications like Linear and Stripe Dashboard, emphasizing clarity, data visibility, error prevention, and workflow efficiency. Key pages include Inventory, Draft Listing creation, Orders, Messages & Returns, Money & Ledger, and a Health dashboard.

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
-   **Background Jobs:** Planned for eBay webhooks and scheduled tasks.
-   **File Uploads:** Multer
-   **Image Processing:** Sharp

#### Data Model
Core entities include Vine Item Management, Inventory & Listings, Order Fulfillment, Financial Tracking (double-entry ledger with detailed event types), Amazon and eBay 1099 Tracking, Configuration, and Monitoring. Key design decisions include SHA-256 hashing for deduplication, separate inventory tracking, event-based accounting, and tracking defective items for tax benefits.

#### Authentication
Currently uses simple in-memory storage for single-user mode, with future plans for email magic link or local password authentication.

### Privacy & Compliance
Features include a forbidden word list, cosine similarity checks to prevent Amazon TOS violations, EXIF data scrubbing, and dual address profiles for returns and shipping. Listings undergo a validation flow before publication.

### Development & Build
Uses Vite for frontend development with HMR and esbuild for backend bundling. Type safety is maintained with shared TypeScript types and strict TSConfig.

## External Dependencies

### eBay APIs
-   **Used for:** Taxonomy, Inventory, Offer, Fulfillment, Post Order, Messaging, Picture Services.
-   **Authentication:** Requires Client Credentials Flow (public APIs) and User Access Token (inventory/listing operations).
-   **Specifics:** All listings are "Buy It Now." Requires merchant location and business policies configured in eBay Seller Hub.

### Shipping Services
-   **Primary:** Shippo API
-   **Carrier:** UPS (exclusively)
-   **Functionality:** Rate calculation, label purchase, tracking number generation.
-   **Pricing:** UPS Ground rate + 5% cushion for estimates.

### AI Services
-   **Provider:** OpenAI-compatible API via Replit AI Integrations.
-   **Use Cases:** Title rewriting, description generation, message triage, reply drafting.
-   **Model:** GPT-4.1-mini (with fallback to gpt-4.1-nano).

### Database
-   **Service:** Neon Serverless PostgreSQL.
-   **Connection:** WebSocket-based via `@neondatabase/serverless`.
-   **Schema Management:** Drizzle Kit.