import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AgentError } from "./protocol.mjs";

export const defaultStateFile = "/var/lib/kai-host-agent/identity.json";

export function stateFilePath() {
  return process.env.KAI_HOST_AGENT_STATE_FILE?.trim() || defaultStateFile;
}

export async function readState(path = stateFilePath()) {
  let file;
  try {
    const metadata = await stat(path);
    if ((metadata.mode & 0o077) !== 0) throw new AgentError("STATE_PERMISSIONS_INVALID", "Agent identity file must not be accessible by group or other users.");
    file = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof AgentError) throw error;
    if (error?.code === "ENOENT") throw new AgentError("STATE_NOT_FOUND", "Agent is not paired. Run the pair command first.");
    throw new AgentError("STATE_READ_FAILED", "Agent identity file cannot be read.", { cause: error });
  }
  try {
    const state = JSON.parse(file);
    if (!state || typeof state !== "object" || state.version !== 1 || typeof state.privateKeyPkcs8 !== "string") throw new Error("shape");
    return state;
  } catch (error) {
    throw new AgentError("STATE_INVALID", "Agent identity file is invalid.", { cause: error });
  }
}

export async function writeState(state, path = stateFilePath()) {
  const directory = dirname(path);
  const temporary = `${path}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function removeState(path = stateFilePath()) {
  await unlink(path).catch((error) => { if (error?.code !== "ENOENT") throw error; });
}
