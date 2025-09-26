export default (router, { services }) => {
  const { ItemsService } = services;

  router.post("/missing-attendance", async (req, res) => {
    const startTime = Date.now();

    try {
      const { startDate, endDate, tenantId } = req.body;

      // Validation
      if (!startDate || !endDate || !tenantId) {
        return res
          .status(400)
          .json({ error: "startDate, endDate, and tenantId are required" });
      }

      // Step 1: Fetch all employee IDs for the tenant from personalModule
      const allEmployees = await fetchAllEmployeesForTenant(
        tenantId,
        services,
        req.schema
      );
      const employeeIds = allEmployees.map((emp) => emp.id);
      if (employeeIds.length === 0) {
        return res.json({
          success: true,
          processed: 0,
          message: "No employees found for tenant",
        });
      }

      // Step 2: Process in batches of 100 employees
      const batchSize = 100;
      const results = [];

      for (let i = 0; i < employeeIds.length; i += batchSize) {
        const batch = employeeIds.slice(i, i + batchSize);
        console.log(
          `Filling missing for batch ${
            Math.floor(i / batchSize) + 1
          }/${Math.ceil(employeeIds.length / batchSize)} with ${
            batch.length
          } employees`
        );

        const batchResult = await processMissingBatch(
          batch,
          startDate,
          endDate,
          tenantId,
          services,
          req.schema
        );
        results.push(...batchResult);
      }

      const endTime = Date.now();
      console.log(
        `Total fill missing time: ${endTime - startTime}ms for ${
          employeeIds.length
        } employees`
      );

      res.json({
        success: true,
        processed: results.length,
        totalTime: `${endTime - startTime}ms`,
        data: results,
      });
    } catch (error) {
      console.error("Fill missing attendance processing error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error.message,
      });
    }
  });
};

async function processMissingBatch(
  employeeIds,
  startDate,
  endDate,
  tenantId,
  services,
  schema
) {
  const { ItemsService } = services;

  // Step 1: Fetch existing attendance dates for the batch to identify missing ones
  const existingAttendance = await fetchExistingAttendanceDates(
    employeeIds,
    startDate,
    endDate,
    tenantId,
    services,
    schema
  );
  const existingDatesMap = createExistingDatesMap(existingAttendance);

  // Step 2: Fetch required data in bulk (personalModules, holidays, shifts)
  const [personalModules, holidays, shifts] = await Promise.all([
    fetchPersonalModules(employeeIds, services, schema),
    fetchHolidays(tenantId, services, schema),
    fetchShifts(tenantId, services, schema),
  ]);

  // Step 3: Create lookup maps
  const holidayMap = createHolidayMap(holidays);
  const shiftMap = createShiftMap(shifts);
  const employeeMap = createEmployeeMap(personalModules);

  // Step 4: Generate date range
  const dateRange = generateDateRange(startDate, endDate);

  // Step 5: Identify and process missing dates for each employee
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
        shiftMap
      );
      if (record) {
        missingRecords.push(record);
      }
    }
  }

  // Step 6: Bulk insert missing records
  if (missingRecords.length > 0) {
    await bulkInsertAttendance(missingRecords, services, schema);
  }

  return missingRecords.map((record) => ({
    employeeId: record.employeeId,
    date: record.date,
    attendance: record.attendance,
    attendanceContext: record.attendanceContext,
  }));
}

async function fetchAllEmployeesForTenant(tenantId, services, schema) {
  const personalModuleService = new ItemsService("personalModule", { schema });

  // Assuming personalModule has a tenant relation; adjust filter if needed
  return await personalModuleService.readByQuery({
    filter: {
      // Add tenant filter if personalModule has direct tenantId; otherwise, via config.tenant
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
  const attendanceService = new ItemsService("attendance", { schema });

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
    if (!map.has(record.employeeId)) {
      map.set(record.employeeId, new Set());
    }
    map.get(record.employeeId).add(record.date);
  });
  return map;
}

async function fetchPersonalModules(employeeIds, services, schema) {
  const personalModuleService = new ItemsService("personalModule", { schema });

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
  const holidayService = new ItemsService("holiday", { schema });

  return await holidayService.readByQuery({
    filter: {
      tenant: {
        tenantId: { _eq: tenantId },
      },
    },
    fields: ["date"],
    limit: -1,
  });
}

async function fetchShifts(tenantId, services, schema) {
  const shiftsService = new ItemsService("shifts", { schema });

  return await shiftsService.readByQuery({
    filter: {
      tenant: {
        tenantId: { _eq: tenantId },
      },
    },
    fields: ["id", "entryTime", "exitTime", "shift"],
    limit: -1,
  });
}

function createHolidayMap(holidays) {
  const map = new Map();
  holidays.forEach((holiday) => {
    map.set(holiday.date, true);
  });
  return map;
}

function createShiftMap(shifts) {
  const map = new Map();
  shifts.forEach((shift) => {
    map.set(shift.id, shift);
  });
  return map;
}

function createEmployeeMap(personalModules) {
  const map = new Map();
  personalModules.forEach((emp) => {
    map.set(emp.id, emp);
  });
  return map;
}

function generateDateRange(startDate, endDate) {
  const dates = [];
  const currentDate = new Date(startDate);
  const end = new Date(endDate);

  while (currentDate <= end) {
    dates.push(currentDate.toISOString().split("T")[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

function calculateMissingAttendanceForDate(
  employee,
  date,
  holidayMap,
  shiftMap
) {
  // Get day info
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

  // Get shift details (for duration, even if missing)
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

  // Calculate shift duration
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

  // Determine status for missing (no logs)
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

  // Return missing record
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
    mode: null,
    action: null,
    status: "absent",
    lastActionOn: null,
    outTime: null,
    penaltyAmount: 0,
    tenant: tenantId, // Assuming tenantId is passed
  };
}

async function bulkInsertAttendance(records, services, schema) {
  const attendanceService = new ItemsService("attendance", { schema });

  // Insert in sub-batches of 100
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await attendanceService.createMany(batch);
  }

  console.log(`Inserted ${records.length} missing attendance records`);
}
