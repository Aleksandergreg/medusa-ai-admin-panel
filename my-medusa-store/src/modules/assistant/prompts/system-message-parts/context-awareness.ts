/**
 * Context awareness and current date information
 */
export function getContextAwareness(): string {
  const currentDate = new Date().toISOString().split("T")[0];
  return `THIS IS THE CURRENT DATE ${currentDate}
If making any calculations, always show your calculations.
If finding products related to anything use tool and batch operation to find the name of these products, don't just answer with a product id.`;
}
