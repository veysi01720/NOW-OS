import { describe, expect, it } from "vitest";
import { deriveApprovedApps } from "../config/approvedApps.js";

const source = (status: "loaded" | "invalid" = "loaded") => ({
  source_status: status,
  app_facts: [
    {
      app: "Layla",
      android_name: "Layla",
      ios_name: "NIVI",
      invite_code: null,
      agency_bind_code: null,
      agency_code: null,
      official_url: null,
      status: "owner_approved",
      aliases: [],
      capabilities: { text_only: true, video_required: false },
    },
    {
      app: "TanChat",
      android_name: "TanChat",
      ios_name: "TanStar",
      invite_code: "X3XREZ",
      agency_bind_code: null,
      agency_code: null,
      official_url: null,
      status: "owner_approved",
      aliases: ["TanStar"],
      capabilities: { text_only: false, video_required: true },
    },
    {
      app: "PendingApp",
      android_name: "PendingApp",
      ios_name: "PendingApp",
      invite_code: null,
      agency_bind_code: null,
      agency_code: null,
      official_url: null,
      status: "pending_review",
      aliases: [],
      capabilities: { text_only: false, video_required: null },
    },
  ],
});

describe("structured app vocabulary", () => {
  it("automatically exposes a newly owner-approved app without env changes", () => {
    expect(deriveApprovedApps(source())).toEqual(["Layla", "TanChat"]);
  });

  it("uses an override only as a narrowing intersection", () => {
    expect(deriveApprovedApps(source(), ["TanChat", "UnknownApp"])).toEqual(["TanChat"]);
  });

  it("fails closed when structured facts are invalid", () => {
    expect(deriveApprovedApps(source("invalid"), ["Layla", "TanChat"])).toEqual([]);
  });
});
