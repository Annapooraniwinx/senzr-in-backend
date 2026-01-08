module.exports = function registerEndpoint(router, { services }) {
  const { ItemsService } = services;

  const ALL_TYPES = {
    present: 0,
    absent: 0,
    weekOff: 0,
    holiday: 0,
    workFromHome: 0,
    onDuty: 0,
    holidayPresent: 0,
    weekoffPresent: 0,

    halfDay: 0,
    paidLeave: 0,
    unpaidLeave: 0,

    earlyLeavingCount: 0,
    earlyLeavingAllowed: 0,
    earlyLeaving: 0,
    earlyLeavingData: {},
    totalEarlyDuration: "00:00:00",
    deductedEarlyDuration: "00:00:00",
    lateEntryCount: 0,
    lateComingAllowed: 0,
    lateComing: 0,
    lateData: {},
    totalLateDuration: "00:00:00",
    deductedLateDuration: "00:00:00",

    workingHoursCount: 0,
    workingHoursAllowed: 0,
    workingHours: 0,
    workingHoursData: {},

    workingDayOT: 0,
    workingDayOTHours: "00:00:00",
    weekOffOT: 0,
    weekOffOTHours: "00:00:00",
    holidayOT: 0,
    holidayOTHours: "00:00:00",
    workFromHomeOT: 0,
    workFromHomeOTHours: "00:00:00",

    totalPayableDays: 0,
  };

  router.get("/verification", async (req, res) => {
    const filter = req.query.filter || {};
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 500;
    const offset = (page - 1) * limit;

    try {
      const betweenDates = filter._and?.[0]?.date?._between;
      const employeeIdFilter = filter._and?.[1]?.employeeId;
      const tenantIdFilter = filter._and?.[2]?.tenant?.tenantId?._eq;

      if (!betweenDates || betweenDates.length !== 2) {
        return res.status(400).json({ error: "Invalid date range" });
      }

      if (!tenantIdFilter) {
        return res.status(400).json({ error: "Tenant ID required" });
      }

      let employeeIds = [];
      if (employeeIdFilter?._eq) {
        employeeIds = [employeeIdFilter._eq];
      } else if (employeeIdFilter?._in) {
        employeeIds =
          typeof employeeIdFilter._in === "string"
            ? employeeIdFilter._in.split(",").map((id) => id.trim())
            : employeeIdFilter._in;
      }

      if (!employeeIds.length) {
        return res.status(400).json({ error: "Employee IDs required" });
      }

      let totalEmployees = employeeIds.length;
      const paginatedEmployeeIds = employeeIds.slice(offset, offset + limit);

      try {
        const attendanceCycleService = new ItemsService("attendanceCycle", {
          schema: req.schema,
          accountability: req.accountability,
        });

        const cycleSettings = await attendanceCycleService.readByQuery({
          filter: { tenant: { tenantId: { _eq: tenantIdFilter } } },
          fields: ["multi_attendance_cycle"],
          limit: 1,
        });

        if (!cycleSettings?.length) {
          return res.status(400).json({ error: "No cycle settings found" });
        }

        const cycles = cycleSettings[0].multi_attendance_cycle?.cycles || [];

        const attendanceService = new ItemsService("attendance", {
          schema: req.schema,
          accountability: req.accountability,
        });

        const records = await attendanceService.readByQuery({
          filter: {
            _and: [
              { date: { _between: betweenDates } },
              { employeeId: { _in: paginatedEmployeeIds } },
              { tenant: { tenantId: { _eq: tenantIdFilter } } },
            ],
          },
          fields: [
            "employeeId",
            "attendance",
            "day",
            "earlyDeparture",
            "lateBy",
            "overTime",
            "workHours",
          ],
          limit: -1,
        });

        const personalModuleService = new ItemsService("personalModule", {
          schema: req.schema,
          accountability: req.accountability,
        });



        const personalModuleData = await personalModuleService.readByQuery({
          filter: { id: { _in: paginatedEmployeeIds } },
          fields: [
            "id",
            "employeeId",
            "cycleType",
            "config.attendancePolicies",
            "config.attendancePolicies.LateCommingDayMode",
            "config.attendancePolicies.earlyExitAllowed",
            "config.attendancePolicies.earlyLeavingDayMode",
            "config.attendancePolicies.earlyLeavingType",
            "config.attendancePolicies.entryTimeLimit",
            "config.attendancePolicies.exitTimeLimit",
            "config.attendancePolicies.isOverTime",
            "config.attendancePolicies.isWorkingHours",
            "config.attendancePolicies.lateComingType",
            "config.attendancePolicies.lateEntryAllowed",
            "config.attendancePolicies.lateEntryPenaltyAmt",
            "config.attendancePolicies.locationCentric",
            "config.attendancePolicies.setEntryTimeLimit",
            "config.attendancePolicies.setExitTimeLimit",
            "config.attendancePolicies.setMinWorkingHours",
            "config.attendancePolicies.setOverTimeLimit",
            "config.attendancePolicies.workingHoursType",
            "config.attendancePolicies.workinghrsDaysLimit",
            "config.attendancePolicies.wrkHoursDayMode",
            "config.attendancePolicies.lateCommingLeave",
            "config.attendancePolicies.earlyLeavingLeave",
            "config.attendancePolicies.wrkHoursLeave",
            "config.attendancePolicies.weekOffType",
            "config.attendancePolicies.publicHolidayType",
            "config.attendancePolicies.extraHoursType",
            "config.attendancePolicies.exitTimeLimit",
            "config.attendancePolicies.entryTimeLimit",
            "config.attendancePolicies.isOverTime",
            "config.attendancePolicies.isWorkingHours",

            "config.attendanceSettings",
            "leaves.leaveBalance",
          ],
          sort: ["-date_updated"],
          limit: -1,
        });

        const personalModuleMap = Object.fromEntries(
          personalModuleData.map((p) => [p.id, p])
        );

        // --- FETCH PAYROLL EXCEL DATA (MOVED AND UPDATED) ---
        const payrollExcelService = new ItemsService("payrollExcel", {
          schema: req.schema,
          accountability: req.accountability,
        });

        // Calculate month/year string (YYYY-MM) from the end date
        const endDateObj = new Date(betweenDates[1]);
        const monthStr = String(endDateObj.getMonth() + 1).padStart(2, "0");
        const yearStr = endDateObj.getFullYear();
        const monthYear = `${yearStr}-${monthStr}`;
        console.log("📅 [DEBUG] Calculated Month for Payroll Excel:", monthYear);

        // Map PKs (UUID) to String IDs (e.g., EMP001) for filtering
        const employeeStringIds = personalModuleData
          .map((p) => p.employeeId)
          .filter((id) => id); // Filter out null/undefined

        let payrollExcelMapStrId = {}; // Map keyed by String ID

        if (employeeStringIds.length > 0) {
          const payrollExcelData = await payrollExcelService.readByQuery({
            filter: {
              _and: [
                { employeeId: { _in: employeeStringIds } },
                { month: { _eq: monthYear } },
                { tenant: { tenantId: { _eq: tenantIdFilter } } },
              ],
            },
            fields: ["employeeId", "payrollFormat"],
            limit: -1,
          });

          console.log("📊 [DEBUG] Payroll Excel Records Found:", payrollExcelData.length);
          if (payrollExcelData.length > 0) {
            console.log("📄 [DEBUG] Sample Excel Record:", JSON.stringify(payrollExcelData[0], null, 2));
          }

          payrollExcelMapStrId = Object.fromEntries(
            payrollExcelData.map((p) => [p.employeeId, p])
          );
        }
        // ----------------------------------------------------

        const result = {};
        const leaveDeductions = {};
        paginatedEmployeeIds.forEach((empId) => {
          const employeeLeaveBalance =
            personalModuleMap[empId]?.leaves?.leaveBalance || {};
          result[empId] = {
            employeeId: empId,
            ...structuredClone(ALL_TYPES),
            leaveDeducted: {},
          };
        });

        records.forEach((record) => {
          const empData = result[record.employeeId];
          if (!empData) return;

          if (record.attendance && empData.hasOwnProperty(record.attendance)) {
            empData[record.attendance] += 1;
          }

          // Check if payrollExcel data exists for this employee
          // Retrieve String ID for the current employee (record.employeeId is PK/UUID)
          const empStringId = personalModuleMap[record.employeeId]?.employeeId;
          const payrollExcelEntry = empStringId ? payrollExcelMapStrId[empStringId] : null;

          if (payrollExcelEntry && payrollExcelEntry.payrollFormat) {
            const fmt = payrollExcelEntry.payrollFormat;

            // Map fields from payrollFormat
            // Keys: LWP, Present Days, WorkFrom Home, Payable Days
            if (fmt["LWP"] !== undefined) {
              empData.unpaidLeave = Number(fmt["LWP"]) || 0;
            }
            if (fmt["Present Days"] !== undefined) {
              empData.present = Number(fmt["Present Days"]) || 0;
            }
            if (fmt["WorkFrom Home"] !== undefined) {
              empData.workFromHome = Number(fmt["WorkFrom Home"]) || 0;
            }
            if (fmt["Payable Days"] !== undefined) {
              empData.totalPayableDays = Number(fmt["Payable Days"]) || 0;
            }

            console.log(`✅ [DEBUG] Using Payroll Excel for Employee: ${record.employeeId}`);
            return;
          } else {
            console.log(`❌ [DEBUG] No Payroll Excel for Employee: ${record.employeeId}`);
          }

          let payableDay =
            record.day && !isNaN(record.day) ? parseFloat(record.day) : 0;

          const empCycleType = personalModuleMap[record.employeeId]?.cycleType;
          let includeWeekoffs = false;
          let includeHolidays = false;

          if (empCycleType) {
            const assignedCycle = cycles.find(
              (c) => String(c.cycleId) === String(empCycleType)
            );

            if (assignedCycle) {
              includeWeekoffs = assignedCycle.includeWeekends;
              includeHolidays = assignedCycle.includeHolidays;
            }
          }

          if (includeWeekoffs && record.attendance === "weekOff") {
            payableDay = 1;
          } else if (includeHolidays && record.attendance === "holiday") {
            payableDay = 1;
          }

          empData.totalPayableDays += payableDay;

          const earlyExitAllowed =
            personalModuleMap[record.employeeId]?.config?.attendancePolicies
              ?.earlyExitAllowed;
          empData.earlyLeavingAllowed = earlyExitAllowed;
          const lateComingAllowed =
            personalModuleMap[record.employeeId]?.config?.attendancePolicies
              ?.lateEntryAllowed;
          empData.lateComingAllowed = lateComingAllowed;
          const workingHoursAllowed =
            personalModuleMap[record.employeeId]?.config?.attendancePolicies
              ?.workinghrsDaysLimit;
          empData.workingHoursAllowed = workingHoursAllowed;

          // Early Leaving Logic
          if (
            record.earlyDeparture !== "00:00:00" &&
            record.earlyDeparture >
            personalModuleMap[record.employeeId]?.config?.attendancePolicies
              ?.setExitTimeLimit
          ) {
            empData.totalEarlyDuration = addTime(
              empData.totalEarlyDuration || "00:00:00",
              record.earlyDeparture
            );

            const earlyLeavingType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.earlyLeavingType;
            const dayMode =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.earlyLeavingDayMode;
            const leaveType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.earlyLeavingLeave;
            const earlyEnabled =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.exitTimeLimit;
            empData.earlyLeavingCount += 1;
            const allowedEarly = empData.earlyLeavingCount - earlyExitAllowed;
            if (allowedEarly > 0 && earlyEnabled) {
              if (earlyLeavingType === "lop") {
                empData.earlyLeavingData = {
                  mode: dayMode,
                  leave: earlyLeavingType,
                };
                if (dayMode === "quarter") {
                  empData.earlyLeaving += 0.25;
                  empData.totalPayableDays -= 0.25;
                } else if (dayMode === "half") {
                  empData.earlyLeaving += 0.5;
                  empData.totalPayableDays -= 0.5;
                } else {
                  empData.earlyLeaving += 1;
                  empData.totalPayableDays -= 1;
                }
              } else if (earlyLeavingType === "leave") {
                const [h, m, s] = record.earlyDeparture.split(":").map(Number);
                const totalHours = h + m / 60 + s / 3600;

                empData.earlyLeavingData = { leave: leaveType };

                let deductionAmount = 0; // ADD THIS

                if (totalHours <= 2) {
                  empData.earlyLeaving += 0.25;
                  deductionAmount = 0.25; // ADD THIS
                  empData.earlyLeavingData.mode = "Quarter Day";
                } else if (totalHours <= 4) {
                  empData.earlyLeaving += 0.5;
                  deductionAmount = 0.5; // ADD THIS
                  empData.earlyLeavingData.mode = "Half Day";
                } else if (totalHours <= 6) {
                  empData.earlyLeaving += 0.75;
                  deductionAmount = 0.75; // ADD THIS
                  empData.earlyLeavingData.mode = "0.75 Day";
                } else {
                  empData.earlyLeaving += 1;
                  deductionAmount = 1; // ADD THIS
                  empData.earlyLeavingData.mode = "Full Day";
                }

                // ADD THESE LINES:
                // Track leave deduction for early leaving
                if (!leaveDeductions[record.employeeId]) {
                  leaveDeductions[record.employeeId] = {};
                }
                if (!leaveDeductions[record.employeeId][leaveType]) {
                  leaveDeductions[record.employeeId][leaveType] = 0;
                }
                leaveDeductions[record.employeeId][leaveType] +=
                  deductionAmount;
                console.log(
                  `📝 Early Leave Deduction - Employee: ${record.employeeId}, Type: ${leaveType}, Amount: ${deductionAmount}`
                );
              } else if (earlyLeavingType === "fixed") {
                empData.earlyLeaving += 1;

                empData.earlyLeavingData = {
                  mode: "fixed",
                  leave: empData.totalEarlyDuration,
                };
              }
              empData.deductedEarlyDuration = addTime(
                empData.deductedEarlyDuration || "00:00:00",
                record.earlyDeparture
              );
            }
          }

          // Late Coming Logic
          if (
            record.lateBy !== "00:00:00" &&
            record.lateBy >
            personalModuleMap[record.employeeId]?.config?.attendancePolicies
              ?.setEntryTimeLimit
          ) {
            empData.totalLateDuration = addTime(
              empData.totalLateDuration || "00:00:00",
              record.lateBy
            );

            const lateComingType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.lateComingType;
            const dayMode =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.LateCommingDayMode;
            const leaveType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.lateCommingLeave;
            const lateEnabled =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.entryTimeLimit;
            empData.lateEntryCount += 1;
            const allowedlate = empData.lateEntryCount - lateComingAllowed;
            {
              if (allowedlate > 0 && lateEnabled)
                if (lateComingType === "lop") {
                  empData.lateData = { mode: dayMode, leave: lateComingType };
                  if (dayMode === "quarter") {
                    empData.lateComing += 0.25;
                    empData.totalPayableDays -= 0.25;
                  } else if (dayMode === "half") {
                    empData.lateComing += 0.5;
                    empData.totalPayableDays -= 0.5;
                  } else {
                    empData.lateComing += 1;
                    empData.totalPayableDays -= 1;
                  }
                } else if (lateComingType === "leave") {
                  const [h, m, s] = record.lateBy.split(":").map(Number);
                  const totalHours = h + m / 60 + s / 3600;

                  empData.lateData = {
                    leave: leaveType,
                    lateBy: record.lateBy,
                  };

                  let deductionAmount = 0; // ADD THIS

                  if (totalHours <= 2) {
                    empData.lateComing += 0.25;
                    deductionAmount = 0.25; // ADD THIS
                    empData.lateData.mode = "Quarter Day";
                  } else if (totalHours <= 4) {
                    empData.lateComing += 0.5;
                    deductionAmount = 0.5; // ADD THIS
                    empData.lateData.mode = "Half Day";
                  } else if (totalHours <= 6) {
                    empData.lateComing += 0.75;
                    deductionAmount = 0.75; // ADD THIS
                    empData.lateData.mode = "0.75 Day";
                  } else {
                    empData.lateComing += 1;
                    deductionAmount = 1; // ADD THIS
                    empData.lateData.mode = "Full Day";
                  }

                  // ADD THESE LINES:
                  // Track leave deduction for late coming
                  if (!leaveDeductions[record.employeeId]) {
                    leaveDeductions[record.employeeId] = {};
                  }
                  if (!leaveDeductions[record.employeeId][leaveType]) {
                    leaveDeductions[record.employeeId][leaveType] = 0;
                  }
                  leaveDeductions[record.employeeId][leaveType] +=
                    deductionAmount;
                  console.log(
                    `📝 Late Coming Leave Deduction - Employee: ${record.employeeId}, Type: ${leaveType}, Amount: ${deductionAmount}`
                  );
                } else if (lateComingType === "fixed") {
                  empData.lateComing += 1;
                  empData.lateData = {
                    mode: "fixed",
                    lateBy: record.lateBy,
                    leave: empData.totalLateDuration,
                  };
                }
              empData.deductedLateDuration = addTime(
                empData.deductedLateDuration || "00:00:00",
                record.lateBy
              );
            }
          }

          // Working Hours Logic
          if (
            record.workHours !== "00:00:00" &&
            record.workHours <
            personalModuleMap[record.employeeId]?.config?.attendancePolicies
              ?.setMinWorkingHours
          ) {
            const workingHoursType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.workingHoursType;
            const dayMode =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.wrkHoursDayMode;
            const leaveType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.wrkHoursLeave;
            const workEnabled =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.isWorkingHours;
            empData.workingHoursCount += 1;
            const allowedworkingHours =
              empData.workingHoursCount - workingHoursAllowed;
            if (allowedworkingHours > 0 && workEnabled) {
              if (workingHoursType === "lop") {
                empData.workingHoursData = {
                  mode: dayMode,
                  leave: workingHoursType,
                };
                if (dayMode === "quarter") {
                  empData.workingHours += 0.25;
                  empData.totalPayableDays -= 0.25;
                } else if (dayMode === "half") {
                  empData.workingHours += 0.5;
                  empData.totalPayableDays -= 0.5;
                } else {
                  empData.workingHours += 1;
                  empData.totalPayableDays -= 1;
                }
              } else if (workingHoursType === "leave") {
                empData.workingHoursData = { mode: dayMode, leave: leaveType };
                let deductionAmount = 0;
                if (dayMode === "quarterDay") {
                  deductionAmount = 0.25;
                } else if (dayMode === "halfDay") {
                  deductionAmount = 0.5;
                } else {
                  deductionAmount = 1;
                }
                empData.workingHours += deductionAmount;

                // Track leave deduction for later processing
                if (!leaveDeductions[record.employeeId]) {
                  leaveDeductions[record.employeeId] = {};
                }
                if (!leaveDeductions[record.employeeId][leaveType]) {
                  leaveDeductions[record.employeeId][leaveType] = 0;
                }
                leaveDeductions[record.employeeId][leaveType] +=
                  deductionAmount;
              } else {
                empData.workingHoursData = {
                  mode: "fixed",
                  leave: "fixedAMount",
                };
                empData.workingHours += 1;
              }
            }
          }

          const fullDayTime = addTime(
            "00:00:00",
            record.overTime || "00:00:00"
          );
          const otEnabled =
            personalModuleMap[record.employeeId]?.config?.attendancePolicies
              ?.isOverTime;
          const OTMinimumHrs =
            personalModuleMap[record.employeeId]?.config?.attendancePolicies
              ?.setOverTimeLimit;
          switch (record.attendance) {
            case "present":
              // empData.totalPayableDays += 1;
              if (otEnabled && record.overTime > OTMinimumHrs) {
                empData.workingDayOT += 1;
                empData.workingDayOTHours = addTime(
                  empData.workingDayOTHours || "00:00:00",
                  fullDayTime
                );
              }

              break;

            case "unPaidLeave":
              empData.unpaidLeave += 1;
              break;
            case "weekoff":
              empData.weekOff += 1;
              break;
            case "weekoffPresent":
              empData.weekOffOT += 1;
              // empData.totalPayableDays += 1;
              if (otEnabled) {
                empData.weekOffOTHours = addTime(
                  empData.weekOffOTHours || "00:00:00",
                  fullDayTime
                );
              }
              break;
            // case "holiday":
            //   empData.holiday += 1;
            //   break;
            case "holidayPresent":
              empData.holidayOT += 1;
              // empData.totalPayableDays += 1;
              if (otEnabled) {
                empData.holidayOTHours = addTime(
                  empData.holidayOTHours || "00:00:00",
                  fullDayTime
                );
              }
              break;

            case "workFromHome":
              empData.workFromHomeOT += 1;
              if (otEnabled) {
                empData.workFromHomeOTHours = addTime(
                  empData.workFromHomeOTHours || "00:00:00",
                  fullDayTime
                );
              }
              break;
          }
        });

        const resultArray = Object.values(result);

        console.log(
          "\n🔍 ========== LEAVE DEDUCTION PROCESSING START =========="
        );
        console.log(
          "📊 Total employees with leave deductions:",
          Object.keys(leaveDeductions).length
        );
        console.log(
          "📋 Leave deductions by employee:",
          JSON.stringify(leaveDeductions, null, 2)
        );

        // Process leave deductions for all employees
        if (Object.keys(leaveDeductions).length > 0) {
          const leaveService = new ItemsService("leave", {
            schema: req.schema,
            accountability: req.accountability,
          });

          console.log(
            "\n🔎 Fetching leave records for employees:",
            Object.keys(leaveDeductions)
          );

          const leaveRecords = await leaveService.readByQuery({
            filter: { assignedTo: { _in: Object.keys(leaveDeductions) } },
            fields: ["id", "assignedTo", "leaveTaken", "leaveBalance"],
            limit: -1,
          });

          console.log(`✅ Found ${leaveRecords.length} leave records`);
          console.log(
            "📄 Leave records:",
            JSON.stringify(leaveRecords, null, 2)
          );

          const leaveUpdates = [];

          leaveRecords.forEach((leaveRecord) => {
            const empId = leaveRecord.assignedTo;
            const empDeductions = leaveDeductions[empId];

            console.log(`\n👤 Processing Employee: ${empId}`);
            console.log("  Current Leave Balance:", leaveRecord.leaveBalance);
            console.log("  Current Leave Taken:", leaveRecord.leaveTaken);
            console.log("  Deductions to apply:", empDeductions);

            if (!empDeductions) {
              console.log("  ⚠️  No deductions found for this employee");
              return;
            }

            let updatedTaken = { ...leaveRecord.leaveTaken };
            let updatedBalance = { ...leaveRecord.leaveBalance };
            let insufficientLeave = 0;

            Object.entries(empDeductions).forEach(([leaveType, amount]) => {
              // REMOVE THIS LINE:
              // const balanceKey = `t${leaveType.toLowerCase().replace(/\s+/g, '')}`;

              // ADD THESE LINES:
              const balanceKey = leaveType.toLowerCase().replace(/\s+/g, ""); // for leaveBalance (no 't')
              const takenKey = `t${balanceKey}`; // for leaveTaken (with 't')

              const currentBalance = updatedBalance[balanceKey] || 0;

              console.log(`\n  🔄 Processing leave type: ${leaveType}`);
              console.log(`     Balance key: ${balanceKey}`);
              console.log(`     Taken key: ${takenKey}`);
              console.log(`     Current balance: ${currentBalance}`);
              console.log(`     Amount to deduct: ${amount}`);

              if (currentBalance >= amount) {
                // Sufficient balance: deduct from balance, add to taken
                updatedBalance[balanceKey] = currentBalance - amount;
                updatedTaken[takenKey] = (updatedTaken[takenKey] || 0) + amount; // CHANGE takenKey here
                console.log(`     ✅ Sufficient balance`);
                console.log(`     New balance: ${updatedBalance[balanceKey]}`);
                console.log(`     New taken: ${updatedTaken[takenKey]}`); // CHANGE takenKey here
              } else {
                // Insufficient balance: use what's available, track remainder
                console.log(`     ⚠️  Insufficient balance!`);
                if (currentBalance > 0) {
                  updatedTaken[takenKey] =
                    (updatedTaken[takenKey] || 0) + currentBalance; // CHANGE takenKey here
                  updatedBalance[balanceKey] = 0;
                  console.log(`     Used available balance: ${currentBalance}`);
                }
                const shortage = amount - currentBalance;
                insufficientLeave += shortage;
                console.log(`     Shortage: ${shortage}`);
                console.log(
                  `     Total insufficient leave so far: ${insufficientLeave}`
                );
              }
            });

            // Deduct insufficient leave from payable days
            if (insufficientLeave > 0 && result[empId]) {
              const previousPayableDays = result[empId].totalPayableDays;
              result[empId].totalPayableDays -= insufficientLeave;
              console.log(`\n  💰 Payable Days Adjustment:`);
              console.log(`     Previous: ${previousPayableDays}`);
              console.log(`     Deducted: ${insufficientLeave}`);
              console.log(`     New: ${result[empId].totalPayableDays}`);
            }

            console.log("\n  📝 Final Updated Values:");
            console.log("     Updated Balance:", updatedBalance);
            console.log("     Updated Taken:", updatedTaken);

            // ADD THESE LINES BEFORE leaveUpdates.push:
            // Track what was actually deducted for this employee
            const deductedSummary = {};
            Object.entries(empDeductions).forEach(([leaveType, amount]) => {
              const balanceKey = leaveType.toLowerCase().replace(/\s+/g, "");
              const actualDeducted = Math.min(
                amount,
                leaveRecord.leaveBalance[balanceKey] || 0
              );
              if (actualDeducted > 0) {
                deductedSummary[balanceKey] = actualDeducted;
              }
            });

            // Update result with deducted summary
            if (result[empId]) {
              result[empId].leaveDeducted = deductedSummary;
            }

            console.log("     Leave Deducted Summary:", deductedSummary); // ADD THIS CONSOLE

            leaveUpdates.push({
              id: leaveRecord.id,
              leaveTaken: updatedTaken,
              leaveBalance: updatedBalance,
            });
          });

          console.log(
            "\n\n📤 Leave updates to be saved:",
            JSON.stringify(leaveUpdates, null, 2)
          );

          // Bulk update all leave records
          if (leaveUpdates.length > 0) {
            console.log(
              `\n💾 Updating ${leaveUpdates.length} leave records...`
            );
            await Promise.all(
              leaveUpdates.map((update) =>
                leaveService.updateOne(update.id, {
                  leaveTaken: update.leaveTaken,
                  leaveBalance: update.leaveBalance,
                })
              )
            );
            console.log("✅ All leave records updated successfully");
          }
        }

        console.log(
          "\n🏁 ========== LEAVE DEDUCTION PROCESSING END ==========\n"
        );

        // Update resultArray with latest payable days
        const finalResultArray = Object.values(result);

        return res.json({
          data: finalResultArray,
          meta: {
            total: totalEmployees,
            page: page,
            limit: limit,
            totalPages: Math.ceil(totalEmployees / limit),
          },
        });
      } catch (serviceError) {
        return res.status(500).json({
          error: "Service error",
          message: serviceError.message,
        });
      }
    } catch (err) {
      return res.status(500).json({
        error: "Internal server error",
        message: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  });
};

const addTime = (time1, time2) => {
  const [h1, m1, s1] = time1.split(":").map(Number);
  const [h2, m2, s2] = time2.split(":").map(Number);

  let seconds = s1 + s2;
  let minutes = m1 + m2 + Math.floor(seconds / 60);
  let hours = h1 + h2 + Math.floor(minutes / 60);

  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(
    2,
    "0"
  )}:${String(seconds % 60).padStart(2, "0")}`;
};
