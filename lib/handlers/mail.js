import { formatMailGetResult } from "../mail-format.js";

export async function handleMail(args, runCLI) {
  const cliArgs = [];

  switch (args.action) {
    case "accounts":
      return await runCLI("mail-cli", ["accounts"]);

    case "mailboxes":
      cliArgs.push("mailboxes");
      if (args.account) cliArgs.push("--account", args.account);
      return await runCLI("mail-cli", cliArgs);

    case "messages":
      cliArgs.push("messages");
      if (args.mailbox) cliArgs.push("--mailbox", args.mailbox);
      if (args.account) cliArgs.push("--account", args.account);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      if (args.filter) cliArgs.push("--filter", args.filter);
      return await runCLI("mail-cli", cliArgs);

    case "get": {
      if (!args.id) throw new Error("Message ID is required for mail get");
      const getArgs = ["get", "--id", args.id];
      if (args.mailbox) getArgs.push("--mailbox", args.mailbox);
      if (args.account) getArgs.push("--account", args.account);
      if (args.format === "markdown") getArgs.push("--include-source");
      const result = await runCLI("mail-cli", getArgs);
      return await formatMailGetResult(result, args.format || "plain");
    }

    case "search":
      if (!args.query) throw new Error("Search query is required for mail search");
      cliArgs.push("search", args.query);
      if (args.field) cliArgs.push("--field", args.field);
      if (args.mailbox) cliArgs.push("--mailbox", args.mailbox);
      if (args.account) cliArgs.push("--account", args.account);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("mail-cli", cliArgs);

    case "update": {
      if (!args.id) throw new Error("Message ID is required for mail update");
      const updateArgs = ["update", "--id", args.id];
      if (args.read !== undefined) updateArgs.push("--read", String(args.read));
      if (args.flagged !== undefined) updateArgs.push("--flagged", String(args.flagged));
      if (args.junk !== undefined) updateArgs.push("--junk", String(args.junk));
      if (args.mailbox) updateArgs.push("--mailbox", args.mailbox);
      if (args.account) updateArgs.push("--account", args.account);
      return await runCLI("mail-cli", updateArgs);
    }

    case "move": {
      if (!args.id) throw new Error("Message ID is required for mail move");
      if (!args.toMailbox) throw new Error("Target mailbox (toMailbox) is required for mail move");
      const moveArgs = ["move", "--id", args.id, "--to-mailbox", args.toMailbox];
      if (args.toAccount) moveArgs.push("--to-account", args.toAccount);
      if (args.mailbox) moveArgs.push("--mailbox", args.mailbox);
      if (args.account) moveArgs.push("--account", args.account);
      return await runCLI("mail-cli", moveArgs);
    }

    case "delete": {
      if (!args.id) throw new Error("Message ID is required for mail delete");
      const delArgs = ["delete", "--id", args.id];
      if (args.mailbox) delArgs.push("--mailbox", args.mailbox);
      if (args.account) delArgs.push("--account", args.account);
      return await runCLI("mail-cli", delArgs);
    }

    case "batch_update": {
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }
      const updates = args.ids.map((id) => {
        const obj = { id };
        if (args.read !== undefined) obj.read = args.read;
        if (args.flagged !== undefined) obj.flagged = args.flagged;
        if (args.junk !== undefined) obj.junk = args.junk;
        return obj;
      });
      const batchArgs = ["batch-update", "--json", JSON.stringify(updates)];
      if (args.mailbox) batchArgs.push("--mailbox", args.mailbox);
      if (args.account) batchArgs.push("--account", args.account);
      return await runCLI("mail-cli", batchArgs);
    }

    case "batch_delete": {
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }
      const batchArgs = ["batch-delete", "--json", JSON.stringify(args.ids)];
      if (args.mailbox) batchArgs.push("--mailbox", args.mailbox);
      if (args.account) batchArgs.push("--account", args.account);
      return await runCLI("mail-cli", batchArgs);
    }

    default:
      throw new Error(`Unknown mail action: ${args.action}`);
  }
}
