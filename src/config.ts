import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";
dotenv({
  path: resolve(".env.local"),
});
const schema = z.object({
  DATABASE_URL: z.string().url(),
  AGENT_SERVICE_KEY: z.string().min(32),
  N8N_WEBHOOK_KEY: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default("127.0.0.1"),
  PANEL_ORIGIN: z.string().url().default("http://localhost:3000"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  DISPATCH_ENABLED: z.enum(["true", "false"]).default("false"),
  N8N_CONVERSATION_URL: z.string().default(""),
  N8N_OPENING_URL: z.string().default(""),
  // One institutional workspace for every invited member of this installation.
  UNSTA_WORKSPACE_ID: z
    .string()
    .uuid()
    .default("00000000-0000-4000-8000-000000000001"),
});
export const config = schema.parse(process.env);
