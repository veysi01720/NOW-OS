import type { EnvConfig } from "./env.js";

export interface EnvSafeSummary {
  dashboard_owner_token_configured: boolean;
  dashboard_manager_token_configured: boolean;
  openai_configured: boolean;
  evolution_configured: boolean;
  storage_dir_configured: boolean;
  auto_send_default_off: boolean;
}

/**
 * Validates the presence of required production environment variables.
 * Fails fast and logs a sanitized error if any are missing.
 */
export function validateProductionEnv(env: EnvConfig, isProduction: boolean = process.env.NODE_ENV === "production"): void {
  if (!isProduction) return;

  const missing: string[] = [];

  if (!env.dashboardOwnerToken || env.dashboardOwnerToken.trim() === "") missing.push("DASHBOARD_OWNER_TOKEN");
  if (!env.dashboardManagerToken || env.dashboardManagerToken.trim() === "") missing.push("DASHBOARD_MANAGER_TOKEN");
  if (!env.openaiApiKey || env.openaiApiKey.trim() === "") missing.push("OPENAI_API_KEY");
  if (!env.openaiAssistantId || env.openaiAssistantId.trim() === "") missing.push("OPENAI_ASSISTANT_ID");
  if (!env.evolutionApiBaseUrl || env.evolutionApiBaseUrl.trim() === "") missing.push("EVOLUTION_API_BASE_URL");
  if (!env.evolutionApiKey || env.evolutionApiKey.trim() === "") missing.push("EVOLUTION_API_KEY");
  if (!env.evolutionInstance || env.evolutionInstance.trim() === "") missing.push("EVOLUTION_INSTANCE");

  if (missing.length > 0) {
    console.error(`[FATAL] Production startup aborted. Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}

/**
 * Returns a sanitized boolean summary of the environment status
 * without leaking actual tokens or keys.
 */
export function getSafeConfigSummary(env: EnvConfig): EnvSafeSummary {
  return {
    dashboard_owner_token_configured: Boolean(env.dashboardOwnerToken && env.dashboardOwnerToken.trim() !== ""),
    dashboard_manager_token_configured: Boolean(env.dashboardManagerToken && env.dashboardManagerToken.trim() !== ""),
    openai_configured: Boolean(env.openaiApiKey && env.openaiAssistantId),
    evolution_configured: Boolean(env.evolutionApiBaseUrl && env.evolutionApiKey && env.evolutionInstance),
    storage_dir_configured: true, // We always resolve "data" locally for now
    auto_send_default_off: true // Hardcoded constraint to ensure auto-send defaults off
  };
}
