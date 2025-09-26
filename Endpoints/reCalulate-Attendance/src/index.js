export default (router, { services }) => {
  router.post("/re-attendance", async (req, res) => {
    const startTime = Date.now();

    console.log(
      "🚀 Lunajaon Starting attendance processing for",
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
        `🏁 Total processing time: ${endTime - startTime}ms for ${
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

  // Step 1: Delete existing non-manual attendance data for the batch and get manual map
  const manualMap = await deleteExistingAttendance(
    employeeIds,
    startDate,
    endDate,
    tenantId,
    services,
    schema,
    accountability
  );

  // Step 2: Fetch all required data in bulk
  const [personalModules, holidays, shifts, policies, logs] = await Promise.all(
    [
      fetchPersonalModules(employeeIds, services, schema, accountability),
      fetchHolidays(tenantId, services, schema, accountability),
      fetchShifts(tenantId, services, schema, accountability),
      fetchAttendancePolicies(employeeIds, services, schema, accountability),
      fetchLogs(
        employeeIds,
        startDate,
        endDate,
        tenantId,
        services,
        schema,
        accountability
      ),
    ]
  );

  // Step 3: Create lookup maps for faster access
  const holidayMap = createHolidayMap(holidays);
  const shiftMap = createShiftMap(shifts);
  const policyMap = createPolicyMap(policies);
  const logsMap = createLogsMap(logs);

  // Step 4: Generate date range
  const dateRange = generateDateRange(startDate, endDate);

  // Step 5: Process each employee for each date, skipping manual dates
  const attendanceRecords = [];

  for (const employee of personalModules) {
    const manualDates = manualMap.get(employee.id) || new Set();
    for (const date of dateRange) {
      if (manualDates.has(date)) {
        console.log(
          `⏩ Skipping manual entry for employee ${employee.id} on ${date}`
        );
        continue;
      }
      const record = calculateAttendanceForDate(
        employee,
        date,
        holidayMap,
        shiftMap,
        policyMap,
        logsMap.get(employee.id)?.get(date) || [],
        tenantId
      );
      if (record) {
        attendanceRecords.push(record);
      }
    }
  }

  // Step 6: Bulk insert attendance records
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

async function deleteExistingAttendance(
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
    "🗑️ Deleting existing non-manual attendance records for",
    employeeIds.length,
    "employees from",
    startDate,
    "to",
    endDate,
    "for tenant",
    tenantId
  );

  // Define manual types
  const manualTypes = new Set([
    "workFromHome",
    "onDuty",
    "halfDay",
    "paidLeave",
    "unPaidLeave",
  ]);

  // Fetch all matching attendance records with necessary fields
  const existingRecords = await attendanceService.readByQuery({
    filter: {
      _and: [
        { employeeId: { _in: employeeIds } },
        { date: { _between: [startDate, endDate] } },
        { tenant: { _eq: tenantId } },
      ],
    },
    fields: ["id", "employeeId", "date", "attendance"],
    limit: -1, // Ensure all records are fetched
  });

  console.log(`🗑️ Found ${existingRecords.length} attendance records in total`);

  // Separate manual and non-manual
  const toDelete = [];
  const manualMap = new Map();

  existingRecords.forEach((record) => {
    if (manualTypes.has(record.attendance)) {
      if (!manualMap.has(record.employeeId)) {
        manualMap.set(record.employeeId, new Set());
      }
      manualMap.get(record.employeeId).add(record.date);
    } else {
      toDelete.push(record.id);
    }
  });

  // Log manual entries
  console.log(`📌 Manual entries preserved for ${manualMap.size} employees`);
  for (const [empId, dates] of manualMap.entries()) {
    console.log(
      `   👤 Employee ${empId}: ${dates.size} dates - ${Array.from(dates)
        .sort()
        .join(", ")}`
    );
  }

  // Delete non-manual in batches of 100
  const batchSize = 100;

  for (let i = 0; i < toDelete.length; i += batchSize) {
    const batch = toDelete.slice(i, i + batchSize);
    console.log(
      `🗑️ Deleting batch ${Math.floor(i / batchSize) + 1} with ${
        batch.length
      } non-manual records`
    );

    await attendanceService.deleteMany(batch);
    console.log(
      `🗑️ Deleted ${batch.length} records in batch ${
        Math.floor(i / batchSize) + 1
      }`
    );
  }

  console.log(
    `🗑️ Total deleted: ${toDelete.length} non-manual attendance records`
  );

  return manualMap;
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
      "holidaySettingsJ",
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

  console.log("🎉 Fetching holidays for tenant", tenantId);

  return await holidayService.readByQuery({
    filter: {
      tenant: {
        tenantId: { _eq: tenantId },
      },
    },
    fields: ["id", "date", "event"],
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

async function fetchAttendancePolicies(
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
    "📜 Fetching attendance policies for",
    employeeIds.length,
    "employees"
  );

  // Get policy IDs first
  const modules = await personalModuleService.readByQuery({
    filter: { id: { _in: employeeIds } },
    fields: ["config.attendancePolicies.id"],
    limit: -1,
  });

  const policyIds = [
    ...new Set(
      modules.map((m) => m.config?.attendancePolicies?.id).filter((id) => id)
    ),
  ];

  if (policyIds.length === 0) return [];

  const policyService = new ItemsService("attendancePolicies", {
    schema,
    accountability,
  });
  return await policyService.readByQuery({
    filter: { id: { _in: policyIds } },
    fields: [
      "id",
      "setMinWorkingHours",
      "workingHoursType",
      "wrkHoursDayMode",
      "earlyLeavingType",
      "earlyLeavingDayMode",
      "earlyExitAllowed",
      "earlyExitPenaltyAmt",
      "earlyLeavingLeave",
      "isWorkingHours",
    ],
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
    fields: ["employeeId", "date", "timeStamp", "action", "mode"],
    sort: ["timeStamp"],
    limit: -1,
  });
}

function createHolidayMap(holidays) {
  const map = new Map();
  holidays.forEach((holiday) => {
    map.set(holiday.date, holiday);
  });

  console.log("🗺️ Creating holiday map with", holidays.length, "holidays");

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

function createPolicyMap(policies) {
  const map = new Map();
  policies.forEach((policy) => {
    map.set(policy.id, policy);
  });

  console.log("🗺️ Creating policy map with", policies.length, "policies");

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
  policyMap,
  dayLogs,
  tenantId
) {
  console.log(
    "⏰ Calculating attendance for employee",
    employee.id,
    "on",
    date
  );

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

  console.log(`🗓️ Date analysis for ${date}:`);
  console.log(`   - Day of week: ${dateObj.getDay()} (${dayKey})`);
  console.log(`   - Day bool key: ${dayBoolKey}`);

  const todayShifts = employee.attendanceSettings?.[dayKey]?.shifts || [];
  const isWeekOff = employee.attendanceSettings?.[dayBoolKey] === true;
  const isHoliday = holidayMap.has(date);

  console.log(`📊 Employee ${employee.id} attendance settings:`);
  console.log(
    `   - Attendance settings exist: ${!!employee.attendanceSettings}`
  );
  console.log(`   - Day key (${dayKey}) shifts:`, todayShifts);
  console.log(
    `   - Week off boolean (${dayBoolKey}): ${employee.attendanceSettings?.[dayBoolKey]}`
  );
  console.log(`   - Is week off: ${isWeekOff}`);
  console.log(`   - Is holiday: ${isHoliday}`);
  if (isHoliday) {
    console.log(`   - Holiday details:`, holidayMap.get(date));
  }

  let selectedShift = null;
  console.log(`🔄 Shift selection process for employee ${employee.id}:`);
  if (todayShifts.length > 0) {
    const shiftId = parseInt(todayShifts[0]);
    console.log(`   - Using shift ID from attendance settings: ${shiftId}`);
    selectedShift = shiftMap.get(shiftId);
    console.log(`   - Selected shift from map:`, selectedShift);
  } else {
    console.log(
      `   - No shifts found in attendance settings, looking for GeneralShift`
    );
    selectedShift = Array.from(shiftMap.values()).find(
      (s) => s.shift === "GeneralShift"
    );
    console.log(`   - GeneralShift found:`, selectedShift);
  }

  if (!selectedShift) {
    console.log(
      `❌ No shift found for employee ${employee.id} on ${date}, skipping record`
    );
    return null;
  }

  console.log(`✅ Using shift for ${employee.id}:`, {
    shiftName: selectedShift.shift,
    entryTime: selectedShift.entryTime,
    exitTime: selectedShift.exitTime,
  });

  const policyId = employee.config?.attendancePolicies?.id;
  const policy = policyMap.get(policyId) || {};
  const minWorkingHoursStr = policy.setMinWorkingHours || "09:00:00";

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
  const minWorkingMins = toMinutes(minWorkingHoursStr);

  let firstIn = null;
  let lastOut = null;
  let mode = null;

  console.log(`📒 Processing logs for employee ${employee.id} on ${date}:`);
  console.log(`   - Total logs for this date: ${dayLogs.length}`);

  if (dayLogs.length > 0) {
    const sortedLogs = dayLogs.sort((a, b) => {
      const timeA = toMinutes(a.timeStamp);
      const timeB = toMinutes(b.timeStamp);
      return timeA - timeB;
    });

    console.log(
      `   - Sorted logs:`,
      sortedLogs.map((log) => ({
        timeStamp: log.timeStamp,
        action: log.action,
        mode: log.mode,
        minutes: toMinutes(log.timeStamp),
      }))
    );

    firstIn = toMinutes(sortedLogs[0].timeStamp);
    console.log(
      `   - Earliest timestamp (firstIn): ${sortedLogs[0].timeStamp} (${firstIn} mins)`
    );

    lastOut = toMinutes(sortedLogs[sortedLogs.length - 1].timeStamp);
    mode = sortedLogs[sortedLogs.length - 1].mode;
    console.log(
      `   - Latest timestamp (lastOut): ${
        sortedLogs[sortedLogs.length - 1].timeStamp
      } (${lastOut} mins), mode: ${mode}`
    );
  }

  console.log(`📊 Final punch times for employee ${employee.id}:`);
  console.log(
    `   - First IN: ${firstIn ? toHHMMSS(firstIn) : "None"} (${firstIn} mins)`
  );
  console.log(
    `   - Last OUT: ${lastOut ? toHHMMSS(lastOut) : "None"} (${lastOut} mins)`
  );
  console.log(`   - Final mode: ${mode || "None"}`);

  const workingMins =
    firstIn && lastOut && lastOut > firstIn ? lastOut - firstIn : 0;
  const overtimeMins = Math.max(0, workingMins - minWorkingMins);
  const earlyDepartureMins =
    firstIn && lastOut && lastOut < shiftEnd ? shiftEnd - lastOut : 0;
  const lateComingMins =
    firstIn && firstIn > shiftStart ? firstIn - shiftStart : 0;

  console.log(`🧮 Time calculations for employee ${employee.id}:`);
  console.log(`   - Shift start: ${toHHMMSS(shiftStart)} (${shiftStart} mins)`);
  console.log(`   - Shift end: ${toHHMMSS(shiftEnd)} (${shiftEnd} mins)`);
  console.log(
    `   - Shift duration: ${toHHMMSS(
      shiftDurationMins
    )} (${shiftDurationMins} mins)`
  );
  console.log(
    `   - Min working hours required: ${toHHMMSS(
      minWorkingMins
    )} (${minWorkingMins} mins)`
  );
  console.log(`   - Actual working minutes: ${workingMins}`);
  console.log(`   - Working hours: ${toHHMMSS(workingMins)}`);
  console.log(
    `   - Late coming: ${toHHMMSS(lateComingMins)} (${lateComingMins} mins)`
  );
  console.log(
    `   - Early departure: ${toHHMMSS(
      earlyDepartureMins
    )} (${earlyDepartureMins} mins)`
  );
  console.log(
    `   - Overtime: ${toHHMMSS(overtimeMins)} (${overtimeMins} mins)`
  );

  let action;
  let status;
  if (dayLogs.length === 0) {
    action = "notPunchedIn";
    status = "notPunchedIn";
  } else {
    action = "punchedIn";
    status = lastOut ? "out" : "in";
  }

  console.log(`🎯 Action and status for employee ${employee.id}:`);
  console.log(`   - Action: ${action}`);
  console.log(`   - Status: ${status}`);

  let attendance = firstIn && lastOut ? "present" : "absent";
  let attendanceContext = firstIn && lastOut ? "Present" : "Absent";

  console.log(
    `🎯 Initial attendance determination for employee ${employee.id}:`
  );
  console.log(`   - Has both firstIn and lastOut: ${!!(firstIn && lastOut)}`);
  console.log(`   - Base attendance: ${attendance}`);
  console.log(`   - Base context: ${attendanceContext}`);

  if (isHoliday) {
    attendance = firstIn && lastOut ? "holidayPresent" : "holiday";
    attendanceContext = firstIn && lastOut ? "Holiday Present" : "Holiday";
    console.log(
      `🎉 Holiday detected - Updated attendance: ${attendance}, context: ${attendanceContext}`
    );
  } else if (isWeekOff) {
    attendance = firstIn && lastOut ? "weekoffPresent" : "weekoff";
    attendanceContext = firstIn && lastOut ? "WeeklyOff Present" : "WeeklyOff";
    console.log(
      `🏖️ Week-off detected - Updated attendance: ${attendance}, context: ${attendanceContext}`
    );
  } else {
    console.log(
      `📅 Regular working day - Keeping attendance: ${attendance}, context: ${attendanceContext}`
    );
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

  console.log(
    `📊 Days calculation for employee ${employee.id}: ${day} (based on attendance: ${attendance})`
  );

  let penaltyAmount = 0;
  if (firstIn && lastOut) {
    const { updatedContext, penalty } = calculateAttendanceDeduction(
      attendanceContext,
      lateComingMins,
      earlyDepartureMins,
      workingMins,
      minWorkingMins,
      policy
    );
    attendanceContext = updatedContext;
    penaltyAmount = penalty;
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
    penaltyAmount,
    tenant: tenantId,
    day,
    uniqueId: `${date}-${employee.id}-${tenantId}`,
  };
}

function calculateAttendanceDeduction(
  baseContext,
  lateMins,
  earlyMins,
  workedMins,
  minWorkedMins,
  policy
) {
  console.log(
    "💸 Calculating deductions for",
    baseContext,
    "with late",
    lateMins,
    "mins"
  );

  let attendanceContext = baseContext;
  let penaltyAmount = 0;
  let appliedRules = [];

  const getFraction = (hours) => {
    if (hours <= 2) return "1/4";
    if (hours <= 4) return "1/2";
    if (hours <= 6) return "3/4";
    return "1";
  };

  const lateHours = lateMins / 60;
  if (lateHours > 0) {
    const type = policy.workingHoursType || "lop";
    const leave = "CL";
    const fraction = getFraction(lateHours);

    if (type === "lop") {
      appliedRules.push(`${fraction}LOP(DueToLate)`);
    } else if (type === "leave") {
      appliedRules.push(`${fraction}${leave}(DueToLate)`);
    } else if (type === "amount") {
      penaltyAmount += 0;
      appliedRules.push(`Penalty₹0(DueToLate)`);
    }
  }

  const earlyHours = earlyMins / 60;
  if (earlyHours > 0 && policy.earlyExitAllowed < earlyHours) {
    const type = policy.earlyLeavingType || "amount";
    const leave = policy.earlyLeavingLeave || "CL";
    const amt = parseFloat(policy.earlyExitPenaltyAmt || 0);
    const fraction = getFraction(earlyHours);

    if (type === "lop") {
      appliedRules.push(`${fraction}LOP(Early)`);
    } else if (type === "leave") {
      appliedRules.push(`${fraction}${leave}(Early)`);
    } else if (type === "amount") {
      penaltyAmount += amt;
      appliedRules.push(`Penalty₹${amt}(Early)`);
    }
  }

  const shortfallHours = Math.max(0, (minWorkedMins - workedMins) / 60);
  if (shortfallHours > 0 && policy.isWorkingHours) {
    const type = policy.workingHoursType || "lop";
    const leave = "CL";
    const fraction = getFraction(shortfallHours);

    if (type === "lop") {
      appliedRules.push(`${fraction}LOP(WH)`);
    } else if (type === "leave") {
      appliedRules.push(`${fraction}${leave}(WH)`);
    } else if (type === "amount") {
      penaltyAmount += 0;
      appliedRules.push(`Penalty₹0(WH)`);
    }
  }

  if (appliedRules.length > 0) {
    const formatted = appliedRules
      .map((rule) => rule.replace("1LOP", "LOP").replace(/\s+/g, ""))
      .join("");
    attendanceContext += formatted;
  }

  return { updatedContext: attendanceContext, penalty: penaltyAmount };
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
