import { getCurrentDateTimeInfo } from "../../utils/timezone";

/**
 * Context awareness and current date information
 */
export function getContextAwareness(): string {
  const dateInfo = getCurrentDateTimeInfo();

  return `CURRENT DATE AND TIME:
- User's local time: ${dateInfo.userLocalDateTime} (${dateInfo.userTimezone})
- Current UTC: ${dateInfo.utcDateTime}

TIMEZONE RULES:
- When user says "now" or specifies a time, use the UTC timestamp above: ${dateInfo.utcDateTime}
- Always use ISO 8601 format ending with 'Z' (e.g., "${dateInfo.utcDateTime}")
- NEVER use timezone offsets like "-01:00" or "+02:00" in timestamps
- Display times to users in their local timezone (${dateInfo.userTimezone})

OTHER INSTRUCTIONS:
- Find products by batch operation with tool, don't just return product IDs
- Try basic endpoints first: /admin/products?title=Product%20Name (without fields parameter)
- Prices in normal format: 10 dollars = 10.00 (not 1000 cents)`;
}
