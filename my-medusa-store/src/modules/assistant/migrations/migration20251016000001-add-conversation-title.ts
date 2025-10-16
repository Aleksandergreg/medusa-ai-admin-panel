import { Migration } from "@mikro-orm/migrations";

export class Migration20251016000001 extends Migration {
  override async up(): Promise<void> {
    const knex = this.getKnex();

    // Add title column to conversation_session table
    await knex.schema.alterTable("conversation_session", (table) => {
      table.text("title").nullable();
    });

    // Set default titles for existing sessions based on first message
    const sessions = await knex("conversation_session").select("id");

    for (const session of sessions) {
      const firstMessage = await knex("conversation_message")
        .where({ session_id: session.id })
        .orderBy("created_at", "asc")
        .first();

      if (firstMessage) {
        const title =
          firstMessage.question.length > 50
            ? firstMessage.question.substring(0, 50) + "..."
            : firstMessage.question;
        await knex("conversation_session")
          .where({ id: session.id })
          .update({ title });
      } else {
        await knex("conversation_session")
          .where({ id: session.id })
          .update({ title: "New Conversation" });
      }
    }
  }

  override async down(): Promise<void> {
    const knex = this.getKnex();
    await knex.schema.alterTable("conversation_session", (table) => {
      table.dropColumn("title");
    });
  }
}
