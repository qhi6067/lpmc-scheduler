import { useEffect, useMemo, useRef, useState } from "react";

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

function parseDisplayDate(value) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (match) {
      const [, year, month, day] = match;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
  }

  return new Date(value);
}

function formatDate(value, options = {}) {
  if (!value) return "—";
  const parsed = parseDisplayDate(value);
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

function isAttachmentOnlySchedule(schedule) {
  return Boolean(schedule) && schedule.parseStatus === "attachment_only";
}

function getExcelColumnLabel(index) {
  let label = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }

  return label;
}

function createUploadRangeState(schedules = {}) {
  return {
    techs: {
      startDate: schedules.techs?.startDate || "",
      endDate: schedules.techs?.endDate || ""
    },
    pharmacists: {
      startDate: schedules.pharmacists?.startDate || "",
      endDate: schedules.pharmacists?.endDate || ""
    }
  };
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
    <div
      className="modal-shell"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <div
        className={`modal-card ${wide ? "modal-card-wide" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
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

// ─── Bell Icon ───────────────────────────────────────────────────────────────

function BellIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// ─── Notification Bell ───────────────────────────────────────────────────────

function NotificationBell({ notifications, onDismiss, onDismissAll }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const count = notifications.length;

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(e) {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div className="notif-bell-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className={`notif-bell-button ${count > 0 ? "has-notifs" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `${count} notification${count !== 1 ? "s" : ""}` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <BellIcon />
        {count > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown" role="menu" aria-label="Notifications">
          <div className="notif-dropdown-header">
            <span className="notif-dropdown-title">Notifications</span>
            {count > 0 && (
              <button
                type="button"
                className="notif-clear-all"
                onClick={() => { onDismissAll(); setOpen(false); }}
              >
                Clear all
              </button>
            )}
          </div>
          {count === 0 ? (
            <p className="notif-empty">No new notifications</p>
          ) : (
            <div className="notif-list">
              {notifications.map((n) => (
                <div key={n.id} className={`notif-item notif-${n.tone}`}>
                  <span className="notif-message">{n.message}</span>
                  <div className="notif-item-actions">
                    {n.action && (
                      <button
                        type="button"
                        className="notif-action-btn"
                        onClick={() => { n.action.callback(); onDismiss(n.id); setOpen(false); }}
                      >
                        {n.action.label}
                      </button>
                    )}
                    <button
                      type="button"
                      className="notif-dismiss-btn"
                      onClick={() => onDismiss(n.id)}
                      aria-label="Dismiss notification"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Top Nav ─────────────────────────────────────────────────────────────────

function TopNav({ activeSchedule, isAdmin, isSystemUser, onScheduleChange, onOpenPtoForm, onOpenAdmin, theme, onThemeChange, notifications, onDismissNotification, onDismissAllNotifications }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function closeMenu() { setMobileMenuOpen(false); }

  return (
    <>
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
          <NotificationBell
            notifications={notifications}
            onDismiss={onDismissNotification}
            onDismissAll={onDismissAllNotifications}
          />
          <button type="button" className="primary-button" onClick={onOpenAdmin}>
            {isAdmin || isSystemUser ? "Dashboard" : "Admin"}
          </button>
          <ThemePicker theme={theme} onChange={onThemeChange} />
        </div>

        {/* Mobile-only: bell + hamburger */}
        <div className="nav-mobile-controls">
          <NotificationBell
            notifications={notifications}
            onDismiss={onDismissNotification}
            onDismissAll={onDismissAllNotifications}
          />
          <label className="hamburger" aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}>
            <input
              type="checkbox"
              checked={mobileMenuOpen}
              onChange={(e) => setMobileMenuOpen(e.target.checked)}
            />
            <svg viewBox="0 0 32 32">
              <path
                className="line line-top-bottom"
                d="M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22"
              />
              <path className="line" d="M7 16 27 16" />
            </svg>
          </label>
        </div>
      </header>

      {/* Mobile dropdown menu — rendered below the sticky header */}
      {mobileMenuOpen && (
        <div className="nav-mobile-menu" role="dialog" aria-label="Navigation menu">
          <nav className="mobile-menu-tabs" aria-label="Schedule type">
            {SCHEDULE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`mobile-menu-tab ${activeSchedule === option.key ? "is-active" : ""}`}
                onClick={() => { onScheduleChange(option.key); closeMenu(); }}
                aria-pressed={activeSchedule === option.key}
              >
                {option.label}
              </button>
            ))}
          </nav>

          <div className="mobile-menu-actions">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => { onOpenPtoForm(); closeMenu(); }}
            >
              Request PTO
            </button>
            <button
              type="button"
              className="mobile-menu-btn mobile-menu-btn-primary"
              onClick={() => { onOpenAdmin(); closeMenu(); }}
            >
              {isAdmin || isSystemUser ? "Dashboard" : "Admin"}
            </button>
          </div>

          <div className="mobile-menu-theme">
            <span className="mobile-menu-theme-label">Theme</span>
            <ThemePicker theme={theme} onChange={onThemeChange} />
          </div>
        </div>
      )}
    </>
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
  const attachmentOnly = isAttachmentOnlySchedule(schedule);

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
          {attachmentOnly && (
            <p className="helper-text hero-note">
              {schedule.parseMessage || "This file is available as an Excel attachment because it could not be rendered as a schedule grid."}
            </p>
          )}
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
          <span>{attachmentOnly ? "Display mode" : "Staff listed"}</span>
          <strong>{attachmentOnly ? "Attachment only" : schedule.employees.length}</strong>
        </div>
        <div className="hero-stat">
          <span>{attachmentOnly ? "Schedule view" : "Days posted"}</span>
          <strong>{attachmentOnly ? "Excel file" : schedule.columns.length}</strong>
        </div>
      </div>
    </section>
  );
}

// ─── Schedule Filters ────────────────────────────────────────────────────────

function ScheduleFilters({ search, onSearch, showOnlyAssigned, onToggleAssigned, schedule, visibleCount, totalCount, onClearFilters, hasActiveFilters }) {
  if (!schedule || isAttachmentOnlySchedule(schedule)) return null;

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

function AttachmentPreview({ schedule }) {
  const [preview, setPreview] = useState({ loading: true, error: "", workbook: null });
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setPreview({ loading: true, error: "", workbook: null });
      setActiveSheetIndex(0);

      try {
        const payload = await apiRequest(schedule.previewUrl);

        if (!cancelled) {
          setPreview({ loading: false, error: "", workbook: payload.preview });
        }
      } catch (error) {
        if (!cancelled) {
          setPreview({
            loading: false,
            error: error.message || "Could not load workbook preview.",
            workbook: null
          });
        }
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [schedule.previewUrl, schedule.uploadedAt]);

  const workbook = preview.workbook;
  const sheets = workbook?.sheets ?? [];
  const activeSheet = sheets[activeSheetIndex] ?? sheets[0] ?? null;
  const normalizedSearch = search.trim().toLowerCase();
  const baseRows = activeSheet?.rows ?? [];
  const headerRow = baseRows[0] ?? [];
  const bodyRows = baseRows.slice(1);
  const indexedBodyRows = bodyRows.map((row, index) => ({
    row,
    sourceRowIndex: index + 1
  }));
  const matchingBodyRows = normalizedSearch
    ? indexedBodyRows.filter(({ row }) =>
        row.some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch))
      )
    : indexedBodyRows;
  const visibleRows = headerRow.length > 0
    ? [{ row: headerRow, sourceRowIndex: 0 }, ...matchingBodyRows]
    : matchingBodyRows;
  const hasSearch = normalizedSearch.length > 0;
  const visibleMatchCount = matchingBodyRows.length;
  const hasFilteredResults = visibleRows.length > 0;

  return (
    <section className="panel excel-preview-panel">
      <div className="attachment-preview-header">
        <div>
          <p className="eyebrow">Attachment Posted</p>
          <h2>Excel attachment preview</h2>
          <p className="muted-text">
            {schedule.parseMessage || "The uploaded workbook is shown below because the schedule grid could not be rendered automatically."}
          </p>
        </div>
        <a className="ghost-button" href={schedule.downloadUrl} download>
          Download Excel
        </a>
      </div>

      {preview.loading && (
        <div className="excel-preview-empty">
          <p className="helper-text">Loading workbook preview...</p>
        </div>
      )}

      {!preview.loading && preview.error && (
        <div className="excel-preview-empty">
          <p className="muted-text">{preview.error}</p>
        </div>
      )}

      {!preview.loading && !preview.error && activeSheet && (
        <>
          {sheets.length > 1 && (
            <div className="excel-sheet-tabs" role="tablist" aria-label="Workbook sheets">
              {sheets.map((sheet, index) => (
                <button
                  key={sheet.name}
                  type="button"
                  role="tab"
                  className={`excel-sheet-tab ${index === activeSheetIndex ? "is-active" : ""}`}
                  onClick={() => setActiveSheetIndex(index)}
                  aria-selected={index === activeSheetIndex}
                >
                  {sheet.name}
                </button>
              ))}
            </div>
          )}

          <div className="excel-preview-toolbar">
            <label className="filter-search-field excel-preview-search">
              <span className="sr-only">Search workbook preview</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search names, shifts, or notes in this sheet"
                aria-label="Search workbook preview"
              />
            </label>
            <div className="excel-preview-summary">
              <span>
                {hasSearch
                  ? `${visibleMatchCount} matching row${visibleMatchCount === 1 ? "" : "s"}`
                  : `${Math.max(bodyRows.length, 0)} data row${bodyRows.length === 1 ? "" : "s"}`}
              </span>
              {hasSearch && (
                <button type="button" className="ghost-button excel-preview-clear" onClick={() => setSearch("")}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="excel-preview-meta">
            <span>{activeSheet.name}</span>
            <span>{activeSheet.totalRows || 0} rows</span>
            <span>{activeSheet.totalColumns || 0} columns</span>
          </div>

          {hasFilteredResults ? (
            <div className="excel-preview-scroll">
              <table className="excel-preview-table">
                <thead>
                  <tr>
                    <th className="excel-corner" />
                    {(visibleRows[0]?.row ?? []).map((_, index) => (
                      <th key={getExcelColumnLabel(index)}>{getExcelColumnLabel(index)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ row, sourceRowIndex }, rowIndex) => {
                    return (
                      <tr key={`${activeSheet.name}-${sourceRowIndex + 1}-${rowIndex + 1}`}>
                        <th>{sourceRowIndex + 1}</th>
                      {row.map((value, columnIndex) => (
                        <td
                          key={`${activeSheet.name}-${sourceRowIndex + 1}-${columnIndex + 1}`}
                          className={
                            hasSearch && String(value ?? "").toLowerCase().includes(normalizedSearch)
                              ? "excel-match-cell"
                              : ""
                          }
                        >
                          {value || "\u00A0"}
                        </td>
                      ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : hasSearch ? (
            <div className="excel-preview-empty">
              <p className="helper-text">No rows in this sheet match "{search.trim()}".</p>
            </div>
          ) : (
            <div className="excel-preview-empty">
              <p className="helper-text">This workbook does not contain visible cell data to preview.</p>
            </div>
          )}

          {(activeSheet.truncatedRows || activeSheet.truncatedColumns || workbook?.truncatedSheets) && (
            <p className="helper-text excel-preview-note">
              Preview trimmed for readability. Download the Excel file to see the full workbook.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ScheduleTable({ schedule, employees, showOnlyAssigned, search, hasActiveFilters, onClearFilters }) {
  if (!schedule) return null;

  if (isAttachmentOnlySchedule(schedule)) {
    return <AttachmentPreview schedule={schedule} />;
  }

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

const PTO_LOG_MONTHS = [
  { key: "all", label: "All months" },
  { key: "1", label: "January" },
  { key: "2", label: "February" },
  { key: "3", label: "March" },
  { key: "4", label: "April" },
  { key: "5", label: "May" },
  { key: "6", label: "June" },
  { key: "7", label: "July" },
  { key: "8", label: "August" },
  { key: "9", label: "September" },
  { key: "10", label: "October" },
  { key: "11", label: "November" },
  { key: "12", label: "December" }
];

function PtoLog({ requests, onReview, reviewLoadingId, onClearRequest, clearLoadingId, onClearReviewed, clearingReviewed }) {
  const [expandedId, setExpandedId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [logMonth, setLogMonth] = useState("all");
  const [logYear, setLogYear] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef(null);

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
  const reviewedCount = counts.approved + counts.denied;
  const availableLogYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = new Set([currentYear]);

    for (let offset = 1; offset <= 6; offset += 1) {
      years.add(currentYear - offset);
      years.add(currentYear + offset);
    }

    return ["all", ...[...years].sort((left, right) => right - left).map(String)];
  }, []);
  const logSearchParams = new URLSearchParams();

  if (logMonth !== "all") {
    logSearchParams.set("month", logMonth);
  }

  if (logYear !== "all") {
    logSearchParams.set("year", logYear);
  }

  const ptoLogDownloadUrl = logSearchParams.size > 0
    ? `/api/admin/pto-log.csv?${logSearchParams.toString()}`
    : "/api/admin/pto-log.csv";

  function toggle(id) {
    setExpandedId((cur) => (cur === id ? "" : id));
  }

  async function handleStatusChange(id, status) {
    const ok = await onReview(id, status);
    if (ok) setExpandedId("");
  }

  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (typeFilter !== "all" ? 1 : 0);

  useEffect(() => {
    if (!filterOpen) return undefined;
    function handleOutside(e) {
      if (!filterRef.current?.contains(e.target)) setFilterOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [filterOpen]);

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
        <div className="pto-header-actions">
          {reviewedCount > 0 && (
            <button
              type="button"
              className="deny-button compact-button pto-clear-reviewed-button"
              onClick={onClearReviewed}
              disabled={clearingReviewed}
            >
              {clearingReviewed ? "Clearing…" : "Clear reviewed"}
            </button>
          )}
        </div>
      </div>

      {/* Search + filter row */}
      <div className="pto-toolbar">
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

        {/* Filter dropdown */}
        <div className="pto-filter-dropdown-wrap" ref={filterRef}>
          <button
            type="button"
            className={`ghost-button compact-button pto-filter-btn ${filterOpen ? "is-open" : ""}`}
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            Filters
            {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
          </button>

          {filterOpen && (
            <div className="pto-filter-dropdown" role="dialog" aria-label="Filters">
              <div className="pto-filter-section">
                <p className="pto-filter-section-label">Status</p>
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
              </div>

              <div className="pto-filter-section">
                <p className="pto-filter-section-label">Position</p>
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

              {(activeFilterCount > 0 || search.trim()) && (
                <button type="button" className="ghost-button compact-button pto-filter-clear" onClick={() => { clearFilters(); setFilterOpen(false); }}>
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>

        <div className="pto-log-export-bar">
          <label className="field pto-log-filter-field">
            <span>Month</span>
            <select value={logMonth} onChange={(e) => setLogMonth(e.target.value)}>
              {PTO_LOG_MONTHS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <label className="field pto-log-filter-field">
            <span>Year</span>
            <select value={logYear} onChange={(e) => setLogYear(e.target.value)}>
              {availableLogYears.map((y) => <option key={y} value={y}>{y === "all" ? "All" : y}</option>)}
            </select>
          </label>
          <a className="ghost-button compact-button pto-log-download-button" href={ptoLogDownloadUrl}>
            Export CSV
          </a>
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
                  disabled={reviewLoadingId === req.id || clearLoadingId === req.id}
                >
                  Change status
                </button>

                {req.status !== "pending" && (
                  <button
                    type="button"
                    className="ghost-button compact-button request-clear-button"
                    onClick={() => onClearRequest(req.id)}
                    disabled={clearLoadingId === req.id || reviewLoadingId === req.id}
                  >
                    {clearLoadingId === req.id ? "Clearing..." : "Clear"}
                  </button>
                )}

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

function UploadCard({ title, schedule, uploadDates, onUploadDateChange, onUpload, loading }) {
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

      <div className="upload-card-actions">
        <div className="form-grid upload-date-grid">
          <label className="field">
            <span>Start date</span>
            <input
              type="date"
              value={uploadDates.startDate}
              onChange={(e) => onUploadDateChange("startDate", e.target.value)}
              disabled={loading}
            />
          </label>

          <label className="field">
            <span>End date</span>
            <input
              type="date"
              value={uploadDates.endDate}
              onChange={(e) => onUploadDateChange("endDate", e.target.value)}
              disabled={loading}
            />
          </label>
        </div>

        <p className="upload-meta-note">
          Parsing starts at the row that contains <strong>Name/Date</strong>. The date range is
          optional and will never block the upload.
        </p>

        <label className="upload-button" aria-label={`Upload ${title}`}>
          <span>{loading ? "Uploading..." : `Upload ${title}`}</span>
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
      </div>
    </article>
  );
}

// ─── Shift Editor ────────────────────────────────────────────────────────────

function ManualEntryView({ schedules, activeType, onTypeChange, onCellSave, onBack }) {
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const pendingRef = useRef({});
  const schedule = schedules[activeType];

  function handleChange(empIdx, colIdx, value) {
    const key = `${empIdx}-${colIdx}`;
    const original = schedule?.employees[empIdx]?.assignments[colIdx] ?? "";
    if (value === original) {
      delete pendingRef.current[key];
    } else {
      pendingRef.current[key] = { empIdx, colIdx, value };
    }
    setHasChanges(Object.keys(pendingRef.current).length > 0);
  }

  function handleTypeChange(type) {
    pendingRef.current = {};
    setHasChanges(false);
    setSaveResult(null);
    onTypeChange(type);
  }

  async function handleSave() {
    const changes = Object.values(pendingRef.current);
    if (!changes.length) return;
    setSaving(true);
    setSaveResult(null);
    let failed = 0;
    for (const { empIdx, colIdx, value } of changes) {
      try { await onCellSave(empIdx, colIdx, value); }
      catch { failed++; }
    }
    pendingRef.current = {};
    setHasChanges(false);
    setSaving(false);
    setSaveResult(failed === 0
      ? { ok: true, message: `${changes.length} cell${changes.length !== 1 ? "s" : ""} saved.` }
      : { ok: false, message: `${failed} cell${failed !== 1 ? "s" : ""} failed to save.` });
  }

  return (
    <div className="shift-editor-view">
      <div className="shift-editor-toolbar">
        <button type="button" className="ghost-button compact-button" onClick={onBack}>
          ← Back
        </button>
        <div className="shift-type-tabs">
          {[{ key: "techs", label: "Techs" }, { key: "pharmacists", label: "Pharmacists" }].map((t) => (
            <button
              key={t.key}
              type="button"
              className={`shift-type-tab ${activeType === t.key ? "is-active" : ""}`}
              onClick={() => handleTypeChange(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {hasChanges && <span className="shift-unsaved-dot" aria-label="Unsaved changes">Unsaved changes</span>}
        <button
          type="button"
          className="primary-button compact-button shift-save-btn"
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? "Saving…" : "Confirm Changes"}
        </button>
      </div>

      {saveResult && (
        <div className={saveResult.ok ? "inline-success" : "inline-error"} role={saveResult.ok ? "status" : "alert"}>
          {saveResult.message}
        </div>
      )}

      {!schedule || schedule.employees.length === 0 ? (
        <div className="shift-editor-empty">
          No {activeType} schedule is available to edit.
        </div>
      ) : (
        <div className="shift-edit-table-wrap">
          <table className="shift-edit-table">
            <thead>
              <tr>
                <th className="shift-name-col">Employee</th>
                {schedule.columns.map((col) => (
                  <th key={col.label}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedule.employees.map((emp, empIdx) => (
                <tr key={emp.name}>
                  <td className="shift-name-col shift-name-cell">{emp.name}</td>
                  {schedule.columns.map((col, colIdx) => (
                    <td key={`${emp.name}-${col.label}`} className="shift-edit-cell">
                      <input
                        type="text"
                        defaultValue={emp.assignments[colIdx] ?? ""}
                        onChange={(e) => handleChange(empIdx, colIdx, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                        aria-label={`${emp.name} — ${col.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DirectSwitchView({ schedules, activeType, onTypeChange, onScheduleUpdate, onBack }) {
  const [colIdx, setColIdx] = useState("");
  const [emp1Idx, setEmp1Idx] = useState("");
  const [emp2Idx, setEmp2Idx] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  const schedule = schedules[activeType];
  const employees = schedule?.employees ?? [];
  const columns = schedule?.columns ?? [];

  const emp1 = employees[Number(emp1Idx)];
  const emp2 = employees[Number(emp2Idx)];
  const col = columns[Number(colIdx)];
  const canSwap = emp1Idx !== "" && emp2Idx !== "" && colIdx !== "" && emp1Idx !== emp2Idx;

  async function handleSwap(e) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const payload = await apiRequest(`/api/admin/schedules/${activeType}/swap`, {
        method: "POST",
        body: JSON.stringify({
          employee1Index: Number(emp1Idx),
          employee2Index: Number(emp2Idx),
          columnIndex: Number(colIdx)
        })
      });
      onScheduleUpdate(activeType, payload.schedule);
      setResult({ ok: true, message: payload.message });
      setEmp1Idx(""); setEmp2Idx(""); setColIdx("");
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  function handleTypeChange(t) {
    onTypeChange(t);
    setEmp1Idx(""); setEmp2Idx(""); setColIdx(""); setResult(null);
  }

  return (
    <div className="shift-editor-view">
      <div className="shift-editor-toolbar">
        <button type="button" className="ghost-button compact-button" onClick={onBack}>
          ← Back
        </button>
        <div className="shift-type-tabs">
          {[{ key: "techs", label: "Techs" }, { key: "pharmacists", label: "Pharmacists" }].map((t) => (
            <button
              key={t.key}
              type="button"
              className={`shift-type-tab ${activeType === t.key ? "is-active" : ""}`}
              onClick={() => handleTypeChange(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {result && (
        <div className={result.ok ? "inline-success" : "inline-error"} role={result.ok ? "status" : "alert"}>
          {result.message}
        </div>
      )}

      {!schedule || employees.length === 0 ? (
        <div className="shift-editor-empty">No {activeType} schedule available.</div>
      ) : (
        <form className="direct-switch-form" onSubmit={handleSwap}>
          <div className="form-grid">
            <label className="field field-wide">
              <span>Day to swap</span>
              <select value={colIdx} onChange={(e) => setColIdx(e.target.value)} required>
                <option value="">— Select day —</option>
                {columns.map((col, i) => (
                  <option key={i} value={i}>{col.label}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Employee 1</span>
              <select value={emp1Idx} onChange={(e) => setEmp1Idx(e.target.value)} required>
                <option value="">— Select employee —</option>
                {employees.map((emp, i) => (
                  <option key={i} value={i}>{emp.name}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Employee 2</span>
              <select value={emp2Idx} onChange={(e) => setEmp2Idx(e.target.value)} required>
                <option value="">— Select employee —</option>
                {employees.map((emp, i) => (
                  <option key={i} value={i} disabled={String(i) === emp1Idx}>{emp.name}</option>
                ))}
              </select>
            </label>
          </div>

          {canSwap && col && (
            <div className="swap-preview">
              <p className="swap-preview-label">Preview — {col.label}</p>
              <div className="swap-preview-row">
                <div className="swap-preview-card">
                  <span className="swap-preview-name">{emp1?.name}</span>
                  <span className="swap-arrow">→</span>
                  <span className={`cell-badge ${getAssignmentTone(emp2?.assignments[Number(colIdx)] || "Off")}`}>
                    {emp2?.assignments[Number(colIdx)] || "Off"}
                  </span>
                </div>
                <div className="swap-preview-divider">⇄</div>
                <div className="swap-preview-card">
                  <span className="swap-preview-name">{emp2?.name}</span>
                  <span className="swap-arrow">→</span>
                  <span className={`cell-badge ${getAssignmentTone(emp1?.assignments[Number(colIdx)] || "Off")}`}>
                    {emp1?.assignments[Number(colIdx)] || "Off"}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="submit" className="primary-button" disabled={!canSwap || submitting}>
              {submitting ? "Swapping…" : "Confirm Swap"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ShiftEditorPanel({ schedules, onScheduleUpdate, onBack }) {
  const [mode, setMode] = useState(null);
  const [activeType, setActiveType] = useState("techs");

  async function handleCellSave(empIdx, colIdx, value) {
    const payload = await apiRequest(`/api/admin/schedules/${activeType}/cells`, {
      method: "PATCH",
      body: JSON.stringify({ employeeIndex: empIdx, columnIndex: colIdx, value })
    });
    onScheduleUpdate(activeType, payload.schedule);
  }

  return (
    <div className="modal-body">
      <button type="button" className="ghost-button compact-button shift-back-btn" onClick={onBack}>
        ← Dashboard
      </button>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Schedule Management</p>
          <h2>Edit Shifts</h2>
        </div>
      </div>

      {mode === null && (
        <div className="shift-mode-grid">
          <button type="button" className="shift-mode-card" onClick={() => setMode("manual")}>
            <strong>Manual Entry</strong>
            <span>Edit any cell directly in the schedule table. Free-form, no restrictions.</span>
          </button>
          <button type="button" className="shift-mode-card" onClick={() => setMode("switch")}>
            <strong>Direct Switch</strong>
            <span>Swap shifts between two employees on a specific day.</span>
          </button>
        </div>
      )}

      {mode === "manual" && (
        <ManualEntryView
          schedules={schedules}
          activeType={activeType}
          onTypeChange={setActiveType}
          onCellSave={handleCellSave}
          onBack={() => setMode(null)}
        />
      )}

      {mode === "switch" && (
        <DirectSwitchView
          schedules={schedules}
          activeType={activeType}
          onTypeChange={setActiveType}
          onScheduleUpdate={onScheduleUpdate}
          onBack={() => setMode(null)}
        />
      )}
    </div>
  );
}

// ─── Admin Panel ─────────────────────────────────────────────────────────────

function AdminPanel({
  open,
  authenticated,
  isSystemUser,
  loginForm,
  onLoginChange,
  onLoginSubmit,
  onLogout,
  loading,
  schedules,
  uploadDates,
  onUploadDateChange,
  onUpload,
  uploadState,
  requests,
  onReview,
  reviewLoadingId,
  onClearRequest,
  clearLoadingId,
  onClearReviewed,
  clearingReviewed,
  onScheduleUpdate,
  closePanel
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [view, setView] = useState("dashboard");
  const [ptoExpanded, setPtoExpanded] = useState(false);

  useEffect(() => {
    if (open) { setView(isSystemUser ? "changePassword" : "dashboard"); setPtoExpanded(false); }
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
              <div className="admin-header-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setView((v) => v === "changePassword" ? "dashboard" : "changePassword")}
                >
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
                    uploadDates={uploadDates.techs}
                    onUploadDateChange={(field, value) => onUploadDateChange("techs", field, value)}
                    onUpload={(file) => onUpload("techs", file)}
                    loading={uploadState.techs}
                  />
                  <UploadCard
                    title="Pharmacist schedule"
                    schedule={schedules.pharmacists}
                    uploadDates={uploadDates.pharmacists}
                    onUploadDateChange={(field, value) => onUploadDateChange("pharmacists", field, value)}
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

                <button
                  type="button"
                  className="edit-shifts-btn"
                  onClick={() => setView("shiftEditor")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit Shifts
                </button>
              </>
            )}
          </div>

          {view === "shiftEditor" && (
            <ShiftEditorPanel
              schedules={schedules}
              onScheduleUpdate={onScheduleUpdate}
              onBack={() => setView("dashboard")}
            />
          )}

          {view === "dashboard" && (
            <>
              <div className="pto-expand-bar">
                <button
                  type="button"
                  className="pto-expand-btn"
                  onClick={() => setPtoExpanded((v) => !v)}
                  aria-expanded={ptoExpanded}
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={`pto-expand-chevron ${ptoExpanded ? "is-open" : ""}`}
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  {ptoExpanded ? "Collapse PTO Requests" : `PTO Requests${counts.pending > 0 ? ` — ${counts.pending} pending` : ""}`}
                </button>
              </div>

              {ptoExpanded && (
                <PtoLog
                  requests={requests}
                  onReview={onReview}
                  reviewLoadingId={reviewLoadingId}
                  onClearRequest={onClearRequest}
                  clearLoadingId={clearLoadingId}
                  onClearReviewed={onClearReviewed}
                  clearingReviewed={clearingReviewed}
                />
              )}
            </>
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
  const [notifications, setNotifications] = useState([]);
  const [undoPtoClear, setUndoPtoClear] = useState(null);
  const [search, setSearch] = useState("");
  const [showOnlyAssigned, setShowOnlyAssigned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [ptoSubmitting, setPtoSubmitting] = useState(false);
  const [reviewLoadingId, setReviewLoadingId] = useState("");
  const [clearLoadingId, setClearLoadingId] = useState("");
  const [clearingReviewed, setClearingReviewed] = useState(false);
  const [uploadState, setUploadState] = useState({ techs: false, pharmacists: false });
  const [uploadDates, setUploadDates] = useState(() => createUploadRangeState());
  const [savedUploadDates, setSavedUploadDates] = useState(() => createUploadRangeState());
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
      notify("error", error.message);
    }
  }

  async function loadPage() {
    setLoading(true);
    try {
      const [schedulePayload, sessionPayload] = await Promise.all([
        apiRequest("/api/schedules"),
        apiRequest("/api/auth/session")
      ]);
      setSchedules(schedulePayload.schedules);
      const nextUploadDates = createUploadRangeState(schedulePayload.schedules);
      setUploadDates(nextUploadDates);
      setSavedUploadDates(nextUploadDates);
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
      notify("error", error.message);
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

  function updateUploadDates(scheduleType, field, value) {
    setUploadDates((current) => ({
      ...current,
      [scheduleType]: {
        ...current[scheduleType],
        [field]: value
      }
    }));
  }

  function hasPendingUploadDateChanges() {
    return ["techs", "pharmacists"].some((scheduleType) => {
      const current = uploadDates[scheduleType];
      const saved = savedUploadDates[scheduleType];
      return current.startDate !== saved.startDate || current.endDate !== saved.endDate;
    });
  }

  async function syncScheduleMetadataOnClose() {
    const changedScheduleTypes = ["techs", "pharmacists"].filter((scheduleType) => {
      const current = uploadDates[scheduleType];
      const saved = savedUploadDates[scheduleType];
      return (
        schedules[scheduleType] &&
        (current.startDate !== saved.startDate || current.endDate !== saved.endDate)
      );
    });

    if (changedScheduleTypes.length === 0) {
      return;
    }

    try {
      const results = await Promise.all(
        changedScheduleTypes.map(async (scheduleType) => {
          const payload = await apiRequest(`/api/admin/schedules/${scheduleType}/metadata`, {
            method: "PATCH",
            body: JSON.stringify(uploadDates[scheduleType])
          });

          return [scheduleType, payload.schedule];
        })
      );

      setSchedules((current) => {
        const next = { ...current };
        for (const [scheduleType, schedule] of results) {
          next[scheduleType] = schedule;
        }
        return next;
      });

      setSavedUploadDates((current) => {
        const next = { ...current };
        for (const [scheduleType, schedule] of results) {
          next[scheduleType] = {
            startDate: schedule.startDate || "",
            endDate: schedule.endDate || ""
          };
        }
        return next;
      });
      setUploadDates((current) => {
        const next = { ...current };
        for (const [scheduleType, schedule] of results) {
          next[scheduleType] = {
            startDate: schedule.startDate || "",
            endDate: schedule.endDate || ""
          };
        }
        return next;
      });
    } catch (error) {
      notify("error", error.message);
    }
  }

  function resetFilters() {
    setSearch("");
    setShowOnlyAssigned(false);
  }

  function notify(tone, message, action) {
    const id = `${Date.now()}-${Math.random()}`;
    setNotifications((prev) => [{ id, tone, message, action: action ?? null }, ...prev.slice(0, 19)]);
    if (tone === "success" && !action) {
      setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 8000);
    }
  }

  function dismissNotification(id) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setUndoPtoClear(null);
  }

  function dismissAllNotifications() {
    setNotifications([]);
    setUndoPtoClear(null);
  }

  function openPtoModal() {
    setPtoForm((c) => ({ ...c, scheduleType: activeSchedule }));
    setPtoModalOpen(true);
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    try {
      const result = await apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify(loginForm) });
      setLoginForm({ username: "", password: "" });
      if (result.isSystem) {
        setIsSystemUser(true);
        setIsAdmin(false);
        setUndoPtoClear(null);
        notify("success", "System access granted. You may reset the admin password.");
      } else {
        setIsAdmin(true);
        setIsSystemUser(false);
        await loadAdminPtoRequests();
        setUndoPtoClear(null);
        notify("success", "Admin access granted.");
      }
    } catch (error) {
      notify("error", error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function closeAdminPanel() {
    setAdminOpen(false);
    setLoginForm({ username: "", password: "" });

    if (isAdmin && hasPendingUploadDateChanges()) {
      void syncScheduleMetadataOnClose();
    }
  }

  async function handleLogout() {
    await apiRequest("/api/auth/logout", { method: "POST" });
    setIsAdmin(false);
    setIsSystemUser(false);
    setPtoRequests([]);
    setUndoPtoClear(null);
    notify("success", "Signed out of admin session.");
  }

  async function handleUpload(scheduleType, file) {
    const selectedRange = uploadDates[scheduleType];

    setUploadState((c) => ({ ...c, [scheduleType]: true }));
    try {
      const payload = new FormData();
      payload.append("file", file);
      if (selectedRange.startDate) {
        payload.append("startDate", selectedRange.startDate);
      }
      if (selectedRange.endDate) {
        payload.append("endDate", selectedRange.endDate);
      }
      const response = await apiRequest(`/api/admin/upload/${scheduleType}`, {
        method: "POST",
        body: payload
      });
      setSchedules((c) => ({ ...c, [scheduleType]: response.schedule }));
      setUploadDates((current) => ({
        ...current,
        [scheduleType]: {
          startDate: response.schedule.startDate || "",
          endDate: response.schedule.endDate || ""
        }
      }));
      setSavedUploadDates((current) => ({
        ...current,
        [scheduleType]: {
          startDate: response.schedule.startDate || "",
          endDate: response.schedule.endDate || ""
        }
      }));
      setActiveSchedule(scheduleType);
      setUndoPtoClear(null);
      notify("success", response.message);
    } catch (error) {
      notify("error", error.message);
    } finally {
      setUploadState((c) => ({ ...c, [scheduleType]: false }));
    }
  }

  async function handlePtoSubmit(event) {
    event.preventDefault();
    setPtoSubmitting(true);
    const normalizedEnd = ptoForm.endDate || ptoForm.startDate;
    if (normalizedEnd < ptoForm.startDate) {
      notify("error", "The end date cannot be before the start date.");
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
      setUndoPtoClear(null);
      notify("success", "PTO request submitted for admin review.");
    } catch (error) {
      notify("error", error.message);
    } finally {
      setPtoSubmitting(false);
    }
  }

  async function handleReview(requestId, status) {
    setReviewLoadingId(requestId);
    setUndoPtoClear(null);
    try {
      const payload = await apiRequest(`/api/admin/pto-requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setPtoRequests(payload.requests);
      notify("success", payload.message);
      return true;
    } catch (error) {
      notify("error", error.message);
      return false;
    } finally {
      setReviewLoadingId("");
    }
  }

  async function handleClearRequest(requestId) {
    setClearLoadingId(requestId);
    try {
      const payload = await apiRequest(`/api/admin/pto-requests/${requestId}`, {
        method: "DELETE"
      });
      setPtoRequests(payload.requests);
      const undoData = { requests: payload.deletedRequests ?? [], actionLabel: "Undo" };
      setUndoPtoClear(undoData);
      notify("success", payload.message, undoData.requests.length ? { label: "Undo", callback: () => handleUndoPtoClear() } : null);
      return true;
    } catch (error) {
      notify("error", error.message);
      return false;
    } finally {
      setClearLoadingId("");
    }
  }

  async function handleClearReviewedRequests() {
    setClearingReviewed(true);
    try {
      const payload = await apiRequest("/api/admin/pto-requests/reviewed", {
        method: "DELETE"
      });
      setPtoRequests(payload.requests);
      const undoData = { requests: payload.deletedRequests ?? [], actionLabel: "Undo" };
      setUndoPtoClear(undoData);
      notify("success", payload.message, undoData.requests.length ? { label: "Undo", callback: () => handleUndoPtoClear() } : null);
      return true;
    } catch (error) {
      notify("error", error.message);
      return false;
    } finally {
      setClearingReviewed(false);
    }
  }

  async function handleUndoPtoClear() {
    if (!undoPtoClear?.requests?.length) {
      return;
    }

    try {
      const payload = await apiRequest("/api/admin/pto-requests/restore", {
        method: "POST",
        body: JSON.stringify({ requests: undoPtoClear.requests })
      });
      setPtoRequests(payload.requests);
      setUndoPtoClear(null);
      notify("success", payload.message);
    } catch (error) {
      notify("error", error.message);
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
        notifications={notifications}
        onDismissNotification={dismissNotification}
        onDismissAllNotifications={dismissAllNotifications}
      />

      <main className="page" id="main-content">

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
        uploadDates={uploadDates}
        onUploadDateChange={updateUploadDates}
        onUpload={handleUpload}
        uploadState={uploadState}
        requests={visibleRequests}
        onReview={handleReview}
        reviewLoadingId={reviewLoadingId}
        onClearRequest={handleClearRequest}
        clearLoadingId={clearLoadingId}
        onClearReviewed={handleClearReviewedRequests}
        clearingReviewed={clearingReviewed}
        onScheduleUpdate={(type, schedule) => setSchedules((prev) => ({ ...prev, [type]: schedule }))}
        closePanel={closeAdminPanel}
      />
    </div>
  );
}
