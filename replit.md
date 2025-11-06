# eBay Resale & Bookkeeping Platform

## Overview
This platform is a privacy-first eBay resale application designed for Amazon Vine reviewers. Its primary purpose is to automate the entire resale workflow, from importing Vine item data and creating privacy-compliant eBay listings to managing orders, generating shipping labels, and producing CPA-ready tax reports. The project aims to streamline the selling process, ensure compliance with Amazon's terms of service, and provide comprehensive financial tracking for tax purposes.

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