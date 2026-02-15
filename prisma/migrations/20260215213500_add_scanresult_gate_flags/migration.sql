-- Add persisted gate flags to ScanResult for scan cache fallback fidelity
ALTER TABLE "ScanResult" ADD COLUMN "passesRiskGates" BOOLEAN;
ALTER TABLE "ScanResult" ADD COLUMN "passesAntiChase" BOOLEAN;
