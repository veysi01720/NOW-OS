import { Client } from "pg";
import type { Logger } from "./logger.js";

export function createEvolutionSessionIntegrityCheck(input: {
  databaseUrl?: string;
  instanceName: string;
  logger: Logger;
}): (() => Promise<"nonempty" | "empty" | "unavailable" | "error">) | undefined {
  if (!input.databaseUrl) return undefined;
  return async () => {
    const client = new Client({ connectionString: input.databaseUrl, connectionTimeoutMillis: 5_000 });
    try {
      await client.connect();
      const result = await client.query<{ session_count: number }>(
        `SELECT COUNT(*)::int AS session_count
           FROM "Session" s
           JOIN "Instance" i ON i.id = s."instanceId"
          WHERE i.name = $1`,
        [input.instanceName],
      );
      const count = Number(result.rows[0]?.session_count ?? 0);
      input.logger.info({ event_type: "EVOLUTION_SESSION_INTEGRITY_CHECKED", instance: input.instanceName, result: count > 0 ? "nonempty" : "empty" });
      return count > 0 ? "nonempty" : "empty";
    } catch (error) {
      input.logger.warn({ event_type: "EVOLUTION_SESSION_INTEGRITY_CHECK_FAILED", instance: input.instanceName, error: "session_table_query_failed" });
      return "error";
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
