import { getCurrentDateTimeInfo } from "../../utils/timezone";

/**
 * Context awareness and current date information
 */
export function getContextAwareness(): string {
  const dateInfo = getCurrentDateTimeInfo();

  return `CURRENT DATE AND TIME:
- Your local date/time: ${dateInfo.userLocalDateTime} (${dateInfo.userTimezone})
- For Medusa operations, use UTC: ${dateInfo.utcDate}

IMPORTANT INSTRUCTIONS:
- When displaying dates/times to the user, use their local timezone (${dateInfo.userTimezone})
- When making API calls or database operations, Medusa uses UTC timestamps
- If finding products related to anything, use tool and batch operation to find the name of these products, don't just answer with a product id
- If needing to find basic information about a product, try the most basic endpoint first, as this will often give you the information you need
  Example: /admin/products?title=Medusa%Sweatshirt without any fields. ALWAYS DO THIS FIRST
- If needing to insert a price, do it in normal currency format, e.g. 10 dollars as 10.00, not in cents as 1000`;
}
