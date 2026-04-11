import { describe, it, expect } from "vitest";

/**
 * Smoke test — verifies that the public API surface is exported correctly.
 * This catches accidental removals or typos in the barrel export.
 */
describe("package exports", () => {
  it("exports RemoteSigner class", async () => {
    const mod = await import("../src/RemoteSigner");
    expect(mod.RemoteSigner).toBeDefined();
    expect(typeof mod.RemoteSigner).toBe("function");
  });

  it("exports SigningClient class", async () => {
    const mod = await import("../src/SigningClient");
    expect(mod.SigningClient).toBeDefined();
    expect(typeof mod.SigningClient).toBe("function");
  });

  it("exports SigningServer class", async () => {
    const mod = await import("../src/SigningServer");
    expect(mod.SigningServer).toBeDefined();
    expect(typeof mod.SigningServer).toBe("function");
  });

  it("exports ContractService class", async () => {
    const mod = await import("../src/ContractService");
    expect(mod.ContractService).toBeDefined();
    expect(typeof mod.ContractService).toBe("function");
  });

  it("exports types from types.ts", async () => {
    // Types are compile-time only, but we can verify the module loads
    const mod = await import("../src/types");
    expect(mod).toBeDefined();
  });
});
