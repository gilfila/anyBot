// Approval bridge between a harness and the anyBot coordinator.
//
// Claude Code runs headless (-p), so it can't show a permission dialog.
// With --permission-prompts host and --permission-prompt-tool, it asks this
// MCP server instead. The server forwards each request to the coordinator
// over loopback HTTP with the run's token and waits for the owner's answer
// in the anyBot chat. Node built-ins only: this file runs outside the app
// bundle (unpacked from app.asar) under ELECTRON_RUN_AS_NODE.
import { request } from "node:http";
import { createInterface } from "node:readline";

const url = new URL(process.env.ANYBOT_APPROVAL_URL || "http://127.0.0.1:1/");
const token = process.env.ANYBOT_APPROVAL_TOKEN || "";
const TOOL = "approve";

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

function ask(body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: "/approve",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          try {
            const answer = JSON.parse(text);
            if (answer.behavior === "allow") resolve({ behavior: "allow", updatedInput: body.input });
            else resolve({ behavior: "deny", message: String(answer.message || "The owner declined this action.") });
          } catch {
            resolve({ behavior: "deny", message: "anyBot could not read the approval answer." });
          }
        });
      },
    );
    req.on("error", () => resolve({ behavior: "deny", message: "anyBot's approval service is not reachable." }));
    req.end(payload);
  });
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (id === undefined) return; // notifications
  if (method === "initialize")
    return send({
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "anybot", version: "1.0.0" },
      },
    });
  if (method === "ping") return send({ id, result: {} });
  if (method === "tools/list")
    return send({
      id,
      result: {
        tools: [
          {
            name: TOOL,
            description: "Asks the anyBot owner to approve a tool call. Used by the harness, not by the assistant.",
            inputSchema: {
              type: "object",
              properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } },
              required: ["tool_name", "input"],
            },
          },
        ],
      },
    });
  if (method === "tools/call") {
    if (params?.name !== TOOL) return send({ id, error: { code: -32602, message: "Unknown tool" } });
    const args = params.arguments || {};
    const decision = await ask({ tool_name: String(args.tool_name || ""), input: args.input || {}, tool_use_id: args.tool_use_id });
    return send({ id, result: { content: [{ type: "text", text: JSON.stringify(decision) }] } });
  }
  send({ id, error: { code: -32601, message: `Unknown method ${method}` } });
});
