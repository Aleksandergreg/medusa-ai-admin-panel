# Order Status Analytics Tools

This document explains how to use the new order status analysis tools in the Medusa MCP analytics factory.

## 🔧 **FIXED ISSUES**

- ✅ Schema now accepts both strings and arrays for status filters
- ✅ Added `all_unfulfilled_orders_count` for counting ALL unfulfilled orders (paid + unpaid)
- ✅ Status normalization handles different API formats ("Not paid" → "awaiting", "Not fulfilled" → "not_fulfilled")
- ✅ Orders repository now fetches `payment_status` and `fulfillment_status` fields

## New Tools Added

### 1. `orders_status_analysis`

A generic tool for analyzing orders by payment and fulfillment status.

**Description**: Analyze orders by payment and fulfillment status. Find failed payments, unfulfilled orders, and other status-based categories. Supports filtering by date range and specific status values.

**Parameters**:

- `start`, `end` (optional): Date range in ISO format
- `payment_status` (optional): Array of payment statuses to filter by (e.g., ["awaiting", "failed", "captured", "completed"])
- `fulfillment_status` (optional): Array of fulfillment statuses to filter by (e.g., ["not_fulfilled", "partially_fulfilled", "fulfilled", "delivered"])
- `include_canceled` (optional): Include canceled orders (default: false)
- `group_by_status` (optional): Group results by status combinations (default: true)

**Example Usage**:

```javascript
// Find all delivered orders (NOW WORKS!)
{
  "fulfillment_status": "delivered"  // String format now supported!
}

// Find all orders with failed payments in the last month
{
  "start": "2024-12-01T00:00:00Z",
  "end": "2025-01-01T00:00:00Z",
  "payment_status": ["failed", "awaiting", "requires_action"]
}

// Find paid but unfulfilled orders
{
  "payment_status": ["captured", "completed"],
  "fulfillment_status": ["not_fulfilled", "partially_fulfilled"]
}

// Find ALL unfulfilled orders (including unpaid) - FIXED!
{
  "fulfillment_status": "not_fulfilled"
}
```

### 2. `failed_payments_count`

Count orders with failed or problematic payment status.

**Description**: Count orders with failed or problematic payment status (awaiting, failed, canceled, requires_action). Useful for finding payment issues.

**Parameters**:

- `start`, `end` (optional): Date range in ISO format

**Example Usage**:

```javascript
// Count failed payments in December 2024
{
  "start": "2024-12-01T00:00:00Z",
  "end": "2025-01-01T00:00:00Z"
}
```

### 3. `unfulfilled_orders_count`

Count paid orders that are not fulfilled or delivered.

**Description**: Count paid orders that are not fulfilled or delivered. Includes partially fulfilled orders. Excludes canceled orders by default.

**Parameters**:

- `start`, `end` (optional): Date range in ISO format
- `include_partial` (optional): Include partially fulfilled orders in count (default: true)

### 4. `all_unfulfilled_orders_count`

Count ALL orders (paid and unpaid) that are not fulfilled or delivered.

**Description**: Count ALL orders (paid and unpaid) that are not fulfilled or delivered. This is useful when you want to see all pending fulfillments regardless of payment status.

**Parameters**:

- `start`, `end` (optional): Date range in ISO format
- `include_partial` (optional): Include partially fulfilled orders in count (default: true)

### 5. `unpaid_orders_count`

Count orders that are not paid.

**Description**: Count orders with payment_status 'not_paid'. Use this when asked about unpaid orders or "not paid" orders.

**Parameters**:

- `start`, `end` (optional): Date range in ISO format

**Example Usage**:

```javascript
// Count ALL unfulfilled orders (including unpaid)
{
  "fulfillment_status": "not_fulfilled"  // Now accepts strings!
}

// Count unfulfilled paid orders (including partial)
{
  "start": "2024-12-01T00:00:00Z",
  "end": "2025-01-01T00:00:00Z",
  "include_partial": true
}

// Count only completely unfulfilled orders
{
  "include_partial": false
}
```

## Common Order Status Values

### Payment Status (Auto-Normalized per Medusa API)

- `not_paid`: Payment is not paid (matches "Not paid", "not_paid")
- `awaiting`: Payment is awaiting capturing (matches "awaiting")
- `captured`: Payment has been captured successfully (matches "Captured")
- `completed`: Payment is completed (matches "Completed")
- `partially_refunded`: Some payment amount is refunded
- `refunded`: Payment amount is refunded
- `failed`: Payment failed (matches "Failed")
- `canceled`: Payment was canceled (matches "Canceled", "Cancelled")
- `requires_action`: Payment requires additional action

### Fulfillment Status (Auto-Normalized)

- `not_fulfilled`: No items have been fulfilled (matches "Not fulfilled", "not_fulfilled")
- `partially_fulfilled`: Some items have been fulfilled (matches "Partially fulfilled", "partially_fulfilled")
- `fulfilled`: All items have been fulfilled (matches "Fulfilled")
- `delivered`: Order has been delivered (matches "Delivered")
- `canceled`: Fulfillment was canceled (matches "Canceled", "Cancelled")

**Note**: The system automatically normalizes different status formats from the Medusa API, so you can use the standard values above regardless of how they appear in the admin interface.

## 🧠 **SEMANTIC MATCHING GUIDANCE**

When using the MCP tools with natural language queries, consider these related status combinations:

### For Refund Queries

- **"refunded orders"** → Use `["refunded", "partially_refunded"]`
- **"orders with refunds"** → Use `["refunded", "partially_refunded"]`

### For Failed Payment Queries  

- **"failed payments"** → Use `["not_paid", "canceled", "requires_action"]` (these are the closest to "failed" in Medusa)
- **"problematic payments"** → Use `["not_paid", "canceled", "requires_action"]`
- **"unpaid orders"** → Use `["not_paid"]`

### For Paid Order Queries

- **"paid orders"** → Use `["captured"]` (captured is the main "paid" status in Medusa)
- **"successful payments"** → Use `["captured"]`### For Fulfillment Queries

- **"unfulfilled orders"** → Use `["not_fulfilled", "partially_fulfilled"]` (if you want to include partial)
- **"shipped orders"** → Use `["shipped", "partially_shipped"]` (if you want to include partial)

**Examples**: 
- "How many orders have been refunded?" → `{"payment_status": ["refunded", "partially_refunded"]}`
- "Show me failed payments" → `{"payment_status": ["not_paid", "canceled", "requires_action"]}`
- "Find paid orders" → `{"payment_status": ["captured"]}`

## Use Cases

### 1. Find Orders with Payment Issues

```javascript
// Use orders_status_analysis or failed_payments_count
{
  "payment_status": ["not_paid", "canceled", "requires_action"],
  "start": "2024-12-01T00:00:00Z",
  "end": "2025-01-01T00:00:00Z"
}
```

### 2. Find Orders That Need Fulfillment

```javascript
// Use unfulfilled_orders_count or orders_status_analysis
{
  "payment_status": ["captured", "completed"],
  "fulfillment_status": ["not_fulfilled", "partially_fulfilled"]
}
```

### 3. Monitor Order Processing Pipeline

```javascript
// Get complete status breakdown
{
  "start": "2024-12-01T00:00:00Z",
  "end": "2025-01-01T00:00:00Z",
  "group_by_status": true
}
```

### 4. Find Specific Problem Categories

```javascript
// Orders paid but not shipped for over a week
{
  "start": "2024-12-20T00:00:00Z",
  "end": "2024-12-27T00:00:00Z",
  "payment_status": ["captured", "completed"],
  "fulfillment_status": ["not_fulfilled"]
}
```

## Implementation Notes

The tools work by:

1. Fetching orders in the specified date range (or all orders if no range specified)
2. Filtering orders based on the status criteria
3. Optionally excluding canceled orders
4. Grouping results by status combinations
5. Returning counts and breakdowns

The implementation handles missing or null status values gracefully and provides detailed breakdowns when requested.
