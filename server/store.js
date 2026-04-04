import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = process.env.VERCEL
  ? "/tmp/lpmc-scheduler-data"
  : path.join(__dirname, "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const DEFAULT_STATE = {
  schedules: {
    techs: null,
    pharmacists: null
  },
  ptoRequests: [],
  adminPassword: null
};

function ensureStorage() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
  }
}

export function initializeStore() {
  ensureStorage();
}

export function readState() {
  ensureStorage();

  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...DEFAULT_STATE,
      ...parsed,
      schedules: {
        ...DEFAULT_STATE.schedules,
        ...(parsed.schedules ?? {})
      },
      ptoRequests: Array.isArray(parsed.ptoRequests) ? parsed.ptoRequests : []
    };
  } catch {
    fs.writeFileSync(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
    return structuredClone(DEFAULT_STATE);
  }
}

export function writeState(nextState) {
  ensureStorage();
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2));
}

export function updateState(updater) {
  const current = readState();
  const next = updater(current);
  writeState(next);
  return next;
}
