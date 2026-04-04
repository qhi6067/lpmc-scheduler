import { useEffect, useMemo, useState } from "react";

const SCHEDULE_OPTIONS = [
  { key: "techs", label: "Techs" },
  { key: "pharmacists", label: "Pharmacists" }
];

const THEMES = [
  { key: "day", label: "Day" },
  { key: "night", label: "Night" },
  { key: "midnight", label: "Midnight" }
];

const PTO_STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "denied", label: "Denied" }
];

const STATUS_STYLES = {
  approved: "approved",
  denied: "denied",
  pending: "pending"
};

function formatDate(value, options = {}) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options
  }).format(parsed);
}

function formatDateTime(value) {
  if (!value) return "Waiting for review";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function getAssignmentTone(assignment) {
  if (!assignment || assignment === "Off") return "is-off";
  if (/pto/i.test(assignment)) return "is-pto";
  return "is-filled";
}

function getScheduleTypeLabel(scheduleType) {
  return scheduleType === "pharmacists" ? "Pharmacist" : "Tech";
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Something went wrong.");
  return payload;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonLoader() {
  return (
    <>
      <div className="skeleton-hero" aria-hidden="true">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-sub" />
        <div className="skeleton-stats-row">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton-block skeleton-stat" />
          ))}
        </div>
      </div>
      <div className="skeleton-table" aria-hidden="true">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="skeleton-block skeleton-row" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </>
  );
}

// ─── Modal Frame ─────────────────────────────────────────────────────────────

function ModalFrame({ open, title, onClose, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className={`modal-card ${wide ? "modal-card-wide" : ""}`}>
        <div className="modal-topbar">
          <p className="eyebrow">{title}</p>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Theme Picker ─────────────────────────────────────────────────────────────

function ThemePicker({ theme, onChange }) {
  return (
    <div className="theme-picker" role="group" aria-label="Theme selector">
      {THEMES.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`theme-dot theme-dot-${option.key} ${theme === option.key ? "is-active" : ""}`}
          onClick={() => onChange(option.key)}
          aria-label={`${option.label} theme`}
          aria-pressed={theme === option.key}
          title={option.label}
        />
      ))}
    </div>
  );
}

// ─── Alert Banner ────────────────────────────────────────────────────────────

function AlertBanner({ tone, message, onDismiss }) {
  if (!message) return null;
  return (
    <div className={`banner banner-${tone}`} role="alert">
      <span className="banner-text">{message}</span>
      <button type="button" className="banner-dismiss" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

// ─── Top Nav ─────────────────────────────────────────────────────────────────

function TopNav({ activeSchedule, isAdmin, isSystemUser, onScheduleChange, onOpenPtoForm, onOpenAdmin, theme, onThemeChange }) {
  return (
    <header className="top-nav">
      <div className="nav-brand">
        <span className="nav-monogram" aria-hidden="true">LP</span>
        <div className="nav-brand-text">
          <h1 className="nav-title">Scheduler</h1>
          <p className="nav-subtitle">Las Palmas Medical Center</p>
        </div>
      </div>

      <nav className="nav-tabs desktop-tabs" aria-label="Schedule type">
        {SCHEDULE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`tab-button ${activeSchedule === option.key ? "is-active" : ""}`}
            onClick={() => onScheduleChange(option.key)}
            aria-pressed={activeSchedule === option.key}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <div className="nav-end">
        <button type="button" className="ghost-button" onClick={onOpenPtoForm}>
          Request PTO
        </button>
        <button type="button" className="primary-button" onClick={onOpenAdmin}>
          {isAdmin || isSystemUser ? "Dashboard" : "Admin"}
        </button>
        <ThemePicker theme={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}

// ─── Mobile Tab Bar ──────────────────────────────────────────────────────────

function MobileTabBar({ activeSchedule, onScheduleChange }) {
  return (
    <nav className="mobile-tab-bar mobile-only" aria-label="Schedule type">
      {SCHEDULE_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`mobile-tab ${activeSchedule === option.key ? "is-active" : ""}`}
          onClick={() => onScheduleChange(option.key)}
          aria-pressed={activeSchedule === option.key}
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
}

// ─── Hero Panel ──────────────────────────────────────────────────────────────

function HeroPanel({ schedule, activeSchedule, onOpenPtoForm }) {
  const typeLabel = activeSchedule === "pharmacists" ? "Pharmacist" : "Tech";

  if (!schedule) {
    return (
      <section className="hero-panel hero-empty">
        <div className="empty-state-inner">
          <p className="eyebrow">No schedule posted yet</p>
          <h2>Waiting for the first upload</h2>
          <p className="empty-state-hint">
            Once an admin uploads the latest Excel file, the {typeLabel.toLowerCase()} schedule will
            appear here for everyone.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="hero-panel">
      <div className="hero-header">
        <div className="hero-copy">
          <p className="eyebrow">{schedule.facility}</p>
          <h2 className="hero-title">{schedule.rangeLabel}</h2>
          <p className="hero-type-label">{schedule.title}</p>
        </div>
        <div className="hero-actions">
          <a className="primary-button" href={schedule.downloadUrl} download>
            Download Excel
          </a>
          <button type="button" className="ghost-button" onClick={onOpenPtoForm}>
            Request PTO
          </button>
        </div>
      </div>

      <div className="hero-stats-row">
        <div className="hero-stat">
          <span>Uploaded</span>
          <strong>{formatDateTime(schedule.uploadedAt)}</strong>
        </div>
        <div className="hero-stat">
          <span>Start date</span>
          <strong>{formatDate(schedule.startDate)}</strong>
        </div>
        <div className="hero-stat">
          <span>End date</span>
          <strong>{formatDate(schedule.endDate)}</strong>
        </div>
        <div className="hero-stat">
          <span>Staff listed</span>
          <strong>{schedule.employees.length}</strong>
        </div>
        <div className="hero-stat">
          <span>Days posted</span>
          <strong>{schedule.columns.length}</strong>
        </div>
      </div>
    </section>
  );
}

// ─── Schedule Filters ────────────────────────────────────────────────────────

function ScheduleFilters({ search, onSearch, showOnlyAssigned, onToggleAssigned, schedule, visibleCount, totalCount, onClearFilters, hasActiveFilters }) {
  if (!schedule) return null;

  return (
    <section className="filter-bar">
      <label className="filter-search-field">
        <span className="sr-only">Find employee</span>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search employee…"
          aria-label="Search employees"
        />
      </label>

      <div className="filter-right">
        <span className="filter-count">
          {visibleCount} <span className="muted">of {totalCount}</span>
        </span>

        <label className="toggle-label">
          <input
            type="checkbox"
            checked={showOnlyAssigned}
            onChange={(e) => onToggleAssigned(e.target.checked)}
          />
          <span>Filled only</span>
        </label>

        <div className="legend-row">
          <span className="legend-pill is-filled">Scheduled</span>
          <span className="legend-pill is-pto">PTO</span>
          <span className="legend-pill is-off">Off</span>
        </div>

        {hasActiveFilters && (
          <button type="button" className="ghost-button compact-button" onClick={onClearFilters}>
            Clear
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Schedule Table ──────────────────────────────────────────────────────────

function ScheduleTable({ schedule, employees, showOnlyAssigned, search, hasActiveFilters, onClearFilters }) {
  if (!schedule) return null;

  if (employees.length === 0) {
    return (
      <section className="panel empty-search-panel">
        <div>
          <p className="eyebrow">No matches</p>
          <h2>No employees matched those filters.</h2>
          <p className="muted-text">
            {search ? `Nothing matched "${search}".` : "Try clearing the filters to see the full schedule."}
          </p>
        </div>
        {hasActiveFilters && (
          <button type="button" className="ghost-button" onClick={onClearFilters}>
            Reset filters
          </button>
        )}
      </section>
    );
  }

  return (
    <>
      <section className="table-shell desktop-only">
        <div className="table-scroll">
          <table className="schedule-table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                {schedule.columns.map((col) => (
                  <th key={col.label} scope="col">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.name}>
                  <th scope="row" className="employee-name-cell">{employee.name}</th>
                  {employee.assignments.map((assignment, index) => {
                    const display = assignment || "Off";
                    return (
                      <td key={`${employee.name}-${schedule.columns[index]?.label}`} className="schedule-cell">
                        <span className={`cell-badge ${getAssignmentTone(display)}`}>{display}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mobile-cards mobile-only" aria-label="Employee schedules">
        {employees.map((employee) => {
          const entries = schedule.columns
            .map((col, i) => ({ col, assignment: employee.assignments[i] || "Off" }))
            .filter((e) => !showOnlyAssigned || e.assignment !== "Off");

          return (
            <article key={employee.name} className="employee-card">
              <div className="employee-card-header">
                <h3>{employee.name}</h3>
                <span className="entry-count">{entries.length} entries</span>
              </div>
              <div className="assignment-list">
                {entries.map(({ col, assignment }) => (
                  <div key={`${employee.name}-${col.label}`} className={`assignment-pill ${getAssignmentTone(assignment)}`}>
                    <span className="pill-date">{col.label}</span>
                    <strong className="pill-value">{assignment}</strong>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}

// ─── PTO Modal ───────────────────────────────────────────────────────────────

function PtoModal({ open, form, onChange, onSubmit, loading, onClose }) {
  return (
    <ModalFrame open={open} title="Request PTO" onClose={onClose}>
      <div className="modal-body">
        <div className="modal-section-head">
          <h2>Submit a PTO request</h2>
          <p className="helper-text">Goes directly to the admin dashboard for review.</p>
        </div>

        <form className="form-grid" onSubmit={onSubmit}>
          <label className="field">
            <span>Employee name <abbr title="required">*</abbr></span>
            <input
              type="text"
              required
              value={form.employeeName}
              onChange={(e) => onChange("employeeName", e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </label>

          <label className="field">
            <span>Schedule</span>
            <select value={form.scheduleType} onChange={(e) => onChange("scheduleType", e.target.value)}>
              <option value="techs">Techs</option>
              <option value="pharmacists">Pharmacists</option>
            </select>
          </label>

          <label className="field">
            <span>From <abbr title="required">*</abbr></span>
            <input
              type="date"
              required
              value={form.startDate}
              onChange={(e) => onChange("startDate", e.target.value)}
            />
          </label>

          <label className="field">
            <span>To</span>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => onChange("endDate", e.target.value)}
            />
          </label>

          <label className="field field-wide">
            <span>Reason <span className="optional-label">(optional)</span></span>
            <textarea
              rows={3}
              value={form.reason}
              onChange={(e) => onChange("reason", e.target.value)}
              placeholder="Vacation, appointment, family event…"
            />
          </label>

          <div className="modal-actions field-wide">
            <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Sending…" : "Submit request"}
            </button>
          </div>
        </form>
      </div>
    </ModalFrame>
  );
}

// ─── PTO Log ─────────────────────────────────────────────────────────────────

const PTO_TYPE_FILTERS = [
  { key: "all", label: "All positions" },
  { key: "techs", label: "Techs" },
  { key: "pharmacists", label: "Pharmacists" }
];

function PtoLog({ requests, onReview, reviewLoadingId }) {
  const [expandedId, setExpandedId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() =>
    requests.reduce(
      (t, r) => ({ ...t, [r.status]: t[r.status] + 1 }),
      { pending: 0, approved: 0, denied: 0 }
    ), [requests]);

  const typeCounts = useMemo(() =>
    requests.reduce(
      (t, r) => ({ ...t, [r.scheduleType]: (t[r.scheduleType] || 0) + 1 }),
      {}
    ), [requests]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.scheduleType !== typeFilter) return false;
      if (term && !r.employeeName.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [requests, statusFilter, typeFilter, search]);

  const hasFilters = statusFilter !== "all" || typeFilter !== "all" || search.trim().length > 0;

  function toggle(id) {
    setExpandedId((cur) => (cur === id ? "" : id));
  }

  async function handleStatusChange(id, status) {
    const ok = await onReview(id, status);
    if (ok) setExpandedId("");
  }

  function clearFilters() {
    setStatusFilter("all");
    setTypeFilter("all");
    setSearch("");
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PTO Requests</p>
          <h2>Review requests</h2>
        </div>
        {hasFilters && (
          <button type="button" className="ghost-button compact-button" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <div className="pto-log-search">
        <label className="filter-search-field" style={{ flex: 1 }}>
          <span className="sr-only">Search employee</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee…"
            aria-label="Search employees"
          />
        </label>
      </div>

      <div className="pto-filter-group">
        <div className="status-filter-row">
          {PTO_STATUS_FILTERS.map((f) => {
            const count = f.key === "all" ? requests.length : counts[f.key];
            return (
              <button
                key={f.key}
                type="button"
                className={`status-chip ${statusFilter === f.key ? "is-active" : ""}`}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label}
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="status-filter-row">
          {PTO_TYPE_FILTERS.map((f) => {
            const count = f.key === "all" ? requests.length : (typeCounts[f.key] || 0);
            return (
              <button
                key={f.key}
                type="button"
                className={`status-chip ${typeFilter === f.key ? "is-active" : ""}`}
                onClick={() => setTypeFilter(f.key)}
              >
                {f.label}
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="request-list">
        {filtered.length === 0 ? (
          <div className="empty-inline">
            {requests.length === 0
              ? "No PTO requests have been submitted yet."
              : "No requests matched those filters."}
          </div>
        ) : (
          filtered.map((req) => (
            <article
              key={req.id}
              className={`request-card status-${STATUS_STYLES[req.status] || "pending"}`}
            >
              <div className="request-card-main">
                <div className="request-card-top">
                  <h3>{req.employeeName}</h3>
                  <span className={`status-badge badge-${req.status}`}>{req.status}</span>
                </div>
                <div className="request-details">
                  <span className="detail-chip">{getScheduleTypeLabel(req.scheduleType)}</span>
                  <span className="detail-chip">
                    {formatDate(req.startDate)}
                    {req.startDate !== req.endDate ? ` – ${formatDate(req.endDate)}` : ""}
                  </span>
                  <span className="detail-chip muted-chip">Submitted {formatDateTime(req.submittedAt)}</span>
                  {req.reason && <span className="detail-chip">{req.reason}</span>}
                  {req.reviewedAt && <span className="detail-chip muted-chip">Reviewed {formatDateTime(req.reviewedAt)}</span>}
                </div>
              </div>

              <div className="review-actions">
                <button
                  type="button"
                  className="ghost-button compact-button review-toggle"
                  onClick={() => toggle(req.id)}
                  disabled={reviewLoadingId === req.id}
                >
                  Change status
                </button>

                {expandedId === req.id && (
                  <div className="review-choice-row">
                    <button
                      type="button"
                      className={`approve-button ${req.status === "approved" ? "is-current" : ""}`}
                      onClick={() => handleStatusChange(req.id, "approved")}
                      disabled={reviewLoadingId === req.id}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className={`deny-button ${req.status === "denied" ? "is-current" : ""}`}
                      onClick={() => handleStatusChange(req.id, "denied")}
                      disabled={reviewLoadingId === req.id}
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

// ─── Change Password ─────────────────────────────────────────────────────────

function ChangePasswordSection({ isSystem = false, onBack }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setError("");
    setSuccess("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (form.next !== form.confirm) {
      setError("New passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const body = isSystem
        ? { newPassword: form.next }
        : { currentPassword: form.current, newPassword: form.next };
      const payload = await apiRequest("/api/admin/change-password", {
        method: "POST",
        body: JSON.stringify(body)
      });
      setForm({ current: "", next: "", confirm: "" });
      setSuccess(payload.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel change-password-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{isSystem ? "Emergency Access" : "Security"}</p>
          <h2>{isSystem ? "Reset admin password" : "Change password"}</h2>
        </div>
        {onBack && (
          <button type="button" className="ghost-button" onClick={onBack}>
            ← Back
          </button>
        )}
      </div>

      {isSystem && (
        <p className="helper-text" style={{ marginBottom: "1rem" }}>
          You are logged in as the system user. Set a new password for the admin account.
        </p>
      )}

      {success && (
        <div className="inline-success" role="status">{success}</div>
      )}
      {error && (
        <div className="inline-error" role="alert">{error}</div>
      )}

      <form className="form-grid change-password-grid" onSubmit={handleSubmit} autoComplete="off">
        {!isSystem && (
          <label className="field field-wide">
            <span>Current password</span>
            <div className="password-wrapper">
              <input
                type={show ? "text" : "password"}
                required
                autoComplete="current-password"
                value={form.current}
                onChange={(e) => update("current", e.target.value)}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide passwords" : "Show passwords"}
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>
        )}

        <label className="field">
          <span>New password</span>
          <input
            type={show ? "text" : "password"}
            required
            autoComplete="new-password"
            minLength={6}
            value={form.next}
            onChange={(e) => update("next", e.target.value)}
          />
        </label>

        <label className="field">
          <span>Confirm new password</span>
          <input
            type={show ? "text" : "password"}
            required
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => update("confirm", e.target.value)}
          />
        </label>

        {isSystem && (
          <div className="password-wrapper" style={{ marginBottom: "0.5rem" }}>
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide passwords" : "Show passwords"}
            >
              {show ? "Hide" : "Show"}
            </button>
          </div>
        )}

        <div className="modal-actions field-wide">
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ─── Upload Card ─────────────────────────────────────────────────────────────

function UploadCard({ title, schedule, onUpload, loading }) {
  return (
    <article className="upload-card">
      <div className="upload-card-info">
        <p className="eyebrow">{title}</p>
        <h3>{schedule?.rangeLabel || "No file uploaded yet"}</h3>
        <p className="upload-hint">
          {schedule
            ? schedule.sourceFileName
            : "Upload an Excel file to publish the schedule."}
        </p>
      </div>
      <label className="upload-button" aria-label={`Upload ${title}`}>
        <span>{loading ? "Uploading…" : `Upload ${title}`}</span>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
          disabled={loading}
        />
      </label>
    </article>
  );
}

// ─── Admin Panel ─────────────────────────────────────────────────────────────

function AdminPanel({ open, authenticated, isSystemUser, loginForm, onLoginChange, onLoginSubmit, onLogout, loading, schedules, onUpload, uploadState, requests, onReview, reviewLoadingId, closePanel }) {
  const [showPassword, setShowPassword] = useState(false);
  const [view, setView] = useState("dashboard");

  useEffect(() => {
    if (open) setView(isSystemUser ? "changePassword" : "dashboard");
  }, [open]);

  const counts = useMemo(() =>
    requests.reduce(
      (t, r) => ({ ...t, [r.status]: t[r.status] + 1 }),
      { pending: 0, approved: 0, denied: 0 }
    ), [requests]);

  const showDashboard = authenticated && !isSystemUser;

  return (
    <ModalFrame open={open} title="Admin" onClose={closePanel} wide>
      {!authenticated && !isSystemUser ? (
        <div className="modal-body">
          <div className="modal-section-head">
            <h2>Admin sign in</h2>
          </div>
          <form className="form-grid login-grid" onSubmit={onLoginSubmit} autoComplete="off">
            <label className="field">
              <span>Username</span>
              <input
                type="text"
                required
                autoComplete="off"
                value={loginForm.username}
                onChange={(e) => onLoginChange("username", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <div className="password-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  value={loginForm.password}
                  onChange={(e) => onLoginChange("password", e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <button className="primary-button field-wide" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      ) : isSystemUser ? (
        <>
          <div className="modal-body">
            <div className="section-heading">
              <div>
                <p className="eyebrow">System access</p>
                <h2>Emergency login</h2>
              </div>
              <button type="button" className="ghost-button" onClick={onLogout}>
                Sign out
              </button>
            </div>
          </div>
          <ChangePasswordSection isSystem />
        </>
      ) : (
        <>
          <div className="modal-body">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Admin dashboard</p>
                <h2>Schedules &amp; PTO</h2>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="ghost-button" onClick={() => setView((v) => v === "changePassword" ? "dashboard" : "changePassword")}>
                  {view === "changePassword" ? "← Dashboard" : "Change Password"}
                </button>
                <button type="button" className="ghost-button" onClick={onLogout}>
                  Sign out
                </button>
              </div>
            </div>

            {view === "dashboard" && (
              <>
                <div className="upload-grid">
                  <UploadCard
                    title="Tech schedule"
                    schedule={schedules.techs}
                    onUpload={(file) => onUpload("techs", file)}
                    loading={uploadState.techs}
                  />
                  <UploadCard
                    title="Pharmacist schedule"
                    schedule={schedules.pharmacists}
                    onUpload={(file) => onUpload("pharmacists", file)}
                    loading={uploadState.pharmacists}
                  />
                </div>

                <div className="admin-stats-row">
                  <article className="admin-stat-card admin-stat-pending">
                    <span>Pending</span>
                    <strong>{counts.pending}</strong>
                  </article>
                  <article className="admin-stat-card admin-stat-approved">
                    <span>Approved</span>
                    <strong>{counts.approved}</strong>
                  </article>
                  <article className="admin-stat-card admin-stat-denied">
                    <span>Denied</span>
                    <strong>{counts.denied}</strong>
                  </article>
                </div>
              </>
            )}
          </div>

          {view === "dashboard" && (
            <PtoLog requests={requests} onReview={onReview} reviewLoadingId={reviewLoadingId} />
          )}
          {view === "changePassword" && (
            <ChangePasswordSection />
          )}
        </>
      )}
    </ModalFrame>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("lpmc-theme") || "night");
  const [schedules, setSchedules] = useState({ techs: null, pharmacists: null });
  const [activeSchedule, setActiveSchedule] = useState("techs");
  const [ptoRequests, setPtoRequests] = useState([]);
  const [adminOpen, setAdminOpen] = useState(false);
  const [ptoModalOpen, setPtoModalOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSystemUser, setIsSystemUser] = useState(false);
  const [pageMessage, setPageMessage] = useState("");
  const [pageError, setPageError] = useState("");
  const [search, setSearch] = useState("");
  const [showOnlyAssigned, setShowOnlyAssigned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [ptoSubmitting, setPtoSubmitting] = useState(false);
  const [reviewLoadingId, setReviewLoadingId] = useState("");
  const [uploadState, setUploadState] = useState({ techs: false, pharmacists: false });
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [ptoForm, setPtoForm] = useState({
    employeeName: "",
    scheduleType: "techs",
    startDate: "",
    endDate: "",
    reason: ""
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("lpmc-theme", theme);
  }, [theme]);

  useEffect(() => { loadPage(); }, []);

  useEffect(() => {
    if (adminOpen && isAdmin) loadAdminPtoRequests();
  }, [adminOpen, isAdmin]);

  const selectedSchedule = schedules[activeSchedule];

  const filteredEmployees = useMemo(() => {
    if (!selectedSchedule) return [];
    return selectedSchedule.employees.filter((e) =>
      e.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [search, selectedSchedule]);

  const visibleRequests = useMemo(
    () => [...ptoRequests].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [ptoRequests]
  );

  const hasActiveFilters = search.trim().length > 0 || showOnlyAssigned;

  async function loadAdminPtoRequests() {
    try {
      const payload = await apiRequest("/api/admin/pto-requests");
      setPtoRequests(payload.requests);
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function loadPage() {
    setLoading(true);
    setPageError("");
    try {
      const [schedulePayload, sessionPayload] = await Promise.all([
        apiRequest("/api/schedules"),
        apiRequest("/api/auth/session")
      ]);
      setSchedules(schedulePayload.schedules);
      setIsAdmin(sessionPayload.authenticated);
      setIsSystemUser(Boolean(sessionPayload.isSystem));
      if (!schedulePayload.schedules.techs && schedulePayload.schedules.pharmacists) {
        setActiveSchedule("pharmacists");
      }
      if (sessionPayload.authenticated) {
        const ptoPayload = await apiRequest("/api/admin/pto-requests");
        setPtoRequests(ptoPayload.requests);
      } else {
        setPtoRequests([]);
      }
    } catch (error) {
      setPageError(error.message);
    } finally {
      setLoading(false);
    }
  }

  function updateLoginForm(field, value) {
    setLoginForm((c) => ({ ...c, [field]: value }));
  }

  function updatePtoForm(field, value) {
    setPtoForm((c) => ({ ...c, [field]: value }));
  }

  function resetFilters() {
    setSearch("");
    setShowOnlyAssigned(false);
  }

  function openPtoModal() {
    setPtoForm((c) => ({ ...c, scheduleType: activeSchedule }));
    setPtoModalOpen(true);
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    setPageError("");
    try {
      const result = await apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify(loginForm) });
      setLoginForm({ username: "", password: "" });
      if (result.isSystem) {
        setIsSystemUser(true);
        setIsAdmin(false);
        setPageMessage("System access granted. You may reset the admin password.");
      } else {
        setIsAdmin(true);
        setIsSystemUser(false);
        await loadAdminPtoRequests();
        setPageMessage("Admin access granted.");
      }
    } catch (error) {
      setPageError(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function closeAdminPanel() {
    setAdminOpen(false);
    setLoginForm({ username: "", password: "" });
  }

  async function handleLogout() {
    await apiRequest("/api/auth/logout", { method: "POST" });
    setIsAdmin(false);
    setIsSystemUser(false);
    setPtoRequests([]);
    setPageMessage("Signed out of admin session.");
  }

  async function handleUpload(scheduleType, file) {
    setUploadState((c) => ({ ...c, [scheduleType]: true }));
    setPageError("");
    try {
      const payload = new FormData();
      payload.append("file", file);
      const response = await apiRequest(`/api/admin/upload/${scheduleType}`, {
        method: "POST",
        body: payload
      });
      setSchedules((c) => ({ ...c, [scheduleType]: response.schedule }));
      setActiveSchedule(scheduleType);
      setPageMessage(response.message);
    } catch (error) {
      setPageError(error.message);
    } finally {
      setUploadState((c) => ({ ...c, [scheduleType]: false }));
    }
  }

  async function handlePtoSubmit(event) {
    event.preventDefault();
    setPageError("");
    setPtoSubmitting(true);
    const normalizedEnd = ptoForm.endDate || ptoForm.startDate;
    if (normalizedEnd < ptoForm.startDate) {
      setPageError("The end date cannot be before the start date.");
      setPtoSubmitting(false);
      return;
    }
    try {
      const payload = await apiRequest("/api/pto-requests", {
        method: "POST",
        body: JSON.stringify({ ...ptoForm, endDate: normalizedEnd })
      });
      if (isAdmin) setPtoRequests((c) => [payload.request, ...c]);
      setPtoForm({ employeeName: "", scheduleType: activeSchedule, startDate: "", endDate: "", reason: "" });
      setPtoModalOpen(false);
      setPageMessage("PTO request submitted for admin review.");
    } catch (error) {
      setPageError(error.message);
    } finally {
      setPtoSubmitting(false);
    }
  }

  async function handleReview(requestId, status) {
    setReviewLoadingId(requestId);
    setPageError("");
    try {
      const payload = await apiRequest(`/api/admin/pto-requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setPtoRequests(payload.requests);
      setPageMessage(payload.message);
      return true;
    } catch (error) {
      setPageError(error.message);
      return false;
    } finally {
      setReviewLoadingId("");
    }
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <TopNav
        activeSchedule={activeSchedule}
        isAdmin={isAdmin}
        isSystemUser={isSystemUser}
        onScheduleChange={setActiveSchedule}
        onOpenPtoForm={openPtoModal}
        onOpenAdmin={() => setAdminOpen(true)}
        theme={theme}
        onThemeChange={setTheme}
      />

      <main className="page" id="main-content">
        <AlertBanner tone="success" message={pageMessage} onDismiss={() => setPageMessage("")} />
        <AlertBanner tone="error" message={pageError} onDismiss={() => setPageError("")} />

        {loading ? (
          <SkeletonLoader />
        ) : (
          <>
            <HeroPanel
              schedule={selectedSchedule}
              activeSchedule={activeSchedule}
              onOpenPtoForm={openPtoModal}
            />
            <ScheduleFilters
              search={search}
              onSearch={setSearch}
              showOnlyAssigned={showOnlyAssigned}
              onToggleAssigned={setShowOnlyAssigned}
              schedule={selectedSchedule}
              visibleCount={filteredEmployees.length}
              totalCount={selectedSchedule?.employees.length ?? 0}
              onClearFilters={resetFilters}
              hasActiveFilters={hasActiveFilters}
            />
            <ScheduleTable
              schedule={selectedSchedule}
              employees={filteredEmployees}
              showOnlyAssigned={showOnlyAssigned}
              search={search}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={resetFilters}
            />
          </>
        )}
      </main>

      <MobileTabBar activeSchedule={activeSchedule} onScheduleChange={setActiveSchedule} />

      <PtoModal
        open={ptoModalOpen}
        form={ptoForm}
        onChange={updatePtoForm}
        onSubmit={handlePtoSubmit}
        loading={ptoSubmitting}
        onClose={() => setPtoModalOpen(false)}
      />

      <AdminPanel
        open={adminOpen}
        authenticated={isAdmin}
        isSystemUser={isSystemUser}
        loginForm={loginForm}
        onLoginChange={updateLoginForm}
        onLoginSubmit={handleLoginSubmit}
        onLogout={handleLogout}
        loading={authLoading}
        schedules={schedules}
        onUpload={handleUpload}
        uploadState={uploadState}
        requests={visibleRequests}
        onReview={handleReview}
        reviewLoadingId={reviewLoadingId}
        closePanel={closeAdminPanel}
      />
    </div>
  );
}
