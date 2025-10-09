import { Migration } from "@mikro-orm/migrations";

export class Migration20251009120000 extends Migration {
  async up(): Promise<void> {
    const knex = this.getKnex();

    // Step 1: Create the new conversation_message table
    await knex.schema.createTable("conversation_message", (table) => {
      table.text("id").primary();
      table.text("session_id").notNullable();
      table.text("question").notNullable();
      table.text("answer").nullable();
      table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
      table.index("session_id", "conversation_message_session_id_index");
    });

    // Step 2: Add temporary id column to conversation_session (will become the new primary key)
    await knex.schema.alterTable("conversation_session", (table) => {
      table.text("id").nullable();
      table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
    });

    // Step 3: Migrate data from history JSONB to conversation_message rows
    // Get all existing sessions
    const sessions = await knex
      .select("actor_id", "history", "updated_at")
      .from("conversation_session");

    for (const session of sessions) {
      // Generate a new session ID
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      // Update the session with its new ID
      await knex("conversation_session")
        .where({ actor_id: session.actor_id })
        .update({ id: sessionId });

      // Parse and migrate history
      if (session.history) {
        let historyArray: Array<{ role: string; content: string }> = [];

        try {
          if (typeof session.history === "string") {
            historyArray = JSON.parse(session.history);
          } else if (Array.isArray(session.history)) {
            historyArray = session.history;
          }
        } catch (error) {
          console.warn(
            `Failed to parse history for actor_id ${session.actor_id}:`,
            error
          );
          continue;
        }

        // Extract question-answer pairs
        let currentQuestion: string | null = null;
        let messageCounter = 0;

        for (const entry of historyArray) {
          if (entry.role === "user") {
            // If we have a pending question without an answer, save it
            if (currentQuestion) {
              const messageId = `msg_${Date.now()}_${messageCounter++}_${Math.random().toString(36).substring(2, 9)}`;
              await knex("conversation_message").insert({
                id: messageId,
                session_id: sessionId,
                question: currentQuestion,
                answer: null,
              });
            }
            currentQuestion = entry.content;
          } else if (entry.role === "assistant" && currentQuestion) {
            // Save the question-answer pair
            const messageId = `msg_${Date.now()}_${messageCounter++}_${Math.random().toString(36).substring(2, 9)}`;
            await knex("conversation_message").insert({
              id: messageId,
              session_id: sessionId,
              question: currentQuestion,
              answer: entry.content,
            });
            currentQuestion = null;
          }
        }

        // If there's a remaining question without an answer
        if (currentQuestion) {
          const messageId = `msg_${Date.now()}_${messageCounter++}_${Math.random().toString(36).substring(2, 9)}`;
          await knex("conversation_message").insert({
            id: messageId,
            session_id: sessionId,
            question: currentQuestion,
            answer: null,
          });
        }
      }
    }

    // Step 4: Make id NOT NULL after it's populated
    await knex.schema.alterTable("conversation_session", (table) => {
      table.text("id").notNullable().alter();
    });

    // Step 5: Drop old primary key and set new one
    await knex.schema.raw(
      'ALTER TABLE "conversation_session" DROP CONSTRAINT "conversation_session_pkey";'
    );

    await knex.schema.alterTable("conversation_session", (table) => {
      table.primary(["id"]);
    });

    // Step 6: Add foreign key constraint
    await knex.schema.alterTable("conversation_message", (table) => {
      table
        .foreign("session_id")
        .references("id")
        .inTable("conversation_session")
        .onDelete("CASCADE");
    });

    // Step 7: Drop the old history column
    await knex.schema.alterTable("conversation_session", (table) => {
      table.dropColumn("history");
    });

    // Step 8: Create index on actor_id for lookups
    await knex.schema.alterTable("conversation_session", (table) => {
      table.index("actor_id", "conversation_session_actor_id_index");
    });
  }

  async down(): Promise<void> {
    const knex = this.getKnex();

    // Step 1: Add back the history column
    await knex.schema.alterTable("conversation_session", (table) => {
      table.jsonb("history").nullable();
    });

    // Step 2: Rebuild history from conversation_message
    const sessions = await knex.select("id", "actor_id").from("conversation_session");

    for (const session of sessions) {
      const messages = await knex
        .select("question", "answer", "created_at")
        .from("conversation_message")
        .where({ session_id: session.id })
        .orderBy("created_at", "asc");

      const history: Array<{ role: string; content: string }> = [];

      for (const message of messages) {
        history.push({ role: "user", content: message.question });
        if (message.answer) {
          history.push({ role: "assistant", content: message.answer });
        }
      }

      await knex("conversation_session")
        .where({ id: session.id })
        .update({ history: JSON.stringify(history) });
    }

    // Step 3: Drop foreign key and conversation_message table
    await knex.schema.dropTable("conversation_message");

    // Step 4: Restore actor_id as primary key
    await knex.schema.raw(
      'ALTER TABLE "conversation_session" DROP CONSTRAINT "conversation_session_pkey";'
    );

    await knex.schema.alterTable("conversation_session", (table) => {
      table.primary(["actor_id"]);
    });

    // Step 5: Drop new columns
    await knex.schema.alterTable("conversation_session", (table) => {
      table.dropIndex("actor_id", "conversation_session_actor_id_index");
      table.dropColumn("id");
      table.dropColumn("created_at");
    });
  }
}
