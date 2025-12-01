export default (router, { services }) => {
  router.post("/re-attendance", async (req, res) => {
    const startTime = Date.now();
    console.log(
      "🚀surthi Heina Jeson Starting attendance processing for",
      req.body.employeeIds.length,
      "employees"
    );
    try {
      const { employeeIds, startDate, endDate, tenantId } = req.body;
      // Validation
      if (
        !employeeIds ||
        !Array.isArray(employeeIds) ||
        employeeIds.length === 0
      ) {
        return res.status(400).json({ error: "employeeIds array is required" });
      }
      if (!startDate || !endDate || !tenantId) {
        return res
          .status(400)
          .json({ error: "startDate, endDate, and tenantId are required" });
      }
      // Process in batches of 100
      const batchSize = 100;
      const results = [];
      for (let i = 0; i < employeeIds.length; i += batchSize) {
        const batch = employeeIds.slice(i, i + batchSize);
        console.log(
          `🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            employeeIds.length / batchSize
          )} with ${batch.length} employees`
        );
        const batchResult = await processBatch(
          batch,
          startDate,
          endDate,
          tenantId,
          services,
          req.schema,
          req.accountability
        );
        results.push(...batchResult);
      }
      const endTime = Date.now();
      console.log(
        `🏁surthi Jeson Total processing time: ${endTime - startTime}ms for ${
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
      console.error("❌ Bulk attendance processing error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error.message,
      });
    }
  });
};

async function processBatch(
  employeeIds,
  startDate,
  endDate,
  tenantId,
  services,
  schema,
  accountability
) {
  console.log("🔄 Processing batch of", employeeIds.length, "employees");
  // Step 1: Delete ALL existing attendance data for the batch
  await deleteAllAttendance(
    employeeIds,
    startDate,
    endDate,
    tenantId,
    services,
    schema,
    accountability
  );
  // Step 2: Fetch all required data in bulk
  const [personalModules, holidays, shifts, logs] = await Promise.all([
    fetchPersonalModules(employeeIds, services, schema, accountability),
    fetchHolidays(tenantId, services, schema, accountability),
    fetchShifts(tenantId, services, schema, accountability),
    fetchLogs(
      employeeIds,
      startDate,
      endDate,
      tenantId,
      services,
      schema,
      accountability
    ),
  ]);
  // Step 3: Create lookup maps for faster access
  const holidayMap = new Map();

  personalModules.forEach((employee) => {
    const branchHolidays = employee.branchLocation?.holidays || [];
    branchHolidays.forEach((holidayId) => {
      const holiday = holidays.find((h) => h.id === Number(holidayId));
      if (holiday) {
        holidayMap.set(holiday.date, {
          event: holiday.event,
          branchIds: new Set([employee.branchLocation.id]),
        });
      }
    });
  });
  const shiftMap = createShiftMap(shifts);
  const logsMap = createLogsMap(logs);
  // Step 4: Generate date range
  const dateRange = generateDateRange(startDate, endDate);
  // Step 5: Process each employee for each date
  const attendanceRecords = [];
  const logsToInsert = [];
  for (const employee of personalModules) {
    for (const date of dateRange) {
      const dayLogs = logsMap.get(employee.id)?.get(date) || [];
      const hasLogs = dayLogs.length > 0;
      const record = calculateAttendanceForDate(
        employee,
        date,
        holidayMap,
        shiftMap,
        dayLogs,
        tenantId,
        hasLogs
      );

      if (record) {
        attendanceRecords.push(record);

        // If no logs exist, create log entry
        if (record.shouldCreateLog) {
          logsToInsert.push({
            tenant: tenantId,
            timeStamp: null,
            date: date,
            date_created: new Date().toISOString(),
            requestedDay: "fullDay",
            attendance_status: record.logAttendanceStatus,
            mode: "reCalculate",
            leaveType: "none",
            ValidLogs: "authorized",
            employeeId: employee.id,
          });
        }
      }
    }
  }
  // Step 6: Bulk insert logs first (if any)
  if (logsToInsert.length > 0) {
    await bulkInsertLogs(logsToInsert, services, schema, accountability);
  }
  // Step 7: Bulk insert attendance records
  if (attendanceRecords.length > 0) {
    await bulkInsertAttendance(
      attendanceRecords,
      services,
      schema,
      accountability
    );
  }
  return attendanceRecords.map((record) => ({
    employeeId: record.employeeId,
    date: record.date,
    attendance: record.attendance,
    attendanceContext: record.attendanceContext,
    inTime: record.inTime,
    outTime: record.outTime,
    workHours: record.workHours,
    lateBy: record.lateBy,
    earlyDeparture: record.earlyDeparture,
    overTime: record.overTime,
    day: record.day,
  }));
}

async function deleteAllAttendance(
  employeeIds,
  startDate,
  endDate,
  tenantId,
  services,
  schema,
  accountability
) {
  const { ItemsService } = services;
  const attendanceService = new ItemsService("attendance", {
    schema,
    accountability,
  });
  console.log(
    "🗑️ Deleting ALL attendance records for",
    employeeIds.length,
    "employees from",
    startDate,
    "to",
    endDate,
    "for tenant",
    tenantId
  );
  const existingRecords = await attendanceService.readByQuery({
    filter: {
      _and: [
        { employeeId: { _in: employeeIds } },
        { date: { _between: [startDate, endDate] } },
        { tenant: { _eq: tenantId } },
      ],
    },
    fields: ["id"],
    limit: -1,
  });
  console.log(
    `🗑️ Found ${existingRecords.length} total attendance records to delete`
  );
  const toDelete = existingRecords.map((record) => record.id);
  const batchSize = 100;
  for (let i = 0; i < toDelete.length; i += batchSize) {
    const batch = toDelete.slice(i, i + batchSize);
    console.log(
      `🗑️ Deleting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
        toDelete.length / batchSize
      )} with ${batch.length} records`
    );
    await attendanceService.deleteMany(batch);
  }
  console.log(`✅ Total deleted: ${toDelete.length} attendance records`);
}

async function fetchPersonalModules(
  employeeIds,
  services,
  schema,
  accountability
) {
  const { ItemsService } = services;
  const personalModuleService = new ItemsService("personalModule", {
    schema,
    accountability,
  });
  console.log(
    "📋 Fetching personal modules for",
    employeeIds.length,
    "employees"
  );
  return await personalModuleService.readByQuery({
    filter: { id: { _in: employeeIds } },
    fields: [
      "employeeId",
      "id",
      "assignedUser.first_name",
      "config.id",
      "config.configName",
      "config.attendancePolicies.id",
      "config.attendancePolicies.TotalWorking_Hours",
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
      "branchLocation.id",
      "branchLocation.holidays",
    ],
    limit: -1,
  });
}

async function fetchHolidays(tenantId, services, schema, accountability) {
  const { ItemsService } = services;
  const holidayService = new ItemsService("holiday", {
    schema,
    accountability,
  });
  console.log("⏰ Fetching branch-wise holidays for tenant", tenantId);
  return await holidayService.readByQuery({
    filter: {
      tenant: {
        tenantId: { _eq: tenantId },
      },
    },
    fields: ["id", "date", "event", "AssignHolidays"],
    limit: -1,
  });
}

async function fetchShifts(tenantId, services, schema, accountability) {
  const { ItemsService } = services;
  const shiftsService = new ItemsService("shifts", {
    schema,
    accountability,
  });
  console.log("⏰ Fetching shifts for tenant", tenantId);
  return await shiftsService.readByQuery({
    filter: {
      tenant: {
        tenantId: { _eq: tenantId },
      },
    },
    fields: ["id", "entryTime", "exitTime", "shift", "breakTypes"],
    limit: -1,
  });
}

async function fetchLogs(
  employeeIds,
  startDate,
  endDate,
  tenantId,
  services,
  schema,
  accountability
) {
  const { ItemsService } = services;
  const logsService = new ItemsService("logs", {
    schema,
    accountability,
  });
  console.log(
    "📒 Fetching logs for",
    employeeIds.length,
    "employees from",
    startDate,
    "to",
    endDate
  );
  return await logsService.readByQuery({
    filter: {
      _and: [
        { employeeId: { _in: employeeIds } },
        { date: { _between: [startDate, endDate] } },
        { tenant: { _eq: tenantId } },
      ],
    },
    fields: [
      "employeeId",
      "date",
      "timeStamp",
      "action",
      "mode",
      "attendance_status",
      "requestedDay",
      "date_created",
      "leaveType",
    ],
    sort: ["date_created"],
    limit: -1,
  });
}

function createBranchHolidayMap(holidays) {
  const map = new Map();

  holidays.forEach((holiday) => {
    const branchIds = holiday.AssignHolidays || [];
    if (branchIds.length === 0) return;

    map.set(holiday.date, {
      event: holiday.event,
      branchIds: new Set(branchIds.map((id) => Number(id))),
    });
  });

  console.log(`Branch-wise holiday map created with ${map.size} dates`);
  return map;
}

function createShiftMap(shifts) {
  const map = new Map();
  shifts.forEach((shift) => {
    map.set(shift.id, shift);
  });
  console.log("🗺️ Creating shift map with", shifts.length, "shifts");
  return map;
}

function createLogsMap(logs) {
  const map = new Map();
  logs.forEach((log) => {
    if (!map.has(log.employeeId)) {
      map.set(log.employeeId, new Map());
    }
    if (!map.get(log.employeeId).has(log.date)) {
      map.get(log.employeeId).set(log.date, []);
    }
    map.get(log.employeeId).get(log.date).push(log);
  });
  console.log("🗺️ Creating logs map for", logs.length, "logs");
  return map;
}

function generateDateRange(startDate, endDate) {
  const dates = [];
  const currentDate = new Date(startDate);
  const end = new Date(endDate);
  console.log("📅 Generating date range from", startDate, "to", endDate);
  while (currentDate <= end) {
    dates.push(currentDate.toISOString().split("T")[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  return dates;
}

function calculateAttendanceForDate(
  employee,
  date,
  holidayMap,
  shiftMap,
  dayLogs,
  tenantId,
  hasLogs
) {
  console.log("\n" + "=".repeat(80));
  console.log(`🎯 STARTING ATTENDANCE CALCULATION`);
  console.log(`👤 Employee ID: ${employee.id}`);
  console.log(`📅 Date: ${date}`);
  console.log(`📊 Has Logs: ${hasLogs ? "✅ YES" : "❌ NO"}`);
  console.log("=".repeat(80));

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
  const todayShifts = employee.attendanceSettings?.[dayKey]?.shifts || [];
  const isWeekOff = employee.attendanceSettings?.[dayBoolKey] === true;
  // New: Branch-based holiday check
  let isHoliday = false;
  let holidayEvent = null;

  const employeeBranchId = employee.branchLocation?.id;

  if (employeeBranchId && holidayMap.has(date)) {
    const holidayData = holidayMap.get(date);
    if (holidayData.branchIds.has(Number(employeeBranchId))) {
      isHoliday = true;
      holidayEvent = holidayData.event;
    }
  }

  console.log("\nDAY TYPE ANALYSIS:");
  console.log(
    ` Day of week: ${dateObj.toLocaleDateString("en-US", {
      weekday: "long",
    })} (${dayKey})`
  );
  console.log(` ${isWeekOff ? "WEEK OFF: YES" : "WEEK OFF: NO"}`);
  console.log(` ${isHoliday ? "HOLIDAY: YES" : "HOLIDAY: NO"}`);
  console.log(` 🎉Employee Branch ID: ${employeeBranchId}`);
  console.log(` 🏖️Holiday Name: ${holidayEvent || "N/A"}`);
  if (isHoliday) {
    console.log(` Holiday Name: ${holidayEvent || "N/A"}`);
    console.log(` Employee Branch ID: ${employeeBranchId}`);
  }

  console.log("\n📋 DAY TYPE ANALYSIS:");
  console.log(
    ` 🗓️ Day of week: ${dateObj.toLocaleDateString("en-US", {
      weekday: "long",
    })} (${dayKey})`
  );
  console.log(` ${isWeekOff ? "🏖️ WEEK OFF: YES" : "💼 WEEK OFF: NO"}`);
  console.log(` ${isHoliday ? "🎉 HOLIDAY: YES" : "📅 HOLIDAY: NO"}`);
  if (isHoliday) {
    console.log(` 🎊 Holiday Name: ${holidayMap.get(date)?.event || "N/A"}`);
  }

  // CASE: No logs at all - Create both attendance and log entry
  if (!hasLogs) {
    console.log("\n" + "🚨".repeat(40));
    console.log("🚨 CASE: NO LOGS FOUND - CREATING AUTOMATIC ENTRIES");
    console.log("🚨".repeat(40));

    let attendance, attendanceContext, day, logAttendanceStatus;

    if (!isWeekOff && !isHoliday) {
      console.log("\n📍 SUB-CASE 1: REGULAR DAY + NO LOGS → ABSENT");
      attendance = "absent";
      attendanceContext = "Absent";
      day = 0.0;
      logAttendanceStatus = "absent";
      console.log(" ❌ Attendance: absent");
      console.log(" 📊 Day Value: 0.0");
      console.log(" 📝 Creating log entry with status: absent");
    } else if (!isWeekOff && isHoliday) {
      console.log("\n📍 SUB-CASE 2: HOLIDAY + NO LOGS → HOLIDAY");
      attendance = "holiday";
      attendanceContext = "Holiday";
      day = 0.0;
      logAttendanceStatus = "holiday";
      console.log(" 🎉 Attendance: holiday");
      console.log(" 📊 Day Value: 0.0");
      console.log(" 📝 Creating log entry with status: holiday");
    } else if (isWeekOff && !isHoliday) {
      console.log("\n📍 SUB-CASE 3: WEEK OFF + NO LOGS → WEEK OFF");
      attendance = "weekOff";
      attendanceContext = "WeeklyOff";
      day = 1.0;
      logAttendanceStatus = "weekOff";
      console.log(" 🏖️ Attendance: weekOff");
      console.log(" 📊 Day Value: 1.0");
      console.log(" 📝 Creating log entry with status: weekOff");
    }

    console.log("\n✅ RESULT: Attendance + Log Entry Created");
    console.log("=".repeat(80) + "\n");

    return {
      employeeId: employee.id,
      date,
      shiftName: null,
      shiftDuration: "00:00:00",
      workHours: "00:00:00",
      breakTime: "00:00:00",
      overTime: "00:00:00",
      earlyDeparture: "00:00:00",
      lateBy: "00:00:00",
      attendance,
      attendanceContext,
      mode: "reCalculate",
      action: "notPunchedIn",
      status: "notPunchedIn",
      inTime: "00:00:00",
      outTime: "00:00:00",
      leaveType: "none",
      tenant: tenantId,
      day,
      uniqueId: `${date}-${employee.id}-${tenantId}`,
      shouldCreateLog: true,
      logAttendanceStatus,
    };
  }

  console.log("\n📋 SHIFT SELECTION PROCESS:");
  let selectedShift = null;
  if (todayShifts.length > 0) {
    const shiftId = parseInt(todayShifts[0]);
    console.log(` 🔍 Shift ID from settings: ${shiftId}`);
    selectedShift = shiftMap.get(shiftId);
    if (selectedShift) {
      console.log(` ✅ Found shift: ${selectedShift.shift}`);
      console.log(` ⏰ Entry Time: ${selectedShift.entryTime}`);
      console.log(` ⏰ Exit Time: ${selectedShift.exitTime}`);
    } else {
      console.log(` ❌ Shift ID ${shiftId} not found in shift map`);
    }
  } else {
    console.log(` ⚠️ No shift assigned, looking for GeneralShift...`);
    selectedShift = Array.from(shiftMap.values()).find(
      (s) => s.shift === "GeneralShift"
    );
    if (selectedShift) {
      console.log(` ✅ Using GeneralShift`);
      console.log(` ⏰ Entry Time: ${selectedShift.entryTime}`);
      console.log(` ⏰ Exit Time: ${selectedShift.exitTime}`);
    } else {
      console.log(` ❌ GeneralShift not found`);
    }
  }

  if (!selectedShift) {
    console.log("\n❌ CRITICAL ERROR: No shift found - Skipping record");
    console.log("=".repeat(80) + "\n");
    return null;
  }

  const totalWorkingHours =
    employee.config?.attendancePolicies?.TotalWorking_Hours || 9;
  console.log("\n⚙️ WORKING HOURS POLICY:");
  console.log(
    ` 📊 Total Working Hours Required: ${totalWorkingHours} hours (${
      totalWorkingHours * 60
    } mins)`
  );
  console.log(
    ` 📊 Half Working Hours: ${totalWorkingHours / 2} hours (${
      (totalWorkingHours * 60) / 2
    } mins)`
  );

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
  const minWorkingMins = totalWorkingHours * 60;
  const halfWorkingMins = minWorkingMins / 2;

  console.log("\n⏱️ SHIFT TIMING BREAKDOWN:");
  console.log(
    ` 🕐 Shift Start: ${selectedShift.entryTime} (${shiftStart} mins from midnight)`
  );
  console.log(
    ` 🕐 Shift End: ${selectedShift.exitTime} (${shiftEnd} mins from midnight)`
  );
  console.log(
    ` 📏 Shift Duration: ${toHHMMSS(
      shiftDurationMins
    )} (${shiftDurationMins} mins)`
  );

  // Separate logs into timestamp logs and status logs
  const timestampLogs = dayLogs.filter(
    (log) =>
      log.timeStamp && log.timeStamp !== "00:00:00" && !log.attendance_status
  );
  const statusLogs = dayLogs.filter((log) => log.attendance_status);

  console.log("\n📝 LOGS ANALYSIS:");
  console.log(` 📋 Total Logs: ${dayLogs.length}`);
  console.log(` ⏰ Timestamp Logs (punches): ${timestampLogs.length}`);
  console.log(` 📌 Status Logs (leaves/approvals): ${statusLogs.length}`);

  if (timestampLogs.length > 0) {
    console.log("\n 🕐 TIMESTAMP LOGS DETAIL:");
    timestampLogs.forEach((log, idx) => {
      console.log(
        ` ${idx + 1}. Time: ${log.timeStamp} | Mode: ${log.mode} | Created: ${
          log.date_created
        }`
      );
    });
  }
  if (statusLogs.length > 0) {
    console.log("\n 📌 STATUS LOGS DETAIL:");
    statusLogs.forEach((log, idx) => {
      console.log(
        ` ${idx + 1}. Status: ${log.attendance_status} | Requested: ${
          log.requestedDay || "N/A"
        } | Created: ${log.date_created}`
      );
    });
  }

  // Determine which case we're in
  const hasTimestamp = timestampLogs.length > 0;
  const hasStatusApproved = statusLogs.some((log) =>
    [
      "paidLeaveApproved",
      "unPaidLeaveApproved",
      "workFromHomeApproved",
      "onDutyApproved",
    ].includes(log.attendance_status)
  );

  console.log("\n🔍 CASE DETECTION:");
  console.log(` ${hasTimestamp ? "✅" : "❌"} Has Timestamp Logs`);
  console.log(` ${hasStatusApproved ? "✅" : "❌"} Has Approved Status`);

  // CASE 1: Only timestamp logs (normal attendance processing)
  if (hasTimestamp && !hasStatusApproved) {
    console.log("\n" + "📌".repeat(40));
    console.log("📌 CASE 1: NORMAL ATTENDANCE (TIMESTAMP ONLY)");
    console.log("📌".repeat(40));
    console.log(" 📝 Description: Employee has punch logs, no leave approvals");
    console.log(
      " ⚙️ Processing: Calculate work hours, late, early departure, overtime"
    );

    return processNormalAttendance(
      employee,
      date,
      selectedShift,
      timestampLogs,
      isHoliday,
      isWeekOff,
      minWorkingMins,
      shiftStart,
      shiftEnd,
      shiftDurationMins,
      tenantId,
      toMinutes,
      toHHMMSS
    );
  }

  // CASE 2: Single timestamp log without status (absent)
  if (timestampLogs.length === 1 && !hasStatusApproved) {
    console.log("\n" + "📌".repeat(40));
    console.log("📌 CASE 2: SINGLE PUNCH - MARKING ABSENT");
    console.log("📌".repeat(40));
    console.log(" 📝 Description: Only one punch found (incomplete)");
    console.log(" ⚙️ Processing: Mark as absent");
    console.log(" ❌ Result: Absent (day: 0.0)");
    console.log("=".repeat(80) + "\n");

    return {
      employeeId: employee.id,
      date,
      shiftName: selectedShift.shift,
      shiftDuration: toHHMMSS(shiftDurationMins),
      workHours: "00:00:00",
      breakTime: "00:00:00",
      overTime: "00:00:00",
      earlyDeparture: "00:00:00",
      lateBy: "00:00:00",
      attendance: "absent",
      attendanceContext: "Absent",
      mode: timestampLogs[0].mode,
      action: "notPunchedIn",
      status: "notPunchedIn",
      inTime: null,
      outTime: null,
      tenant: tenantId,
      day: 0.0,
      uniqueId: `${date}-${employee.id}-${tenantId}`,
      shouldCreateLog: false,
    };
  }

  // CASE 3 & 4: Timestamp + full day approved status
  if (hasTimestamp && hasStatusApproved) {
    const fullDayApproved = statusLogs.filter(
      (log) =>
        ["workFromHomeApproved", "onDutyApproved"].includes(
          log.attendance_status
        ) && log.requestedDay === "fullDay"
    );
    if (fullDayApproved.length > 0) {
      console.log("\n" + "📌".repeat(40));
      console.log("📌 CASE 3/4: TIMESTAMP + FULL DAY APPROVED (WFH/OD)");
      console.log("📌".repeat(40));
      console.log(" 📝 Description: Has punches + full day WFH/OD approval");
      console.log(` 📋 Found ${fullDayApproved.length} full day approval(s)`);
      // Get the latest approved status
      const latestApproved = fullDayApproved.sort(
        (a, b) =>
          new Date(b.date_created).getTime() -
          new Date(a.date_created).getTime()
      )[0];
      console.log("\n 🏆 LATEST APPROVAL WINS:");
      console.log(` Status: ${latestApproved.attendance_status}`);
      console.log(` Created: ${latestApproved.date_created}`);
      console.log(` Mode: ${latestApproved.mode}`);
      // Calculate work hours from timestamps
      const sortedTimestamps = timestampLogs.sort(
        (a, b) => toMinutes(a.timeStamp) - toMinutes(b.timeStamp)
      );
      const firstIn = toMinutes(sortedTimestamps[0].timeStamp);
      const lastOut = toMinutes(
        sortedTimestamps[sortedTimestamps.length - 1].timeStamp
      );
      const workingMins =
        firstIn && lastOut && lastOut > firstIn ? lastOut - firstIn : 0;
      const overtimeMins = Math.max(0, workingMins - minWorkingMins);
      const earlyDepartureMins =
        firstIn && lastOut && lastOut < shiftEnd ? shiftEnd - lastOut : 0;
      const lateComingMins =
        firstIn && firstIn > shiftStart ? firstIn - shiftStart : 0;
      console.log("\n ⏱️ TIME CALCULATIONS:");
      console.log(` First IN: ${toHHMMSS(firstIn)}`);
      console.log(` Last OUT: ${toHHMMSS(lastOut)}`);
      console.log(` Work Hours: ${toHHMMSS(workingMins)}`);
      console.log(` Late By: ${toHHMMSS(lateComingMins)}`);
      console.log(` Early Departure: ${toHHMMSS(earlyDepartureMins)}`);
      console.log(` Overtime: ${toHHMMSS(overtimeMins)}`);
      let attendance, attendanceContext;
      if (latestApproved.attendance_status === "workFromHomeApproved") {
        attendance = "workFromHome";
        attendanceContext = "Work From Home";
        console.log("\n 🏠 Final Attendance: Work From Home (day: 1.0)");
      } else {
        attendance = "onDuty";
        attendanceContext = "On OD";
        console.log("\n 🚗 Final Attendance: On Duty (day: 1.0)");
      }

      console.log("=".repeat(80) + "\n");
      return {
        employeeId: employee.id,
        date,
        shiftName: selectedShift.shift,
        shiftDuration: toHHMMSS(shiftDurationMins),
        workHours: toHHMMSS(workingMins),
        breakTime: "00:00:00",
        overTime: toHHMMSS(overtimeMins),
        earlyDeparture: toHHMMSS(earlyDepartureMins),
        lateBy: toHHMMSS(lateComingMins),
        attendance,
        attendanceContext,
        mode: latestApproved.mode,
        action: "punchedIn",
        status: lastOut ? "out" : "in",
        inTime: toHHMMSS(firstIn),
        outTime: toHHMMSS(lastOut),
        tenant: tenantId,
        day: 1.0,
        uniqueId: `${date}-${employee.id}-${tenantId}`,
        shouldCreateLog: false,
      };
    }
  }

  // CASE 5: No timestamp, only approved status (full day leaves/statuses)
  // In CASE 5: Add this check to detect and route half-day leaves
  if (!hasTimestamp && statusLogs.length > 0) {
    console.log("\n" + "📌".repeat(40));
    console.log("📌 CASE 5: NO TIMESTAMP, ONLY STATUS LOGS");
    console.log("📌".repeat(40));
    console.log(
      " 📝 Description: No punches, only status entries (leaves/manual)"
    );
    console.log(` 📋 Found ${statusLogs.length} status log(s)`);

    const approvedStatuses = statusLogs.filter((log) =>
      [
        "present",
        "absent",
        "holiday",
        "weekOff",
        "weekoffPresent",
        "holidayPresent",
        "paidLeave",
        "unPaidLeave",
        "onDuty",
        "workFromHome",
        "unPaidLeaveApproved",
        "paidLeaveApproved",
      ].includes(log.attendance_status)
    );

    if (approvedStatuses.length > 0) {
      const latestStatus = approvedStatuses.sort(
        (a, b) =>
          new Date(b.date_created).getTime() -
          new Date(a.date_created).getTime()
      )[0];

      // ✅ CHECK FOR HALF-DAY REQUEST
      if (latestStatus.requestedDay === "halfDay") {
        console.log(
          "\n🎯 HALF-DAY REQUEST DETECTED - ROUTING TO HALF-DAY PROCESSOR"
        );
        console.log(`Status: ${latestStatus.attendance_status}`);
        console.log(`Created: ${latestStatus.date_created}`);
        console.log("=".repeat(80) + "\n");

        return processHalfDayAttendance(
          employee,
          date,
          selectedShift,
          latestStatus,
          isHoliday,
          isWeekOff,
          shiftDurationMins,
          tenantId,
          toHHMMSS,
          false // hasPunch = false (no timestamps)
        );
      }

      // Otherwise continue with full-day mapping
      console.log("\n 🏆 LATEST STATUS WINS:");
      console.log(` Status: ${latestStatus.attendance_status}`);
      console.log(` Created: ${latestStatus.date_created}`);
      console.log(` Mode: ${latestStatus.mode}`);
      console.log(` Requested Day: ${latestStatus.requestedDay || "N/A"}`);

      const statusMapping = {
        present: { attendance: "present", context: "Present", day: 1.0 },
        absent: { attendance: "absent", context: "Absent", day: 0.0 },
        holiday: { attendance: "holiday", context: "Holiday", day: 0.0 },
        weekOff: { attendance: "weekOff", context: "WeeklyOff", day: 1.0 },
        weekoffPresent: {
          attendance: "weekoffPresent",
          context: "WeeklyOff Present",
          day: 1.0,
        },
        holidayPresent: {
          attendance: "holidayPresent",
          context: "Holiday Present",
          day: 1.0,
        },
        paidLeave: {
          attendance: "paidLeave",
          context: "On Leave",
          day: 1.0,
        },
        paidLeaveApproved: {
          attendance: "paidLeave",
          context: "On Leave",
          day: 1.0,
        },
        unPaidLeave: {
          attendance: "unPaidLeave",
          context: "UnPaidLeave",
          day: 0.0,
        },
        unPaidLeaveApproved: {
          attendance: "unPaidLeave",
          context: "UnPaidLeave",
          day: 0.0,
        },
        onDuty: { attendance: "onDuty", context: "On OD", day: 1.0 },
        workFromHome: {
          attendance: "workFromHome",
          context: "Work From Home",
          day: 1.0,
        },
      };
      const mapped =
        statusMapping[latestStatus.attendance_status] || statusMapping.absent;
      console.log("\n ✅ MAPPED ATTENDANCE:");
      console.log(` Attendance: ${mapped.attendance}`);
      console.log(` Context: ${mapped.context}`);
      console.log(` Day: ${mapped.day}`);
      console.log("=".repeat(80) + "\n");
      return {
        employeeId: employee.id,
        date,
        shiftName: selectedShift.shift,
        shiftDuration: toHHMMSS(shiftDurationMins),
        workHours: "00:00:00",
        breakTime: "00:00:00",
        overTime: "00:00:00",
        earlyDeparture: "00:00:00",
        lateBy: "00:00:00",
        attendance: mapped.attendance,
        attendanceContext: mapped.context,
        mode: latestStatus.mode,
        action: "notPunchedIn",
        status: "notPunchedIn",
        inTime: "00:00:00",
        outTime: "00:00:00",
        leaveType: latestStatus.leaveType || null,
        tenant: tenantId,
        day: mapped.day,
        uniqueId: `${date}-${employee.id}-${tenantId}`,
        shouldCreateLog: false,
      };
    }
  }

  // ✅ CORRECTED: processHalfDayAttendance function
  function processHalfDayAttendance(
    employee,
    date,
    selectedShift,
    halfDayLeave,
    isHoliday,
    isWeekOff,
    shiftDurationMins,
    tenantId,
    toHHMMSS,
    hasPunch
  ) {
    const isPaidLeave = halfDayLeave.attendance_status === "paidLeaveApproved";
    const isUnpaidLeave =
      halfDayLeave.attendance_status === "unPaidLeaveApproved";

    let attendance, attendanceContext, day, leaveType;

    console.log("\n" + "🎯".repeat(40));
    console.log("🎯 PROCESSING HALF-DAY LEAVE");
    console.log("🎯".repeat(40));
    console.log(` Leave Type: ${isPaidLeave ? "PAID" : "UNPAID"}`);
    console.log(` Has Punch: ${hasPunch ? "YES" : "NO"}`);
    console.log(
      ` Day Type: ${isHoliday ? "HOLIDAY" : isWeekOff ? "WEEKOFF" : "REGULAR"}`
    );

    if (isPaidLeave) {
      leaveType = halfDayLeave.leaveType || null;

      if (!isWeekOff && !isHoliday) {
        // Regular day + Paid Leave
        attendance = "present";
        if (hasPunch) {
          attendanceContext = "1/2Present 1/2On Leave";
        } else {
          attendanceContext = "1/2On Leave";
        }
        day = 1.0;
        console.log(
          ` ✅ Regular Day + Paid: attendance=${attendance}, context=${attendanceContext}, day=${day}`
        );
      } else if (!isWeekOff && isHoliday) {
        // Holiday + Paid Leave
        if (hasPunch) {
          attendance = "holidayPresent";
          attendanceContext = "1/2Holiday Present 1/2On Leave";
        } else {
          attendance = "holiday";
          attendanceContext = "1/2Holiday 1/2On Leave";
        }
        day = 1.0;
        console.log(
          ` ✅ Holiday + Paid: attendance=${attendance}, context=${attendanceContext}, day=${day}`
        );
      } else if (isWeekOff && !isHoliday) {
        // WeekOff + Paid Leave
        if (hasPunch) {
          attendance = "weekoffPresent";
          attendanceContext = "1/2WeeklyOff Present 1/2On Leave";
        } else {
          attendance = "weekOff";
          attendanceContext = "1/2WeeklyOff 1/2On Leave";
        }
        day = 1.0;
        console.log(
          ` ✅ WeekOff + Paid: attendance=${attendance}, context=${attendanceContext}, day=${day}`
        );
      } else if (isWeekOff && isHoliday) {
        // WeekOff + Holiday + Paid Leave
        if (hasPunch) {
          attendance = "weekoffPresent";
          attendanceContext = "1/2WeeklyOff Present 1/2Holiday 1/2On Leave";
        } else {
          attendance = "weekOff";
          attendanceContext = "1/2WeeklyOff 1/2Holiday 1/2On Leave";
        }
        day = 1.0;
        console.log(
          ` ✅ WeekOff+Holiday + Paid: attendance=${attendance}, context=${attendanceContext}, day=${day}`
        );
      }
    } else if (isUnpaidLeave) {
      leaveType = "none";

      if (!isWeekOff && !isHoliday) {
        // Regular day + Unpaid Leave
        if (hasPunch) {
          attendance = "present";
          attendanceContext = "1/2Present 1/2UnPaidLeave";
          day = 0.5;
        } else {
          attendance = "absent";
          attendanceContext = "1/2Absent 1/2UnPaidLeave";
          day = 0.0;
        }
        console.log(
          ` ✅ Regular Day + Unpaid: attendance=${attendance}, context=${attendanceContext}, day=${day}`
        );
      } else if (!isWeekOff && isHoliday) {
        // Holiday + Unpaid Leave
        if (hasPunch) {
          attendance = "holidayPresent";
          attendanceContext = "1/2Holiday Present 1/2UnPaidLeave";
          day = 0.5;
        } else {
          attendance = "holiday";
          attendanceContext = "1/2Holiday 1/2UnPaidLeave";
          day = 0.0;
        }
        console.log(
          ` ✅ Holiday + Unpaid: attendance=${attendance}, context=${attendanceContext}, day=${day}`
        );
      } else if (isWeekOff && !isHoliday) {
        // WeekOff + Unpaid Leave
        if (hasPunch) {
          attendance = "weekoffPresent";
          attendanceContext = "1/2WeeklyOff Present 1/2UnPaidLeave";
          day = 0.5;
        } else {
          attendance = "weekOff";
          attendanceContext = "1/2WeeklyOff 1/2UnPaidLeave";
          day = 0.0;
        }
        console.log(
          ` ✅ WeekOff + Unpaid: attendance=${attendance}, context=${attendanceContext}, day=${day}`
        );
      } else if (isWeekOff && isHoliday) {
        // WeekOff + Holiday + Unpaid Leave
        if (hasPunch) {
          attendance = "weekoffPresent";
          attendanceContext = "1/2WeeklyOff Present 1/2Holiday 1/2UnPaidLeave";
          day = 0.5;
        } else {
          attendance = "weekOff";
          attendanceContext = "1/2WeeklyOff 1/2Holiday 1/2UnPaidLeave";
          day = 0.0;
        }
        console.log(
          ` ✅ WeekOff+Holiday + Unpaid: attendance=${attendance}, context=${attendanceContext}, day=${day}`
        );
      }
    }

    console.log("=".repeat(80) + "\n");

    return {
      employeeId: employee.id,
      date,
      shiftName: selectedShift.shift,
      shiftDuration: toHHMMSS(shiftDurationMins),
      workHours: hasPunch ? "00:00:00" : "00:00:00",
      breakTime: "00:00:00",
      overTime: "00:00:00",
      earlyDeparture: "00:00:00",
      lateBy: "00:00:00",
      attendance,
      attendanceContext,
      mode: "reCalculate",
      action: hasPunch ? "punchedIn" : "notPunchedIn",
      status: hasPunch ? "out" : "notPunchedIn",
      inTime: hasPunch || null,
      outTime: hasPunch || null,
      leaveType,
      tenant: tenantId,
      day,
      uniqueId: `${date}-${employee.id}-${tenantId}`,
    };
  }

  // CASE 6: Timestamp exists but worked less than half + has approved leaves
  if (hasTimestamp && hasStatusApproved) {
    console.log("\n" + "📌".repeat(40));
    console.log("📌 CASE 6: INSUFFICIENT HOURS + APPROVED LEAVE");
    console.log("📌".repeat(40));
    console.log(
      " 📝 Description: Has punches but worked < half required hours"
    );
    const sortedTimestamps = timestampLogs.sort(
      (a, b) => toMinutes(a.timeStamp) - toMinutes(b.timeStamp)
    );
    const firstIn = toMinutes(sortedTimestamps[0].timeStamp);
    const lastOut = toMinutes(
      sortedTimestamps[sortedTimestamps.length - 1].timeStamp
    );
    const workingMins =
      firstIn && lastOut && lastOut > firstIn ? lastOut - firstIn : 0;
    console.log("\n ⏱️ WORK HOURS CHECK:");
    console.log(` First IN: ${toHHMMSS(firstIn)}`);
    console.log(` Last OUT: ${toHHMMSS(lastOut)}`);
    console.log(` Worked: ${toHHMMSS(workingMins)} (${workingMins} mins)`);
    console.log(
      ` Half Required: ${toHHMMSS(halfWorkingMins)} (${halfWorkingMins} mins)`
    );
    console.log(
      ` ${workingMins < halfWorkingMins ? "❌ INSUFFICIENT" : "✅ SUFFICIENT"}`
    );
    // Check if worked less than half
    if (workingMins < halfWorkingMins) {
      console.log("\n 🔍 CHECKING FOR LEAVE APPROVALS...");

      const fullDayLeaves = statusLogs.filter(
        (log) =>
          [
            "paidLeaveApproved",
            "unPaidLeaveApproved",
            "workFromHomeApproved",
            "onDutyApproved",
          ].includes(log.attendance_status) && log.requestedDay === "fullDay"
      );
      if (fullDayLeaves.length > 0) {
        console.log(` ✅ Found ${fullDayLeaves.length} full day leave(s)`);

        const latestLeave = fullDayLeaves.sort(
          (a, b) =>
            new Date(b.date_created).getTime() -
            new Date(a.date_created).getTime()
        )[0];
        console.log("\n 🏆 APPLYING LATEST FULL DAY LEAVE:");
        console.log(` Status: ${latestLeave.attendance_status}`);
        console.log(` Created: ${latestLeave.date_created}`);
        console.log(` ⚠️ Ignoring actual punch times (insufficient hours)`);
        const leaveMapping = {
          paidLeaveApproved: {
            attendance: "paidLeave",
            context: "On Leave",
            day: 1.0,
          },
          unPaidLeaveApproved: {
            attendance: "unPaidLeave",
            context: "UnPaidLeave",
            day: 0.0,
          },
          workFromHomeApproved: {
            attendance: "workFromHome",
            context: "Work From Home",
            day: 1.0,
          },
          onDutyApproved: {
            attendance: "onDuty",
            context: "On OD",
            day: 1.0,
          },
        };
        const mapped = leaveMapping[latestLeave.attendance_status];
        console.log("\n ✅ FINAL ATTENDANCE (LEAVE APPLIED):");
        console.log(` Attendance: ${mapped.attendance}`);
        console.log(` Context: ${mapped.context}`);
        console.log(` Day: ${mapped.day}`);
        console.log(` Times: 00:00:00 (leave overrides punches)`);
        console.log("=".repeat(80) + "\n");
        return {
          employeeId: employee.id,
          date,
          shiftName: selectedShift.shift,
          shiftDuration: toHHMMSS(shiftDurationMins),
          workHours: "00:00:00",
          breakTime: "00:00:00",
          overTime: "00:00:00",
          earlyDeparture: "00:00:00",
          lateBy: "00:00:00",
          attendance: mapped.attendance,
          attendanceContext: mapped.context,
          mode: latestLeave.mode,
          action: "notPunchedIn",
          status: "notPunchedIn",
          inTime: "00:00:00",
          outTime: "00:00:00",
          leaveType: latestLeave.leaveType || null,
          tenant: tenantId,
          day: mapped.day,
          uniqueId: `${date}-${employee.id}-${tenantId}`,
          shouldCreateLog: false,
        };
      }
      // Check for half day leaves
      // ————————————————————————————————————————————————————————————————
      // FINAL CORRECTED HALF-DAY LOGIC (2025 HR Standard)
      // ————————————————————————————————————————————————————————————————
      const halfDayLeave = statusLogs.find(
        (log) =>
          log.requestedDay === "halfDay" &&
          ["paidLeaveApproved", "unPaidLeaveApproved"].includes(
            log.attendance_status
          )
      );

      if (halfDayLeave) {
        console.log("HALF-DAY LEAVE APPROVED → APPLYING CORRECT HR LOGIC");
        const isPaid = halfDayLeave.attendance_status === "paidLeaveApproved";
        const hasPunch = timestampLogs.length > 0;

        const dayValue = isPaid ? 1.0 : hasPunch ? 0.5 : 0.0;

        let attendance, context;

        if (isHoliday) {
          attendance = hasPunch ? "holidayPresent" : "holiday";
          context = hasPunch
            ? `1/2Holiday Present 1/2${isPaid ? "On Leave" : "UnPaidLeave"}`
            : `1/2Holiday 1/2${isPaid ? "On Leave" : "UnPaidLeave"}`;
        } else if (isWeekOff) {
          attendance = hasPunch ? "weekoffPresent" : "weekOff";
          context = hasPunch
            ? `1/2WeeklyOff Present 1/2${isPaid ? "On Leave" : "UnPaidLeave"}`
            : `1/2WeeklyOff 1/2${isPaid ? "On Leave" : "UnPaidLeave"}`;
        } else {
          // Regular Day
          if (hasPunch) {
            attendance = "present";
            context = `1/2Present 1/2${isPaid ? "On Leave" : "UnPaidLeave"}`;
          } else {
            attendance = isPaid ? "present" : "unPaidLeave"; // or "absent"
            context = isPaid
              ? "1/2Present 1/2On Leave"
              : "1/2Absent 1/2UnPaidLeave";
          }
        }

        console.log(
          `FINAL → Attendance: ${attendance} | Context: ${context} | Day: ${dayValue}`
        );

        return {
          employeeId: employee.id,
          date,
          shiftName: selectedShift?.shift || "GeneralShift",
          shiftDuration: selectedShift
            ? toHHMMSS(shiftDurationMins)
            : "09:00:00",
          workHours: hasPunch && isPaid ? toHHMMSS(workingMins) : "00:00:00",
          breakTime: "00:00:00",
          overTime: "00:00:00",
          earlyDeparture: "00:00:00",
          lateBy: "00:00:00",
          attendance,
          attendanceContext: context,
          mode: "reCalculate",
          action: hasPunch ? "punchedIn" : "notPunchedIn",
          status: hasPunch ? "out" : "notPunchedIn",
          inTime: hasPunch ? timestampLogs[0].timeStamp : null,
          outTime: hasPunch
            ? timestampLogs[timestampLogs.length - 1].timeStamp
            : null,
          leaveType: isPaid ? halfDayLeave.leaveType || null : "none",
          tenant: tenantId,
          day: dayValue,
          uniqueId: `${date}-${employee.id}-${tenantId}`,
          shouldCreateLog: false,
        };
      }
    } else {
      console.log("\n ✅ SUFFICIENT HOURS: Processing as normal attendance");
      console.log("=".repeat(80) + "\n");
    }
  }

  // Default: Normal attendance processing
  console.log("\n" + "📌".repeat(40));
  console.log("📌 DEFAULT CASE: PROCESSING AS NORMAL ATTENDANCE");
  console.log("📌".repeat(40));

  return processNormalAttendance(
    employee,
    date,
    selectedShift,
    timestampLogs,
    isHoliday,
    isWeekOff,
    minWorkingMins,
    shiftStart,
    shiftEnd,
    shiftDurationMins,
    tenantId,
    toMinutes,
    toHHMMSS
  );
}

function processNormalAttendance(
  employee,
  date,
  selectedShift,
  timestampLogs,
  isHoliday,
  isWeekOff,
  minWorkingMins,
  shiftStart,
  shiftEnd,
  shiftDurationMins,
  tenantId,
  toMinutes,
  toHHMMSS
) {
  let firstIn = null;
  let lastOut = null;
  let mode = null;
  if (timestampLogs.length > 0) {
    const sortedLogs = timestampLogs.sort(
      (a, b) => toMinutes(a.timeStamp) - toMinutes(b.timeStamp)
    );
    firstIn = toMinutes(sortedLogs[0].timeStamp);
    lastOut = toMinutes(sortedLogs[sortedLogs.length - 1].timeStamp);
    mode = sortedLogs[sortedLogs.length - 1].mode;
  }
  const workingMins =
    firstIn && lastOut && lastOut > firstIn ? lastOut - firstIn : 0;
  const overtimeMins = Math.max(0, workingMins - minWorkingMins);
  const earlyDepartureMins =
    firstIn && lastOut && lastOut < shiftEnd ? shiftEnd - lastOut : 0;
  const lateComingMins =
    firstIn && firstIn > shiftStart ? firstIn - shiftStart : 0;
  let action, status;
  if (timestampLogs.length === 0) {
    action = "notPunchedIn";
    status = "notPunchedIn";
  } else {
    action = "punchedIn";
    status = lastOut ? "out" : "in";
  }
  let attendance = firstIn && lastOut ? "present" : "absent";
  let attendanceContext = firstIn && lastOut ? "Present" : "Absent";
  if (isHoliday) {
    attendance = firstIn && lastOut ? "holidayPresent" : "holiday";
    attendanceContext = firstIn && lastOut ? "Holiday Present" : "Holiday";
  } else if (isWeekOff) {
    attendance = firstIn && lastOut ? "weekoffPresent" : "weekoff";
    attendanceContext = firstIn && lastOut ? "WeeklyOff Present" : "WeeklyOff";
  }
  let day = 0.0;
  if (
    attendance === "present" ||
    attendance === "weekoff" ||
    attendance === "weekoffPresent" ||
    attendance === "holidayPresent"
  ) {
    day = 1.0;
  } else if (attendance === "absent" || attendance === "holiday") {
    day = 0.0;
  }
  return {
    employeeId: employee.id,
    date,
    shiftName: selectedShift.shift,
    shiftDuration: toHHMMSS(shiftDurationMins),
    workHours: toHHMMSS(workingMins),
    breakTime: "00:00:00",
    overTime: toHHMMSS(overtimeMins),
    earlyDeparture: toHHMMSS(earlyDepartureMins),
    lateBy: toHHMMSS(lateComingMins),
    attendance,
    attendanceContext,
    mode,
    action,
    status,
    inTime: firstIn ? toHHMMSS(firstIn) : null,
    outTime: lastOut ? toHHMMSS(lastOut) : null,
    tenant: tenantId,
    day,
    uniqueId: `${date}-${employee.id}-${tenantId}`,
    shouldCreateLog: false,
  };
}

function processHalfDayAttendance(
  employee,
  date,
  selectedShift,
  halfDayLeave,
  isHoliday,
  isWeekOff,
  shiftDurationMins,
  tenantId,
  toHHMMSS
) {
  const isPaidLeave = halfDayLeave.attendance_status === "paidLeaveApproved";
  const isUnpaidLeave =
    halfDayLeave.attendance_status === "unPaidLeaveApproved";
  let attendance, attendanceContext, day, leaveType;
  if (isPaidLeave) {
    leaveType = halfDayLeave.leaveType || null;
    if (!isWeekOff && !isHoliday) {
      // Regular day
      attendance = "present";
      attendanceContext = "1/2Present 1/2On Leave";
      day = 1.0;
    } else if (!isWeekOff && isHoliday) {
      // Holiday
      attendance = "holidayPresent";
      attendanceContext = "1/2HolidayPresent 1/2On Leave";
      day = 1.0;
    } else if (isWeekOff && !isHoliday) {
      // Week off
      attendance = "weekoffPresent";
      attendanceContext = "1/2WeeklyOff Present 1/2On Leave";
      day = 1.0;
    }
  } else if (isUnpaidLeave) {
    leaveType = "none";
    if (!isWeekOff && !isHoliday) {
      // Regular day
      attendance = "present";
      attendanceContext = "1/2Present 1/2UnPaidLeave";
      day = 0.5;
    } else if (!isWeekOff && isHoliday) {
      // Holiday
      attendance = "holidayPresent";
      attendanceContext = "1/2HolidayPresent 1/2UnPaidLeave";
      day = 0.5;
    } else if (isWeekOff && !isHoliday) {
      // Week off
      attendance = "weekoffPresent";
      attendanceContext = "1/2WeeklyOff Present 1/2UnPaidLeave";
      day = 0.5;
    }
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
    lateBy: "00:00:00",
    attendance,
    attendanceContext,
    mode: halfDayLeave.mode,
    action: "notPunchedIn",
    status: "notPunchedIn",
    inTime: null,
    outTime: null,
    leaveType,
    tenant: tenantId,
    day,
    uniqueId: `${date}-${employee.id}-${tenantId}`,
    shouldCreateLog: false,
  };
}

async function bulkInsertLogs(records, services, schema, accountability) {
  const { ItemsService } = services;
  const logsService = new ItemsService("logs", {
    schema,
    accountability,
  });
  console.log("📥 Inserting", records.length, "log records");
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await logsService.createMany(batch);
  }
  console.log(`📥 Inserted ${records.length} log records`);
}

async function bulkInsertAttendance(records, services, schema, accountability) {
  const { ItemsService } = services;
  const attendanceService = new ItemsService("attendance", {
    schema,
    accountability,
  });
  console.log("📥 Inserting", records.length, "attendance records");
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await attendanceService.createMany(batch);
  }
  console.log(`📥 Inserted ${records.length} attendance records`);
}
