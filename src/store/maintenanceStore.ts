import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

export interface MaintenanceStore {
    isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
}

export class PersistentMaintenanceStore implements MaintenanceStore {
    private enabled = false;
    private filePath: string;

    constructor(filePath = resolve("data", "maintenance.json")) {
        this.filePath = filePath;
        this.load();
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.persist();
    }

    private load(): void {
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
            this.enabled = parsed.enabled ?? false;
        } catch (error) {
            this.enabled = false;
        }
    }

    private persist(): void {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            writeFileSync(this.filePath, JSON.stringify({ enabled: this.enabled }, null, 2), "utf8");
        } catch (e) {
            // Log if needed, but not critical enough to crash
        }
    }
}
