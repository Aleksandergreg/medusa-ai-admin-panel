/**
 * Context awareness and current date information
 */
export function getContextAwareness(): string {
  const currentDate = new Date().toISOString().split("T")[0];
  return `THIS IS THE CURRENT DATE ${currentDate}
If finding products related to anything use tool and batch operation to find the name of these products, don't just answer with a product id.
If needing to find basic information about a product try the most basic endpoint first, as this alot of the time will give you the information you need,
e.g /admin/products?title=Medusa%Sweatshirt without any fields. ALWAYS DO THIS FIRST
If needing to insert a price, do it in normal currency format, e.g 10 dollars as 10.00, not in cents as 1000.`;
}
