import { Migration } from "@mikro-orm/migrations";

const TABLE = "agent_nps_response";

export class Migration20251001120000 extends Migration {
  override async up(): Promise<void> {
    const knex = this.getKnex();

    console.info(
      JSON.stringify({
        event: "migration.start",
        table: TABLE,
        direction: "up",
      })
    );

    const hasTable = await knex.schema.hasTable(TABLE);
    if (!hasTable) {
      await knex.schema.createTable(TABLE, (table) => {
        table.text("id").primary();
        table
          .timestamp("created_at", { useTz: true })
          .notNullable()
          .defaultTo(knex.fn.now());
        table.text("agent_id").notNullable();
        table.text("agent_version").nullable();
        table.text("session_id").notNullable();
        table.text("user_id").nullable();
        table
          .specificType("score", "smallint")
          .notNullable()
          .checkBetween([0, 10]);
        table.text("task_label").nullable();
        table.text("operation_id").nullable();
        table
          .specificType("tools_used", "jsonb")
          .notNullable()
          .defaultTo(knex.raw("'[]'::jsonb"));
        table.integer("duration_ms").nullable();
        table.boolean("error_flag").notNullable().defaultTo(false);
        table.text("error_summary").nullable();
        table.boolean("user_permission").notNullable().defaultTo(false);
        table.specificType("client_metadata", "jsonb").nullable();
      });

      await knex.schema.alterTable(TABLE, (table) => {
        table.index(["created_at"], `${TABLE}_created_at_idx`);
        table.index(["task_label"], `${TABLE}_task_label_idx`);
        table.index(["operation_id"], `${TABLE}_operation_id_idx`);
      });
    }

    console.info(
      JSON.stringify({
        event: "migration.finish",
        table: TABLE,
        direction: "up",
      })
    );
  }

  override async down(): Promise<void> {
    const knex = this.getKnex();

    console.info(
      JSON.stringify({
        event: "migration.start",
        table: TABLE,
        direction: "down",
      })
    );

    const hasTable = await knex.schema.hasTable(TABLE);
    if (hasTable) {
      await knex.schema.dropTable(TABLE);
    }

    console.info(
      JSON.stringify({
        event: "migration.finish",
        table: TABLE,
        direction: "down",
      })
    );
  }
}
