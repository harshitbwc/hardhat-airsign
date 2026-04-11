import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";
import { RemoteSigner } from "../src/RemoteSigner";
import { SigningTransport, SigningRequest, SigningResponse } from "../src/types";

// ─── Helpers ──────────────────────────────────────────────────────

function createMockTransport(
  respondWith?: Partial<SigningResponse>
): SigningTransport {
  return {
    sendSigningRequest: vi.fn(
      (request: SigningRequest, callback: (r: SigningResponse) => void) => {
        callback({
          id: request.id,
          success: true,
          result: "0xmockhash",
          ...respondWith,
        });
      }
    ),
  };
}

function createMockProvider() {
  return {
    getNetwork: vi.fn().mockResolvedValue({ chainId: 11155111, name: "sepolia" }),
    waitForTransaction: vi.fn().mockResolvedValue({ blockNumber: 42 }),
    getTransaction: vi.fn().mockResolvedValue({
      hash: "0xmockhash",
      blockNumber: 42,
      from: "0xSigner",
      to: "0xRecipient",
    }),
  } as unknown as ethers.providers.Provider;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("RemoteSigner", () => {
  let signer: RemoteSigner;
  let transport: SigningTransport;
  let provider: ethers.providers.Provider;

  beforeEach(() => {
    transport = createMockTransport();
    provider = createMockProvider();
    signer = new RemoteSigner(transport, provider, "0xTestAddress");
  });

  describe("getAddress", () => {
    it("returns the address passed in the constructor", async () => {
      expect(await signer.getAddress()).toBe("0xTestAddress");
    });
  });

  describe("updateAddress", () => {
    it("changes the address returned by getAddress", async () => {
      signer.updateAddress("0xNewAddress");
      expect(await signer.getAddress()).toBe("0xNewAddress");
    });
  });

  describe("signMessage", () => {
    it("sends a signMessage request through the transport", async () => {
      const result = await signer.signMessage("hello");
      expect(result).toBe("0xmockhash");
      expect(transport.sendSigningRequest).toHaveBeenCalledOnce();
      const call = (transport.sendSigningRequest as any).mock.calls[0];
      expect(call[0].type).toBe("signMessage");
      expect(call[0].message).toBe("hello");
    });

    it("converts Bytes message to hex string", async () => {
      const bytes = ethers.utils.toUtf8Bytes("hello");
      await signer.signMessage(bytes);
      const call = (transport.sendSigningRequest as any).mock.calls[0];
      expect(call[0].message).toBe(ethers.utils.hexlify(bytes));
    });

    it("throws on failed signing response", async () => {
      transport = createMockTransport({ success: false, error: "rejected" });
      signer = new RemoteSigner(transport, provider, "0xTestAddress");
      await expect(signer.signMessage("hello")).rejects.toThrow(
        "Remote signing failed: rejected"
      );
    });
  });

  describe("signTransaction", () => {
    it("throws because browser wallets don't support it", async () => {
      await expect(
        signer.signTransaction({ to: "0x0" })
      ).rejects.toThrow("signTransaction is not supported");
    });
  });

  describe("sendTransaction", () => {
    it("sends a sendTransaction request and waits for on-chain confirmation", async () => {
      const tx = { to: "0xRecipient", value: ethers.utils.parseEther("1.0") };
      const result = await signer.sendTransaction(tx);

      expect(transport.sendSigningRequest).toHaveBeenCalledOnce();
      const call = (transport.sendSigningRequest as any).mock.calls[0];
      expect(call[0].type).toBe("sendTransaction");
      expect(call[0].transaction.to).toBe("0xRecipient");
      expect(call[0].transaction.from).toBe("0xTestAddress");

      // Provider methods called for confirmation
      expect(provider.waitForTransaction).toHaveBeenCalledWith("0xmockhash", 1, 60_000);
      expect(provider.getTransaction).toHaveBeenCalledWith("0xmockhash");
    });

    it("throws on failed transaction response", async () => {
      transport = createMockTransport({ success: false, error: "user rejected" });
      signer = new RemoteSigner(transport, provider, "0xTestAddress");
      await expect(
        signer.sendTransaction({ to: "0xRecipient" })
      ).rejects.toThrow("Remote transaction failed: user rejected");
    });

    it("includes value as hex string", async () => {
      await signer.sendTransaction({
        to: "0xRecipient",
        value: ethers.utils.parseEther("0.5"),
      });
      const call = (transport.sendSigningRequest as any).mock.calls[0];
      expect(call[0].transaction.value).toBe(
        ethers.utils.parseEther("0.5").toHexString()
      );
    });
  });

  describe("connect", () => {
    it("returns a new RemoteSigner with the new provider", () => {
      const newProvider = createMockProvider();
      const newSigner = signer.connect(newProvider);
      expect(newSigner).toBeInstanceOf(RemoteSigner);
      expect(newSigner).not.toBe(signer);
      expect(newSigner.provider).toBe(newProvider);
    });
  });

  describe("timeout", () => {
    it("rejects if transport does not respond within timeout", async () => {
      const slowTransport: SigningTransport = {
        sendSigningRequest: vi.fn(), // never calls callback
      };
      const fastSigner = new RemoteSigner(
        slowTransport,
        provider,
        "0xTestAddress",
        100 // 100ms timeout
      );
      await expect(fastSigner.signMessage("hello")).rejects.toThrow(
        "Signing request timed out"
      );
    });
  });
});
