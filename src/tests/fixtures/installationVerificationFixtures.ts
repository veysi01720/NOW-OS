// Synthetic bytes only; these fixtures never represent a real candidate image.
export const clearInstallationScreenshot = Buffer.from(
  "SYNTHETIC_INSTALLATION_SCREEN_CLEAR",
).toString("base64");

export const ambiguousInstallationScreenshot = Buffer.from(
  "SYNTHETIC_INSTALLATION_SCREEN_AMBIGUOUS",
).toString("base64");
