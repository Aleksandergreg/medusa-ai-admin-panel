/**
 * Error recovery strategies and troubleshooting guidance
 */
export const ERROR_RECOVERY_STRATEGIES = `ERROR RECOVERY STRATEGIES:
- If product search by exact title fails, try partial keyword search
- Search by the exact keyword coming from the user prompt first, before trying anything else
- If variant creation fails with "options" error, ensure options is an object not array
- If variant creation fails with "prices" error, include prices array in every variant
- If JSON parsing fails, ensure your response is valid JSON without extra text`;
