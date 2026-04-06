import "dotenv/config";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const EMPTY_SCHEDULES = {
  techs: null,
  pharmacists: null
};

const DEFAULT_LOCAL_STATE = {
  schedules: { ...EMPTY_SCHEDULES },
  ptoRequests: [],
  adminPasswordHash: null
};

const DATABASE_URL =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  "";

export const STORE_MODE = DATABASE_URL ? "postgres" : "local";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
const stateFilePath = path.join(dataDir, "state.json");

let sqlClient = null;
let initializationPromise = null;

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function getSql() {
  if (!DATABASE_URL) {
    return null;
  }

  if (!sqlClient) {
    sqlClient = neon(DATABASE_URL);
  }

  return sqlClient;
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  if (typeof value === "object") {
    return value;
  }

  return fallback;
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toIsoTimestamp(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function mapScheduleRow(row) {
  if (!row) {
    return null;
  }

  return {
    scheduleType: row.schedule_type,
    title: row.title,
    facility: row.facility,
    rangeLabel: row.range_label,
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
    columns: parseJsonField(row.columns_json, []),
    employees: parseJsonField(row.employees_json, []),
    sourceFileName: row.source_file_name,
    uploadedAt: toIsoTimestamp(row.uploaded_at),
    blobPathname: row.blob_pathname,
    blobUrl: row.blob_url,
    blobDownloadUrl: row.blob_download_url,
    localFileName: null,
    storedFileName: null
  };
}

function mapLocalSchedule(schedule) {
  if (!schedule) {
    return null;
  }

  const localFileName = schedule.localFileName ?? schedule.storedFileName ?? null;

  return {
    scheduleType: schedule.scheduleType,
    title: schedule.title,
    facility: schedule.facility,
    rangeLabel: schedule.rangeLabel,
    startDate: toIsoDate(schedule.startDate),
    endDate: toIsoDate(schedule.endDate),
    columns: Array.isArray(schedule.columns) ? schedule.columns : [],
    employees: Array.isArray(schedule.employees) ? schedule.employees : [],
    sourceFileName: schedule.sourceFileName ?? localFileName,
    uploadedAt: toIsoTimestamp(schedule.uploadedAt),
    blobPathname: schedule.blobPathname ?? null,
    blobUrl: schedule.blobUrl ?? null,
    blobDownloadUrl: schedule.blobDownloadUrl ?? null,
    localFileName,
    storedFileName: schedule.storedFileName ?? localFileName
  };
}

function mapPtoRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    employeeName: row.employee_name,
    scheduleType: row.schedule_type,
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
    reason: row.reason ?? "",
    status: row.status,
    submittedAt: toIsoTimestamp(row.submitted_at),
    reviewedAt: toIsoTimestamp(row.reviewed_at)
  };
}

function mapLocalPtoRequest(request) {
  if (!request) {
    return null;
  }

  return {
    id: request.id,
    employeeName: request.employeeName,
    scheduleType: request.scheduleType,
    startDate: toIsoDate(request.startDate),
    endDate: toIsoDate(request.endDate),
    reason: request.reason ?? "",
    status: request.status,
    submittedAt: toIsoTimestamp(request.submittedAt),
    reviewedAt: toIsoTimestamp(request.reviewedAt)
  };
}

function normalizeLocalState(parsed = {}) {
  return {
    schedules: {
      ...EMPTY_SCHEDULES,
      ...(parsed.schedules && typeof parsed.schedules === "object" ? parsed.schedules : {})
    },
    ptoRequests: Array.isArray(parsed.ptoRequests) ? parsed.ptoRequests : [],
    adminPasswordHash:
      typeof parsed.adminPasswordHash === "string" ? parsed.adminPasswordHash : null,
    adminPassword: typeof parsed.adminPassword === "string" ? parsed.adminPassword : null
  };
}

async function writeLocalState(state) {
  const nextState = {
    schedules: {
      ...EMPTY_SCHEDULES,
      ...(state.schedules ?? {})
    },
    ptoRequests: Array.isArray(state.ptoRequests) ? state.ptoRequests : [],
    adminPasswordHash: state.adminPasswordHash ?? null
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(stateFilePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

async function ensureLocalStateFile() {
  await mkdir(dataDir, { recursive: true });

  if (!existsSync(stateFilePath)) {
    await writeLocalState(DEFAULT_LOCAL_STATE);
  }
}

async function readLocalState() {
  await ensureLocalStateFile();
  const raw = await readFile(stateFilePath, "utf8");

  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = DEFAULT_LOCAL_STATE;
  }

  const normalized = normalizeLocalState(parsed);

  if (!normalized.adminPasswordHash && normalized.adminPassword) {
    normalized.adminPasswordHash = createPasswordHash(normalized.adminPassword);
    await writeLocalState(normalized);
  }

  return normalized;
}

async function ensureSchema() {
  if (STORE_MODE === "local") {
    await ensureLocalStateFile();
    return;
  }

  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS schedules (
      schedule_type TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      facility TEXT NOT NULL,
      range_label TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      columns_json JSONB NOT NULL,
      employees_json JSONB NOT NULL,
      source_file_name TEXT NOT NULL,
      blob_pathname TEXT NOT NULL,
      blob_url TEXT NOT NULL,
      blob_download_url TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT schedules_type_check CHECK (schedule_type IN ('techs', 'pharmacists'))
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS pto_requests (
      id UUID PRIMARY KEY,
      employee_name TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      CONSTRAINT pto_schedule_type_check CHECK (schedule_type IN ('techs', 'pharmacists')),
      CONSTRAINT pto_status_check CHECK (status IN ('pending', 'approved', 'denied'))
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS pto_requests_status_submitted_idx
    ON pto_requests (status, submitted_at DESC)
  `;
}

export async function initializeStore() {
  if (!initializationPromise) {
    initializationPromise = ensureSchema().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  await initializationPromise;
}

export async function getSchedules() {
  await initializeStore();

  if (STORE_MODE === "local") {
    const state = await readLocalState();
    return {
      techs: mapLocalSchedule(state.schedules.techs),
      pharmacists: mapLocalSchedule(state.schedules.pharmacists)
    };
  }

  const sql = getSql();
  const rows = await sql`SELECT * FROM schedules`;
  const schedules = { ...EMPTY_SCHEDULES };

  for (const row of rows) {
    const schedule = mapScheduleRow(row);

    if (schedule && Object.hasOwn(schedules, schedule.scheduleType)) {
      schedules[schedule.scheduleType] = schedule;
    }
  }

  return schedules;
}

export async function getSchedule(scheduleType) {
  await initializeStore();

  if (STORE_MODE === "local") {
    const state = await readLocalState();
    return mapLocalSchedule(state.schedules[scheduleType] ?? null);
  }

  const sql = getSql();
  const rows = await sql`
    SELECT * FROM schedules
    WHERE schedule_type = ${scheduleType}
    LIMIT 1
  `;

  return mapScheduleRow(rows[0] ?? null);
}

export async function saveSchedule(schedule) {
  await initializeStore();

  if (STORE_MODE === "local") {
    const state = await readLocalState();
    const previousSchedule = state.schedules[schedule.scheduleType] ?? null;
    const nextSchedule = {
      ...schedule,
      uploadedAt: new Date().toISOString(),
      blobPathname: schedule.blobPathname ?? null,
      blobUrl: schedule.blobUrl ?? null,
      blobDownloadUrl: schedule.blobDownloadUrl ?? null,
      localFileName: schedule.localFileName ?? schedule.storedFileName ?? null,
      storedFileName: schedule.storedFileName ?? schedule.localFileName ?? null
    };

    state.schedules[schedule.scheduleType] = nextSchedule;
    await writeLocalState(state);

    return {
      schedule: mapLocalSchedule(nextSchedule),
      previousBlobPathname: previousSchedule?.blobPathname ?? null,
      previousLocalFileName:
        previousSchedule?.localFileName ?? previousSchedule?.storedFileName ?? null
    };
  }

  const sql = getSql();
  const existingRows = await sql`
    SELECT blob_pathname
    FROM schedules
    WHERE schedule_type = ${schedule.scheduleType}
    LIMIT 1
  `;

  const rows = await sql`
    INSERT INTO schedules (
      schedule_type,
      title,
      facility,
      range_label,
      start_date,
      end_date,
      columns_json,
      employees_json,
      source_file_name,
      blob_pathname,
      blob_url,
      blob_download_url,
      uploaded_at
    )
    VALUES (
      ${schedule.scheduleType},
      ${schedule.title},
      ${schedule.facility},
      ${schedule.rangeLabel},
      ${schedule.startDate},
      ${schedule.endDate},
      ${JSON.stringify(schedule.columns)}::jsonb,
      ${JSON.stringify(schedule.employees)}::jsonb,
      ${schedule.sourceFileName},
      ${schedule.blobPathname},
      ${schedule.blobUrl},
      ${schedule.blobDownloadUrl},
      NOW()
    )
    ON CONFLICT (schedule_type) DO UPDATE SET
      title = EXCLUDED.title,
      facility = EXCLUDED.facility,
      range_label = EXCLUDED.range_label,
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      columns_json = EXCLUDED.columns_json,
      employees_json = EXCLUDED.employees_json,
      source_file_name = EXCLUDED.source_file_name,
      blob_pathname = EXCLUDED.blob_pathname,
      blob_url = EXCLUDED.blob_url,
      blob_download_url = EXCLUDED.blob_download_url,
      uploaded_at = NOW()
    RETURNING *
  `;

  return {
    schedule: mapScheduleRow(rows[0] ?? null),
    previousBlobPathname: existingRows[0]?.blob_pathname ?? null,
    previousLocalFileName: null
  };
}

export async function listPtoRequests() {
  await initializeStore();

  if (STORE_MODE === "local") {
    const state = await readLocalState();
    return state.ptoRequests
      .map(mapLocalPtoRequest)
      .sort((left, right) => (right?.submittedAt ?? "").localeCompare(left?.submittedAt ?? ""));
  }

  const sql = getSql();
  const rows = await sql`
    SELECT * FROM pto_requests
    ORDER BY submitted_at DESC
  `;

  return rows.map(mapPtoRow);
}

export async function createPtoRequest(request) {
  await initializeStore();

  if (STORE_MODE === "local") {
    const state = await readLocalState();
    const nextRequest = {
      ...request,
      reviewedAt: request.reviewedAt ?? null
    };

    state.ptoRequests = [nextRequest, ...state.ptoRequests];
    await writeLocalState(state);
    return mapLocalPtoRequest(nextRequest);
  }

  const sql = getSql();
  const rows = await sql`
    INSERT INTO pto_requests (
      id,
      employee_name,
      schedule_type,
      start_date,
      end_date,
      reason,
      status,
      submitted_at,
      reviewed_at
    )
    VALUES (
      ${request.id},
      ${request.employeeName},
      ${request.scheduleType},
      ${request.startDate},
      ${request.endDate},
      ${request.reason},
      ${request.status},
      ${request.submittedAt},
      ${request.reviewedAt}
    )
    RETURNING *
  `;

  return mapPtoRow(rows[0] ?? null);
}

export async function updatePtoRequestStatus(id, status) {
  await initializeStore();

  if (STORE_MODE === "local") {
    const state = await readLocalState();
    const requestIndex = state.ptoRequests.findIndex((request) => request.id === id);

    if (requestIndex === -1) {
      return null;
    }

    const updatedRequest = {
      ...state.ptoRequests[requestIndex],
      status,
      reviewedAt: new Date().toISOString()
    };

    state.ptoRequests[requestIndex] = updatedRequest;
    await writeLocalState(state);
    return mapLocalPtoRequest(updatedRequest);
  }

  const sql = getSql();
  const rows = await sql`
    UPDATE pto_requests
    SET
      status = ${status},
      reviewed_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return mapPtoRow(rows[0] ?? null);
}

export async function getAdminPasswordHash() {
  await initializeStore();

  if (STORE_MODE === "local") {
    const state = await readLocalState();
    return state.adminPasswordHash ?? null;
  }

  const sql = getSql();
  const rows = await sql`
    SELECT value
    FROM settings
    WHERE key = 'admin_password_hash'
    LIMIT 1
  `;

  return rows[0]?.value ?? null;
}

export async function setAdminPasswordHash(passwordHash) {
  await initializeStore();

  if (STORE_MODE === "local") {
    const state = await readLocalState();
    state.adminPasswordHash = passwordHash;
    await writeLocalState(state);
    return;
  }

  const sql = getSql();

  await sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('admin_password_hash', ${passwordHash}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW()
  `;
}
