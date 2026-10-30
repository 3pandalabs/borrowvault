// No proxy.ts / middleware in this app (see ../CLAUDE.md). The adapter cannot
// bundle Next.js middleware (it pulls in Node-only `async_hooks`). Authed
// pages gate rendering in their client layouts; the API's bearer-token check
// is the real boundary.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
