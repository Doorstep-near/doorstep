import { buildApp } from "./app";
import { loadEnvFile, readConfig } from "./config";
import { checkContract, createDemo, createLive } from "./setup";

loadEnvFile();
const config = readConfig();

const wired = await (config.demoMode ? createDemo(config) : createLive(config)).catch((e: Error) => {
  console.error(`Cannot start: ${e.message}`);
  process.exit(1);
});
const app = buildApp(wired, { logger: true });

await app.listen({ port: config.port, host: config.host });

const lines = [
  `Doorstep API on http://${config.host}:${config.port} (${config.demoMode ? "DEMO MODE: fake chain, fake 1Click, mock courier, no network" : config.network})`,
  `Web app: ${config.webUrl}   Escrow: ${wired.deps.escrow.account}   Shop: ${config.shopName}`,
];
if (config.demoMode) lines.push(`Seller token: ${config.sellerToken}`);
console.log(lines.join("\n"));

const warnings = [...wired.warnings, ...(config.demoMode ? [] : await checkContract(wired))];
for (const w of warnings) console.warn(`WARNING: ${w}`);

wired.scheduler.start(config.schedulerIntervalMs);

const shutdown = async () => {
  await wired.scheduler.stop();
  await app.close();
  wired.deps.db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
