import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { del, get, put } from "@vercel/blob";
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
  clearReviewedPtoRequests,
  createPtoRequest,
  deletePtoRequest,
  getSchedule,
  getSchedules,
  initializeStore,
  listPtoLogEntries,
  listPtoRequests,
  restorePtoRequests,
  saveSchedule,
  STORE_MODE,
  updatePtoRequestStatus
} from "./store.js";
import { buildWorkbookPreview, parseScheduleWorkbook } from "./scheduleParser.js";

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
const BLOB_ACCESS = process.env.BLOB_ACCESS === "public" ? "public" : "private";

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
    parseStatus: schedule.parseStatus ?? "parsed",
    parseMessage: schedule.parseMessage ?? null,
    sourceFileName: schedule.sourceFileName,
    uploadedAt: schedule.uploadedAt,
    downloadUrl: `/api/schedules/${schedule.scheduleType}/download`,
    previewUrl: `/api/schedules/${schedule.scheduleType}/preview`
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

function parseOptionalMonth(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : null;
}

function parseOptionalYear(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 9999 ? parsed : null;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function buildPtoLogCsv(entries) {
  const header = [
    "Request ID",
    "Employee Name",
    "Schedule Type",
    "Start Date",
    "End Date",
    "Reason",
    "Approval Status",
    "Submitted At",
    "Reviewed At",
    "Cleared At"
  ];

  const rows = entries.map((entry) => [
    entry.requestId,
    entry.employeeName,
    entry.scheduleType,
    entry.startDate,
    entry.endDate,
    entry.reason ?? "",
    entry.status,
    entry.submittedAt,
    entry.reviewedAt ?? "",
    entry.clearedAt ?? ""
  ]);

  return [header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

function buildPtoLogFileName(month, year) {
  if (year && month) {
    return `pto-log-${year}-${String(month).padStart(2, "0")}.csv`;
  }

  if (year) {
    return `pto-log-${year}.csv`;
  }

  if (month) {
    return `pto-log-month-${String(month).padStart(2, "0")}.csv`;
  }

  return "pto-log-all.csv";
}

function formatShortDate(date) {
  const shortYear = String(date.getFullYear()).slice(-2);
  return `${date.getMonth() + 1}/${date.getDate()}/${shortYear}`;
}

function normalizeScheduleUpload(body) {
  const startDate = String(body?.startDate ?? "");
  const endDate = String(body?.endDate ?? "");
  const parsedStart = parseIsoDateInput(startDate);
  const parsedEnd = parseIsoDateInput(endDate);

  return {
    startDate: parsedStart ? startDate : null,
    endDate: parsedStart && parsedEnd && parsedEnd >= parsedStart ? endDate : null
  };
}

function buildRangeLabel(startDate, endDate) {
  const parsedStart = startDate ? parseIsoDateInput(startDate) : null;
  const parsedEnd = endDate ? parseIsoDateInput(endDate) : null;

  if (parsedStart && parsedEnd && parsedEnd >= parsedStart) {
    return `${formatShortDate(parsedStart)} - ${formatShortDate(parsedEnd)}`;
  }

  if (parsedStart) {
    return formatShortDate(parsedStart);
  }

  if (parsedEnd) {
    return formatShortDate(parsedEnd);
  }

  return "Posted schedule";
}

function buildAttachmentOnlySchedule(scheduleType, originalFileName, uploadDetails, parseError) {
  const typeLabel = scheduleType === "pharmacists" ? "Pharmacist Schedule" : "Tech Schedule";
  const parsedStart = uploadDetails.startDate ? parseIsoDateInput(uploadDetails.startDate) : null;
  const parsedEnd = uploadDetails.endDate ? parseIsoDateInput(uploadDetails.endDate) : null;

  return {
    scheduleType,
    title: typeLabel,
    facility: "Las Palmas Medical Center",
    rangeLabel:
      parsedStart && parsedEnd
        ? `${formatShortDate(parsedStart)} - ${formatShortDate(parsedEnd)}`
        : "Excel attachment posted",
    startDate: uploadDetails.startDate ?? null,
    endDate: uploadDetails.endDate ?? null,
    columns: [],
    employees: [],
    parseStatus: "attachment_only",
    parseMessage:
      parseError instanceof Error
        ? parseError.message
        : "The Excel file was uploaded, but the schedule grid could not be read.",
    sourceFileName: originalFileName
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

async function loadScheduleFileBuffer(schedule) {
  const localFileName = schedule?.localFileName ?? schedule?.storedFileName;

  if (localFileName) {
    const safeFileName = path.basename(localFileName);
    const filePath = path.join(uploadsDir, safeFileName);
    return readFile(filePath);
  }

  const remoteUrl = schedule?.blobDownloadUrl ?? schedule?.blobUrl;
  const remotePathname = schedule?.blobPathname ?? null;

  if (!remoteUrl && !remotePathname) {
    throw new Error("No uploaded file is available for this schedule.");
  }

  if (BLOB_ACCESS === "private") {
    const result = await get(remotePathname ?? remoteUrl, { access: "private" });

    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error("The uploaded workbook could not be fetched for preview.");
    }

    const chunks = [];
    const nodeStream = Readable.fromWeb(result.stream);

    for await (const chunk of nodeStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  const remoteResponse = await fetch(remoteUrl);

  if (!remoteResponse.ok) {
    throw new Error("The uploaded workbook could not be fetched for preview.");
  }

  return Buffer.from(await remoteResponse.arrayBuffer());
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

  if (schedule?.blobDownloadUrl && BLOB_ACCESS === "public") {
    response.redirect(schedule.blobDownloadUrl);
    return;
  }

  if (schedule?.blobPathname || schedule?.blobUrl) {
    try {
      const result = await get(schedule.blobPathname ?? schedule.blobUrl, { access: BLOB_ACCESS });

      if (!result || result.statusCode !== 200 || !result.stream) {
        response.status(404).json({ message: "No file available for download." });
        return;
      }

      response.setHeader(
        "Content-Type",
        result.blob.contentType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      response.setHeader(
        "Content-Disposition",
        result.blob.contentDisposition ||
          `attachment; filename="${schedule.sourceFileName ?? path.basename(result.blob.pathname)}"`
      );
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", BLOB_ACCESS === "private" ? "private, no-cache" : "public, max-age=3600");

      Readable.fromWeb(result.stream).pipe(response);
      return;
    } catch (error) {
      response.status(500).json({
        message: error instanceof Error ? error.message : "Could not download the uploaded file."
      });
      return;
    }
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

app.get("/api/schedules/:type/preview", async (request, response) => {
  const scheduleType = getScheduleType(request);

  if (!scheduleType) {
    response.status(404).json({ message: "Unknown schedule type." });
    return;
  }

  const schedule = await getSchedule(scheduleType);

  if (!schedule) {
    response.status(404).json({ message: "No schedule has been uploaded yet." });
    return;
  }

  try {
    const fileBuffer = await loadScheduleFileBuffer(schedule);
    const preview = buildWorkbookPreview(fileBuffer);
    response.json({ preview });
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : "Could not build workbook preview."
    });
  }
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

  const validatedUpload = normalizeScheduleUpload(request.body ?? {});

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
    parsedSchedule = buildAttachmentOnlySchedule(
      scheduleType,
      request.file.originalname,
      validatedUpload,
      error
    );
  }

  let uploadedBlob = null;
  let localUpload = null;

  try {
    const storageDetails = HAS_BLOB_STORAGE
      ? await put(buildBlobPath(scheduleType, request.file.originalname), request.file.buffer, {
          access: BLOB_ACCESS,
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
      message:
        parsedSchedule.parseStatus === "attachment_only"
          ? `${scheduleType === "techs" ? "Tech" : "Pharmacist"} schedule uploaded. The Excel file is posted as an attachment because the schedule grid could not be read automatically.`
          : `${scheduleType === "techs" ? "Tech" : "Pharmacist"} schedule uploaded.`,
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

app.patch("/api/admin/schedules/:type/metadata", requireAdmin, async (request, response) => {
  const scheduleType = getScheduleType(request);

  if (!scheduleType) {
    response.status(404).json({ message: "Unknown schedule type." });
    return;
  }

  const existingSchedule = await getSchedule(scheduleType);

  if (!existingSchedule) {
    response.status(404).json({ message: "No schedule has been uploaded yet." });
    return;
  }

  const normalizedUpload = normalizeScheduleUpload(request.body ?? {});
  const nextSchedule = {
    ...existingSchedule,
    startDate: normalizedUpload.startDate,
    endDate: normalizedUpload.endDate,
    rangeLabel: buildRangeLabel(normalizedUpload.startDate, normalizedUpload.endDate)
  };

  const { schedule } = await saveSchedule(nextSchedule);

  response.json({
    message: `${scheduleType === "techs" ? "Tech" : "Pharmacist"} schedule dates updated.`,
    schedule: serializeSchedule(schedule)
  });
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

app.get("/api/admin/pto-log.csv", requireAdmin, async (request, response) => {
  const month = parseOptionalMonth(request.query.month);
  const year = parseOptionalYear(request.query.year);
  const entries = await listPtoLogEntries({ month, year });
  const csv = buildPtoLogCsv(entries);

  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="${buildPtoLogFileName(month, year)}"`
  );
  response.status(200).send(csv);
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

app.delete("/api/admin/pto-requests/reviewed", requireAdmin, async (_request, response) => {
  const existingRequests = await listPtoRequests();
  const deletedRequests = existingRequests.filter((request) => request.status !== "pending");
  const deletedCount = await clearReviewedPtoRequests();

  response.json({
    message:
      deletedCount === 0
        ? "No approved or denied PTO requests were available to clear."
        : `Cleared ${deletedCount} reviewed PTO request${deletedCount === 1 ? "" : "s"}.`,
    requests: await listPtoRequests(),
    deletedRequests
  });
});

app.delete("/api/admin/pto-requests/:id", requireAdmin, async (request, response) => {
  const { id } = request.params;
  const deletedRequest = await deletePtoRequest(id);

  if (!deletedRequest) {
    response.status(404).json({ message: "PTO request not found." });
    return;
  }

  response.json({
    message: "PTO request cleared.",
    request: deletedRequest,
    requests: await listPtoRequests(),
    deletedRequests: deletedRequest ? [deletedRequest] : []
  });
});

app.patch("/api/admin/schedules/:type/cells", requireAdmin, async (request, response) => {
  const scheduleType = getScheduleType(request);

  if (!scheduleType) {
    response.status(404).json({ message: "Unknown schedule type." });
    return;
  }

  const schedule = await getSchedule(scheduleType);

  if (!schedule) {
    response.status(404).json({ message: "No schedule has been uploaded for this type." });
    return;
  }

  const { employeeIndex, columnIndex, value } = request.body ?? {};

  if (!Number.isInteger(employeeIndex) || !Number.isInteger(columnIndex)) {
    response.status(400).json({ message: "employeeIndex and columnIndex must be integers." });
    return;
  }

  if (employeeIndex < 0 || employeeIndex >= schedule.employees.length) {
    response.status(400).json({ message: "Invalid employee index." });
    return;
  }

  if (columnIndex < 0 || columnIndex >= schedule.columns.length) {
    response.status(400).json({ message: "Invalid column index." });
    return;
  }

  const employees = schedule.employees.map((e, i) =>
    i === employeeIndex
      ? { ...e, assignments: e.assignments.map((a, j) => (j === columnIndex ? String(value ?? "") : a)) }
      : e
  );

  const { schedule: saved } = await saveSchedule({ ...schedule, employees });

  response.json({
    message: "Cell updated.",
    schedule: serializeSchedule(saved)
  });
});

app.post("/api/admin/schedules/:type/swap", requireAdmin, async (request, response) => {
  const scheduleType = getScheduleType(request);

  if (!scheduleType) {
    response.status(404).json({ message: "Unknown schedule type." });
    return;
  }

  const schedule = await getSchedule(scheduleType);

  if (!schedule) {
    response.status(404).json({ message: "No schedule has been uploaded for this type." });
    return;
  }

  const { employee1Index, employee2Index, columnIndex } = request.body ?? {};

  if (!Number.isInteger(employee1Index) || !Number.isInteger(employee2Index) || !Number.isInteger(columnIndex)) {
    response.status(400).json({ message: "employee1Index, employee2Index, and columnIndex must be integers." });
    return;
  }

  if (employee1Index === employee2Index) {
    response.status(400).json({ message: "Please choose two different employees." });
    return;
  }

  const maxEmpIdx = schedule.employees.length - 1;

  if (employee1Index < 0 || employee1Index > maxEmpIdx || employee2Index < 0 || employee2Index > maxEmpIdx) {
    response.status(400).json({ message: "Invalid employee index." });
    return;
  }

  if (columnIndex < 0 || columnIndex >= schedule.columns.length) {
    response.status(400).json({ message: "Invalid column index." });
    return;
  }

  const emp1Name = schedule.employees[employee1Index].name;
  const emp2Name = schedule.employees[employee2Index].name;

  const employees = schedule.employees.map((e, i) => {
    if (i === employee1Index) {
      const next = [...e.assignments];
      next[columnIndex] = schedule.employees[employee2Index].assignments[columnIndex];
      return { ...e, assignments: next };
    }

    if (i === employee2Index) {
      const next = [...e.assignments];
      next[columnIndex] = schedule.employees[employee1Index].assignments[columnIndex];
      return { ...e, assignments: next };
    }

    return e;
  });

  const { schedule: saved } = await saveSchedule({ ...schedule, employees });

  response.json({
    message: `Shifted swapped between ${emp1Name} and ${emp2Name} on ${schedule.columns[columnIndex].label}.`,
    schedule: serializeSchedule(saved)
  });
});

app.post("/api/admin/pto-requests/restore", requireAdmin, async (request, response) => {
  const deletedRequests = Array.isArray(request.body?.requests) ? request.body.requests : [];
  const restoredRequests = await restorePtoRequests(deletedRequests);

  if (restoredRequests.length === 0) {
    response.status(400).json({ message: "No PTO requests were provided to restore." });
    return;
  }

  response.json({
    message:
      restoredRequests.length === 1
        ? "PTO request restored."
        : `Restored ${restoredRequests.length} PTO requests.`,
    requests: await listPtoRequests(),
    restoredRequests
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
