import { describe, expect, it } from "vitest";
import { handleMail } from "../../lib/handlers/mail.js";

function createMockRunCLI() {
  const calls = [];
  const runCLI = async (cli, args) => {
    calls.push({ cli, args: [...args] });
    return { success: true, messages: [], count: 0 };
  };
  return { runCLI, calls };
}

describe("mail handler --since passthrough", () => {
  it("does not pass --since to messages (lazy iteration, no date predicate)", async () => {
    const { runCLI, calls } = createMockRunCLI();
    await handleMail({ action: "messages", since: "2026-05-01" }, runCLI);
    expect(calls[0].args).not.toContain("--since");
  });

  it("passes --since to search when provided", async () => {
    const { runCLI, calls } = createMockRunCLI();
    await handleMail({ action: "search", query: "test", since: "2026-04-30" }, runCLI);
    expect(calls[0].args).toContain("--since");
    const idx = calls[0].args.indexOf("--since");
    expect(calls[0].args[idx + 1]).toBe("2026-04-30");
  });

  it("omits --since from search when not provided", async () => {
    const { runCLI, calls } = createMockRunCLI();
    await handleMail({ action: "search", query: "test" }, runCLI);
    expect(calls[0].args).not.toContain("--since");
  });
});

describe("mail schema", () => {
  it("includes since property in mail tool schema", async () => {
    const { tools } = await import("../../lib/schemas.js");
    const mailTool = tools.find(t => t.name === "mail");
    expect(mailTool).toBeDefined();
    expect(mailTool.inputSchema.properties.since).toBeDefined();
    expect(mailTool.inputSchema.properties.since.type).toBe("string");
  });
});
