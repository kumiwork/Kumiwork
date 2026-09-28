import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { REMEMBER_MCP_SERVER, REMEMBER_TOOL } from "./codex-events.js";
import { REMEMBER_ACKNOWLEDGEMENT, REMEMBER_CONTENT_DESCRIPTION, REMEMBER_TOOL_DESCRIPTION } from "./remember-tool.js";

const server = new McpServer({ name: REMEMBER_MCP_SERVER, version: "1.0.0" });

server.registerTool(
  REMEMBER_TOOL,
  {
    description: REMEMBER_TOOL_DESCRIPTION,
    inputSchema: { content: z.string().describe(REMEMBER_CONTENT_DESCRIPTION) },
  },
  async () => ({ content: [{ type: "text", text: REMEMBER_ACKNOWLEDGEMENT }] }),
);

await server.connect(new StdioServerTransport());
