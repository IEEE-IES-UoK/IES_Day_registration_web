/**
 * IEEE IES Day 2026 — custom website -> Vercel API -> Google Sheets.
 * No Google Form is needed. Bind this project to the destination spreadsheet.
 * Run setupRegistrationSheet() once, then deploy as a Web App, executing as you.
 * Copy REGISTRATION_SECRET from Project Settings > Script properties into Vercel.
 * Never put that secret in the website or log it. Re-running setup preserves it.
 */
const TAB_NAME = "Registrations";
const SERVICE_VERSION = "2026-10-27-ieee-ies-day-1";
const TIME_ZONE = "Asia/Colombo";
const MAX_BODY_BYTES = 8192;
const INITIAL_ROWS = 1000;
const GROWTH_ROWS = 500;
const HEADERS = [
  "Submitted At",
  "Full name",
  "University",
  "Faculty / Department",
  "WhatsApp",
  "Request ID",
];
const PAYLOAD_KEYS = [
  "secret",
  "requestId",
  "firstName",
  "university",
  "faculty",
  "whatsapp",
  "website",
];

function result_(success, code, extra) {
  return Object.assign({ success: success, code: code }, extra || {});
}
function output_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
function failureCategory_(error) {
  const message =
    error && typeof error.message === "string"
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  // Use messages only to select a fixed category. Never return or log their contents.
  if (
    /rate.?limit|too many requests|per second|in a short time|running simultaneously/i.test(
      message,
    )
  )
    return "rate-limit";
  if (
    /quota|limit exceeded|too many times|for one day|per day|daily limit|maximum execution time/i.test(
      message,
    )
  )
    return "quota";
  if (
    /permission|not authorized|authorization|access denied|do not have access|does not have access|unauthenticated/i.test(
      message,
    )
  )
    return "permission";
  if (
    /service spreadsheets failed while accessing document|cannot (?:find|open)|(?:document|spreadsheet).*(?:not found|does not exist|unavailable|is missing)/i.test(
      message,
    )
  )
    return "document-unavailable";
  if (
    /service.*(?:error|failed|unavailable)|internal error|server error|backend error|timeout|timed out|temporarily unavailable/i.test(
      message,
    )
  )
    return "service-error";
  return "unknown";
}
function exceptionType_(error) {
  const knownTypes = [
    "Error",
    "Exception",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "EvalError",
    "URIError",
  ];
  return error && knownTypes.indexOf(error.name) !== -1 ? error.name : "Error";
}
function logStorageFailure_(operation, phase, error) {
  console.error(
    JSON.stringify({
      event: "registration_storage_failure",
      version: SERVICE_VERSION,
      operation: operation,
      phase: phase,
      category: failureCategory_(error),
      exceptionType: exceptionType_(error),
    }),
  );
}
function validSecret_(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 256;
}
function secretsMatch_(candidate, expected) {
  if (typeof candidate !== "string") return false;
  // Compare every character, without returning at the first mismatch.
  // This is best effort in the managed V8 runtime, not a timing guarantee.
  let difference = candidate.length ^ expected.length;
  const length = Math.max(candidate.length, expected.length);
  for (let i = 0; i < length; i++) {
    difference |=
      (candidate.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return difference === 0;
}
function cleanCell_(value) {
  const text = String(value).trim();
  // Literal text prevents Sheets formulas, and preserves an initial apostrophe.
  return /^[=+\-@']/.test(text) ? "'" + text : text;
}
function literalCell_(value) {
  // IDs and phones must stay exact, including leading zeros and a leading +.
  return value ? "'" + value : "";
}
function plainText_(value, min, max) {
  return (
    typeof value === "string" &&
    value.trim().length >= min &&
    value.trim().length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function validatePayload_(data) {
  if (
    Object.keys(data).some(function (key) {
      return PAYLOAD_KEYS.indexOf(key) === -1;
    }) ||
    !plainText_(data.firstName, 2, 80) ||
    !plainText_(data.university, 2, 120) ||
    !plainText_(data.faculty, 2, 120) ||
    !plainText_(data.whatsapp, 8, 16) ||
    !plainText_(data.requestId, 8, 100) ||
    (data.website !== undefined &&
      (typeof data.website !== "string" || data.website.trim() !== ""))
  ) {
    return null;
  }
  const normalized = {
    requestId: data.requestId.trim(),
    firstName: data.firstName.trim(),
    university: data.university.trim(),
    faculty: data.faculty.trim(),
    whatsapp: data.whatsapp.trim(),
  };
  if (
    !/^[A-Za-z0-9-]{8,100}$/.test(normalized.requestId) ||
    !/^(?:07\d{8}|\+?947\d{8}|\+?\d{8,15})$/.test(normalized.whatsapp)
  )
    return null;
  return normalized;
}
function schemaWidth_(sheet) {
  const width = sheet.getLastColumn();
  if (width !== HEADERS.length) return 0;
  const header = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  return header.every(function (cell, index) {
    return cell === HEADERS[index];
  })
    ? width
    : 0;
}
function hasExactValue_(sheet, column, lastRow, value, matchCase) {
  if (lastRow < 2) return false;
  return (
    sheet
      .getRange(2, column, lastRow - 1, 1)
      .createTextFinder(value)
      .matchEntireCell(true)
      .matchCase(matchCase)
      .useRegularExpression(false)
      .findNext() !== null
  );
}

/** Owner-only setup: safe to run again; never clears existing registrations. */
function setupRegistrationSheet() {
  let lock;
  let acquired = false;
  let phase = "active-spreadsheet";
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) return result_(false, "NOT_CONFIGURED");
    const properties = PropertiesService.getScriptProperties();
    phase = "acquire-lock";
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(10000);
    if (!acquired) return result_(false, "BUSY");
    phase = "read-configuration";
    const existingSecret = properties.getProperty("REGISTRATION_SECRET");
    // Preserve an existing secret. Replace an old short secret manually, never silently.
    if (existingSecret && !validSecret_(existingSecret))
      return result_(false, "NOT_CONFIGURED");

    phase = "read-schema";
    let sheet = spreadsheet.getSheetByName(TAB_NAME);
    let width = 0;
    if (sheet && sheet.getLastRow() > 0) {
      width = schemaWidth_(sheet);
      if (!width) return result_(false, "SCHEMA_MISMATCH");
    }
    phase = "prepare-sheet";
    if (!sheet) sheet = spreadsheet.insertSheet(TAB_NAME);
    const columns = sheet.getMaxColumns();
    if (columns < HEADERS.length)
      sheet.insertColumnsAfter(columns, HEADERS.length - columns);
    const rows = sheet.getMaxRows();
    if (rows < INITIAL_ROWS) sheet.insertRowsAfter(rows, INITIAL_ROWS - rows);
    if (!width) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

    // All presentation and number formatting happens here, outside the normal POST path.
    phase = "format-sheet";
    spreadsheet.setSpreadsheetTimeZone(TIME_ZONE);
    sheet.setFrozenRows(1);
    sheet
      .getRange(1, 1, 1, HEADERS.length)
      .setBackground("#073b74")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setWrap(true);
    const dataRows = sheet.getMaxRows() - 1;
    sheet.getRange(2, 1, dataRows, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
    sheet.getRange(2, 2, dataRows, HEADERS.length - 1).setNumberFormat("@");
    sheet.setColumnWidth(1, 165);
    sheet.setColumnWidths(2, HEADERS.length - 1, 180);
    sheet.setColumnWidths(3, 2, 240);
    sheet.setColumnWidth(6, 290);
    if (!sheet.getFilter())
      sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).createFilter();
    phase = "flush";
    SpreadsheetApp.flush();
    phase = "save-configuration";
    const secret =
      existingSecret ||
      (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
    properties.setProperties({
      SPREADSHEET_ID: spreadsheet.getId(),
      REGISTRATION_SECRET: secret,
    });
    console.info(
      "Registration sheet ready. Copy REGISTRATION_SECRET from Script properties to Vercel; keep it private.",
    );
    return result_(true, "READY");
  } catch (error) {
    logStorageFailure_("setup", phase, error);
    return result_(false, "STORAGE_UNAVAILABLE");
  } finally {
    if (acquired) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }
  }
}

/** Owner-run, read-only diagnostics. Never creates, formats, or changes a sheet/property. */
function diagnoseRegistrationStorage() {
  const report = {
    version: SERVICE_VERSION,
    code: "NOT_CONFIGURED",
    secretConfigured: false,
    spreadsheetConfigured: false,
    accessVerified: false,
    sheetExists: false,
    schemaOkay: false,
    headerCount: 0,
    registrationCount: 0,
  };
  let phase = "read-configuration";
  try {
    const settings = PropertiesService.getScriptProperties().getProperties();
    report.secretConfigured = validSecret_(settings.REGISTRATION_SECRET);
    report.spreadsheetConfigured =
      typeof settings.SPREADSHEET_ID === "string" &&
      settings.SPREADSHEET_ID.trim() !== "";
    if (report.spreadsheetConfigured) {
      phase = "open-spreadsheet";
      const spreadsheet = SpreadsheetApp.openById(settings.SPREADSHEET_ID);
      report.accessVerified = true;
      phase = "read-schema";
      const sheet = spreadsheet.getSheetByName(TAB_NAME);
      report.sheetExists = !!sheet;
      if (sheet) {
        report.headerCount = sheet.getLastColumn();
        report.schemaOkay = schemaWidth_(sheet) === HEADERS.length;
        report.registrationCount = Math.max(0, sheet.getLastRow() - 1);
        report.code = report.secretConfigured
          ? report.schemaOkay
            ? "READY"
            : "SCHEMA_MISMATCH"
          : "NOT_CONFIGURED";
      }
    }
  } catch (error) {
    report.code = "STORAGE_UNAVAILABLE";
    report.failureCategory = failureCategory_(error);
    report.exceptionType = exceptionType_(error);
    logStorageFailure_("diagnose", phase, error);
  }
  // Fixed report fields contain booleans/counts/version only, never credentials or row data.
  console.info(
    JSON.stringify(
      Object.assign({ event: "registration_storage_diagnostic" }, report),
    ),
  );
  return report;
}

/** Public deployment health check: exposes no configuration or registration data. */
function doGet() {
  return output_(
    result_(true, "OK", {
      service: "IEEE IES Day registration",
      version: SERVICE_VERSION,
    }),
  );
}

function doPost(event) {
  let lock;
  let acquired = false;
  let phase = "parse-request";
  try {
    const body = event && event.postData && event.postData.contents;
    if (typeof body !== "string" || !body)
      return output_(result_(false, "INVALID"));
    if (
      body.length > MAX_BODY_BYTES ||
      Utilities.newBlob(body).getBytes().length > MAX_BODY_BYTES
    ) {
      return output_(result_(false, "PAYLOAD_TOO_LARGE"));
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      return output_(result_(false, "INVALID"));
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      return output_(result_(false, "INVALID"));
    phase = "read-configuration";
    const settings = PropertiesService.getScriptProperties().getProperties();
    if (!validSecret_(settings.REGISTRATION_SECRET))
      return output_(result_(false, "NOT_CONFIGURED"));
    if (!secretsMatch_(data.secret, settings.REGISTRATION_SECRET))
      return output_(result_(false, "UNAUTHORIZED"));
    phase = "validate-request";
    const registration = validatePayload_(data);
    if (!registration) return output_(result_(false, "INVALID"));
    if (!settings.SPREADSHEET_ID)
      return output_(result_(false, "NOT_CONFIGURED"));

    // Validate/authenticate before obtaining the lock or opening the spreadsheet.
    phase = "acquire-lock";
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(5000);
    if (!acquired) return output_(result_(false, "BUSY"));
    phase = "open-spreadsheet";
    const spreadsheet = SpreadsheetApp.openById(settings.SPREADSHEET_ID);
    phase = "read-schema";
    const sheet = spreadsheet.getSheetByName(TAB_NAME);
    if (!sheet) return output_(result_(false, "NOT_CONFIGURED"));
    // Never repair or overwrite headers while processing a public registration.
    if (schemaWidth_(sheet) !== HEADERS.length)
      return output_(result_(false, "SCHEMA_MISMATCH"));
    phase = "read-row-count";
    const lastRow = sheet.getLastRow();
    phase = "request-id-lookup";
    if (hasExactValue_(sheet, 6, lastRow, registration.requestId, true)) {
      return output_(result_(true, "ALREADY_STORED", { alreadyStored: true }));
    }
    phase = "ensure-capacity";
    const row = lastRow + 1;
    const capacity = sheet.getMaxRows();
    if (row > capacity) {
      // Rare capacity growth only; normal submissions never format cells.
      sheet.insertRowsAfter(capacity, GROWTH_ROWS);
      sheet
        .getRange(capacity, 1, 1, HEADERS.length)
        .copyFormatToRange(
          sheet,
          1,
          HEADERS.length,
          capacity + 1,
          capacity + GROWTH_ROWS,
        );
    }
    phase = "write-registration";
    sheet
      .getRange(row, 1, 1, HEADERS.length)
      .setValues([
        [
          new Date(),
          cleanCell_(registration.firstName),
          cleanCell_(registration.university),
          cleanCell_(registration.faculty),
          literalCell_(registration.whatsapp),
          literalCell_(registration.requestId),
        ],
      ]);
    // Commit the single row write before another request can inspect duplicate IDs.
    phase = "flush";
    SpreadsheetApp.flush();
    phase = "response";
    return output_(result_(true, "OK"));
  } catch (error) {
    // Do not expose spreadsheet IDs, raw payloads, secrets, or service exceptions.
    logStorageFailure_("register", phase, error);
    return output_(result_(false, "STORAGE_UNAVAILABLE"));
  } finally {
    if (acquired) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }
  }
}
