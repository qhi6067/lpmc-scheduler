import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { del, put } from "@vercel/blob";
import {
  attachAuth,
  clearAuthCookie,
  getAuthSessionPayload,
  isAdmin,
  isSystem,
  setAuthCookie,
  updateAdminPassword,
  validateAdminCredentials,
  validateCurrentAdminPassword,
  validateSystemCredentials
} from "./auth.js";
import {
  createPtoRequest,
  getSchedule,
  getSchedules,
  initializeStore,
  listPtoRequests,
  saveSchedule,
  STORE_MODE,
  updatePtoRequestStatus
} from "./store.js";
import { parseScheduleWorkbook } from "./scheduleParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const uploadsDir = path.join(__dirname, "data", "uploads");

const app = express();
const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_UPLOAD_BYTES = Math.floor(4.5 * 1024 * 1024);
const HAS_BLOB_STORAGE = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

app.set("trust proxy", 1);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES
  },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowed = [".xlsx", ".xls", ".csv"];

    if (allowed.includes(extension)) {
      callback(null, true);
      return;
    }

    callback(new Error("Please upload an Excel file (.xlsx, .xls, or .csv)."));
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(attachAuth);

function requireAdmin(request, response, next) {
  if (isAdmin(request)) {
    next();
    return;
  }

  response.status(401).json({
    message: "Admin login required."
  });
}

function requireAdminOrSystem(request, response, next) {
  if (isAdmin(request) || isSystem(request)) {
    next();
    return;
  }

  response.status(401).json({
    message: "Admin login required."
  });
}

function serializeSchedule(schedule) {
  if (!schedule) {
    return null;
  }

  return {
    scheduleType: schedule.scheduleType,
    title: schedule.title,
    facility: schedule.facility,
    rangeLabel: schedule.rangeLabel,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    columns: schedule.columns,
    employees: schedule.employees,
    sourceFileName: schedule.sourceFileName,
    uploadedAt: schedule.uploadedAt,
    downloadUrl: `/api/schedules/${schedule.scheduleType}/download`
  };
}

function getScheduleType(request) {
  const type = request.params.type;
  return type === "techs" || type === "pharmacists" ? type : null;
}

function parseIsoDateInput(value) {
  if (typeof value !== "string" || !ISO_DATE_REGEX.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validatePtoRequest(body) {
  const employeeName = String(body?.employeeName ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  const scheduleType = body?.scheduleType === "pharmacists" ? "pharmacists" : "techs";
  const startDate = String(body?.startDate ?? "");
  const endDate = String(body?.endDate || body?.startDate || "");
  const parsedStart = parseIsoDateInput(startDate);
  const parsedEnd = parseIsoDateInput(endDate);

  if (!employeeName) {
    return { error: "Employee name is required." };
  }

  if (!parsedStart || !parsedEnd) {
    return { error: "Please provide a valid PTO date or date range." };
  }

  if (parsedEnd < parsedStart) {
    return { error: "The PTO end date cannot be before the start date." };
  }

  return {
    employeeName,
    reason,
    scheduleType,
    startDate,
    endDate
  };
}

function validateScheduleUpload(body) {
  const startDate = String(body?.startDate ?? "");
  const endDate = String(body?.endDate ?? "");
  const parsedStart = parseIsoDateInput(startDate);
  const parsedEnd = parseIsoDateInput(endDate);

  if (!parsedStart || !parsedEnd) {
    return { error: "Please choose a valid schedule start and end date before uploading." };
  }

  if (parsedEnd < parsedStart) {
    return { error: "The schedule end date cannot be before the start date." };
  }

  return {
    startDate,
    endDate
  };
}

function sanitizeBaseName(originalFileName) {
  const extension = path.extname(originalFileName) || ".xlsx";

  return originalFileName
    .replace(extension, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function buildBlobPath(scheduleType, originalFileName) {
  const extension = path.extname(originalFileName).toLowerCase() || ".xlsx";
  const safeBase = sanitizeBaseName(originalFileName) || "schedule";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `schedules/${scheduleType}/${stamp}-${safeBase}${extension}`;
}

async function deleteBlobIfPresent(pathname) {
  if (!pathname) {
    return;
  }

  try {
    await del(pathname);
  } catch (error) {
    console.warn(`Unable to delete blob ${pathname}.`, error);
  }
}

async function saveFileLocally(buffer, originalFileName) {
  await mkdir(uploadsDir, { recursive: true });
  const extension = path.extname(originalFileName).toLowerCase() || ".xlsx";
  const safeBase = sanitizeBaseName(originalFileName) || "schedule";
  const fileName = `${Date.now()}-${safeBase}${extension}`;
  const filePath = path.join(uploadsDir, fileName);
  await writeFile(filePath, buffer);
  return { fileName, filePath };
}

async function deleteLocalFileIfPresent(fileName) {
  if (!fileName) {
    return;
  }

  const safeFileName = path.basename(fileName);
  const filePath = path.join(uploadsDir, safeFileName);

  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`Unable to delete local upload ${safeFileName}.`, error);
    }
  }
}

app.get("/api/health", async (_request, response) => {
  await initializeStore();
  response.json({
    ok: true,
    storage: STORE_MODE === "postgres" ? "vercel-blob-and-postgres" : "local-json",
    uploads: HAS_BLOB_STORAGE ? "vercel-blob" : "local-files"
  });
});

app.get("/api/auth/session", (request, response) => {
  response.json(getAuthSessionPayload(request));
});

app.post("/api/auth/login", async (request, response) => {
  const { username, password } = request.body ?? {};

  if (await validateAdminCredentials(username, password)) {
    setAuthCookie(response, "admin");
    response.json({
      authenticated: true,
      isSystem: false,
      username
    });
    return;
  }

  if (validateSystemCredentials(username, password)) {
    setAuthCookie(response, "system");
    response.json({
      authenticated: false,
      isSystem: true
    });
    return;
  }

  response.status(401).json({
    message: "Invalid admin username or password."
  });
});

app.post("/api/auth/logout", (_request, response) => {
  clearAuthCookie(response);
  response.json({ authenticated: false });
});

app.get("/api/schedules", async (_request, response) => {
  const schedules = await getSchedules();

  response.json({
    schedules: {
      techs: serializeSchedule(schedules.techs),
      pharmacists: serializeSchedule(schedules.pharmacists)
    }
  });
});

app.get("/api/schedules/:type", async (request, response) => {
  const scheduleType = getScheduleType(request);

  if (!scheduleType) {
    response.status(404).json({ message: "Unknown schedule type." });
    return;
  }

  const schedule = await getSchedule(scheduleType);

  if (!schedule) {
    response.status(404).json({
      message: `No ${scheduleType} schedule has been uploaded yet.`
    });
    return;
  }

  response.json({
    schedule: serializeSchedule(schedule)
  });
});

app.get("/api/schedules/:type/download", async (request, response) => {
  const scheduleType = getScheduleType(request);

  if (!scheduleType) {
    response.status(404).json({ message: "Unknown schedule type." });
    return;
  }

  const schedule = await getSchedule(scheduleType);

  if (schedule?.blobDownloadUrl) {
    response.redirect(schedule.blobDownloadUrl);
    return;
  }

  const localFileName = schedule?.localFileName ?? schedule?.storedFileName;

  if (!localFileName) {
    response.status(404).json({ message: "No file available for download." });
    return;
  }

  const safeFileName = path.basename(localFileName);
  const absolutePath = path.join(uploadsDir, safeFileName);

  if (!existsSync(absolutePath)) {
    response.status(404).json({ message: "The uploaded file could not be found on disk." });
    return;
  }

  response.download(absolutePath, schedule.sourceFileName ?? safeFileName);
});

app.post("/api/admin/upload/:type", requireAdmin, upload.single("file"), async (request, response) => {
  const scheduleType = getScheduleType(request);

  if (!scheduleType) {
    response.status(404).json({ message: "Unknown schedule type." });
    return;
  }

  if (!request.file?.buffer) {
    response.status(400).json({ message: "Please choose a file to upload." });
    return;
  }

  const validatedUpload = validateScheduleUpload(request.body ?? {});

  if ("error" in validatedUpload) {
    response.status(400).json({ message: validatedUpload.error });
    return;
  }

  let parsedSchedule = null;

  try {
    parsedSchedule = parseScheduleWorkbook(
      request.file.buffer,
      scheduleType,
      request.file.originalname,
      {
        startDate: validatedUpload.startDate,
        endDate: validatedUpload.endDate
      }
    );
  } catch (error) {
    if (error instanceof Error) {
      error.statusCode = 400;
    }

    throw error;
  }

  let uploadedBlob = null;
  let localUpload = null;

  try {
    const storageDetails = HAS_BLOB_STORAGE
      ? await put(buildBlobPath(scheduleType, request.file.originalname), request.file.buffer, {
          access: "public",
          contentType: request.file.mimetype || undefined
        })
      : await saveFileLocally(request.file.buffer, request.file.originalname);

    if (HAS_BLOB_STORAGE) {
      uploadedBlob = storageDetails;
    } else {
      localUpload = storageDetails;
    }

    const { schedule, previousBlobPathname, previousLocalFileName } = await saveSchedule({
      ...parsedSchedule,
      blobPathname: uploadedBlob?.pathname ?? null,
      blobUrl: uploadedBlob?.url ?? null,
      blobDownloadUrl: uploadedBlob?.downloadUrl ?? null,
      localFileName: localUpload?.fileName ?? null,
      storedFileName: localUpload?.fileName ?? null
    });

    if (previousBlobPathname && previousBlobPathname !== uploadedBlob?.pathname) {
      await deleteBlobIfPresent(previousBlobPathname);
    }

    if (previousLocalFileName && previousLocalFileName !== localUpload?.fileName) {
      await deleteLocalFileIfPresent(previousLocalFileName);
    }

    response.json({
      message: `${scheduleType === "techs" ? "Tech" : "Pharmacist"} schedule uploaded.`,
      schedule: serializeSchedule(schedule)
    });
  } catch (error) {
    if (uploadedBlob?.pathname) {
      await deleteBlobIfPresent(uploadedBlob.pathname);
    }

    if (localUpload?.fileName) {
      await deleteLocalFileIfPresent(localUpload.fileName);
    }

    throw error;
  }
});

app.post("/api/admin/change-password", requireAdminOrSystem, async (request, response) => {
  const adminUser = isAdmin(request);
  const { currentPassword, newPassword } = request.body ?? {};

  if (!newPassword) {
    response.status(400).json({ message: "New password is required." });
    return;
  }

  if (adminUser) {
    if (!currentPassword) {
      response.status(400).json({ message: "Current password is required." });
      return;
    }

    const currentPasswordValid = await validateCurrentAdminPassword(currentPassword);

    if (!currentPasswordValid) {
      response.status(400).json({ message: "Current password is incorrect." });
      return;
    }
  }

  if (newPassword.length < 6) {
    response.status(400).json({ message: "New password must be at least 6 characters." });
    return;
  }

  await updateAdminPassword(newPassword);
  response.json({ message: "Password updated successfully." });
});

app.get("/api/admin/pto-requests", requireAdmin, async (_request, response) => {
  const requests = await listPtoRequests();
  response.json({ requests });
});

app.post("/api/pto-requests", async (request, response) => {
  const validated = validatePtoRequest(request.body ?? {});

  if ("error" in validated) {
    response.status(400).json({
      message: validated.error
    });
    return;
  }

  const savedRequest = await createPtoRequest({
    id: crypto.randomUUID(),
    employeeName: validated.employeeName,
    scheduleType: validated.scheduleType,
    startDate: validated.startDate,
    endDate: validated.endDate,
    reason: validated.reason,
    status: "pending",
    submittedAt: new Date().toISOString(),
    reviewedAt: null
  });

  response.status(201).json({
    message: "PTO request submitted.",
    request: savedRequest
  });
});

app.patch("/api/admin/pto-requests/:id", requireAdmin, async (request, response) => {
  const { id } = request.params;
  const { status } = request.body ?? {};

  if (!["approved", "denied"].includes(status)) {
    response.status(400).json({
      message: "Status must be approved or denied."
    });
    return;
  }

  const updatedRequest = await updatePtoRequestStatus(id, status);

  if (!updatedRequest) {
    response.status(404).json({ message: "PTO request not found." });
    return;
  }

  response.json({
    message: `PTO request ${status}.`,
    request: updatedRequest,
    requests: await listPtoRequests()
  });
});

if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (request, response, next) => {
    if (request.path.startsWith("/api")) {
      next();
      return;
    }

    response.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") {
    response.status(400).json({
      message: "Please upload an Excel file smaller than 4.5 MB."
    });
    return;
  }

  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;

  response.status(statusCode).json({
    message: error instanceof Error ? error.message : "Something went wrong."
  });
});

export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`LPMC Scheduler server running on http://localhost:${port}`);
  });
}
