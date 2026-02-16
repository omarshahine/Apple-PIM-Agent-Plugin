import { describe, expect, it } from "vitest";
import { formatMailGetResult, markdownFromEmailSource } from "../mail-format.js";

const multipartMessage = `From: sender@example.com
To: user@example.com
Subject: HTML test
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain; charset=utf-8

Plain fallback content.

--alt
Content-Type: text/html; charset=utf-8

<html><body><h1>Hello</h1><p>Visit <a href="https://example.com">Example</a>.</p><ul><li>One</li><li>Two</li></ul></body></html>
--alt--
`;

describe("markdownFromEmailSource", () => {
  it("converts HTML email body to markdown", async () => {
    const markdown = await markdownFromEmailSource(multipartMessage);

    expect(markdown).toContain("# Hello");
    expect(markdown).toContain("[Example](https://example.com)");
    expect(markdown).toMatch(/[*-]\s+One/);
  });
});

describe("formatMailGetResult", () => {
  it("keeps result unchanged for plain format", async () => {
    const input = {
      success: true,
      message: {
        content: "plain text",
      },
    };

    const output = await formatMailGetResult(input, "plain");
    expect(output).toEqual(input);
  });

  it("formats message content as markdown when requested", async () => {
    const input = {
      success: true,
      message: {
        content: "plain fallback",
        source: multipartMessage,
      },
    };

    const output = await formatMailGetResult(input, "markdown");

    expect(output.message.contentFormat).toBe("markdown");
    expect(output.message.content).toContain("# Hello");
    expect(output.message.source).toBeUndefined();
  });
});
