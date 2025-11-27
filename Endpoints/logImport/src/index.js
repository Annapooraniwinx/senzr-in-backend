import multer from "multer";
import * as XLSX from "xlsx";

const upload = multer({ storage: multer.memoryStorage() });

// ====================
// 🔧 Helper Functions
// ====================

const section = (label) =>
  console.log(
    `\n========== ${label.toUpperCase()} (${new Date().toLocaleString()}) ==========\n`
  );

// 🔍 Detect sheet format
function detectSheetFormat(data) {
  section("DETECTING SHEET FORMAT");

  // Check first few rows for format indicators
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];

    // Format 1: Original format with "Employee Code:-" in column B
    if (row[1] === "Employee Code:-") {
      console.log("📋 Detected: ORIGINAL FORMAT (Employee Code:- in column B)");
      return "format1";
    }

    // Format 2: Simple table format with headers
    if (
      row.length >= 3 &&
      String(row[0]).toLowerCase().includes("employee") &&
      String(row[0]).toLowerCase().includes("code") &&
      String(row[2]).toLowerCase().includes("logdate")
    ) {
      console.log(
        "📋 Detected: SIMPLE TABLE FORMAT (Employee Code | Employee Name | LogDate)"
      );
      return "format2";
    }
  }

  console.log("⚠️ Unknown format, defaulting to ORIGINAL FORMAT");
  return "format1";
}

// 1️⃣ Parse Excel to JSON
async function parseExcelFile(fileBuffer) {
  section("STEP 1: PARSING EXCEL FILE");
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
  });

  console.log(`📊 Sheet: ${sheetName}`);
  console.log(`📋 Total rows read: ${data.length}`);
  return data;
}

// 2️⃣ Extract employee codes - FORMAT 1 (Original)
function extractEmployeeCodesFormat1(data) {
  const codes = [];
  for (let row of data) {
    if (row[1] === "Employee Code:-" && row[10]) {
      codes.push(row[10].toString().trim());
    }
  }
  return codes;
}

// 2️⃣ Extract employee codes - FORMAT 2 (Simple Table)
function extractEmployeeCodesFormat2(data) {
  const codes = [];
  let headerFound = false;

  for (let row of data) {
    // Skip until we find the header row
    if (!headerFound) {
      if (
        row[0] &&
        String(row[0]).toLowerCase().includes("employee") &&
        String(row[0]).toLowerCase().includes("code")
      ) {
        headerFound = true;
      }
      continue;
    }

    // Extract employee code from first column
    if (row[0] && row[0] !== "Employee Code") {
      const code = row[0].toString().trim();
      if (code) codes.push(code);
    }
  }

  return codes;
}

// Master extraction function
function extractEmployeeCodes(data, format) {
  section("STEP 2: EXTRACTING EMPLOYEE CODES");

  const codes =
    format === "format1"
      ? extractEmployeeCodesFormat1(data)
      : extractEmployeeCodesFormat2(data);

  console.log(`👥 Found ${codes.length} employee codes.`);
  return codes;
}

// 3️⃣ Validate employees from DB (batch of 100)
async function validateEmployees(allCodes, tenantId, personalModuleService) {
  section("STEP 3: VALIDATING EMPLOYEES FROM DATABASE");

  const EMP_BATCH = 100;
  const employeeMap = new Map();
  const invalidUsers = [];

  for (let i = 0; i < allCodes.length; i += EMP_BATCH) {
    const batch = allCodes.slice(i, i + EMP_BATCH);
    const batchNo = i / EMP_BATCH + 1;
    console.time(`⏱ Employee Batch ${batchNo}`);

    const validEmployees = await personalModuleService.readByQuery({
      filter: {
        _and: [
          { employeeId: { _in: batch } },
          { assignedUser: { tenant: { tenantId: { _eq: tenantId } } } },
        ],
      },
      fields: ["id", "employeeId"],
    });

    console.timeEnd(`⏱ Employee Batch ${batchNo}`);
    validEmployees.forEach((emp) => employeeMap.set(emp.employeeId, emp.id));
  }

  console.log(`✅ Valid employees found: ${employeeMap.size}`);
  return { employeeMap, invalidUsers };
}

// 4️⃣ Parse logs - FORMAT 1 (Original)
function extractLogsFormat1(data, validMap, tenantId) {
  const monthMap = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };

  let currentEmployee = null;
  const logs = [];
  const logCount = new Map();

  for (let [rowIndex, row] of data.entries()) {
    if (row[1] === "Employee Code:-") {
      const empCode = row[10]?.toString().trim();
      if (!empCode || !validMap.has(empCode)) {
        currentEmployee = null;
        continue;
      }
      currentEmployee = empCode;
      logCount.set(empCode, 0);
    }

    if (currentEmployee && typeof row[1] === "number") {
      const [day, month, year] = (row[3] || "").split("-");
      const inTime = row[8]
        ?.toString()
        .trim()
        .replace(/\(.*?\)/g, "")
        .trim();
      const outTime = row[9]
        ?.toString()
        .trim()
        .replace(/\(.*?\)/g, "")
        .trim();
      if (!day || !monthMap[month]) continue;

      const date = `${year}-${monthMap[month]}-${day}`;
      const employeeId = validMap.get(currentEmployee);

      if (inTime && inTime !== "00:00")
        logs.push({
          tenant: tenantId,
          date,
          timeStamp: inTime,
          action: "in",
          employeeId,
          rowIndex,
        });
      if (outTime && outTime !== "00:00")
        logs.push({
          tenant: tenantId,
          date,
          timeStamp: outTime,
          action: "out",
          employeeId,
          rowIndex,
        });

      logCount.set(currentEmployee, logCount.get(currentEmployee) + 1);
    }
  }

  return { logs, logCount };
}

// 4️⃣ Parse logs - FORMAT 2 (Simple Table)
function extractLogsFormat2(data, validMap, tenantId) {
  const logs = [];
  const logCount = new Map();
  let headerFound = false;
  let skippedRows = {
    noEmployeeCode: 0,
    noLogDate: 0,
    invalidEmployee: 0,
    invalidDateFormat: 0,
    headerRow: 0,
  };

  // Track punch count per employee per date for alternating in/out
  const punchTracker = new Map(); // Key: "empCode-date", Value: punch count

  console.log(`🔍 Starting Format 2 log extraction...`);
  console.log(`📋 Valid employee map has ${validMap.size} employees`);
  console.log(`📋 Valid employees: ${Array.from(validMap.keys()).join(", ")}`);

  for (let [rowIndex, row] of data.entries()) {
    // Skip until header row
    if (!headerFound) {
      if (
        row[0] &&
        String(row[0]).toLowerCase().includes("employee") &&
        String(row[0]).toLowerCase().includes("code")
      ) {
        headerFound = true;
        skippedRows.headerRow++;
        console.log(`✓ Header found at row ${rowIndex}: [${row.join(" | ")}]`);
      }
      continue;
    }

    // Debug: Log first few data rows
    if (rowIndex < 5) {
      console.log(`🔎 Row ${rowIndex}: [${row.join(" | ")}]`);
    }

    // Parse data rows
    const empCode = row[0]?.toString().trim();
    const logDateTimeStr = row[2]?.toString().trim();

    // Check for missing data
    if (!empCode) {
      skippedRows.noEmployeeCode++;
      if (rowIndex < 5) console.log(`❌ Row ${rowIndex}: No employee code`);
      continue;
    }

    if (!logDateTimeStr) {
      skippedRows.noLogDate++;
      if (rowIndex < 5)
        console.log(`❌ Row ${rowIndex}: No log date for ${empCode}`);
      continue;
    }

    if (!validMap.has(empCode)) {
      skippedRows.invalidEmployee++;
      if (rowIndex < 5)
        console.log(`❌ Row ${rowIndex}: Invalid employee ${empCode}`);
      continue;
    }

    // Parse datetime: Handle multiple formats
    // Format 1: "2025-09-12 09:00:00"
    // Format 2: Excel serial date number
    let dateTimeMatch = null;
    let date = null;
    let timeStamp = null;

    // Try standard format first
    dateTimeMatch = logDateTimeStr.match(
      /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/
    );

    if (dateTimeMatch) {
      const [, year, month, day, hour, minute, second] = dateTimeMatch;
      date = `${year}-${month}-${day}`;
      timeStamp = `${hour}:${minute}`;
    } else {
      // Try Excel serial date number
      const serialNumber = parseFloat(logDateTimeStr);
      if (!isNaN(serialNumber)) {
        // Excel date serial number (days since 1900-01-01)
        const excelEpoch = new Date(1900, 0, 1);
        const jsDate = new Date(
          excelEpoch.getTime() + (serialNumber - 2) * 86400000
        );

        const year = jsDate.getFullYear();
        const month = String(jsDate.getMonth() + 1).padStart(2, "0");
        const day = String(jsDate.getDate()).padStart(2, "0");
        const hour = String(jsDate.getHours()).padStart(2, "0");
        const minute = String(jsDate.getMinutes()).padStart(2, "0");

        date = `${year}-${month}-${day}`;
        timeStamp = `${hour}:${minute}`;
      }
    }

    if (!date || !timeStamp) {
      skippedRows.invalidDateFormat++;
      if (rowIndex < 5)
        console.log(
          `❌ Row ${rowIndex}: Invalid date format: ${logDateTimeStr}`
        );
      continue;
    }

    const employeeId = validMap.get(empCode);

    // 🔄 Alternating in/out logic based on chronological order per employee per date
    const trackerKey = `${empCode}-${date}`;
    const punchCount = punchTracker.get(trackerKey) || 0;

    // 1st punch = in, 2nd = out, 3rd = in, 4th = out, ...
    const action = punchCount % 2 === 0 ? "in" : "out";

    // Increment punch count for this employee-date combination
    punchTracker.set(trackerKey, punchCount + 1);

    logs.push({
      tenant: tenantId,
      date,
      timeStamp,
      action,
      employeeId,
      rowIndex,
    });

    logCount.set(empCode, (logCount.get(empCode) || 0) + 1);

    if (logs.length <= 5) {
      console.log(
        `✅ Log ${
          logs.length
        }: ${empCode} → ${date} ${timeStamp} (${action}) [Punch #${
          punchCount + 1
        }]`
      );
    }
  }

  console.log(`\n📊 Format 2 Parsing Summary:`);
  console.log(`   ✅ Successfully parsed: ${logs.length} logs`);
  console.log(`   ❌ Skipped - Header rows: ${skippedRows.headerRow}`);
  console.log(
    `   ❌ Skipped - No employee code: ${skippedRows.noEmployeeCode}`
  );
  console.log(`   ❌ Skipped - No log date: ${skippedRows.noLogDate}`);
  console.log(
    `   ❌ Skipped - Invalid employee: ${skippedRows.invalidEmployee}`
  );
  console.log(
    `   ❌ Skipped - Invalid date format: ${skippedRows.invalidDateFormat}`
  );

  return { logs, logCount };
}

// Master logs extraction
function extractLogs(data, validMap, tenantId, format) {
  section("STEP 4: PARSING LOGS");

  const { logs, logCount } =
    format === "format1"
      ? extractLogsFormat1(data, validMap, tenantId)
      : extractLogsFormat2(data, validMap, tenantId);

  console.log(`🧾 Total logs parsed: ${logs.length}`);
  return { logs, logCount };
}

// 5️⃣ Insert logs in batches
async function insertLogsInBatches(
  logs,
  logService,
  importService,
  importID,
  fileId
) {
  section("STEP 5: INSERTING LOGS IN BATCHES");

  const LOG_BATCH_SIZE = 100;
  const CONCURRENT_LIMIT = 3;

  const batches = [];
  for (let i = 0; i < logs.length; i += LOG_BATCH_SIZE) {
    batches.push(logs.slice(i, i + LOG_BATCH_SIZE));
  }

  console.log(`📦 Total ${batches.length} batches to insert.`);

  let index = 0;
  const totalBatches = batches.length;
  let completed = 0;

  const workers = new Array(CONCURRENT_LIMIT).fill(null).map(async () => {
    while (index < totalBatches) {
      const current = index++;
      const batch = batches[current];
      const batchStart = Date.now();

      console.log(
        `🚀 Batch ${current + 1}/${totalBatches} → Rows ${batch[0].rowIndex}–${
          batch.at(-1).rowIndex
        }`
      );

      try {
        console.time(`⏱ Batch ${current + 1}`);
        await logService.createMany(batch);
        console.timeEnd(`⏱ Batch ${current + 1}`);

        await importService.updateOne(importID, {
          processingCount: {
            batchNo: current + 1,
            fileId,
            lastProcessedRow: batch.at(-1).rowIndex,
            updatedAt: new Date().toISOString(),
          },
        });

        console.log(
          `✅ Batch ${current + 1} done | Rows: ${batch.length} | Time: ${(
            (Date.now() - batchStart) /
            1000
          ).toFixed(2)}s`
        );

        completed++;
      } catch (err) {
        console.error(`❌ Error in batch ${current + 1}:`, err.message);
      }
    }
  });

  await Promise.all(workers);
  console.log(`✅ All ${completed}/${totalBatches} batches processed.`);
  return completed;
}

// ====================
// 🚀 Main Endpoint
// ====================

export default function registerEndpoint(router, { services, database }) {
  const { ItemsService } = services;

  router.post("/", upload.single("file"), async (req, res) => {
    console.time("⏱ TOTAL PROCESS TIME");
    const start = Date.now();

    const results = {
      sheetFormat: "",
      totalEmployees: 0,
      totalLogs: 0,
      totalBatches: 0,
      invalidUsers: [],
      processingTime: "",
    };

    try {
      section("START IMPORT PROCESS");

      // Step 0 — Extract Input Data
      const { tenantId, importID, fileId } = req.body;
      const { file } = req;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      console.log(`📁 File: ${file.originalname}`);
      console.log(`🏢 Tenant ID: ${tenantId}`);
      console.log(`🪪 Import ID: ${importID}`);
      console.log(`📄 File ID: ${fileId}`);

      // Step 1 — Parse Excel
      const data = await parseExcelFile(file.buffer);

      // 🆕 Detect format
      const format = detectSheetFormat(data);
      results.sheetFormat = format;

      // Step 2-5 — Process with format-aware functions
      const employeeCodes = extractEmployeeCodes(data, format);

      const personalModuleService = new ItemsService("personalModule", {
        schema: req.schema,
        knex: database,
        accountability: req.accountability,
      });
      const logService = new ItemsService("logs", {
        schema: req.schema,
        knex: database,
        accountability: req.accountability,
      });
      const importService = new ItemsService("import", {
        schema: req.schema,
        knex: database,
        accountability: req.accountability,
      });

      const { employeeMap, invalidUsers } = await validateEmployees(
        employeeCodes,
        tenantId,
        personalModuleService
      );

      const { logs, logCount } = extractLogs(
        data,
        employeeMap,
        tenantId,
        format
      );

      const totalBatches = await insertLogsInBatches(
        logs,
        logService,
        importService,
        importID,
        fileId
      );

      if (totalBatches === Math.ceil(logs.length / 100)) {
        await importService.updateOne(importID, {
          status: "generated",
          updatedAt: new Date().toISOString(),
        });
        console.log(`🎉 Import completed: status set to GENERATED`);
      }

      // Final Summary
      results.totalEmployees = employeeMap.size;
      results.totalLogs = logs.length;
      results.invalidUsers = invalidUsers;
      results.totalBatches = totalBatches;
      results.processingTime = `${((Date.now() - start) / 1000).toFixed(2)}s`;

      console.table(results);
      console.timeEnd("⏱ TOTAL PROCESS TIME");

      res.json({
        message: `${logs.length} logs imported successfully.`,
        summary: results,
      });
    } catch (err) {
      console.error("❌ Import failed:", err);
      res.status(500).json({ error: err.message, summary: results });
    }
  });
}
