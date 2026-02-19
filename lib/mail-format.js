import { simpleParser } from "mailparser";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
});

function normalizeMarkdown(markdown) {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function markdownFromEmailSource(source) {
  const parsed = await simpleParser(source);

  if (parsed.html) {
    return normalizeMarkdown(turndown.turndown(parsed.html));
  }

  if (parsed.textAsHtml) {
    return normalizeMarkdown(turndown.turndown(parsed.textAsHtml));
  }

  if (parsed.text) {
    return normalizeMarkdown(parsed.text);
  }

  return "";
}

export async function formatMailGetResult(result, format) {
  if (format !== "markdown") return result;

  const message = result?.message;
  if (!message || typeof message !== "object") return result;

  let markdown = "";
  if (typeof message.source === "string" && message.source.trim().length > 0) {
    try {
      markdown = await markdownFromEmailSource(message.source);
    } catch {
      // Fall back to Mail.app plain-text extraction if MIME parsing fails.
      markdown = "";
    }
  }

  if (!markdown && typeof message.content === "string") {
    markdown = normalizeMarkdown(message.content);
  }

  return {
    ...result,
    message: {
      ...message,
      content: markdown,
      contentFormat: "markdown",
      // Source is only needed for conversion, not for normal tool output.
      source: undefined,
    },
  };
}
