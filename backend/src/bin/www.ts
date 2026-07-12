import { createApp } from "../app";
import { env } from "../config/env";
import { disconnectDb, warmDbPool } from "../lib/prisma";

async function main() {
  const app = createApp();

  try {
    await warmDbPool();
    console.log(`Connected to Aurora via IAM → ${env.DB_HOST}`);
  } catch (err) {
    console.error("Failed to connect to database:", err);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
