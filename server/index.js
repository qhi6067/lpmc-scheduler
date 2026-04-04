import express from "express";
import session from "express-session";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { initializeStore, readState, updateState, UPLOAD_DIR } from "./store.js";
import { parseScheduleWorkbook } from "./scheduleParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const app = express();
const port = Number.parseInt(process.env.PORT ?? "3001", 10);

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin";
const SYSTEM_USERNAME = "system";
const SYSTEM_PASSWORD = "manager";
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

initializeStore();

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname) || ".xlsx";
    const safeBase = file.originalname
      .replace(extension, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);

    callback(null, `${Date.now()}-${safeBase || "schedule"}${extension}`);
  }
});

const upload = multer({
  storage,
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
app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "lpmc-scheduler-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

function getEffectivePassword() {
  const state = readState();
  return state.adminPassword || ADMIN_PASSWORD;
}

function requireAdmin(request, response, next) {
  if (request.session?.isAdmin) {
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
    ...schedule,
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

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/auth/session", (request, response) => {
  response.json({
    authenticated: Boolean(request.session?.isAdmin),
    isSystem: Boolean(request.session?.isSystem),
    username: request.session?.isAdmin ? ADMIN_USERNAME : null
  });
});

app.post("/api/auth/login", (request, response) => {
  const { username, password } = request.body ?? {};

  if (username === ADMIN_USERNAME && password === getEffectivePassword()) {
    request.session.isAdmin = true;
    request.session.isSystem = false;
    response.json({ authenticated: true, isSystem: false, username: ADMIN_USERNAME });
    return;
  }

  if (username === SYSTEM_USERNAME && password === SYSTEM_PASSWORD) {
    request.session.isSystem = true;
    request.session.isAdmin = false;
    response.json({ authenticated: false, isSystem: true });
    return;
  }

  response.status(401).json({
    message: "Invalid admin username or password."
  });
});

app.post("/api/auth/logout", (request, response) => {
  request.session.destroy(() => {
    response.json({ authenticated: false });
  });
});

app.get("/api/schedules", (_request, response) => {
  const state = readState();

  response.json({
    schedules: {
      techs: serializeSchedule(state.schedules.techs),
      pharmacists: serializeSchedule(state.schedules.pharmacists)
    }
  });
});

app.get("/api/schedules/:type", (request, response) => {
  const scheduleType = getScheduleType(request);

  if (!scheduleType) {
    response.status(404).json({ message: "Unknown schedule type." });
    return;
  }

  const state = readState();
  const schedule = state.schedules[scheduleType];

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

app.get("/api/schedules/:type/download", (request, response) => {
  const scheduleType = getScheduleType(request);

  if (!scheduleType) {
    response.status(404).json({ message: "Unknown schedule type." });
    return;
  }

  const state = readState();
  const schedule = state.schedules[scheduleType];

  if (!schedule?.storedFileName) {
    response.status(404).json({ message: "No file available for download." });
    return;
  }

  const filePath = path.join(UPLOAD_DIR, schedule.storedFileName);

  if (!fs.existsSync(filePath)) {
    response.status(404).json({ message: "The uploaded file could not be found." });
    return;
  }

  response.download(filePath, schedule.sourceFileName);
});

app.post(
  "/api/admin/upload/:type",
  requireAdmin,
  upload.single("file"),
  (request, response) => {
    const scheduleType = getScheduleType(request);

    if (!scheduleType) {
      response.status(404).json({ message: "Unknown schedule type." });
      return;
    }

    if (!request.file) {
      response.status(400).json({ message: "Please choose a file to upload." });
      return;
    }

    try {
      const parsedSchedule = parseScheduleWorkbook(
        request.file.path,
        scheduleType,
        request.file.originalname
      );

      const nextState = updateState((current) => {
        const previous = current.schedules[scheduleType];

        if (previous?.storedFileName) {
          const previousPath = path.join(UPLOAD_DIR, previous.storedFileName);

          if (fs.existsSync(previousPath)) {
            fs.unlinkSync(previousPath);
          }
        }

        return {
          ...current,
          schedules: {
            ...current.schedules,
            [scheduleType]: {
              ...parsedSchedule,
              storedFileName: request.file.filename,
              uploadedAt: new Date().toISOString()
            }
          }
        };
      });

      response.json({
        message: `${scheduleType === "techs" ? "Tech" : "Pharmacist"} schedule uploaded.`,
        schedule: serializeSchedule(nextState.schedules[scheduleType])
      });
    } catch (error) {
      fs.unlink(request.file.path, () => {});
      response.status(400).json({
        message: error instanceof Error ? error.message : "Unable to read the uploaded file."
      });
    }
  }
);

app.post("/api/admin/change-password", (request, response) => {
  const isAdmin = Boolean(request.session?.isAdmin);
  const isSystem = Boolean(request.session?.isSystem);

  if (!isAdmin && !isSystem) {
    response.status(401).json({ message: "Admin login required." });
    return;
  }

  const { currentPassword, newPassword } = request.body ?? {};

  if (!newPassword) {
    response.status(400).json({ message: "New password is required." });
    return;
  }

  if (isAdmin) {
    if (!currentPassword) {
      response.status(400).json({ message: "Current password is required." });
      return;
    }
    if (currentPassword !== getEffectivePassword()) {
      response.status(400).json({ message: "Current password is incorrect." });
      return;
    }
  }

  if (newPassword.length < 6) {
    response.status(400).json({ message: "New password must be at least 6 characters." });
    return;
  }

  updateState((current) => ({ ...current, adminPassword: newPassword }));
  response.json({ message: "Password updated successfully." });
});

app.get("/api/admin/pto-requests", requireAdmin, (_request, response) => {
  const state = readState();
  const requests = [...state.ptoRequests].sort((left, right) =>
    right.submittedAt.localeCompare(left.submittedAt)
  );

  response.json({
    requests
  });
});

app.post("/api/pto-requests", (request, response) => {
  const validated = validatePtoRequest(request.body ?? {});

  if ("error" in validated) {
    response.status(400).json({
      message: validated.error
    });
    return;
  }

  const nextState = updateState((current) => ({
    ...current,
    ptoRequests: [
      {
        id: crypto.randomUUID(),
        employeeName: validated.employeeName,
        scheduleType: validated.scheduleType,
        startDate: validated.startDate,
        endDate: validated.endDate,
        reason: validated.reason,
        status: "pending",
        submittedAt: new Date().toISOString(),
        reviewedAt: null
      },
      ...current.ptoRequests
    ]
  }));

  response.status(201).json({
    message: "PTO request submitted.",
    request: nextState.ptoRequests[0]
  });
});

app.patch("/api/admin/pto-requests/:id", requireAdmin, (request, response) => {
  const { id } = request.params;
  const { status } = request.body ?? {};

  if (!["approved", "denied"].includes(status)) {
    response.status(400).json({
      message: "Status must be approved or denied."
    });
    return;
  }

  let updatedRequest = null;

  const nextState = updateState((current) => ({
    ...current,
    ptoRequests: current.ptoRequests.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }

      updatedRequest = {
        ...entry,
        status,
        reviewedAt: new Date().toISOString()
      };

      return updatedRequest;
    })
  }));

  if (!updatedRequest) {
    response.status(404).json({ message: "PTO request not found." });
    return;
  }

  response.json({
    message: `PTO request ${status}.`,
    request: updatedRequest,
    requests: nextState.ptoRequests
  });
});

if (fs.existsSync(distDir)) {
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
  response.status(400).json({
    message: error instanceof Error ? error.message : "Something went wrong."
  });
});

export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`LPMC Scheduler server running on http://localhost:${port}`);
  });
}
