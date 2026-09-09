import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const python = root + "ml-pipeline/.venv/bin/python";
if (!existsSync(python)) {
  console.error(
    "Create ml-pipeline/.venv and install requirements.txt first. See README.md.",
  );
  process.exit(1);
}
const children = [
  spawn(
    python,
    ["-m", "uvicorn", "api:app", "--host", "127.0.0.1", "--port", "8000"],
    { cwd: root + "ml-pipeline", stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      root + "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ],
    { cwd: root + "web", stdio: "inherit" },
  ),
];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 0));
}
