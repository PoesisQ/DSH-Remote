// Isolated local server for supervisor ownership tests. No DSH/provider/relay access.
import { createServer } from "node:http";
const server = createServer(async (req, res) => {
  for await (const _ of req) {}
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ type: "server-response", result: { ok: true, value: { version: "fixture" } } }));
});
server.listen(Number(process.argv[2]), "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
