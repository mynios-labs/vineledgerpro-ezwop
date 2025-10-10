# Design Guidelines: eBay Resale & Bookkeeping Platform

## Design Approach

**Selected Approach:** Design System - Modern Business Application  
**Reference Inspiration:** Linear, Vercel Dashboard, Stripe Dashboard  
**Justification:** This is a utility-focused, information-dense business tool requiring efficiency, clarity, and data visibility. The design prioritizes quick task completion, error prevention, and financial accuracy over visual storytelling.

## Core Design Principles

1. **Clarity Over Decoration** - Every visual element serves a functional purpose
2. **Data Visibility** - Critical information (shipping dates, profit margins, privacy flags) must be immediately scannable
3. **Error Prevention** - Visual warnings for privacy violations, missing fields, and policy risks
4. **Workflow Efficiency** - Minimize clicks from item selection to published listing

## Color Palette

### Light Mode
- **Background:** 0 0% 100% (white base), 0 0% 98% (subtle gray for cards)
- **Primary:** 222 47% 11% (near-black for headers and primary actions)
- **Success:** 142 71% 45% (green for approved listings, profit indicators)
- **Warning:** 38 92% 50% (amber for shipping deadlines, missing photos)
- **Danger:** 0 84% 60% (red for privacy violations, forbidden words)
- **Muted:** 210 40% 96% (background for secondary elements)
- **Border:** 214 32% 91% (subtle card separators)

### Dark Mode
- **Background:** 222 47% 11%, 224 71% 4% (deep slate)
- **Primary:** 210 40% 98% (off-white text)
- **Success:** 142 76% 36% (muted green)
- **Warning:** 38 92% 50% (amber warnings)
- **Danger:** 0 72% 51% (urgent red)
- **Muted:** 217 33% 17% (card backgrounds)
- **Border:** 217 33% 20% (card separators)

### Accent Colors (Use Sparingly)
- **Info Blue:** 217 91% 60% (eBay integration status, external links)
- **Financial Green:** 160 84% 39% (realized gains)
- **Financial Red:** 0 84% 60% (losses, fees)

## Typography

**Font Families:**
- **Primary:** Inter (via Google Fonts) - For UI, data tables, forms
- **Monospace:** JetBrains Mono - For ASIN, order IDs, tracking numbers, financial calculations

**Scale:**
- **Headings:** text-2xl (24px) font-semibold for page titles, text-lg (18px) for section headers
- **Body:** text-sm (14px) for primary content and data tables, text-xs (12px) for metadata and labels
- **Data:** text-base (16px) for financial figures, tracking numbers

**Weights:** Regular (400) for body, Medium (500) for labels, Semibold (600) for headings, Bold (700) for critical alerts

## Layout System

**Spacing Primitives:** Use 2, 4, 6, 8, 12 as core units (p-2, m-4, gap-6, py-8, px-12)

**Grid Structure:**
- **Dashboard:** 12-column grid with responsive breakpoints (grid-cols-1 md:grid-cols-2 lg:grid-cols-3)
- **Data Tables:** Full-width with sticky headers, 4px row spacing
- **Forms:** Single column max-w-2xl for drafts, two-column for order details
- **Sidebar Navigation:** Fixed 64px width icons-only on mobile, 240px expanded on desktop

**Container Max-Widths:**
- Dashboard tiles: max-w-7xl
- Draft listing forms: max-w-4xl
- Reports/exports: max-w-6xl

## Component Library

### Navigation
- **Top Bar:** Fixed header with app logo, search command palette (⌘K), user menu, 64px height
- **Sidebar:** Collapsible navigation with inventory (home), orders, messages, money, health sections
- **Breadcrumbs:** Show path for deep navigation (Inventory > Draft > Approve)

### Data Display
- **Tables:** Striped rows, sortable columns, inline actions (label, track, refund), status badges
- **Cards:** Elevated (shadow-sm) with 16px padding, rounded-lg borders
- **Badges:** Rounded-full status indicators (Live: green, Draft: blue, Privacy Alert: red)
- **Metrics Tiles:** Large numbers (text-3xl), trend arrows, comparison to prior period

### Forms & Inputs
- **Text Inputs:** Consistent height (h-10), border-2 on focus, error state with red border + helper text
- **Dropdowns:** shadcn Select with typeahead, show preview of 5 options max
- **File Upload:** Drag-drop zone with preview grid, minimum 2 photos required (show counter)
- **Validation:** Inline errors below fields, success checkmarks for completed sections

### Actions
- **Primary Button:** Solid background, semibold text, 44px min-height for touch targets
- **Secondary Button:** Outline variant with hover state
- **Danger Actions:** Red with confirmation modal (refund, delete listing)
- **Bulk Actions:** Checkbox selection with floating action bar

### Feedback & Alerts
- **Privacy Warnings:** Alert component with red border, list forbidden words detected, block action until resolved
- **Similarity Gate:** Amber alert showing percentage match to Amazon text, regenerate button
- **Success Toast:** Bottom-right, 4-second auto-dismiss, green with checkmark
- **Loading States:** Skeleton screens for tables, spinner for button actions

### Specialized Components
- **Draft Preview:** Split view - left side form inputs, right side live preview of eBay listing
- **Photo Manager:** Grid with reorder drag handles, replace button, EXIF warning icon overlay
- **Ledger Viewer:** Waterfall chart showing basis → gross → fees → net → realized gain/loss
- **Packing Slip:** Print-optimized layout, large tracking barcode, business name prominent, no personal addresses

## Images

**Product Photos:**
- Minimum 2 required, displayed in 4-column grid during upload
- Main listing view: 1:1 aspect ratio thumbnails (150x150px)
- Draft preview: Carousel with 4:3 ratio, full-width on mobile

**Iconography:**
- Use Lucide React icons throughout (Package, DollarSign, AlertTriangle, CheckCircle)
- 20px size for buttons, 24px for section headers, 16px inline with text

**No Hero Images:** This is a business dashboard - lead with data and search, not marketing imagery

## Responsive Behavior

- **Mobile (< 768px):** Single column, bottom tab navigation, collapsed tables with expandable rows
- **Tablet (768px-1024px):** Two-column dashboard, side navigation drawer
- **Desktop (> 1024px):** Full sidebar, three-column dashboard, split-screen draft editor

## Accessibility

- WCAG AA contrast ratios for all text (4.5:1 minimum)
- Focus visible rings (ring-2 ring-offset-2) on all interactive elements
- ARIA labels for icon-only buttons
- Keyboard shortcuts for common actions (N for new listing, S for search, / for command palette)