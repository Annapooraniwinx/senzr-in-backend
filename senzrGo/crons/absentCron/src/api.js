export default {
  id: "absentCron",
  handler: async ({ services, schema }) => {
    const { ItemsService } = services;
    const startTime = Date.now();

    console.log("🚀 Starting automatic missing attendance fill job...");

    try {
      // 1️⃣ Get today and previous date (yesterday)
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);

      const startDate = yesterday.toISOString().split("T")[0];
      const endDate = today.toISOString().split("T")[0];

      console.log(
        `📅 Processing missing attendance for ${startDate} → ${endDate}`
      );

      // 2️⃣ Fetch all tenants
      const tenantService = new ItemsService("tenant", { schema });
      const tenants = await tenantService.readByQuery({
        fields: ["tenantId"],
        limit: -1,
      });

      if (!tenants || tenants.length === 0) {
        console.log("⚠️ No tenants found.");
        return;
      }

      console.log(`🏢 Found ${tenants.length} tenants to process.`);

      // 3️⃣ Process each tenant sequentially (or parallel if safe)
      for (const tenant of tenants) {
        const tenantId = tenant.tenantId;
        console.log(`🔹 Processing tenant: ${tenantId}`);

        try {
          await processTenantMissingAttendance(
            tenantId,
            startDate,
            endDate,
            services,
            schema
          );
        } catch (tenantError) {
          console.error(
            `❌ Error processing tenant ${tenantId}:`,
            tenantError.message
          );
        }
      }

      const endTime = Date.now();
      console.log(
        `✅ Missing attendance job completed for ${tenants.length} tenants in ${
          endTime - startTime
        }ms`
      );
    } catch (error) {
      console.error("🔥 Missing attendance auto job failed:", error);
    }
  },
};

// 🧩 Process missing attendance for a specific tenant
async function processTenantMissingAttendance(
  tenantId,
  startDate,
  endDate,
  services,
  schema
) {
  const { ItemsService } = services;
  const cronJobService = new ItemsService("cronJobs", { schema });

  // Create uniqueId for this tenant and date
  const uniqueId = `${tenantId}-${startDate}`;
  let cronJobId = null;

  try {
    // 🟢 INSERT: Log cron job start
    const cronJobRecord = await cronJobService.createOne({
      startTime: new Date().toISOString(),
      tenant: tenantId,
      date: startDate,
      message: "started",
      uniqueId: uniqueId,
    });
    cronJobId = cronJobRecord.id;

    console.log(`📝 Cron job logged for tenant ${tenantId} (ID: ${cronJobId})`);

    // Step 1: Fetch all employees under this tenant
    const allEmployees = await fetchAllEmployeesForTenant(
      tenantId,
      services,
      schema
    );
    const employeeIds = allEmployees.map((emp) => emp.id);

    if (employeeIds.length === 0) {
      console.log(`⚠️ No employees found for tenant ${tenantId}`);

      // 🔴 UPDATE: No employees found
      await cronJobService.updateOne(cronJobId, {
        endTime: new Date().toISOString(),
        message: "No employees found for this tenant",
      });
      return;
    }

    console.log(`👥 Tenant ${tenantId} → ${employeeIds.length} employees`);

    // Step 2: Process in batches and count total inserted records
    let totalInserted = 0;
    const batchSize = 100;
    for (let i = 0; i < employeeIds.length; i += batchSize) {
      const batch = employeeIds.slice(i, i + batchSize);
      console.log(
        `🧮 Tenant ${tenantId} → Batch ${
          Math.floor(i / batchSize) + 1
        }/${Math.ceil(employeeIds.length / batchSize)}`
      );

      const result = await processMissingBatch(
        batch,
        startDate,
        endDate,
        tenantId,
        services,
        schema
      );
      totalInserted += result.length;
      console.log(
        `✅ Tenant ${tenantId} → ${result.length} missing records inserted`
      );
    }

    // 🔴 UPDATE: Job completed with results
    const finalMessage =
      totalInserted === 0
        ? "No employees absent"
        : `Absent users updated: ${totalInserted}`;

    await cronJobService.updateOne(cronJobId, {
      endTime: new Date().toISOString(),
      message: finalMessage,
    });

    console.log(
      `✅ Cron job completed for tenant ${tenantId}: ${finalMessage}`
    );
  } catch (error) {
    // 🔴 UPDATE: Log error if cron job was created
    if (cronJobId) {
      try {
        await cronJobService.updateOne(cronJobId, {
          endTime: new Date().toISOString(),
          message: `Error: ${error.message}`,
        });
      } catch (updateError) {
        console.error(`Failed to update cron job ${cronJobId}:`, updateError);
      }
    }
    throw error;
  }
}

/* ---------- Reuse your previous helper functions ---------- */

async function processMissingBatch(
  employeeIds,
  startDate,
  endDate,
  tenantId,
  services,
  schema
) {
  const { ItemsService } = services;

  const existingAttendance = await fetchExistingAttendanceDates(
    employeeIds,
    startDate,
    endDate,
    tenantId,
    services,
    schema
  );
  const existingDatesMap = createExistingDatesMap(existingAttendance);

  const [personalModules, holidays, shifts] = await Promise.all([
    fetchPersonalModules(employeeIds, services, schema),
    fetchHolidays(tenantId, services, schema),
    fetchShifts(tenantId, services, schema),
  ]);

  const holidayMap = createHolidayMap(holidays);
  const shiftMap = createShiftMap(shifts);
  const employeeMap = createEmployeeMap(personalModules);
  const dateRange = generateDateRange(startDate, endDate);

  const missingRecords = [];

  for (const employeeId of employeeIds) {
    const employee = employeeMap.get(employeeId);
    if (!employee) continue;

    const existingDatesForEmp = existingDatesMap.get(employeeId) || new Set();
    const missingDates = dateRange.filter(
      (date) => !existingDatesForEmp.has(date)
    );

    for (const date of missingDates) {
      const record = calculateMissingAttendanceForDate(
        employee,
        date,
        holidayMap,
        shiftMap,
        tenantId
      );
      if (record) missingRecords.push(record);
    }
  }

  if (missingRecords.length > 0) {
    await bulkInsertAttendance(missingRecords, services, schema);
  }

  return missingRecords;
}

// ========== Helper functions ==========

async function fetchAllEmployeesForTenant(tenantId, services, schema) {
  const personalModuleService = new services.ItemsService("personalModule", {
    schema,
  });
  return await personalModuleService.readByQuery({
    filter: {
      config: {
        tenant: {
          tenantId: { _eq: tenantId },
        },
      },
    },
    fields: ["id", "employeeId"],
    limit: -1,
  });
}

async function fetchExistingAttendanceDates(
  employeeIds,
  startDate,
  endDate,
  tenantId,
  services,
  schema
) {
  const attendanceService = new services.ItemsService("attendance", { schema });
  return await attendanceService.readByQuery({
    filter: {
      _and: [
        { employeeId: { _in: employeeIds } },
        { date: { _between: [startDate, endDate] } },
        { tenant: { _eq: tenantId } },
      ],
    },
    fields: ["employeeId", "date"],
    limit: -1,
  });
}

function createExistingDatesMap(existingAttendance) {
  const map = new Map();
  existingAttendance.forEach((record) => {
    if (!map.has(record.employeeId)) map.set(record.employeeId, new Set());
    map.get(record.employeeId).add(record.date);
  });
  return map;
}

async function fetchPersonalModules(employeeIds, services, schema) {
  const personalModuleService = new services.ItemsService("personalModule", {
    schema,
  });
  return await personalModuleService.readByQuery({
    filter: { id: { _in: employeeIds } },
    fields: [
      "employeeId",
      "id",
      "config.id",
      "config.attendancePolicies.id",
      "attendanceSettings.id",
      "attendanceSettings.monJ",
      "attendanceSettings.tueJ",
      "attendanceSettings.wedJ",
      "attendanceSettings.thuJ",
      "attendanceSettings.friJ",
      "attendanceSettings.satJ",
      "attendanceSettings.sunJ",
      "attendanceSettings.isMonday",
      "attendanceSettings.isTuesday",
      "attendanceSettings.isWednesday",
      "attendanceSettings.isThursday",
      "attendanceSettings.isFriday",
      "attendanceSettings.isSaturday",
      "attendanceSettings.isSunday",
    ],
    limit: -1,
  });
}

async function fetchHolidays(tenantId, services, schema) {
  const holidayService = new services.ItemsService("holiday", { schema });
  return await holidayService.readByQuery({
    filter: { tenant: { tenantId: { _eq: tenantId } } },
    fields: ["date"],
    limit: -1,
  });
}

async function fetchShifts(tenantId, services, schema) {
  const shiftService = new services.ItemsService("shifts", { schema });
  return await shiftService.readByQuery({
    filter: { tenant: { tenantId: { _eq: tenantId } } },
    fields: ["id", "entryTime", "exitTime", "shift"],
    limit: -1,
  });
}

function createHolidayMap(holidays) {
  const map = new Map();
  holidays.forEach((h) => map.set(h.date, true));
  return map;
}

function createShiftMap(shifts) {
  const map = new Map();
  shifts.forEach((s) => map.set(s.id, s));
  return map;
}

function createEmployeeMap(personalModules) {
  const map = new Map();
  personalModules.forEach((emp) => map.set(emp.id, emp));
  return map;
}

function generateDateRange(startDate, endDate) {
  const dates = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    dates.push(d.toISOString().split("T")[0]);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function calculateMissingAttendanceForDate(
  employee,
  date,
  holidayMap,
  shiftMap,
  tenantId
) {
  const dateObj = new Date(date);
  const weekdayMap = ["sunJ", "monJ", "tueJ", "wedJ", "thuJ", "friJ", "satJ"];
  const weekdayBoolMap = [
    "isSunday",
    "isMonday",
    "isTuesday",
    "isWednesday",
    "isThursday",
    "isFriday",
    "isSaturday",
  ];

  const dayKey = weekdayMap[dateObj.getDay()];
  const dayBoolKey = weekdayBoolMap[dateObj.getDay()];
  const isWeekOff = employee.attendanceSettings?.[dayBoolKey] === true;
  const isHoliday = holidayMap.has(date);

  let selectedShift = null;
  const todayShifts = employee.attendanceSettings?.[dayKey]?.shifts || [];
  if (todayShifts.length > 0) {
    const shiftId = parseInt(todayShifts[0]);
    selectedShift = shiftMap.get(shiftId);
  } else {
    selectedShift = Array.from(shiftMap.values()).find(
      (s) => s.shift === "GeneralShift"
    );
  }
  if (!selectedShift) return null;

  const toMinutes = (time) => {
    if (!time) return 0;
    const [h, m, s = 0] = time.split(":").map(Number);
    return h * 60 + m + s / 60;
  };
  const toHHMMSS = (mins) => {
    const h = Math.floor(mins / 60);
    const m = Math.floor(mins % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  };

  let shiftStart = toMinutes(selectedShift.entryTime);
  let shiftEnd = toMinutes(selectedShift.exitTime);
  if (shiftEnd <= shiftStart) shiftEnd += 24 * 60;
  const shiftDurationMins = shiftEnd - shiftStart;

  let attendance, attendanceContext;
  if (isHoliday) {
    attendance = "holiday";
    attendanceContext = "Holiday";
  } else if (isWeekOff) {
    attendance = "weekoff";
    attendanceContext = "WeeklyOff";
  } else {
    attendance = "absent";
    attendanceContext = "Absent";
  }

  return {
    employeeId: employee.id,
    date,
    shiftName: selectedShift.shift,
    shiftDuration: toHHMMSS(shiftDurationMins),
    workHours: "00:00:00",
    breakTime: "00:00:00",
    overTime: "00:00:00",
    earlyDeparture: "00:00:00",
    lateComing: "00:00:00",
    attendance,
    attendanceContext,
    status: "absent",
    tenant: tenantId,
  };
}

async function bulkInsertAttendance(records, services, schema) {
  const attendanceService = new services.ItemsService("attendance", { schema });
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await attendanceService.createMany(batch);
  }
  console.log(`📦 Inserted ${records.length} attendance records.`);
}
