import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("web/out");
const destination = resolve("out");

if (!existsSync(source)) {
  throw new Error(`Static export not found at ${source}. Run the web build first.`);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });

console.log(`Prepared Sites output at ${destination}`);
