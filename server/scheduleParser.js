import XLSX from "xlsx";

const DISPLAY_TYPES = {
  techs: "Tech Schedule",
  pharmacists: "Pharmacist Schedule"
};

const RANGE_REGEX =
  /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*\D+\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i;

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

function lastUsefulColumn(headerRow, datesRow) {
  const maxLength = Math.max(headerRow.length, datesRow.length);

  for (let index = maxLength - 1; index >= 1; index -= 1) {
    if (cleanCell(headerRow[index]) || cleanCell(datesRow[index])) {
      return index;
    }
  }

  return 0;
}

function inferColumns(headerRow, datesRow, startDate) {
  const endIndex = lastUsefulColumn(headerRow, datesRow);

  if (endIndex === 0) {
    return [];
  }

  const columns = [];
  let currentMonth = startDate ? startDate.getMonth() : 0;
  let currentYear = startDate ? startDate.getFullYear() : new Date().getFullYear();
  let previousDay = null;

  for (let columnIndex = 1; columnIndex <= endIndex; columnIndex += 1) {
    const rawDateCell = cleanCell(datesRow[columnIndex]);
    const rawHeaderCell = cleanCell(headerRow[columnIndex]);

    if (!rawDateCell && !rawHeaderCell) {
      continue;
    }

    let actualDate = parseDateValue(rawDateCell);

    if (!actualDate && /^\d{1,2}$/.test(rawDateCell)) {
      const day = Number.parseInt(rawDateCell, 10);

      if (previousDay !== null && day < previousDay) {
        currentMonth += 1;

        if (currentMonth > 11) {
          currentMonth = 0;
          currentYear += 1;
        }
      }

      actualDate = new Date(currentYear, currentMonth, day);
      previousDay = day;
    } else if (actualDate) {
      previousDay = actualDate.getDate();
    }

    const label = actualDate ? formatDisplayDate(actualDate) : rawHeaderCell || rawDateCell;

    columns.push({
      index: columnIndex,
      weekdayLabel: rawHeaderCell,
      dayLabel: rawDateCell,
      label,
      isoDate: actualDate ? formatIsoDate(actualDate) : null
    });
  }

  return columns;
}

function findHeaderRow(rows) {
  return rows.findIndex((row) => cleanCell(row[0]).toLowerCase().includes("name/date"));
}

function findRangeText(rows) {
  for (const row of rows) {
    for (const cell of row) {
      const text = cleanCell(cell);

      if (RANGE_REGEX.test(text)) {
        return text.match(RANGE_REGEX)?.[0] ?? text;
      }
    }
  }

  return "";
}

function findFirstMeaningful(rows, preferredMatch) {
  const flattened = rows
    .flatMap((row) => row)
    .map(cleanCell)
    .filter(Boolean);

  const preferred = flattened.find((value) =>
    value.toLowerCase().includes(preferredMatch.toLowerCase())
  );

  return preferred ?? flattened[0] ?? preferredMatch;
}

export function parseScheduleWorkbook(fileSource, scheduleType, originalFileName) {
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

  const headerRowIndex = findHeaderRow(rows);

  if (headerRowIndex === -1) {
    throw new Error(
      "We could not find the schedule header row. Please upload the standard LPMC schedule format."
    );
  }

  const datesRowIndex = headerRowIndex + 1;
  const headerRow = rows[headerRowIndex] ?? [];
  const datesRow = rows[datesRowIndex] ?? [];
  const rangeText = findRangeText(rows.slice(0, headerRowIndex + 2));
  const rangeMatch = rangeText.match(RANGE_REGEX);
  const normalizedRangeLabel = rangeMatch ? `${rangeMatch[1]} - ${rangeMatch[2]}` : rangeText;
  const startDate = rangeMatch ? parseDateValue(rangeMatch[1]) : null;
  const endDateFromRange = rangeMatch ? parseDateValue(rangeMatch[2]) : null;
  const columns = inferColumns(headerRow, datesRow, startDate);
  const employees = [];

  for (let rowIndex = datesRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const employeeName = cleanCell(row[0]);

    if (!employeeName) {
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
      "The uploaded spreadsheet does not include any employee rows below the date header."
    );
  }

  const finalEndDate =
    endDateFromRange ??
    (columns.length > 0 && columns[columns.length - 1].isoDate
      ? new Date(columns[columns.length - 1].isoDate)
      : null);

  return {
    scheduleType,
    title:
      findFirstMeaningful(rows.slice(0, headerRowIndex), DISPLAY_TYPES[scheduleType] ?? "Schedule") ??
      DISPLAY_TYPES[scheduleType],
    facility: findFirstMeaningful(rows.slice(0, headerRowIndex), "Las Palmas Medical Center"),
    rangeLabel: normalizedRangeLabel || "Current schedule",
    startDate: startDate ? formatIsoDate(startDate) : null,
    endDate: finalEndDate ? formatIsoDate(finalEndDate) : null,
    columns,
    employees,
    sourceFileName: originalFileName
  };
}
