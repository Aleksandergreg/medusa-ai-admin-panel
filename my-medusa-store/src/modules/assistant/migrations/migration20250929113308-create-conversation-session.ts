import { Migration } from '@mikro-orm/migrations';

export class Migration20250929113308 extends Migration {

  override async up(): Promise<void> {
    const knex = this.getKnex();

    // Create the conversation_session table with the final schema
    await knex.schema.createTable('conversation_session', (table) => {
      table.text('id').primary();
      table.text('actor_id').notNullable().index();
      table
        .timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
      table
        .timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
    });

    // Create the conversation_message table
    await knex.schema.createTable('conversation_message', (table) => {
      table.text('id').primary();
      table
        .text('session_id')
        .notNullable()
        .references('id')
        .inTable('conversation_session')
        .onDelete('CASCADE')
        .index();
      table.text('question').notNullable();
      table.text('answer').nullable();
      table
        .timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
    });
  }

  override async down(): Promise<void> {
    const knex = this.getKnex();
    await knex.schema.dropTableIfExists('conversation_message');
    await knex.schema.dropTableIfExists('conversation_session');
  }

}
