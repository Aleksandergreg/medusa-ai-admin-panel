import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core";

export type AgentNpsToolsUsed = Array<Record<string, unknown>>;
export type AgentNpsClientMetadata = Record<string, unknown>;

@Entity({ tableName: "agent_nps_response" })
export class AgentNpsResponse {
  @PrimaryKey({ type: "string" })
  id!: string;

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  @Index()
  created_at = new Date();

  @Property({ type: "string" })
  agent_id!: string;

  @Property({ type: "string", nullable: true })
  agent_version?: string | null;

  @Property({ type: "string" })
  session_id!: string;

  @Property({ type: "string", nullable: true })
  user_id?: string | null;

  @Property({ type: "number" })
  score!: number;

  @Property({ type: "string", nullable: true })
  @Index()
  task_label?: string | null;

  @Property({ type: "string", nullable: true })
  @Index()
  operation_id?: string | null;

  @Property({ type: "jsonb", defaultRaw: "'[]'::jsonb" })
  tools_used: AgentNpsToolsUsed = [];

  @Property({ type: "number", nullable: true })
  duration_ms?: number | null;

  @Property({ type: "boolean", defaultRaw: "false" })
  error_flag = false;

  @Property({ type: "string", nullable: true })
  error_summary?: string | null;

  @Property({ type: "boolean", defaultRaw: "false" })
  user_permission = false;

  @Property({ type: "jsonb", nullable: true })
  client_metadata?: AgentNpsClientMetadata | null;
}
