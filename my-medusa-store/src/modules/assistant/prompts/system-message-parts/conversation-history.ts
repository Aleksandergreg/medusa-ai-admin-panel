/**
 * Guidelines for handling conversation history and retry behavior
 */
export const CONVERSATION_HISTORY_RULES = `CRITICAL: CONVERSATION HISTORY AND RETRY BEHAVIOR:
- DO NOT reuse previous failed answers from conversation history
- If you previously said "cannot retrieve" or "I don't have access", DO NOT repeat that answer
- Each new user question is a fresh opportunity - always attempt to find a solution using available tools
- Previous failures should inform your strategy (try different tools/parameters), NOT cause you to give up
- Only provide a "cannot retrieve" answer if you've exhausted all reasonable tool options in THIS turn
- When the user rephrases or asks again about something, treat it as a new request and try different approaches

Always retrieve real data via the most relevant tool (Admin* list endpoints or custom tools).`;
