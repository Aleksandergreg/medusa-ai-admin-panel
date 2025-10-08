import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export default async function listColumns({ container }: ExecArgs) {
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const rows = await db
    .select("column_name", "data_type")
    .from("information_schema.columns")
    .where({ table_name: "order", table_schema: "public" })
    .orderBy("column_name");

  console.log(rows);
}
