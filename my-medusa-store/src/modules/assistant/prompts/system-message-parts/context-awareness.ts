import { getCurrentDateTimeInfo } from "../../utils/timezone";

/**
 * Context awareness and current date information
 */
export function getContextAwareness(): string {
  const dateInfo = getCurrentDateTimeInfo();

  return `CURRENT DATE AND TIME:
- User's local time: ${dateInfo.userLocalDateTime} (${dateInfo.userTimezone})
- Current UTC: ${dateInfo.utcDateTime}

CRITICAL TIMESTAMP FORMAT RULE:
- When user says "now" or specifies a time, use this EXACT format: ${dateInfo.userLocalDateTime}
- Format MUST be: YYYY-MM-DD HH:MM:SS (e.g., "2025-10-15 10:46:49")
- NO timezone suffix (no 'Z', no '+HH:MM', no '-HH:MM')
- This is the user's LOCAL time in ${dateInfo.userTimezone}

OTHER INSTRUCTIONS:
- Find products by batch operation with tool, don't just return product IDs
- Try basic endpoints first: /admin/products?title=Product%20Name (without fields parameter)
- Prices in normal format: 10 dollars = 10.00 (not 1000 cents)`;
}
