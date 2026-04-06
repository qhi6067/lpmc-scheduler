import XLSX from "xlsx";

const DISPLAY_TYPES = {
  techs: "Tech Schedule",
  pharmacists: "Pharmacist Schedule"
};

const DEFAULT_FACILITY = "Las Palmas Medical Center";

function cleanCell(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const normalized = cleanCell(value);

  if (/^\d{1,2}$/.test(normalized)) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split("-").map((part) => Number.parseInt(part, 10));
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parts = normalized.split("/");

  if (parts.length !== 3) {
    if (!normalized.includes("-")) {
      return null;
    }

    const fallback = new Date(normalized);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const [month, day, yearText] = parts.map((part) => Number.parseInt(part, 10));
  const year = yearText < 100 ? 2000 + yearText : yearText;
  const parsed = new Date(year, month - 1, day);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric"
  }).format(date);
}

function formatShortDate(date) {
  const shortYear = String(date.getFullYear()).slice(-2);
  return `${date.getMonth() + 1}/${date.getDate()}/${shortYear}`;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function getInclusiveDayCount(startDate, endDate) {
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.floor((endUtc - startUtc) / 86400000) + 1;
}

function lastUsefulColumn(headerRow, datesRow, startColumnIndex) {
  const maxLength = Math.max(headerRow.length, datesRow.length);

  for (let index = maxLength - 1; index > startColumnIndex; index -= 1) {
    if (cleanCell(headerRow[index]) || cleanCell(datesRow[index])) {
      return index;
    }
  }

  return startColumnIndex;
}

function findHeaderCell(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cellValue = cleanCell(row[columnIndex]).toLowerCase();

      if (cellValue.includes("name/date")) {
        return { rowIndex, columnIndex };
      }
    }
  }

  return null;
}

function inferColumns(headerRow, datesRow, nameColumnIndex, startDate, endDate) {
  const endIndex = lastUsefulColumn(headerRow, datesRow, nameColumnIndex);
  const expectedColumnCount = getInclusiveDayCount(startDate, endDate);
  const discoveredColumnCount = Math.max(0, endIndex - nameColumnIndex);

  if (discoveredColumnCount === 0) {
    return [];
  }

  if (discoveredColumnCount !== expectedColumnCount) {
    throw new Error(
      `The provided date range covers ${expectedColumnCount} day${expectedColumnCount === 1 ? "" : "s"}, but the schedule row after Name/Date contains ${discoveredColumnCount} date column${discoveredColumnCount === 1 ? "" : "s"}.`
    );
  }

  const columns = [];

  for (let offset = 0; offset < expectedColumnCount; offset += 1) {
    const columnIndex = nameColumnIndex + 1 + offset;
    const actualDate = addDays(startDate, offset);
    const rawHeaderCell = cleanCell(headerRow[columnIndex]);
    const rawDateCell = cleanCell(datesRow[columnIndex]);

    columns.push({
      index: columnIndex,
      weekdayLabel: rawHeaderCell,
      dayLabel: rawDateCell,
      label: formatDisplayDate(actualDate),
      isoDate: formatIsoDate(actualDate)
    });
  }

  return columns;
}

function isLikelyEmployeeRow(row, nameColumnIndex, columns) {
  const employeeName = cleanCell(row[nameColumnIndex]);

  if (!employeeName) {
    return false;
  }

  const filledAssignments = columns.reduce((count, column) => {
    return cleanCell(row[column.index]) ? count + 1 : count;
  }, 0);

  return filledAssignments > 0;
}

export function parseScheduleWorkbook(
  fileSource,
  scheduleType,
  originalFileName,
  { startDate: startDateInput, endDate: endDateInput } = {}
) {
  const startDate = parseDateValue(startDateInput);
  const endDate = parseDateValue(endDateInput);

  if (!startDate || !endDate) {
    throw new Error("A valid schedule start and end date are required for upload.");
  }

  if (endDate < startDate) {
    throw new Error("The schedule end date cannot be before the start date.");
  }

  const workbook = Buffer.isBuffer(fileSource)
    ? XLSX.read(fileSource, {
        type: "buffer",
        cellDates: true
      })
    : XLSX.readFile(fileSource, {
        cellDates: true
      });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: ""
  });

  const headerCell = findHeaderCell(rows);

  if (!headerCell) {
    throw new Error(
      'We could not find the row containing "Name/Date". Please upload the standard LPMC schedule format.'
    );
  }

  const { rowIndex: headerRowIndex, columnIndex: nameColumnIndex } = headerCell;
  const datesRowIndex = headerRowIndex + 1;
  const headerRow = rows[headerRowIndex] ?? [];
  const datesRow = rows[datesRowIndex] ?? [];
  const columns = inferColumns(headerRow, datesRow, nameColumnIndex, startDate, endDate);
  const employees = [];

  for (let rowIndex = datesRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const employeeName = cleanCell(row[nameColumnIndex]);

    if (!employeeName) {
      continue;
    }

    if (!isLikelyEmployeeRow(row, nameColumnIndex, columns)) {
      if (employees.length > 0) {
        break;
      }

      continue;
    }

    const assignments = columns.map((column) => cleanCell(row[column.index]));

    employees.push({
      name: employeeName,
      assignments
    });
  }

  if (employees.length === 0) {
    throw new Error(
      'No employee rows with assignments were found below the "Name/Date" header.'
    );
  }

  return {
    scheduleType,
    title: DISPLAY_TYPES[scheduleType] ?? "Schedule",
    facility: DEFAULT_FACILITY,
    rangeLabel: `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`,
    startDate: formatIsoDate(startDate),
    endDate: formatIsoDate(endDate),
    columns,
    employees,
    sourceFileName: originalFileName
  };
}
