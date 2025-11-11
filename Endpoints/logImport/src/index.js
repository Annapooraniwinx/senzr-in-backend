import multer from "multer";
import * as XLSX from "xlsx";

const upload = multer({ storage: multer.memoryStorage() });

// ====================
// 🔧 Helper Functions
// ====================

// Pretty section header
const section = (label) =>
  console.log(
    `\n========== ${label.toUpperCase()} (${new Date().toLocaleString()}) ==========\n`
  );

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

// 2️⃣ Extract all employee codes
function extractEmployeeCodes(data) {
  section("STEP 2: EXTRACTING EMPLOYEE CODES");
  const codes = [];
  for (let row of data) {
    if (row[1] === "Employee Code:-" && row[10]) {
      codes.push(row[10].toString().trim());
    }
  }
  console.log(`👥 Found ${codes.length} employee blocks.`);
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

// 4️⃣ Parse logs for valid employees
function extractLogs(data, validMap, tenantId) {
  section("STEP 4: PARSING LOGS");
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

      // Step 1–5 — Process
      const data = await parseExcelFile(file.buffer);
      const employeeCodes = extractEmployeeCodes(data);

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

      const { logs, logCount } = extractLogs(data, employeeMap, tenantId);

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
