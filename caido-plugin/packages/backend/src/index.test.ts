import { describe, it, expect } from "vitest";
import { validateEndpoint } from "./index";

// ── SSRF Hardening Test Suite ───────────────────────────────
// Covers all 8 bypass vectors from the security spec plus
// edge cases (case sensitivity, malformed input, userinfo, etc.).
// OWASP A10:2021 — Server-Side Request Forgery (SSRF).

describe("validateEndpoint (Ollama) — SSRF rejection vectors", () => {
  it("rejects IPv6 localhost (::1)", () => {
    expect(validateEndpoint("http://[::1]:11434", "ollama")).toBe(false);
  });

  it("rejects IPv6 localhost long form (0:0:0:0:0:0:0:1)", () => {
    expect(validateEndpoint("http://[0:0:0:0:0:0:0:1]:11434", "ollama")).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 (::ffff:127.0.0.1)", () => {
    expect(validateEndpoint("http://[::ffff:127.0.0.1]:11434", "ollama")).toBe(false);
  });

  it("rejects decimal IP encoding (2130706433)", () => {
    // Node normalizes this to "127.0.0.1"; we must reject the raw form.
    expect(validateEndpoint("http://2130706433:11434", "ollama")).toBe(false);
  });

  it("rejects hex IP encoding (0x7f000001)", () => {
    expect(validateEndpoint("http://0x7f000001:11434", "ollama")).toBe(false);
  });

  it("rejects octal IP encoding (0177.0.0.1)", () => {
    expect(validateEndpoint("http://0177.0.0.1:11434", "ollama")).toBe(false);
  });

  it("rejects cloud metadata endpoint (169.254.169.254)", () => {
    expect(validateEndpoint("http://169.254.169.254:11434", "ollama")).toBe(false);
  });

  it("rejects arbitrary public IP (8.8.8.8)", () => {
    expect(validateEndpoint("http://8.8.8.8:11434", "ollama")).toBe(false);
  });

  it("rejects arbitrary hostname (attacker.com)", () => {
    expect(validateEndpoint("http://attacker.com:11434", "ollama")).toBe(false);
  });

  it("rejects link-local IPv6 (fe80::1)", () => {
    expect(validateEndpoint("http://[fe80::1]:11434", "ollama")).toBe(false);
  });

  it("rejects unique-local IPv6 (fc00::1)", () => {
    expect(validateEndpoint("http://[fc00::1]:11434", "ollama")).toBe(false);
  });

  it("rejects userinfo confusion (http://evil@127.0.0.1)", () => {
    expect(validateEndpoint("http://evil@127.0.0.1:11434", "ollama")).toBe(false);
  });

  it("rejects non-http(s) protocol (file://)", () => {
    expect(validateEndpoint("file:///etc/passwd", "ollama")).toBe(false);
  });

  it("rejects non-http(s) protocol (gopher://)", () => {
    expect(validateEndpoint("gopher://127.0.0.1:11434", "ollama")).toBe(false);
  });

  it("rejects malformed URL", () => {
    expect(validateEndpoint("not a url", "ollama")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateEndpoint("", "ollama")).toBe(false);
  });

  it("rejects subdomain that ends in 'localhost' (evil.localhost.attacker.com)", () => {
    expect(validateEndpoint("http://evil.localhost.attacker.com:11434", "ollama")).toBe(false);
  });

  it("rejects octets out of range (999.0.0.1)", () => {
    expect(validateEndpoint("http://999.0.0.1:11434", "ollama")).toBe(false);
  });

  it("rejects public IP just outside RFC1918 (172.32.0.1)", () => {
    // 172.16.0.0/12 ends at 172.31.255.255 — 172.32.x is public.
    expect(validateEndpoint("http://172.32.0.1:11434", "ollama")).toBe(false);
  });

  it("rejects 11.0.0.1 (just outside 10.0.0.0/8)", () => {
    expect(validateEndpoint("http://11.0.0.1:11434", "ollama")).toBe(false);
  });
});

describe("validateEndpoint (Ollama) — allowlist acceptance", () => {
  it("accepts localhost", () => {
    expect(validateEndpoint("http://localhost:11434", "ollama")).toBe(true);
  });

  it("accepts 127.0.0.1", () => {
    expect(validateEndpoint("http://127.0.0.1:11434", "ollama")).toBe(true);
  });

  it("accepts host.docker.internal", () => {
    expect(validateEndpoint("http://host.docker.internal:11434", "ollama")).toBe(true);
  });

  it("accepts RFC1918 192.168.x", () => {
    expect(validateEndpoint("http://192.168.1.100:11434", "ollama")).toBe(true);
  });

  it("accepts RFC1918 10.x", () => {
    expect(validateEndpoint("http://10.0.0.5:11434", "ollama")).toBe(true);
  });

  it("accepts RFC1918 172.16-31.x boundary low", () => {
    expect(validateEndpoint("http://172.16.0.1:11434", "ollama")).toBe(true);
  });

  it("accepts RFC1918 172.16-31.x boundary high", () => {
    expect(validateEndpoint("http://172.31.255.254:11434", "ollama")).toBe(true);
  });

  it("accepts case-insensitive LOCALHOST", () => {
    expect(validateEndpoint("http://LOCALHOST:11434", "ollama")).toBe(true);
  });

  it("accepts https:// to localhost", () => {
    expect(validateEndpoint("https://localhost:11434", "ollama")).toBe(true);
  });

  it("accepts localhost without explicit port", () => {
    expect(validateEndpoint("http://localhost", "ollama")).toBe(true);
  });

  it("accepts trailing path on localhost", () => {
    expect(validateEndpoint("http://localhost:11434/api", "ollama")).toBe(true);
  });
});

describe("validateEndpoint (Claude) — regression check", () => {
  it("accepts https://api.anthropic.com", () => {
    expect(validateEndpoint("https://api.anthropic.com/v1/messages", "claude")).toBe(true);
  });

  it("rejects http (must be TLS) Claude endpoint", () => {
    expect(validateEndpoint("http://api.anthropic.com/v1/messages", "claude")).toBe(false);
  });

  it("rejects non-anthropic.com Claude endpoint", () => {
    expect(validateEndpoint("https://attacker.com/v1/messages", "claude")).toBe(false);
  });

  it("rejects malformed Claude URL", () => {
    expect(validateEndpoint("not a url", "claude")).toBe(false);
  });
});
