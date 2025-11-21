export default {
  id: "absentCron",
  handler: async (_options, { services, getSchema, database }) => {
    console.log(
      "🚀🔥HeinaJeson Starting automatic 123 attendance processing job..."
    );

    const { ItemsService } = services;
    const schema = await getSchema();
    const startTime = Date.now();

    console.log("🚀 Starting automatic attendance processing job...");

    try {
      const today = new Date();
      // const today = new Date("2025-11-16");
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const date = yesterday.toISOString().split("T")[0];

      console.log(`📅 Processing attendance for ${date}`);

      // Fetch tenant (you had only one hardcoded)
      const tenantService = new ItemsService("tenant", {
        schema,
        knex: database,
        accountability: null,
      });
      const tenants = await tenantService.readByQuery({
        fields: ["tenantId"],
        // filter: {
        //   tenantId: { _eq: "a5ee9889-619f-4b8a-b919-30528a74cf0b" },
        // },
        limit: -1,
      });

      if (!tenants?.length) {
        console.log("No tenants found.");
        return;
      }

      console.log(`🏢 Found ${tenants.length} tenants to process.`);

      // Process tenants sequentially
      for (const tenant of tenants) {
        const tenantId = tenant.tenantId;
        const uniqueId = `${tenantId}-${date}`;

        let cronJobId = null;
        const cronJobService = new ItemsService("cronJobs", {
          schema,
          knex: database,
        });

        try {
          console.log(`🔹 Processing tenant: ${tenantId}`);

          // Check if already processed today
          const existing = await cronJobService.readByQuery({
            filter: { uniqueId: { _eq: uniqueId } },
            limit: 1,
          });

          if (existing?.length > 0) {
            cronJobId = existing[0].id;
            await cronJobService.updateOne(cronJobId, {
              startTime: new Date().toISOString(),
              message: "restarted",
            });
            console.log(`Restarting existing cronJob ID: ${cronJobId}`);
          } else {
            const created = await cronJobService.createOne({
              tenant: tenantId,
              date,
              uniqueId,
              startTime: new Date().toISOString(),
              message: "started",
            });
            cronJobId = created.id;
            console.log(`Created new cronJob ID: ${cronJobId}`);
          }

          // Main processing
          const result = await processTenantMissingAttendance(
            tenantId,
            date,
            services,
            schema,
            database
          );

          // Final success update
          const finalMessage = `Processed: ${result.processed} | Inserted: ${result.inserted} | Updated: ${result.updated}`;

          await cronJobService.updateOne(cronJobId, {
            endTime: new Date().toISOString(),
            message: finalMessage,
          });

          console.log(`Tenant ${tenantId} completed → ${finalMessage}`);
        } catch (tenantError) {
          console.error(`Tenant ${tenantId} FAILED:`, tenantError.message);

          const errorMsg = `Error: ${tenantError.message.substring(0, 200)}`;

          if (cronJobId) {
            try {
              await cronJobService.updateOne(cronJobId, {
                endTime: new Date().toISOString(),
                message: errorMsg,
              });
            } catch {} // ignore if update fails
          } else {
            // Even if create failed, try to log failure
            try {
              await cronJobService.createOne({
                tenant: tenantId,
                date,
                uniqueId,
                startTime: new Date().toISOString(),
                endTime: new Date().toISOString(),
                message: `Failed to start: ${errorMsg}`,
              });
            } catch {}
          }

          console.log(`Continuing with next tenant...`);
        }
      }

      console.log(
        `All tenants processed in ${(Date.now() - startTime) / 1000}s`
      );
    } catch (error) {
      console.error("CRITICAL: Entire job failed:", error);
    }
  },
};

// =============================================
// MAIN TENANT PROCESSOR (unchanged logic, just cleaned)
// =============================================
async function processTenantMissingAttendance(
  tenantId,
  date,
  services,
  schema,
  database
) {
  const { ItemsService } = services;

  const allEmployees = await fetchAllEmployeesForTenant(
    tenantId,
    services,
    schema,
    database
  );
  const employeeIds = allEmployees.map((e) => e.id);

  if (employeeIds.length === 0) {
    console.log(`No employees in tenant ${tenantId}`);
    return { processed: 0, inserted: 0, updated: 0 };
  }

  console.log(`Tenant ${tenantId} → ${employeeIds.length} employees`);

  let totalProcessed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  const batchSize = 100;

  for (let i = 0; i < employeeIds.length; i += batchSize) {
    const batch = employeeIds.slice(i, i + batchSize);
    console.log(
      `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
        employeeIds.length / batchSize
      )}`
    );

    const result = await processAttendanceBatch(
      batch,
      date,
      tenantId,
      services,
      schema,
      database
    );

    totalProcessed += result.processed;
    totalInserted += result.inserted;
    totalUpdated += result.updated;
  }

  return {
    processed: totalProcessed,
    inserted: totalInserted,
    updated: totalUpdated,
  };
}
// ========== BATCH PROCESSING ==========
async function processAttendanceBatch(
  employeeIds,
  date,
  tenantId,
  services,
  schema,
  database
) {
  // Fetch all required data
  const [existingAttendance, personalModules, holidays, shifts, logs] =
    await Promise.all([
      fetchExistingAttendance(
        employeeIds,
        date,
        tenantId,
        services,
        schema,
        database
      ),
      fetchPersonalModules(employeeIds, services, schema, database),
      fetchHolidays(tenantId, services, schema, database),
      fetchShifts(tenantId, services, schema, database),
      fetchLogs(employeeIds, date, tenantId, services, schema, database),
    ]);

  // Create lookup maps
  const holidayMap = createBranchHolidayMap(holidays);
  const shiftMap = createShiftMap(shifts);
  const employeeMap = createEmployeeMap(personalModules);
  const attendanceMap = createAttendanceMap(existingAttendance);
  const logsMap = createLogsMap(logs);
  const dateRange = generateDateRange(date);

  const recordsToInsert = [];
  const recordsToUpdate = [];

  // Process each employee
  for (const employeeId of employeeIds) {
    const employee = employeeMap.get(employeeId);
    if (!employee) continue;

    // Process each date
    for (const date of dateRange) {
      const attendanceKey = `${employeeId}-${date}`;
      const existingAttendance = attendanceMap.get(attendanceKey);
      const employeeLogs = logsMap.get(attendanceKey) || [];

      const result = processEmployeeDate(
        employee,
        date,
        existingAttendance,
        employeeLogs,
        holidayMap,
        shiftMap,
        tenantId
      );

      if (result) {
        if (result.action === "insert") {
          recordsToInsert.push(result.data);
        } else if (result.action === "update") {
          recordsToUpdate.push(result.data);
        }
      }
    }
  }

  // Bulk insert/update
  let insertedCount = 0;
  let updatedCount = 0;

  if (recordsToInsert.length > 0) {
    await bulkInsertAttendance(recordsToInsert, services, schema, database);
    insertedCount = recordsToInsert.length;
  }

  if (recordsToUpdate.length > 0) {
    await bulkUpdateAttendance(recordsToUpdate, services, schema, database);
    updatedCount = recordsToUpdate.length;
  }

  // Insert logs for new records
  const logsToInsert = recordsToInsert.map((record) =>
    createLogEntry(record, tenantId)
  );
  if (logsToInsert.length > 0) {
    await bulkInsertLogs(logsToInsert, services, schema, database);
  }

  return {
    processed: employeeIds.length * dateRange.length,
    inserted: insertedCount,
    updated: updatedCount,
  };
}

// ========== CORE PROCESSING LOGIC WITH DETAILED LOGGING ==========
function processEmployeeDate(
  employee,
  date,
  existingAttendance,
  employeeLogs,
  holidayMap,
  shiftMap,
  tenantId
) {
  const dateObj = new Date(date);
  const isWeekOff = checkWeekOff(employee, dateObj);
  // === BRANCH-WISE HOLIDAY CHECK ===
  let isHoliday = false;
  let holidayEvent = null;

  const employeeBranchId = employee.branchLocation?.id
    ? Number(employee.branchLocation.id)
    : null;

  if (employeeBranchId && holidayMap.has(date)) {
    const holidayData = holidayMap.get(date);
    if (holidayData.branchIds.has(employeeBranchId)) {
      isHoliday = true;
      holidayEvent = holidayData.event;
    }
  }

  if (!employeeBranchId) {
    console.log("   Employee has no branch assigned → No holiday applies");
  }

  console.log("\nDAY TYPE ANALYSIS:");
  console.log(`   Week Off: ${isWeekOff ? "YES" : "NO"}`);
  console.log(`   Holiday: ${isHoliday ? `YES (${holidayEvent})` : "NO"}`);
  if (isHoliday) {
    console.log(`     Holiday Name: ${holidayEvent}`);
    console.log(`     Employee Branch ID: ${employeeBranchId}`);
  }
  const totalWorkingHours = parseFloat(
    employee.config?.attendancePolicies?.TotalWorking_Hours || 9
  );

  // 🎯 START OF EMPLOYEE PROCESSING
  console.log("\n" + "=".repeat(80));
  console.log(
    `👤 PROCESSING EMPLOYEE: ${employee.employeeId} (ID: ${employee.id})`
  );
  console.log(
    `📅 Date: ${date} | Day: ${dateObj.toLocaleDateString("en-US", {
      weekday: "long",
    })}`
  );
  console.log("=".repeat(80));

  // 📊 EMPLOYEE CONFIGURATION
  console.log("\n📋 EMPLOYEE CONFIGURATION:");
  console.log(`   ⏰ Total Working Hours: ${totalWorkingHours} hours`);
  console.log(`   🏖️ Is Week Off: ${isWeekOff ? "✅ YES" : "❌ NO"}`);
  console.log(`   🎉 Is Holiday: ${isHoliday ? "✅ YES" : "❌ NO"}`);

  // 🆕 PRIORITY-BASED LOG SELECTION
  // Sort logs by date_created (latest first) and requestedDay priority
  const sortedLogs = [...employeeLogs].sort((a, b) => {
    const timeA = new Date(a.date_created || 0).getTime();
    const timeB = new Date(b.date_created || 0).getTime();

    // Sort by timestamp descending (latest first)
    if (timeB !== timeA) return timeB - timeA;

    // If same time, prioritize fullDay over halfDay
    if (a.requestedDay === "fullDay" && b.requestedDay === "halfDay") return -1;
    if (a.requestedDay === "halfDay" && b.requestedDay === "fullDay") return 1;

    return 0;
  });

  console.log("\n📋 ALL APPROVED LOGS (sorted by latest first):");
  if (sortedLogs.length === 0) {
    console.log("   ❌ No approved logs found");
  } else {
    sortedLogs.forEach((log, idx) => {
      console.log(
        `   ${idx + 1}. ${log.attendance_status} (${
          log.requestedDay
        }) - Created: ${log.date_created || "N/A"}`
      );
    });
  }

  // Extract latest of each type
  const paidLeaveLog = sortedLogs.find(
    (log) => log.attendance_status === "paidLeaveApproved"
  );
  const unpaidLeaveLog = sortedLogs.find(
    (log) => log.attendance_status === "unPaidLeaveApproved"
  );
  const wfhLog = sortedLogs.filter(
    (log) => log.attendance_status === "workFromHomeApproved"
  );
  const odLog = sortedLogs.filter(
    (log) => log.attendance_status === "onDutyApproved"
  );

  // 🆕 DETERMINE PRIMARY REQUEST (Latest overall)
  const primaryRequest = sortedLogs[0]; // Latest approved request

  if (primaryRequest) {
    console.log("\n🎯 PRIMARY REQUEST (Latest Approval):");
    console.log(`   📌 Type: ${primaryRequest.attendance_status}`);
    console.log(`   📅 Requested: ${primaryRequest.requestedDay}`);
    console.log(`   🕐 Approved At: ${primaryRequest.date_created || "N/A"}`);
    if (primaryRequest.leaveType) {
      console.log(`   💼 Leave Type: ${primaryRequest.leaveType}`);
    }
  }

  // 📝 EXISTING ATTENDANCE DATA
  console.log("\n📊 EXISTING ATTENDANCE RECORD:");
  if (existingAttendance) {
    console.log(`   ✅ Record Exists (ID: ${existingAttendance.id})`);
    console.log(`   🕐 In Time: ${existingAttendance.inTime || "N/A"}`);
    console.log(`   🕐 Out Time: ${existingAttendance.outTime || "N/A"}`);
    console.log(`   📌 Status: ${existingAttendance.attendance}`);
    console.log(`   📝 Context: ${existingAttendance.attendanceContext}`);

    const hasInOut =
      existingAttendance.inTime &&
      existingAttendance.outTime &&
      existingAttendance.inTime !== "00:00:00" &&
      existingAttendance.outTime !== "00:00:00";

    if (hasInOut) {
      const workedHours = calculateWorkedHours(
        existingAttendance.inTime,
        existingAttendance.outTime
      );
      console.log(`   ⏱️ Worked Hours: ${workedHours.toFixed(2)} hours`);
      console.log(
        `   📊 Work Status: ${
          workedHours >= totalWorkingHours ? "✅ Full Day" : "⚠️ Partial Day"
        }`
      );
    } else {
      console.log(`   ⚠️ No Valid Punch Times (00:00:00)`);
    }
  } else {
    console.log(`   ❌ No Existing Record`);
  }

  // 📋 APPROVED LEAVE LOGS SUMMARY
  console.log("\n📋 APPROVED LEAVE LOGS SUMMARY:");
  console.log(
    `   💼 Paid Leave: ${
      paidLeaveLog
        ? `✅ ${paidLeaveLog.requestedDay} (${paidLeaveLog.leaveType})`
        : "❌ None"
    }`
  );
  console.log(
    `   💸 Unpaid Leave: ${
      unpaidLeaveLog ? `✅ ${unpaidLeaveLog.requestedDay}` : "❌ None"
    }`
  );
  console.log(
    `   🏠 Work From Home: ${
      wfhLog.length > 0
        ? `✅ ${wfhLog[0].requestedDay} (${wfhLog.length} logs)`
        : "❌ None"
    }`
  );
  console.log(
    `   🚗 On Duty: ${
      odLog.length > 0
        ? `✅ ${odLog[0].requestedDay} (${odLog.length} logs)`
        : "❌ None"
    }`
  );

  // ========== CASE 1: No attendance, no logs ==========
  if (
    !existingAttendance &&
    !paidLeaveLog &&
    !unpaidLeaveLog &&
    wfhLog.length === 0 &&
    odLog.length === 0
  ) {
    console.log("\n🔍 CASE 1: No attendance, no logs");
    console.log("   ➡️ ACTION: INSERT base record (absent/weekoff/holiday)");
    const record = createBaseAttendanceRecord(
      employee.id,
      date,
      isWeekOff,
      isHoliday,
      shiftMap,
      tenantId
    );
    console.log(`   📝 Status: ${record.attendance}`);
    console.log(`   📌 Context: ${record.attendanceContext}`);
    console.log(`   📊 Day Value: ${record.day}`);
    return {
      action: "insert",
      data: record,
    };
  }

  // ========== CASE 2: Attendance exists with inTime/outTime = 00:00:00 ==========
  if (existingAttendance) {
    const hasInOut =
      existingAttendance.inTime &&
      existingAttendance.outTime &&
      existingAttendance.inTime !== "00:00:00" &&
      existingAttendance.outTime !== "00:00:00";

    if (!hasInOut) {
      console.log("\n🔍 CASE 2: Existing record with no punch (00:00:00)");

      // 🆕 Collect all full-day requests
      const fullDayRequests = sortedLogs.filter(
        (log) => log.requestedDay === "fullDay"
      );

      if (fullDayRequests.length > 0) {
        const primary = fullDayRequests[0]; // Latest one

        console.log(
          `\n🔍 CASE 2.X: Full day request (${primary.attendance_status})`
        );
        console.log(`   🕐 Latest Approval: ${primary.date_created || "N/A"}`);

        if (fullDayRequests.length > 1) {
          console.log(
            `   ⚠️ Multiple full-day requests found (${fullDayRequests.length})`
          );
          console.log(`   ✅ Using latest: ${primary.attendance_status}`);
          fullDayRequests.forEach((req, idx) => {
            console.log(
              `      ${idx + 1}. ${req.attendance_status} - ${
                req.date_created || "N/A"
              }`
            );
          });
        }

        let record;

        switch (primary.attendance_status) {
          case "paidLeaveApproved":
            console.log(`   💼 Leave Type: ${primary.leaveType}`);
            console.log("   📝 ACTION: UPDATE to full day paid leave");
            record = createFullDayPaidLeave(
              employee.id,
              date,
              primary.leaveType,
              tenantId
            );
            break;

          case "unPaidLeaveApproved":
            console.log("   📝 ACTION: UPDATE to full day unpaid leave");
            record = createFullDayUnpaidLeave(employee.id, date, tenantId);
            break;

          case "workFromHomeApproved":
            const wfhTimes = extractWFHODTimes(
              sortedLogs.filter(
                (l) => l.attendance_status === "workFromHomeApproved"
              )
            );
            console.log(
              `   🕐 WFH Times: ${wfhTimes.inTime} - ${wfhTimes.outTime}`
            );
            console.log("   📝 ACTION: UPDATE to work from home");
            record = createWorkFromHome(
              employee.id,
              date,
              wfhTimes.inTime,
              wfhTimes.outTime,
              tenantId
            );
            break;

          case "onDutyApproved":
            const odTimes = extractWFHODTimes(
              sortedLogs.filter((l) => l.attendance_status === "onDutyApproved")
            );
            console.log(
              `   🕐 OD Times: ${odTimes.inTime} - ${odTimes.outTime}`
            );
            console.log("   📝 ACTION: UPDATE to on duty");
            record = createOnDuty(
              employee.id,
              date,
              odTimes.inTime,
              odTimes.outTime,
              tenantId
            );
            break;
        }

        if (record) {
          console.log(`   📊 Day Value: ${record.day}`);
          return {
            action: "update",
            data: {
              id: existingAttendance.id,
              ...record,
            },
          };
        }
      }

      // 🆕 Handle multiple half-day requests
      const halfDayRequests = sortedLogs.filter(
        (log) => log.requestedDay === "halfDay"
      );

      if (halfDayRequests.length >= 2) {
        // Check if we have both paid and unpaid
        const hasPaidHalf = halfDayRequests.some(
          (r) => r.attendance_status === "paidLeaveApproved"
        );
        const hasUnpaidHalf = halfDayRequests.some(
          (r) => r.attendance_status === "unPaidLeaveApproved"
        );

        if (hasPaidHalf && hasUnpaidHalf) {
          console.log("\n🔍 CASE 2.5: Both half-day paid & unpaid leaves");

          const paidLog = halfDayRequests.find(
            (r) => r.attendance_status === "paidLeaveApproved"
          );
          const unpaidLog = halfDayRequests.find(
            (r) => r.attendance_status === "unPaidLeaveApproved"
          );

          console.log(
            `   📅 Paid Leave Created: ${paidLog.date_created || "N/A"}`
          );
          console.log(
            `   📅 Unpaid Leave Created: ${unpaidLog.date_created || "N/A"}`
          );
          console.log(`   💼 Leave Type: ${paidLog.leaveType}`);
          console.log("   📝 ACTION: UPDATE to combined half leaves");

          const record = createHalfDayPaidAndUnpaidLeave(
            employee.id,
            date,
            paidLog.leaveType,
            tenantId
          );
          console.log(`   📌 Context: ${record.attendanceContext}`);
          console.log(`   📊 Day Value: ${record.day}`);
          return {
            action: "update",
            data: {
              id: existingAttendance.id,
              ...record,
            },
          };
        }
      }

      // Single half-day request
      if (halfDayRequests.length === 1) {
        const primary = halfDayRequests[0];

        console.log(
          `\n🔍 CASE 2.Y: Single half-day request (${primary.attendance_status})`
        );

        let record;

        if (primary.attendance_status === "paidLeaveApproved") {
          console.log(`   💼 Leave Type: ${primary.leaveType}`);
          console.log(
            "   📝 ACTION: UPDATE to half paid leave + half absent/holiday/weekoff"
          );
          record = createHalfDayPaidLeaveWithAbsent(
            employee.id,
            date,
            isWeekOff,
            isHoliday,
            primary.leaveType,
            tenantId
          );
        } else if (primary.attendance_status === "unPaidLeaveApproved") {
          console.log(
            "   📝 ACTION: UPDATE to half unpaid leave + half absent/holiday/weekoff"
          );
          record = createHalfDayUnpaidLeaveWithAbsent(
            employee.id,
            date,
            isWeekOff,
            isHoliday,
            tenantId
          );
        }

        if (record) {
          console.log(`   📌 Context: ${record.attendanceContext}`);
          console.log(`   📊 Day Value: ${record.day}`);
          return {
            action: "update",
            data: {
              id: existingAttendance.id,
              ...record,
            },
          };
        }
      }
    }

    // ========== CASES WITH ACTUAL PUNCH RECORDS (hasInOut = true) ==========
    if (hasInOut) {
      const workedHours = calculateWorkedHours(
        existingAttendance.inTime,
        existingAttendance.outTime
      );

      console.log(`\n⏱️ WORKED HOURS ANALYSIS:`);
      console.log(`   📊 Worked: ${workedHours.toFixed(2)} hours`);
      console.log(`   🎯 Required: ${totalWorkingHours} hours`);
      console.log(
        `   📈 Status: ${
          workedHours >= totalWorkingHours ? "✅ Complete" : "⚠️ Incomplete"
        }`
      );

      // CASE 4: Worked >= total working hours, no leave - skip
      if (
        workedHours >= totalWorkingHours &&
        !paidLeaveLog &&
        !unpaidLeaveLog &&
        wfhLog.length === 0 &&
        odLog.length === 0
      ) {
        console.log("\n🔍 CASE 4: Full day worked, no leave");
        console.log("   ➡️ ACTION: SKIP (no update needed)");
        return null;
      }

      // CASE 3: Worked < total working hours, no leave logs
      if (
        workedHours < totalWorkingHours &&
        !paidLeaveLog &&
        !unpaidLeaveLog &&
        wfhLog.length === 0 &&
        odLog.length === 0
      ) {
        console.log("\n🔍 CASE 3: Partial day worked, no leave");
        console.log("   ➡️ ACTION: UPDATE to half day present");
        const record = createHalfDayPresentRecord(
          employee.id,
          date,
          isWeekOff,
          isHoliday,
          tenantId
        );
        console.log(`   📝 Status: ${record.attendance}`);
        console.log(`   📌 Context: ${record.attendanceContext}`);
        console.log(`   📊 Day Value: ${record.day}`);
        return {
          action: "update",
          data: {
            id: existingAttendance.id,
            ...record,
          },
        };
      }

      // CASE 5: Worked < total working hours + leave combinations
      if (workedHours < totalWorkingHours) {
        // 🆕 CASE 5.5: Both half-day paid AND unpaid leave (overrides work)
        if (
          paidLeaveLog?.requestedDay === "halfDay" &&
          unpaidLeaveLog?.requestedDay === "halfDay"
        ) {
          console.log(
            "\n🔍 CASE 5.5: Worked + Both half-day paid & unpaid leaves"
          );
          console.log(
            `   ⏱️ Worked: ${workedHours.toFixed(2)} hours (IGNORED)`
          );
          console.log(`   💼 Paid Leave: ${paidLeaveLog.leaveType}`);
          console.log("   💸 Unpaid Leave: Yes");
          console.log("   📝 ACTION: UPDATE to both leaves (override work)");
          const record = createHalfDayPaidAndUnpaidLeave(
            employee.id,
            date,
            paidLeaveLog.leaveType,
            tenantId
          );
          console.log(`   📌 Context: ${record.attendanceContext}`);
          console.log(`   📊 Day Value: ${record.day}`);
          return {
            action: "update",
            data: {
              id: existingAttendance.id,
              ...record,
            },
          };
        }

        // CASE 5: Worked < total hours + half-day paid leave only
        if (paidLeaveLog?.requestedDay === "halfDay") {
          console.log("\n🔍 CASE 5: Partial day worked + half day paid leave");
          console.log(`   💼 Leave Type: ${paidLeaveLog.leaveType}`);
          console.log(
            "   ➡️ ACTION: UPDATE to half day present + half day paid leave"
          );
          const record = createHalfDayPresentWithPaidLeave(
            employee.id,
            date,
            isWeekOff,
            isHoliday,
            paidLeaveLog.leaveType,
            tenantId
          );
          console.log(`   📊 Day Value: ${record.day}`);
          return {
            action: "update",
            data: {
              id: existingAttendance.id,
              ...record,
            },
          };
        }

        // CASE 5: Worked < total hours + half-day unpaid leave only
        if (unpaidLeaveLog?.requestedDay === "halfDay") {
          console.log(
            "\n🔍 CASE 5: Partial day worked + half day unpaid leave"
          );
          console.log(
            "   ➡️ ACTION: UPDATE to half day present + half day unpaid leave"
          );
          const record = createHalfDayPresentWithUnpaidLeave(
            employee.id,
            date,
            isWeekOff,
            isHoliday,
            tenantId
          );
          console.log(`   📊 Day Value: ${record.day}`);
          return {
            action: "update",
            data: {
              id: existingAttendance.id,
              ...record,
            },
          };
        }
      }

      // CASE 6: Worked < total working hours + full-day leave (override to full leave)
      if (workedHours < totalWorkingHours) {
        console.log(
          "\n🔍 CASE 6: Partial day worked + full day leave (override to full leave)"
        );

        // Check for full-day requests with priority
        const fullDayRequests = sortedLogs.filter(
          (log) => log.requestedDay === "fullDay"
        );

        if (fullDayRequests.length > 0) {
          const primary = fullDayRequests[0]; // Latest one

          if (fullDayRequests.length > 1) {
            console.log(
              `   ⚠️ Multiple full-day requests found (${fullDayRequests.length})`
            );
            console.log(`   ✅ Using latest: ${primary.attendance_status}`);
          }

          let record;

          switch (primary.attendance_status) {
            case "paidLeaveApproved":
              console.log(`   💼 Leave Type: ${primary.leaveType}`);
              console.log("   ➡️ ACTION: UPDATE to full day paid leave");
              record = createFullDayPaidLeave(
                employee.id,
                date,
                primary.leaveType,
                tenantId
              );
              break;

            case "unPaidLeaveApproved":
              console.log("   ➡️ ACTION: UPDATE to full day unpaid leave");
              record = createFullDayUnpaidLeave(employee.id, date, tenantId);
              break;

            case "workFromHomeApproved":
              const wfhTimes = extractWFHODTimes(wfhLog);
              console.log(
                `   🕐 WFH Times: ${wfhTimes.inTime} - ${wfhTimes.outTime}`
              );
              console.log("   ➡️ ACTION: UPDATE to work from home");
              record = createWorkFromHome(
                employee.id,
                date,
                wfhTimes.inTime,
                wfhTimes.outTime,
                tenantId
              );
              break;

            case "onDutyApproved":
              const odTimes = extractWFHODTimes(odLog);
              console.log(
                `   🕐 OD Times: ${odTimes.inTime} - ${odTimes.outTime}`
              );
              console.log("   ➡️ ACTION: UPDATE to on duty");
              record = createOnDuty(
                employee.id,
                date,
                odTimes.inTime,
                odTimes.outTime,
                tenantId
              );
              break;
          }

          if (record) {
            console.log(`   📊 Day Value: ${record.day}`);
            return {
              action: "update",
              data: {
                id: existingAttendance.id,
                ...record,
              },
            };
          }
        }
      }
    }
  }

  // ========== CASE 7: No attendance but leave logs exist ==========
  if (!existingAttendance) {
    console.log("\n🔍 CASE 7: No attendance + leave logs");

    // Check for full-day requests first
    const fullDayRequests = sortedLogs.filter(
      (log) => log.requestedDay === "fullDay"
    );

    if (fullDayRequests.length > 0) {
      const primary = fullDayRequests[0]; // Latest one

      console.log(
        `\n🔍 CASE 7.X: Full day request (${primary.attendance_status})`
      );
      console.log(`   🕐 Latest Approval: ${primary.date_created || "N/A"}`);

      if (fullDayRequests.length > 1) {
        console.log(
          `   ⚠️ Multiple full-day requests found (${fullDayRequests.length})`
        );
        console.log(`   ✅ Using latest: ${primary.attendance_status}`);
      }

      let record;

      switch (primary.attendance_status) {
        case "paidLeaveApproved":
          console.log(`   💼 Leave Type: ${primary.leaveType}`);
          console.log("   📝 ACTION: INSERT full day paid leave");
          record = createFullDayPaidLeave(
            employee.id,
            date,
            primary.leaveType,
            tenantId
          );
          break;

        case "unPaidLeaveApproved":
          console.log("   📝 ACTION: INSERT full day unpaid leave");
          record = createFullDayUnpaidLeave(employee.id, date, tenantId);
          break;

        case "workFromHomeApproved":
          const wfhTimes = extractWFHODTimes(
            sortedLogs.filter(
              (l) => l.attendance_status === "workFromHomeApproved"
            )
          );
          console.log(
            `   🕐 WFH Times: ${wfhTimes.inTime} - ${wfhTimes.outTime}`
          );
          console.log("   📝 ACTION: INSERT work from home");
          record = createWorkFromHome(
            employee.id,
            date,
            wfhTimes.inTime,
            wfhTimes.outTime,
            tenantId
          );
          break;

        case "onDutyApproved":
          const odTimes = extractWFHODTimes(
            sortedLogs.filter((l) => l.attendance_status === "onDutyApproved")
          );
          console.log(`   🕐 OD Times: ${odTimes.inTime} - ${odTimes.outTime}`);
          console.log("   📝 ACTION: INSERT on duty");
          record = createOnDuty(
            employee.id,
            date,
            odTimes.inTime,
            odTimes.outTime,
            tenantId
          );
          break;
      }

      if (record) {
        console.log(`   📊 Day Value: ${record.day}`);
        return {
          action: "insert",
          data: record,
        };
      }
    }

    // Handle half-day requests
    const halfDayRequests = sortedLogs.filter(
      (log) => log.requestedDay === "halfDay"
    );

    // 🆕 CASE 7.5: Both half-day paid and unpaid leave
    if (halfDayRequests.length >= 2) {
      const hasPaidHalf = halfDayRequests.some(
        (r) => r.attendance_status === "paidLeaveApproved"
      );
      const hasUnpaidHalf = halfDayRequests.some(
        (r) => r.attendance_status === "unPaidLeaveApproved"
      );

      if (hasPaidHalf && hasUnpaidHalf) {
        console.log(
          "\n🔍 CASE 7.5: No attendance + Half day paid + Half day unpaid"
        );

        const paidLog = halfDayRequests.find(
          (r) => r.attendance_status === "paidLeaveApproved"
        );

        console.log(`   💼 Paid Leave Type: ${paidLog.leaveType}`);
        console.log("   💸 Unpaid Leave: Yes");
        console.log("   📝 ACTION: INSERT combined leave status");
        const record = createHalfDayPaidAndUnpaidLeave(
          employee.id,
          date,
          paidLog.leaveType,
          tenantId
        );
        console.log(`   📌 Context: ${record.attendanceContext}`);
        console.log(`   📊 Day Value: ${record.day}`);
        return {
          action: "insert",
          data: record,
        };
      }
    }

    // Single half-day request
    if (halfDayRequests.length === 1) {
      const primary = halfDayRequests[0];

      console.log(
        `\n🔍 CASE 7.Y: Single half-day request (${primary.attendance_status})`
      );

      let record;

      if (primary.attendance_status === "paidLeaveApproved") {
        console.log(`   💼 Leave Type: ${primary.leaveType}`);
        console.log(
          "   📝 ACTION: INSERT half day paid leave + half absent/weekoff/holiday"
        );
        record = createHalfDayPaidLeaveWithAbsent(
          employee.id,
          date,
          isWeekOff,
          isHoliday,
          primary.leaveType,
          tenantId
        );
      } else if (primary.attendance_status === "unPaidLeaveApproved") {
        console.log(
          "   📝 ACTION: INSERT half day unpaid leave + half absent/weekoff/holiday"
        );
        record = createHalfDayUnpaidLeaveWithAbsent(
          employee.id,
          date,
          isWeekOff,
          isHoliday,
          tenantId
        );
      }

      if (record) {
        console.log(`   📌 Context: ${record.attendanceContext}`);
        console.log(`   📊 Day Value: ${record.day}`);
        return {
          action: "insert",
          data: record,
        };
      }
    }
  }

  console.log("\n⚠️ NO MATCHING CASE - No action taken");
  return null;
}

// ========== ATTENDANCE RECORD CREATORS ==========

// Case 1: Base records (absent/holiday/weekoff)
function createBaseAttendanceRecord(
  employeeId,
  date,
  isWeekOff,
  isHoliday,
  shiftMap,
  tenantId
) {
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
    employeeId,
    date,
    outTime: "00:00:00",
    inTime: "00:00:00",
    attendance,
    day: "0.0",
    attendanceContext,
    mode: "cronJob",
    leaveType: "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
    tenant: tenantId,
  };
}

// Case 3: Half-day present (no leave)
function createHalfDayPresentRecord(
  employeeId,
  date,
  isWeekOff,
  isHoliday,
  tenantId
) {
  let attendance, attendanceContext;

  if (isHoliday) {
    attendance = "holidayPresent";
    attendanceContext = "1/2Holiday Present 1/2Holiday";
  } else if (isWeekOff) {
    attendance = "weekoffPresent";
    attendanceContext = "1/2WeeklyOff Present 1/2WeekOff";
  } else {
    attendance = "present";
    attendanceContext = "1/2Present 1/2Absent";
  }

  return {
    date,
    attendance,
    day: "0.5",
    attendanceContext,
    employeeId,
    mode: "cronJob",
    leaveType: "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
  };
}

// Case 5: Half-day present + half-day paid leave
function createHalfDayPresentWithPaidLeave(
  employeeId,
  date,
  isWeekOff,
  isHoliday,
  leaveType,
  tenantId
) {
  let attendance, attendanceContext;

  if (isHoliday) {
    attendance = "holidayPresent";
    attendanceContext = "1/2HolidayPresent 1/2On Leave";
  } else if (isWeekOff) {
    attendance = "weekoffPresent";
    attendanceContext = "1/2WeeklyOff Present 1/2On Leave";
  } else {
    attendance = "present";
    attendanceContext = "1/2Present 1/2On Leave";
  }

  return {
    date,
    attendance,
    day: "1.0",
    attendanceContext,
    employeeId,
    mode: "cronJob",
    leaveType: leaveType || "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
  };
}

// Case 5: Half-day present + half-day unpaid leave
function createHalfDayPresentWithUnpaidLeave(
  employeeId,
  date,
  isWeekOff,
  isHoliday,
  tenantId
) {
  let attendance, attendanceContext;

  if (isHoliday) {
    attendance = "holidayPresent";
    attendanceContext = "1/2HolidayPresent 1/2UnPaidLeave";
  } else if (isWeekOff) {
    attendance = "weekoffPresent";
    attendanceContext = "1/2WeeklyOff Present 1/2UnPaidLeave";
  } else {
    attendance = "present";
    attendanceContext = "1/2Present 1/2UnPaidLeave";
  }

  return {
    date,
    attendance,
    day: "0.5",
    attendanceContext,
    employeeId,
    mode: "cronJob",
    leaveType: "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
  };
}

// Case 2.5 & 5.5 & 7.5: Half-day paid leave + half-day unpaid leave
function createHalfDayPaidAndUnpaidLeave(
  employeeId,
  date,
  leaveType,
  tenantId
) {
  return {
    date,
    attendance: "paidLeave",
    day: "0.5",
    attendanceContext: "1/2On Leave 1/2UnPaidLeave",
    employeeId,
    mode: "cronJob",
    leaveType: leaveType || "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
  };
}

// Case 6: Full-day paid leave
function createFullDayPaidLeave(employeeId, date, leaveType, tenantId) {
  return {
    date,
    attendance: "paidLeave",
    day: "1.0",
    attendanceContext: "On Leave",
    employeeId,
    mode: "cronJob",
    leaveType: leaveType || "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
  };
}

// Case 6: Full-day unpaid leave
function createFullDayUnpaidLeave(employeeId, date, tenantId) {
  return {
    date,
    attendance: "unPaidLeave",
    day: "0.0",
    attendanceContext: "UnPaidLeave",
    employeeId,
    mode: "cronJob",
    leaveType: "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
  };
}

// Case 6: Work from home
function createWorkFromHome(employeeId, date, inTime, outTime, tenantId) {
  return {
    inTime,
    outTime,
    date,
    attendance: "workFromHome",
    day: "1.0",
    attendanceContext: "Work From Home",
    employeeId,
    mode: "cronJob",
    leaveType: "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
  };
}

// Case 6: On duty
function createOnDuty(employeeId, date, inTime, outTime, tenantId) {
  return {
    inTime,
    outTime,
    date,
    attendance: "onDuty",
    day: "1.0",
    attendanceContext: "On OD",
    employeeId,
    mode: "cronJob",
    leaveType: "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
  };
}

// Case 7: Half-day paid leave + half absent/holiday/weekoff
function createHalfDayPaidLeaveWithAbsent(
  employeeId,
  date,
  isWeekOff,
  isHoliday,
  leaveType,
  tenantId
) {
  let attendanceContext;

  if (isHoliday) {
    attendanceContext = "1/2On Leave 1/2Holiday";
  } else if (isWeekOff) {
    attendanceContext = "1/2On Leave 1/2WeeklyOff";
  } else {
    attendanceContext = "1/2On Leave 1/2Absent";
  }

  return {
    date,
    attendance: "paidLeave",
    day: "0.5",
    attendanceContext,
    employeeId,
    mode: "cronJob",
    leaveType: leaveType || "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
    tenant: tenantId,
  };
}

// Case 7: Half-day unpaid leave + half absent/holiday/weekoff
function createHalfDayUnpaidLeaveWithAbsent(
  employeeId,
  date,
  isWeekOff,
  isHoliday,
  tenantId
) {
  let attendanceContext;

  if (isHoliday) {
    attendanceContext = "1/2UnPaidLeave 1/2Holiday";
  } else if (isWeekOff) {
    attendanceContext = "1/2UnPaidLeave 1/2WeeklyOff";
  } else {
    attendanceContext = "1/2UnPaidLeave 1/2Absent";
  }

  return {
    date,
    attendance: "unPaidLeave",
    day: "0.0",
    attendanceContext,
    employeeId,
    mode: "cronJob",
    leaveType: "none",
    uniqueId: `${date}-${employeeId}-${tenantId}`,
    tenant: tenantId,
  };
}

// ========== HELPER FUNCTIONS ==========

function checkWeekOff(employee, dateObj) {
  const weekdayBoolMap = [
    "isSunday",
    "isMonday",
    "isTuesday",
    "isWednesday",
    "isThursday",
    "isFriday",
    "isSaturday",
  ];
  const dayBoolKey = weekdayBoolMap[dateObj.getDay()];
  return employee.attendanceSettings?.[dayBoolKey] === true;
}

function calculateWorkedHours(inTime, outTime) {
  const toMinutes = (time) => {
    if (!time || time === "00:00:00") return 0;
    const [h, m, s = 0] = time.split(":").map(Number);
    return h * 60 + m + s / 60;
  };

  let startMins = toMinutes(inTime);
  let endMins = toMinutes(outTime);
  if (endMins <= startMins) endMins += 24 * 60;

  return (endMins - startMins) / 60;
}

function extractWFHODTimes(logs) {
  const times = logs
    .map((log) => log.timeStamp)
    .filter(Boolean)
    .sort();
  return {
    inTime: times[0] || "09:00:00",
    outTime: times[times.length - 1] || "18:00:00",
  };
}

function createLogEntry(attendanceRecord, tenantId) {
  return {
    tenant: tenantId,
    timeStamp: null,
    date: attendanceRecord.date,
    date_created: new Date().toISOString(),
    requestedDay: "fullDay",
    attendance_status: attendanceRecord.attendance,
    mode: "cronJob",
    leaveType: attendanceRecord.leaveType,
    ValidLogs: "authorized",
    employeeId: attendanceRecord.employeeId,
  };
}

// ========== DATA FETCHING ==========

async function fetchAllEmployeesForTenant(
  tenantId,
  services,
  schema,
  database
) {
  const personalModuleService = new services.ItemsService("personalModule", {
    schema,
    knex: database,
    accountability: null,
  });
  return await personalModuleService.readByQuery({
    filter: { assignedUser: { tenant: { tenantId: { _eq: tenantId } } } },
    fields: ["id", "employeeId"],
    limit: -1,
  });
}

async function fetchExistingAttendance(
  employeeIds,
  date,
  tenantId,
  services,
  schema,
  database
) {
  const attendanceService = new services.ItemsService("attendance", {
    schema,
    knex: database,
    accountability: null,
  });
  return await attendanceService.readByQuery({
    filter: {
      _and: [
        { employeeId: { _in: employeeIds } },
        { date: { _eq: date } },
        { tenant: { _eq: tenantId } },
      ],
    },
    fields: [
      "id",
      "employeeId",
      "date",
      "inTime",
      "outTime",
      "attendance",
      "attendanceContext",
    ],
    limit: -1,
  });
}

async function fetchPersonalModules(employeeIds, services, schema, database) {
  const personalModuleService = new services.ItemsService("personalModule", {
    schema,
    knex: database,
    accountability: null,
  });
  return await personalModuleService.readByQuery({
    filter: { id: { _in: employeeIds } },
    fields: [
      "employeeId",
      "id",
      "config.id",
      "config.attendancePolicies.id",
      "config.attendancePolicies.TotalWorking_Hours",
      "attendanceSettings.id",
      "attendanceSettings.isMonday",
      "attendanceSettings.isTuesday",
      "attendanceSettings.isWednesday",
      "attendanceSettings.isThursday",
      "attendanceSettings.isFriday",
      "attendanceSettings.isSaturday",
      "attendanceSettings.isSunday",
      "branchLocation.id",
    ],
    limit: -1,
  });
}

async function fetchHolidays(tenantId, services, schema, database) {
  const holidayService = new services.ItemsService("holiday", {
    schema,
    knex: database,
    accountability: null,
  });
  return await holidayService.readByQuery({
    filter: { tenant: { tenantId: { _eq: tenantId } } },
    fields: ["date", "event", "AssignHolidays"],
    limit: -1,
  });
}

async function fetchShifts(tenantId, services, schema, database) {
  const shiftService = new services.ItemsService("shifts", {
    schema,
    knex: database,
    accountability: null,
  });
  return await shiftService.readByQuery({
    filter: { tenant: { tenantId: { _eq: tenantId } } },
    fields: ["id", "entryTime", "exitTime", "shift"],
    limit: -1,
  });
}

async function fetchLogs(
  employeeIds,
  date,
  tenantId,
  services,
  schema,
  database
) {
  const logsService = new services.ItemsService("logs", {
    schema,
    knex: database,
    accountability: null,
  });
  return await logsService.readByQuery({
    filter: {
      _and: [
        { employeeId: { _in: employeeIds } },
        { date: { _eq: date } },
        { tenant: { _eq: tenantId } },
        {
          attendance_status: {
            _in: [
              "paidLeaveApproved",
              "unPaidLeaveApproved",
              "workFromHomeApproved",
              "onDutyApproved",
            ],
          },
        },
      ],
    },
    fields: [
      "id",
      "employeeId",
      "date",
      "attendance_status",
      "requestedDay",
      "leaveType",
      "timeStamp",
      "date_created",
    ],
    limit: -1,
    sort: ["date_created"],
  });
}

// ========== MAP CREATORS ==========

function createBranchHolidayMap(holidays) {
  const map = new Map();

  holidays.forEach((holiday) => {
    const branchIds = holiday.AssignHolidays || [];
    if (branchIds.length === 0) return;

    map.set(holiday.date, {
      event: holiday.event || "Holiday",
      branchIds: new Set(branchIds.map((id) => Number(id))),
    });
  });

  console.log(`Branch-wise holiday map created: ${map.size} dates`);
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

function createAttendanceMap(attendance) {
  const map = new Map();
  attendance.forEach((record) => {
    const key = `${record.employeeId}-${record.date}`;
    map.set(key, record);
  });
  return map;
}

function createLogsMap(logs) {
  const map = new Map();
  logs.forEach((log) => {
    const key = `${log.employeeId}-${log.date}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(log);
  });
  return map;
}

function generateDateRange(date) {
  return [date];
}

// ========== BULK OPERATIONS ==========

async function bulkInsertAttendance(records, services, schema, database) {
  const service = new services.ItemsService("attendance", {
    schema,
    knex: database,
    accountability: null,
  });
  for (let i = 0; i < records.length; i += 100) {
    await service.createMany(records.slice(i, i + 100));
  }
}

async function bulkUpdateAttendance(records, services, schema, database) {
  const attendanceService = new services.ItemsService("attendance", {
    schema,
    knex: database,
    accountability: null,
  });
  for (const record of records) {
    const { id, ...updateData } = record;
    await attendanceService.updateOne(id, updateData);
  }
  console.log(`🔄 Updated ${records.length} attendance records.`);
}

async function bulkInsertLogs(records, services, schema, database) {
  const logsService = new services.ItemsService("logs", {
    schema,
    knex: database,
    accountability: null,
  });
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await logsService.createMany(batch);
  }
  console.log(`📝 Inserted ${records.length} log records.`);
}
