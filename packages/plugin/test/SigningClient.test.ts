import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import { SigningClient } from "../src/SigningClient";

// ─── Helpers ──────────────────────────────────────────────────────

function createTestServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ─── Tests ────────────────────────────────────────────────────────

describe("SigningClient", () => {
  let server: http.Server;
  let client: SigningClient;

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  describe("isServerRunning", () => {
    it("returns true when server responds with status ok", async () => {
      const s = await createTestServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
      server = s.server;
      client = new SigningClient(s.port, "127.0.0.1");

      expect(await client.isServerRunning()).toBe(true);
    });

    it("returns false when server is not running", async () => {
      client = new SigningClient(19999, "127.0.0.1");
      expect(await client.isServerRunning()).toBe(false);
    });
  });

  describe("getWalletAddress", () => {
    it("returns the address from /api/wallet", async () => {
      const s = await createTestServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ address: "0xAbCdEf1234567890" }));
      });
      server = s.server;
      client = new SigningClient(s.port, "127.0.0.1");

      expect(await client.getWalletAddress()).toBe("0xAbCdEf1234567890");
    });

    it("returns null when no address is set", async () => {
      const s = await createTestServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ address: null }));
      });
      server = s.server;
      client = new SigningClient(s.port, "127.0.0.1");

      expect(await client.getWalletAddress()).toBeNull();
    });
  });

  describe("sendSigningRequest", () => {
    it("sends POST to /api/sign and returns the response via callback", async () => {
      const s = await createTestServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const parsed = JSON.parse(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              id: parsed.id,
              success: true,
              result: "0xtxhash",
            })
          );
        });
      });
      server = s.server;
      client = new SigningClient(s.port, "127.0.0.1");

      const response = await new Promise<any>((resolve) => {
        client.sendSigningRequest(
          {
            id: "test-1",
            type: "sendTransaction",
            transaction: { to: "0xRecipient", from: "0xSender" },
          },
          resolve
        );
      });

      expect(response.success).toBe(true);
      expect(response.result).toBe("0xtxhash");
      expect(response.id).toBe("test-1");
    });

    it("returns error response when server returns invalid JSON", async () => {
      const s = await createTestServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<!DOCTYPE html><html><body>Not JSON</body></html>");
      });
      server = s.server;
      client = new SigningClient(s.port, "127.0.0.1");

      const response = await new Promise<any>((resolve) => {
        client.sendSigningRequest(
          { id: "test-2", type: "signMessage", message: "hello" },
          resolve
        );
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain("Invalid JSON");
    });
  });

  describe("waitForWallet", () => {
    it("resolves immediately if wallet is already connected", async () => {
      const s = await createTestServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ address: "0xWallet" }));
      });
      server = s.server;
      client = new SigningClient(s.port, "127.0.0.1");

      const address = await client.waitForWallet(5000, 100);
      expect(address).toBe("0xWallet");
    });

    it("polls until wallet connects", async () => {
      let callCount = 0;
      const s = await createTestServer((req, res) => {
        callCount++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            address: callCount >= 3 ? "0xDelayedWallet" : null,
          })
        );
      });
      server = s.server;
      client = new SigningClient(s.port, "127.0.0.1");

      const address = await client.waitForWallet(5000, 50);
      expect(address).toBe("0xDelayedWallet");
      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it("throws on timeout", async () => {
      const s = await createTestServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ address: null }));
      });
      server = s.server;
      client = new SigningClient(s.port, "127.0.0.1");

      await expect(client.waitForWallet(200, 50)).rejects.toThrow(
        "Timed out waiting for wallet connection"
      );
    });
  });
});
