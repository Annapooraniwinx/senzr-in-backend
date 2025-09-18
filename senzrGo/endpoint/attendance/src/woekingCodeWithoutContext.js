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

    lateEntryCount: 0,
    lateComingAllowed: 0,
    lateComing: 0,
    lateData: {},
    totalLateDuration: "00:00:00",

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

  router.get("/attendance-verification", async (req, res) => {
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
            "config.attendanceSettings",
            "leaves.leaveBalance",
          ],
          sort: ["-date_updated"],
          limit: -1,
        });

        const personalModuleMap = Object.fromEntries(
          personalModuleData.map((p) => [p.id, p])
        );

        const result = {};
        paginatedEmployeeIds.forEach((empId) => {
          const employeeLeaveBalance =
            personalModuleMap[empId]?.leaves?.leaveBalance || {};
          result[empId] = {
            employeeId: empId,
            ...structuredClone(ALL_TYPES),
            leaveBalance: employeeLeaveBalance,
          };
        });

        records.forEach((record) => {
          const empData = result[record.employeeId];
          if (!empData) return;

          if (record.attendance && empData.hasOwnProperty(record.attendance)) {
            empData[record.attendance] += 1;
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
            empData.earlyLeavingCount += 1;

            const earlyLeavingType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.earlyLeavingType;
            const dayMode =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.earlyLeavingDayMode;
            const leaveType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.earlyLeavingLeave;

            const exceededCount = empData.earlyLeavingCount - earlyExitAllowed;
            if (exceededCount <= 0) return;

            if (earlyLeavingType === "lop") {
              empData.earlyLeavingData = {
                mode: dayMode,
                leave: earlyLeavingType,
              };
              if (dayMode === "quarterDay") {
                empData.earlyLeaving += 0.25;
                empData.totalPayableDays -= 0.25;
              } else if (dayMode === "halfDay") {
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

              if (totalHours <= 2) {
                empData.earlyLeaving += 0.25;
                empData.earlyLeavingData.mode = "Quarter Day";
              } else if (totalHours <= 4) {
                empData.earlyLeaving += 0.5;
                empData.earlyLeavingData.mode = "Half Day";
              } else if (totalHours <= 6) {
                empData.earlyLeaving += 0.75;
                empData.earlyLeavingData.mode = "0.75 Day";
              } else {
                empData.earlyLeaving += 1;
                empData.earlyLeavingData.mode = "Full Day";
              }
            } else if (earlyLeavingType === "fixed") {
              empData.earlyLeaving += 1;

              empData.totalEarlyDuration = addTime(
                empData.totalEarlyDuration || "00:00:00",
                record.earlyDeparture
              );
              empData.earlyLeavingData = {
                mode: "fixed",
                leave: empData.totalEarlyDuration,
              };
            }
          }

          // Late Coming Logic
          if (
            record.lateBy !== "00:00:00" &&
            record.lateBy >
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.setEntryTimeLimit
          ) {
            empData.lateEntryCount += 1;

            const lateComingType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.lateComingType;
            const dayMode =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.LateCommingDayMode;
            const leaveType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.lateCommingLeave;

            const exceededCount = empData.lateEntryCount - lateComingAllowed;
            if (exceededCount <= 0) return;

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

              empData.lateData = { leave: leaveType };

              if (totalHours <= 2) {
                empData.lateComing += 0.25;
                empData.lateData.mode = "Quarter Day";
              } else if (totalHours <= 4) {
                empData.lateComing += 0.5;
                empData.lateData.mode = "Half Day";
              } else if (totalHours <= 6) {
                empData.lateComing += 0.75;
                empData.lateData.mode = "0.75 Day";
              } else {
                empData.lateComing += 1;
                empData.lateData.mode = "Full Day";
              }
            } else if (lateComingType === "fixed") {
              empData.lateComing += 1;
              empData.totalLateDuration = addTime(
                empData.totalLateDuration || "00:00:00",
                record.lateBy
              );
              empData.lateData = {
                mode: "fixed",
                leave: empData.totalLateDuration,
              };
            }
          }

          // Working Hours Logic
          if (
            record.workHours <
            personalModuleMap[record.employeeId]?.config?.attendancePolicies
              ?.setMinWorkingHours
          ) {
            empData.workingHoursCount += 1;

            const workingHoursType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.workingHoursType;
            const dayMode =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.wrkHoursDayMode;
            const leaveType =
              personalModuleMap[record.employeeId]?.config?.attendancePolicies
                ?.wrkHoursLeave;

            const exceededCount =
              empData.workingHoursCount - workingHoursAllowed;
            if (exceededCount <= 0) return;

            if (workingHoursType === "lop") {
              empData.workingHoursData = {
                mode: dayMode,
                leave: workingHoursType,
              };
              if (dayMode === "quarterDay") {
                empData.workingHours += 0.25;
                empData.totalPayableDays -= 0.25;
              } else if (dayMode === "halfDay") {
                empData.workingHours += 0.5;
                empData.totalPayableDays -= 0.5;
              } else {
                empData.workingHours += 1;
                empData.totalPayableDays -= 1;
              }
            } else if (workingHoursType === "leave") {
              empData.workingHoursData = { mode: dayMode, leave: leaveType };
              if (dayMode === "quarterDay") {
                empData.workingHours += 0.25;
              } else if (dayMode === "halfDay") {
                empData.workingHours += 0.5;
              } else {
                empData.workingHours += 1;
              }
            } else {
              empData.workingHoursData = {
                mode: "fixed",
                leave: "fixedAMount",
              };
              empData.workingHours += 1;
            }
          }

          const fullDayTime = addTime(
            record.workHours || "00:00:00",
            record.overTime || "00:00:00"
          );

          switch (record.attendance) {
            case "present":
              if (record.overTime && record.overTime !== "00:00:00") {
                empData.workingDayOT += 1;
                empData.workingDayOTHours = addTime(
                  empData.workingDayOTHours || "00:00:00",
                  fullDayTime
                );
              }
              break;
            case "paidLeave":
              empData.paidLeave += 1;
              break;
            case "unPaidLeave":
              empData.unpaidLeave += 1;
              break;
            case "weekOff":
            case "weekoffPresent":
              empData.weekOffOT += 1;
              empData.weekOffOTHours = addTime(
                empData.weekOffOTHours || "00:00:00",
                fullDayTime
              );
              break;
            case "holiday":
            case "holidayPresent":
              empData.holidayOT += 1;
              empData.holidayOTHours = addTime(
                empData.holidayOTHours || "00:00:00",
                fullDayTime
              );
              break;
            case "workFromHome":
              empData.workFromHomeOT += 1;
              empData.workFromHomeOTHours = addTime(
                empData.workFromHomeOTHours || "00:00:00",
                fullDayTime
              );
              break;
          }
        });

        const resultArray = Object.values(result);

        return res.json({
          data: resultArray,
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

  //attendance dashboard
  router.get("/monthly-dashboard", async (req, res) => {
    try {
      let filter = {};
      if (req.query.filter) {
        if (typeof req.query.filter === "string") {
          try {
            filter = JSON.parse(req.query.filter);
          } catch (e) {
            console.error("❌ Failed to parse filter JSON", e);
          }
        } else if (typeof req.query.filter === "object") {
          filter = req.query.filter;
        }
      }

      let tenantId = req.query.tenantId;
      if (!tenantId) {
        const filterAnd = filter._and || [];
        tenantId = filterAnd.find((f) => f.tenant)?.tenant?.tenantId?._eq;
      }

      let year = req.query.year ? parseInt(req.query.year) : null;
      if (!year) {
        const filterAnd = filter._and || [];
        year = filterAnd.find((f) => f["year(date)"])?.["year(date)"]?._eq;
      }

      let month = req.query.month ? parseInt(req.query.month) : null;
      if (!month) {
        const filterAnd = filter._and || [];
        month = filterAnd.find((f) => f["month(date)"])?.["month(date)"]?._eq;
      }

      let startDate = req.query.startDate;
      if (!startDate) {
        const filterAnd = filter._and || [];
        startDate = filterAnd.find((f) => f.date?._gte)?.date?._gte;
      }

      let endDate = req.query.endDate;
      if (!endDate) {
        const filterAnd = filter._and || [];
        endDate = filterAnd.find((f) => f.date?._lte)?.date?._lte;
      }

      let employeeIds = [];
      if (req.query.employeeId) {
        employeeIds = req.query.employeeId.split(",").map((id) => id.trim());
      } else {
        const filterAnd = filter._and || [];
        const employeeFilter = filterAnd.find((f) => f.employeeId);
        if (employeeFilter?.employeeId?.id?._in) {
          employeeIds = employeeFilter.employeeId.id._in
            .split(",")
            .map((id) => id.trim());
        } else if (employeeFilter?.employeeId?.id?._eq) {
          employeeIds = [employeeFilter.employeeId.id._eq];
        }
      }

      const organizationId = req.query.organizationId;
      const branchLocationId = req.query.branchLocationId;
      const departmentId = req.query.departmentId;
      const cycleTypeFilter = req.query.cycleTypeFilter; // Note: Changed from cycleTypeId to match query parameter

      const searchTerm = req.query.search || "";
      const page = Number.parseInt(req.query.page) || 1;
      const limit = Number.parseInt(req.query.limit) || 50;
      const offset = (page - 1) * limit;

      console.log("📝 FILTER DATA CHECK 📝");
      console.log("💠 tenantId:", tenantId);
      console.log("💠 employeeIds:", employeeIds);
      console.log("💠 year:", year);
      console.log("💠 month:", month);
      console.log("💠 startDate:", startDate);
      console.log("💠 endDate:", endDate);
      console.log("💠 organizationId:", organizationId);
      console.log("💠 branchLocationId:", branchLocationId);
      console.log("💠 departmentId:", departmentId);
      console.log("💠 cycleTypeFilter:", cycleTypeFilter);
      console.log("💠 searchTerm:", searchTerm);
      console.log("💠 page:", page);
      console.log("💠 limit:", limit);
      console.log("💠 full filter object:", JSON.stringify(filter, null, 2));

      if (!tenantId) {
        return res.status(400).json({
          error: "Missing required parameter",
          message: "tenantId is required",
        });
      }

      const attendanceCycleService = new ItemsService("attendanceCycle", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const attendanceService = new ItemsService("attendance", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const personalModuleService = new ItemsService("personalModule", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const cycleSettings = await attendanceCycleService.readByQuery({
        filter: { tenant: { tenantId: { _eq: tenantId } } },
        fields: ["multi_attendance_cycle"],
        limit: 1,
      });

      const cycles = cycleSettings[0]?.multi_attendance_cycle?.cycles || [];
      console.log("💠 Fetched cycles:", JSON.stringify(cycles, null, 2));

      if (!cycles.length) {
        console.warn(
          "💠 No cycles found, using default 1st-to-last day for current month"
        );
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        return await getCurrentMonthAllEmployees(
          req,
          res,
          attendanceService,
          personalModuleService,
          tenantId,
          organizationId,
          branchLocationId,
          departmentId,
          cycleTypeFilter,
          searchTerm,
          page,
          limit,
          offset,
          [
            {
              cycleId: "default",
              cycleName: "Default",
              startDate: "1",
              endDate: new Date(currentYear, currentMonth, 0)
                .getDate()
                .toString(),
              includeWeekends: true,
              includeHolidays: true,
            },
          ],
          null
        );
      }

      let isSingleEmployee = employeeIds.length === 1;
      let employeeId = isSingleEmployee ? employeeIds[0] : null;

      if (employeeIds.length === 0) {
        // All employees cases
        if (startDate && endDate) {
          return await getDateRangeAllEmployees(
            req,
            res,
            attendanceService,
            personalModuleService,
            tenantId,
            startDate,
            endDate,
            organizationId,
            branchLocationId,
            departmentId,
            cycleTypeFilter,
            searchTerm,
            page,
            limit,
            offset,
            cycles,
            null
          );
        } else {
          return await getCurrentMonthAllEmployees(
            req,
            res,
            attendanceService,
            personalModuleService,
            tenantId,
            organizationId,
            branchLocationId,
            departmentId,
            cycleTypeFilter,
            searchTerm,
            page,
            limit,
            offset,
            cycles,
            null
          );
        }
      } else if (isSingleEmployee) {
        // Single employee cases
        // Fetch employee's cycleType from personalModule
        let employeeCycleType = cycleTypeFilter;
        if (!employeeCycleType) {
          const employeeData = await personalModuleService.readByQuery({
            filter: {
              id: { _eq: employeeId },
              assignedUser: {
                tenant: { tenantId: { _eq: tenantId } },
              },
            },
            fields: ["cycleType"],
            limit: 1,
          });
          employeeCycleType = employeeData[0]?.cycleType;
          console.log("💠 Fetched employee cycleType:", employeeCycleType);
          if (!employeeCycleType) {
            console.warn("💠 No cycleType found for employeeId:", employeeId);
            return res.status(400).json({
              error: "Invalid employee data",
              message: "No cycleType found for the specified employee",
            });
          }
        }

        if (year && month) {
          return await getMonthlyDetailedAttendance(
            req,
            res,
            attendanceService,
            employeeId,
            tenantId,
            Number.parseInt(year),
            Number.parseInt(month),
            cycles,
            employeeCycleType
          );
        } else if (year) {
          return await getYearlySummary(
            req,
            res,
            attendanceService,
            employeeId,
            tenantId,
            Number.parseInt(year),
            cycles,
            employeeCycleType
          );
        } else if (startDate && endDate) {
          return await getDateRangeDetailedForEmployee(
            req,
            res,
            attendanceService,
            employeeId,
            tenantId,
            startDate,
            endDate,
            cycles,
            employeeCycleType
          );
        } else {
          // Default to current month detailed for single
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = now.getMonth() + 1;
          const { startDate: calcStart, endDate: calcEnd } =
            calculateDateRangeFromCycles(
              currentYear,
              currentMonth,
              cycles,
              employeeCycleType
            );
          return await getDateRangeDetailedForEmployee(
            req,
            res,
            attendanceService,
            employeeId,
            tenantId,
            calcStart,
            calcEnd,
            cycles,
            employeeCycleType
          );
        }
      } else {
        // Multiple employees
        if (year && month) {
          const { startDate: calcStart, endDate: calcEnd } =
            calculateDateRangeFromCycles(
              Number.parseInt(year),
              Number.parseInt(month),
              cycles,
              cycleTypeFilter
            );
          return await getDateRangeAllEmployees(
            req,
            res,
            attendanceService,
            personalModuleService,
            tenantId,
            calcStart,
            calcEnd,
            organizationId,
            branchLocationId,
            departmentId,
            cycleTypeFilter,
            searchTerm,
            page,
            limit,
            offset,
            cycles,
            employeeIds
          );
        } else if (year) {
          return res.status(400).json({
            error: "Unsupported",
            message: "Yearly summary only supported for single employee",
          });
        } else if (startDate && endDate) {
          return await getDateRangeAllEmployees(
            req,
            res,
            attendanceService,
            personalModuleService,
            tenantId,
            startDate,
            endDate,
            organizationId,
            branchLocationId,
            departmentId,
            cycleTypeFilter,
            searchTerm,
            page,
            limit,
            offset,
            cycles,
            employeeIds
          );
        } else {
          // Current month for multiple
          return await getCurrentMonthAllEmployees(
            req,
            res,
            attendanceService,
            personalModuleService,
            tenantId,
            organizationId,
            branchLocationId,
            departmentId,
            cycleTypeFilter,
            searchTerm,
            page,
            limit,
            offset,
            cycles,
            employeeIds
          );
        }
      }
    } catch (error) {
      console.error("❌ Error in monthly-dashboard:", error);
      return res.status(500).json({
        error: "Internal server error",
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  async function getCurrentMonthAllEmployees(
    req,
    res,
    attendanceService,
    personalModuleService,
    tenantId,
    organizationId,
    branchLocationId,
    departmentId,
    cycleTypeFilter,
    searchTerm,
    page,
    limit,
    offset,
    cycles,
    employeeIds = null
  ) {
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      // Parse cycleTypeFilter if it's in JSON format
      let cycleTypeValue = cycleTypeFilter;
      if (typeof cycleTypeFilter === "string") {
        try {
          const parsedFilter = JSON.parse(cycleTypeFilter);
          if (parsedFilter.cycleType && parsedFilter.cycleType._contains) {
            cycleTypeValue = parsedFilter.cycleType._contains;
          }
        } catch (e) {
          // If JSON parsing fails, assume cycleTypeFilter is a direct value
          console.warn(
            "💠 Failed to parse cycleTypeFilter JSON, using raw value:",
            cycleTypeFilter
          );
        }
      }

      // Find the matching cycle from multi_attendance_cycle
      let selectedCycle = cycles.find(
        (cycle) => cycle.cycleId == cycleTypeValue
      );
      if (!selectedCycle) {
        selectedCycle = cycles[0] || {
          cycleId: "default",
          cycleName: "Default",
          startDate: "1",
          endDate: new Date(currentYear, currentMonth, 0).getDate().toString(),
          includeWeekends: true,
          includeHolidays: true,
        };
        console.warn(
          "💠 No matching cycle found, using default:",
          selectedCycle
        );
      }

      const { startDate, endDate } = calculateDateRangeFromCycles(
        currentYear,
        currentMonth,
        [selectedCycle],
        cycleTypeValue
      );

      const personalModuleFilter = {
        _and: [
          {
            assignedUser: {
              tenant: { tenantId: { _eq: tenantId } },
            },
          },
        ],
      };

      if (organizationId) {
        personalModuleFilter._and.push({
          assignedUser: { organization: { id: { _eq: organizationId } } },
        });
      }

      if (branchLocationId) {
        personalModuleFilter._and.push({
          branchLocation: { id: { _eq: branchLocationId } },
        });
      }

      if (departmentId) {
        personalModuleFilter._and.push({
          department: { id: { _eq: departmentId } },
        });
      }

      // Apply cycleType filter strictly, excluding null values
      if (cycleTypeValue) {
        personalModuleFilter._and.push({
          cycleType: { _eq: cycleTypeValue },
        });
        // Explicitly exclude null cycleType values
        personalModuleFilter._and.push({
          cycleType: { _nnull: true },
        });
      } else {
        // If no cycleTypeFilter is provided, exclude null cycleType values to avoid invalid data
        personalModuleFilter._and.push({
          cycleType: { _nnull: true },
        });
      }

      if (searchTerm) {
        personalModuleFilter._and.push({
          _or: [
            { employeeId: { _icontains: searchTerm } },
            { assignedUser: { first_name: { _icontains: searchTerm } } },
            { assignedUser: { last_name: { _icontains: searchTerm } } },
          ],
        });
      }

      if (employeeIds) {
        personalModuleFilter._and.push({
          id: { _in: employeeIds },
        });
      }

      console.log(
        "🔍 personalModuleFilter:",
        JSON.stringify(personalModuleFilter, null, 2)
      );

      const totalEmployeesResult = await personalModuleService.readByQuery({
        filter: personalModuleFilter,
        fields: ["id"],
        limit: -1,
      });

      const totalEmployees = totalEmployeesResult.length;

      const paginatedEmployees = await personalModuleService.readByQuery({
        filter: personalModuleFilter,
        fields: [
          "id",
          "employeeId",
          "assignedUser.first_name",
          "assignedUser.last_name",
          "department.departmentName",
          "assignedUser.id",
          "reportingManager",
          "approver.id",
          "cycleType",
        ],
        limit: limit,
        offset: offset,
      });

      const employeeIdsFetched = paginatedEmployees.map((emp) => emp.id);

      if (employeeIdsFetched.length === 0) {
        return res.json({
          data: [],
          meta: {
            tenantId,
            month: currentMonth,
            year: currentYear,
            cycleStartDate: startDate,
            cycleEndDate: endDate,
            cycleType: cycleTypeValue || "Multi Attendance Cycle",
            totalEmployees: 0,
            page,
            limit,
            totalPages: 0,
            search: searchTerm,
          },
        });
      }

      const records = await attendanceService.readByQuery({
        filter: {
          _and: [
            { date: { _between: [startDate, endDate] } },
            { employeeId: { id: { _in: employeeIdsFetched } } },
            { tenant: { tenantId: { _eq: tenantId } } },
          ],
        },
        fields: [
          "id",
          "date",
          "attendance",
          "day",
          "leaveType",
          "overTime",
          "lateBy",
          "earlyDeparture",
          "attendanceContext",
          "employeeId.id",
        ],
        sort: ["date"],
        limit: -1,
      });

      const employeeDetailsMap = {};
      paginatedEmployees.forEach((emp) => {
        employeeDetailsMap[emp.id] = {
          employeeId: emp.employeeId,
          firstName: emp.assignedUser?.first_name || "Unknown",
          department: emp.department?.departmentName || "Finance",
          userId: emp?.assignedUser?.id,
          reportingManager: emp?.reportingManager,
          cycleType: emp?.cycleType,
        };
      });

      const employeeRecords = {};

      records.forEach((record) => {
        const empId = record.employeeId?.id;
        if (!empId) return;

        if (!employeeRecords[empId]) {
          employeeRecords[empId] = [];
        }

        employeeRecords[empId].push(record);
      });

      const employeeSummaries = [];

      for (const empId of employeeIdsFetched) {
        const empDetails = employeeDetailsMap[empId];
        if (!empDetails) continue;

        const empRecords = employeeRecords[empId] || [];
        const summary = calculateAttendanceSummaryWithCycles(
          empRecords,
          cycles,
          empDetails.cycleType
        );

        const leaveTypes = empRecords
          .filter((record) => record.leaveType)
          .map((record) => record.leaveType);

        const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";

        employeeSummaries.push({
          employeeId: empId,
          employeeCode: empDetails.employeeId,
          firstName: empDetails.firstName,
          department: empDetails.department,
          userId: empDetails.userId,
          reportingManager: empDetails.reportingManager,
          cycleType: empDetails.cycleType,
          month: currentMonth,
          monthName: getMonthName(currentMonth),
          year: currentYear,
          leaveType: leaveType,
          ...summary,
        });
      }

      return res.json({
        data: employeeSummaries,
        meta: {
          tenantId,
          month: currentMonth,
          year: currentYear,
          cycleStartDate: startDate,
          cycleEndDate: endDate,
          cycleType: cycleTypeValue || "Multi Attendance Cycle",
          totalEmployees,
          page,
          limit,
          totalPages: Math.ceil(totalEmployees / limit),
          search: searchTerm,
        },
      });
    } catch (error) {
      console.error("❌ Error in getCurrentMonthAllEmployees:", error);
      throw error;
    }
  }

  async function getDateRangeAllEmployees(
    req,
    res,
    attendanceService,
    personalModuleService,
    tenantId,
    startDate,
    endDate,
    organizationId,
    branchLocationId,
    departmentId,
    cycleTypeFilter,
    searchTerm,
    page,
    limit,
    offset,
    cycles,
    employeeIds = null
  ) {
    try {
      // Parse cycleTypeFilter if it's in JSON format
      let cycleTypeValue = cycleTypeFilter;
      if (typeof cycleTypeFilter === "string") {
        try {
          const parsedFilter = JSON.parse(cycleTypeFilter);
          if (parsedFilter.cycleType && parsedFilter.cycleType._contains) {
            cycleTypeValue = parsedFilter.cycleType._contains;
          }
        } catch (e) {
          console.warn(
            "💠 Failed to parse cycleTypeFilter JSON, using raw value:",
            cycleTypeFilter
          );
        }
      }

      const personalModuleFilter = {
        _and: [
          {
            assignedUser: {
              tenant: { tenantId: { _eq: tenantId } },
            },
          },
        ],
      };

      if (organizationId) {
        personalModuleFilter._and.push({
          assignedUser: { organization: { id: { _eq: organizationId } } },
        });
      }

      if (branchLocationId) {
        personalModuleFilter._and.push({
          branchLocation: { id: { _eq: branchLocationId } },
        });
      }

      if (departmentId) {
        personalModuleFilter._and.push({
          department: { id: { _eq: departmentId } },
        });
      }

      // Apply cycleType filter strictly, excluding null values
      if (cycleTypeValue) {
        personalModuleFilter._and.push({
          cycleType: { _eq: cycleTypeValue },
        });
        personalModuleFilter._and.push({
          cycleType: { _nnull: true },
        });
      } else {
        personalModuleFilter._and.push({
          cycleType: { _nnull: true },
        });
      }

      if (searchTerm) {
        personalModuleFilter._and.push({
          _or: [
            { employeeId: { _icontains: searchTerm } },
            { assignedUser: { first_name: { _icontains: searchTerm } } },
            { assignedUser: { last_name: { _icontains: searchTerm } } },
          ],
        });
      }

      if (employeeIds) {
        personalModuleFilter._and.push({
          id: { _in: employeeIds },
        });
      }

      console.log(
        "🔍 personalModuleFilter:",
        JSON.stringify(personalModuleFilter, null, 2)
      );

      const totalEmployeesResult = await personalModuleService.readByQuery({
        filter: personalModuleFilter,
        fields: ["id"],
        limit: -1,
      });

      const totalEmployees = totalEmployeesResult.length;

      const paginatedEmployees = await personalModuleService.readByQuery({
        filter: personalModuleFilter,
        fields: [
          "id",
          "employeeId",
          "assignedUser.first_name",
          "assignedUser.last_name",
          "department.departmentName",
          "cycleType",
        ],
        limit: limit,
        offset: offset,
      });

      const employeeIdsFetched = paginatedEmployees.map((emp) => emp.id);

      if (employeeIdsFetched.length === 0) {
        return res.json({
          data: [],
          meta: {
            tenantId,
            startDate,
            endDate,
            startMonth: new Date(startDate).getMonth() + 1,
            startYear: new Date(startDate).getFullYear(),
            endMonth: new Date(endDate).getMonth() + 1,
            endYear: new Date(endDate).getFullYear(),
            totalEmployees: 0,
            page,
            limit,
            totalPages: 0,
            search: searchTerm,
          },
        });
      }

      const records = await attendanceService.readByQuery({
        filter: {
          _and: [
            { date: { _between: [startDate, endDate] } },
            { employeeId: { id: { _in: employeeIdsFetched } } },
            { tenant: { tenantId: { _eq: tenantId } } },
          ],
        },
        fields: [
          "id",
          "date",
          "attendance",
          "day",
          "leaveType",
          "overTime",
          "lateBy",
          "earlyDeparture",
          "attendanceContext",
          "employeeId.id",
        ],
        sort: ["date"],
        limit: -1,
      });

      const employeeDetailsMap = {};
      paginatedEmployees.forEach((emp) => {
        employeeDetailsMap[emp.id] = {
          employeeId: emp.employeeId,
          firstName: emp.assignedUser?.first_name || "Unknown",
          department: emp.department?.departmentName || "Finance",
          cycleType: emp?.cycleType,
        };
      });

      const employeeRecords = {};

      records.forEach((record) => {
        const empId = record.employeeId?.id;
        if (!empId) return;

        if (!employeeRecords[empId]) {
          employeeRecords[empId] = [];
        }

        employeeRecords[empId].push(record);
      });

      const employeeSummaries = [];

      for (const empId of employeeIdsFetched) {
        const empDetails = employeeDetailsMap[empId];
        if (!empDetails) continue;

        const empRecords = employeeRecords[empId] || [];
        const summary = calculateAttendanceSummaryWithCycles(
          empRecords,
          cycles,
          empDetails.cycleType
        );

        const leaveTypes = empRecords
          .filter((record) => record.leaveType)
          .map((record) => record.leaveType);

        const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";

        employeeSummaries.push({
          employeeId: empId,
          employeeCode: empDetails.employeeId,
          firstName: empDetails.firstName,
          department: empDetails.department,
          cycleType: empDetails.cycleType,
          leaveType: leaveType,
          ...summary,
        });
      }

      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);

      return res.json({
        data: employeeSummaries,
        meta: {
          tenantId,
          startDate,
          endDate,
          startMonth: startDateObj.getMonth() + 1,
          startYear: startDateObj.getFullYear(),
          endMonth: endDateObj.getMonth() + 1,
          endYear: endDateObj.getFullYear(),
          totalEmployees,
          page,
          limit,
          totalPages: Math.ceil(totalEmployees / limit),
          search: searchTerm,
        },
      });
    } catch (error) {
      console.error("❌ Error in getDateRangeAllEmployees:", error);
      throw error;
    }
  }

  async function getDateRangeDetailedForEmployee(
    req,
    res,
    attendanceService,
    employeeId,
    tenantId,
    startDate,
    endDate,
    cycles,
    cycleType
  ) {
    try {
      let lockedMonthAttendance = false;
      if (tenantId && employeeId) {
        try {
          const payrollVerificationService = new ItemsService(
            "payrollVerification",
            {
              schema: req.schema,
              accountability: req.accountability,
            }
          );

          const payrollVerificationRecords =
            await payrollVerificationService.readByQuery({
              filter: {
                tenant: { tenantId: { _eq: tenantId } },
                startDate: { _gte: startDate },
                endDate: { _lte: endDate },
                employee: { id: { _eq: employeeId } },
              },
              fields: ["id", "employee", "salaryPaid", "startDate", "endDate"],
            });

          if (
            payrollVerificationRecords &&
            payrollVerificationRecords.length > 0
          ) {
            const payrollRecord = payrollVerificationRecords.find(
              (record) => record.salaryPaid === "paid"
            );

            if (payrollRecord) {
              lockedMonthAttendance = true;
              console.log(
                "💠 Found paid salary record - locking attendance:",
                payrollRecord
              );
            } else {
              const unpaidRecord = payrollVerificationRecords.find(
                (record) => record.salaryPaid === "unpaid"
              );
              if (unpaidRecord) {
                lockedMonthAttendance = false;
                console.log(
                  "💠 Found unpaid salary record - attendance unlocked:",
                  unpaidRecord
                );
              }
            }
          } else {
            console.log("💠 No payroll verification records found");
          }
        } catch (error) {
          console.error("❌ Error fetching payroll verification data:", error);
        }
      } else {
        console.log(
          "💠 Missing required parameters for payroll verification query:",
          {
            tenantId,
            employeeId,
          }
        );
      }

      const records = await attendanceService.readByQuery({
        filter: {
          _and: [
            { date: { _between: [startDate, endDate] } },
            { employeeId: { id: { _eq: employeeId } } },
            { tenant: { tenantId: { _eq: tenantId } } },
          ],
        },
        fields: [
          "id",
          "date",
          "attendance",
          "day",
          "leaveType",
          "attendanceContext",
          "employeeId.id",
          "onTime",
          "lateBy",
          "breakTime",
          "overTime",
          "earlyDeparture",
          "workHours",
          "outTime",
          "inTime",
          "action",
          "mode",
        ],
        sort: ["date"],
        limit: -1,
      });

      const allDates = getAllDatesInRange(startDate, endDate);

      const dailyAttendance = allDates.map((date) => {
        const dateStr = date.toISOString().split("T")[0];
        const record = records.find((r) => r.date === dateStr);

        if (record) {
          return {
            id: record.id,
            date: dateStr,
            attendance: record.attendance,
            day: record.day,
            leaveType: record.leaveType || "none",
            attendanceContext: record.attendanceContext,
            employeeId: record.employeeId,
            onTime: record.onTime,
            lateBy: record.lateBy,
            breakTime: record.breakTime,
            overTime: record.overTime,
            earlyDeparture: record.earlyDeparture,
            workHours: record.workHours,
            outTime: record.outTime,
            inTime: record.inTime,
            action: record.action,
            mode: record.mode,
          };
        } else {
          return {
            id: null,
            date: dateStr,
            attendance: "noRecord",
            day: null,
            leaveType: "none",
            attendanceContext: null,
            employeeId: { id: employeeId, employeeId: null },
            onTime: null,
            lateBy: null,
            breakTime: null,
            overTime: null,
            earlyDeparture: null,
            workHours: null,
            outTime: null,
            inTime: null,
            action: null,
            mode: null,
          };
        }
      });

      const monthlySummary = calculateAttendanceSummaryWithCycles(
        records,
        cycles,
        cycleType
      );

      const leaveTypes = records
        .filter((record) => record.leaveType)
        .map((record) => record.leaveType);

      const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";

      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);

      return res.json({
        data: {
          summary: {
            startDate,
            endDate,
            leaveType: leaveType,
            ...monthlySummary,
          },
          dailyRecords: dailyAttendance,
        },
        meta: {
          employeeId,
          tenantId,
          startDate,
          endDate,
          startMonth: startDateObj.getMonth() + 1,
          startYear: startDateObj.getFullYear(),
          endMonth: endDateObj.getMonth() + 1,
          endYear: endDateObj.getFullYear(),
          cycleType: cycleType || "Multi Attendance Cycle",
          totalDays: dailyAttendance.length,
          lockedMonthAttendance,
        },
      });
    } catch (error) {
      console.error("❌ Error in getDateRangeDetailedForEmployee:", error);
      throw error;
    }
  }

  async function getYearlySummary(
    req,
    res,
    attendanceService,
    employeeId,
    tenantId,
    year,
    cycles,
    cycleType
  ) {
    try {
      const monthlySummaries = [];

      for (let month = 1; month <= 12; month++) {
        const { startDate, endDate } = calculateDateRangeFromCycles(
          year,
          month,
          cycles,
          cycleType
        );

        const records = await attendanceService.readByQuery({
          filter: {
            _and: [
              { date: { _between: [startDate, endDate] } },
              { employeeId: { id: { _eq: employeeId } } },
              { tenant: { tenantId: { _eq: tenantId } } },
            ],
          },
          fields: [
            "id",
            "date",
            "attendance",
            "day",
            "leaveType",
            "overTime",
            "lateBy",
            "earlyDeparture",
            "attendanceContext",
          ],
          sort: ["date"],
          limit: -1,
        });

        const monthlySummary = calculateAttendanceSummaryWithCycles(
          records,
          cycles,
          cycleType
        );
        const leaveTypes = records
          .filter((record) => record.leaveType)
          .map((record) => record.leaveType);

        const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";

        monthlySummaries.push({
          month,
          monthName: getMonthName(month),
          year,
          cycleStartDate: startDate,
          cycleEndDate: endDate,
          cycleType: cycleType || "Multi Attendance Cycle",
          leaveType: leaveType,
          ...monthlySummary,
        });
      }

      return res.json({
        data: monthlySummaries,
        meta: {
          employeeId,
          tenantId,
          year,
          cycleType: cycleType || "Multi Attendance Cycle",
          totalMonths: monthlySummaries.length,
        },
      });
    } catch (error) {
      console.error("❌ Error in getYearlySummary:", error);
      throw error;
    }
  }

  async function getMonthlyDetailedAttendance(
    req,
    res,
    attendanceService,
    employeeId,
    tenantId,
    year,
    month,
    cycles,
    cycleType
  ) {
    try {
      const { startDate, endDate } = calculateDateRangeFromCycles(
        year,
        month,
        cycles,
        cycleType
      );

      let lockedMonthAttendance = false;
      if (tenantId && employeeId && month && year) {
        try {
          const payrollVerificationService = new ItemsService(
            "payrollVerification",
            {
              schema: req.schema,
              accountability: req.accountability,
            }
          );

          const payrollVerificationRecords =
            await payrollVerificationService.readByQuery({
              filter: {
                tenant: { tenantId: { _eq: tenantId } },
                startDate: { _between: [startDate, endDate] },
                employee: { id: { _eq: employeeId } },
              },
              fields: ["id", "employee", "salaryPaid", "startDate", "endDate"],
            });

          if (
            payrollVerificationRecords &&
            payrollVerificationRecords.length > 0
          ) {
            const payrollRecord = payrollVerificationRecords.find(
              (record) => record.salaryPaid === "paid"
            );

            if (payrollRecord) {
              lockedMonthAttendance = true;
              console.log(
                "💠 Found paid salary record - locking attendance:",
                payrollRecord
              );
            } else {
              const unpaidRecord = payrollVerificationRecords.find(
                (record) => record.salaryPaid === "unpaid"
              );
              if (unpaidRecord) {
                lockedMonthAttendance = false;
                console.log(
                  "💠 Found unpaid salary record - attendance unlocked:",
                  unpaidRecord
                );
              }
            }
          } else {
            console.log("💠 No payroll verification records found");
          }
        } catch (error) {
          console.error("❌ Error fetching payroll verification data:", error);
        }
      } else {
        console.log(
          "💠 Missing required parameters for payroll verification query:",
          {
            tenantId,
            employeeId,
            month,
            year,
          }
        );
      }

      const records = await attendanceService.readByQuery({
        filter: {
          _and: [
            { date: { _between: [startDate, endDate] } },
            { employeeId: { id: { _eq: employeeId } } },
            { tenant: { tenantId: { _eq: tenantId } } },
          ],
        },
        fields: [
          "id",
          "date",
          "attendance",
          "day",
          "leaveType",
          "attendanceContext",
          "employeeId.id",
          "onTime",
          "lateBy",
          "breakTime",
          "overTime",
          "earlyDeparture",
          "workHours",
          "outTime",
          "inTime",
          "action",
          "mode",
        ],
        sort: ["date"],
        limit: -1,
      });

      const allDates = getAllDatesInRange(startDate, endDate);

      const dailyAttendance = allDates.map((date) => {
        const dateStr = date.toISOString().split("T")[0];
        const record = records.find((r) => r.date === dateStr);

        if (record) {
          return {
            id: record.id,
            date: dateStr,
            attendance: record.attendance,
            day: record.day,
            leaveType: record.leaveType || "none",
            attendanceContext: record.attendanceContext,
            employeeId: record.employeeId,
            onTime: record.onTime,
            lateBy: record.lateBy,
            breakTime: record.breakTime,
            overTime: record.overTime,
            earlyDeparture: record.earlyDeparture,
            workHours: record.workHours,
            outTime: record.outTime,
            inTime: record.inTime,
            action: record.action,
            mode: record.mode,
          };
        } else {
          return {
            id: null,
            date: dateStr,
            attendance: "noRecord",
            day: null,
            leaveType: "none",
            attendanceContext: null,
            employeeId: { id: employeeId, employeeId: null },
            onTime: null,
            lateBy: null,
            breakTime: null,
            overTime: null,
            earlyDeparture: null,
            workHours: null,
            outTime: null,
            inTime: null,
            action: null,
            mode: null,
          };
        }
      });

      const monthlySummary = calculateAttendanceSummaryWithCycles(
        records,
        cycles,
        cycleType
      );

      const leaveTypes = records
        .filter((record) => record.leaveType)
        .map((record) => record.leaveType);

      const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";

      return res.json({
        data: {
          summary: {
            month,
            monthName: getMonthName(month),
            year,
            cycleStartDate: startDate,
            cycleEndDate: endDate,
            cycleType: cycleType || "Multi Attendance Cycle",
            leaveType: leaveType,
            ...monthlySummary,
          },
          dailyRecords: dailyAttendance,
        },
        meta: {
          employeeId,
          tenantId,
          year,
          month,
          cycleType: cycleType || "Multi Attendance Cycle",
          totalDays: dailyAttendance.length,
          lockedMonthAttendance,
        },
      });
    } catch (error) {
      console.error("❌ Error in getMonthlyDetailedAttendance:", error);
      throw error;
    }
  }

  function calculateDateRangeFromCycles(year, month, cycles, cycleType = null) {
    let selectedCycle = cycles[0]; // Default to first cycle

    if (cycleType) {
      const foundCycle = cycles.find((cycle) => cycle.cycleId == cycleType);
      if (foundCycle) {
        selectedCycle = foundCycle;
      } else {
        console.warn("💠 No matching cycle found for cycleType:", cycleType);
      }
    }

    let { startDate: cycleStartDay, endDate: cycleEndDay } = selectedCycle;

    cycleStartDay = parseInt(cycleStartDay);
    if (isNaN(cycleStartDay) || cycleStartDay < 1 || cycleStartDay > 31) {
      console.warn(
        "💠 Invalid cycle startDate, defaulting to 1:",
        cycleStartDay
      );
      cycleStartDay = 1;
    }

    let endDay;
    if (
      typeof cycleEndDay === "string" &&
      cycleEndDay.toLowerCase().includes("end")
    ) {
      endDay = new Date(year, month, 0).getDate();
    } else {
      endDay = parseInt(cycleEndDay);
      if (isNaN(endDay) || endDay < 1 || endDay > 31) {
        console.warn(
          "💠 Invalid cycle endDate, defaulting to last day:",
          cycleEndDay
        );
        endDay = new Date(year, month, 0).getDate();
      }
    }

    let startYear = year;
    let startMonth = month - 1;
    if (startMonth === 0) {
      startMonth = 12;
      startYear -= 1;
    }

    if (cycleStartDay === 1) {
      startMonth = month;
      startYear = year;
    }

    const startDate = new Date(startYear, startMonth - 1, cycleStartDay);
    const endDate = new Date(year, month - 1, endDay);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error("❌ Invalid date calculated:", { startDate, endDate });
      throw new Error("Invalid date values in cycle calculation");
    }

    console.log("💠 Calculated date range:", {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    });

    return {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    };
  }

  function calculateAttendanceSummaryWithCycles(
    records,
    cycles,
    cycleType = null
  ) {
    let selectedCycle = cycles[0];

    if (cycleType) {
      const foundCycle = cycles.find((cycle) => cycle.cycleId == cycleType);
      if (foundCycle) {
        selectedCycle = foundCycle;
      }
    }

    const { includeWeekends, includeHolidays } = selectedCycle;

    return calculateAttendanceSummary(
      records,
      includeWeekends,
      includeHolidays
    );
  }

  function calculateAttendanceSummary(
    records,
    includeWeekoffs,
    includeHolidays
  ) {
    const summary = {
      present: 0,
      absent: 0,
      weekOff: 0,
      holiday: 0,
      onDuty: 0,
      workFromHome: 0,
      halfDay: 0,
      paidLeave: 0,
      unPaidLeave: 0,
      holidayPresent: 0,
      weekoffPresent: 0,
      earlyLeaving: 0,
      lateComing: 0,
      workingDayOT: 0,
      weekoffPresentOT: 0,
      holidayPresentOT: 0,
      workFromHomeOT: 0,
      totalPayableDays: 0,
      totalDaysOfMonth: 0,
    };

    if (records.length > 0) {
      const firstRecord = records[0];
      if (firstRecord && firstRecord.date) {
        const date = new Date(firstRecord.date);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        summary.totalDaysOfMonth = new Date(year, month, 0).getDate();
      }
    }

    records.forEach((record) => {
      if (record.attendanceContext === "Holiday") {
        summary.holiday += 1;
        const payableDay = includeHolidays ? 1 : 0;
        summary.totalPayableDays += payableDay;
        return;
      }

      if (record.attendanceContext === "WeeklyOff") {
        summary.weekOff += 1;
        const payableDay = includeWeekoffs ? 1 : 0;
        summary.totalPayableDays += payableDay;
        return;
      }

      if (record.attendanceContext === "Unpaid Leave") {
        summary.unPaidLeave += 1;
        return;
      }

      const dayValue =
        record.day && !isNaN(record.day) ? Number.parseFloat(record.day) : 0;
      let considerableDay = dayValue;
      if (dayValue === 0.75) {
        considerableDay = 1.0;
      } else if (dayValue > 1) {
        considerableDay = 1.0;
      }

      if (record.attendanceContext) {
        const context = record.attendanceContext;

        if (
          context === "1/2Present On Leave(1/4SL)" ||
          context === "1/4SL1/2P"
        ) {
          summary.present += 0.5;
          summary.absent += 0.25;
          summary.paidLeave += 0.25;
          record.leaveType = record.leaveType || "sickLeave";
        } else if (
          context === "Present On Leave(1/4CL)" ||
          context === "1/4CLP"
        ) {
          summary.present += 1.0;
          summary.paidLeave += 0.25;
          record.leaveType = record.leaveType || "casualLeave";
        } else if (
          context === "Present On Leave(1/4PL)" ||
          context === "1/4PLP"
        ) {
          summary.present += 1.0;
          summary.paidLeave += 0.25;
          record.leaveType = record.leaveType || "privilegeLeave";
        } else if (
          context === "Present On Leave(1/4SL)" ||
          context === "1/4SLP"
        ) {
          summary.present += 1.0;
          summary.paidLeave += 0.25;
          record.leaveType = record.leaveType || "sickLeave";
        } else if (context === "1/2Present" || context === "1/2P") {
          summary.halfDay += 0.5;
          summary.absent += 0.5;
        } else if (context === "On Leave(1/2PL)" || context === "1/2PL") {
          summary.paidLeave += 0.5;
          summary.absent += 0.5;
          record.leaveType = record.leaveType || "privilegeLeave";
        } else if (
          context === "On Leave(½CL)" ||
          context === "On Leave(1/2CL)" ||
          context === "1/2CL"
        ) {
          summary.paidLeave += 0.5;
          summary.absent += 0.5;
          record.leaveType = record.leaveType || "casualLeave";
        } else if (
          context === "1/2Present On Leave(1/2CL)" ||
          context === "1/2CL1/2P"
        ) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
          record.leaveType = record.leaveType || "casualLeave";
        } else if (
          context === "1/2Present On OD On Leave(1/2CL)" ||
          context === "1/2CL1/2P(OD)"
        ) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
          record.leaveType = record.leaveType || "casualLeave";
        } else if (
          context === "Present On Leave(1/2CL)" ||
          context === "1/2CLP"
        ) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
          record.leaveType = record.leaveType || "casualLeave";
        } else if (
          context === "1/2Present On Leave(1/2PL)" ||
          context === "1/2PL1/2P"
        ) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
          record.leaveType = record.leaveType || "privilegeLeave";
        } else if (
          context === "Present On Leave(1/2PL)" ||
          context === "1/2PLP"
        ) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
          record.leaveType = record.leaveType || "privilegeLeave";
        } else if (
          context === "Present On OD On Leave(1/2PL)" ||
          context === "1/2PLP(OD)"
        ) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
          record.leaveType = record.leaveType || "privilegeLeave";
        } else if (
          context === "1/2Present On Leave(1/2SL)" ||
          context === "1/2SL1/2P"
        ) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
          record.leaveType = record.leaveType || "sickLeave";
        } else if (
          context === "Present On Leave(1/2SL)" ||
          context === "1/2SLP"
        ) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
          record.leaveType = record.leaveType || "sickLeave";
        } else if (context === "On Leave(3/4CL)" || context === "3/4CL") {
          summary.paidLeave += 0.75;
          summary.absent += 0.25;
          record.leaveType = record.leaveType || "casualLeave";
        } else if (
          context === "Present On Leave(3/4SL)" ||
          context === "3/4SLP"
        ) {
          summary.present += 1.0;
          summary.paidLeave += 0.75;
          record.leaveType = record.leaveType || "sickLeave";
        } else if (
          context === "1/2Present On Leave(CL)" ||
          context === "CL1/2P"
        ) {
          summary.present += 0.5;
          summary.paidLeave += 1.0;
          record.leaveType = record.leaveType || "casualLeave";
        } else if (
          (context === "Present On Leave(CL)" ||
            context === "CLP" ||
            context === "On Leave(CL)") &&
          !context.includes("On OD")
        ) {
          summary.paidLeave += 1.0;
          record.leaveType = record.leaveType || "casualLeave";
        } else if (
          context === "Present On OD On Leave(CL)" ||
          context === "CLP(OD)"
        ) {
          summary.paidLeave += 1.0;
          summary.onDuty += 1.0;
          record.leaveType = record.leaveType || "casualLeave";
        } else if (context === "On Leave(PL)" || context === "PL") {
          summary.paidLeave += 1.0;
          record.leaveType = record.leaveType || "privilegeLeave";
        } else if (context === "Present On Leave(PL)" || context === "PLP") {
          summary.present += 1.0;
          record.leaveType = record.leaveType || "privilegeLeave";
        } else if (context === "On Leave(SL)" || context === "SL") {
          summary.paidLeave += 1.0;
          record.leaveType = record.leaveType || "sickLeave";
        } else if (
          context === "WeeklyOff 1/2Present" ||
          context === "WOA1/2P"
        ) {
          summary.weekoffPresent += 0.5;
        } else if (context === "WeeklyOff Present" || context === "WOP") {
          summary.weekoffPresent += 1.0;
        } else if (
          context === "WeeklyOff Present On OD" ||
          context === "WOP(OD)"
        ) {
          summary.weekoffPresent += 1.0;
        } else if (context === "Present" || context === "P") {
          summary.present += 1.0;
        } else if (context === "Absent" || context === "A") {
          if (record.attendance === "unPaidLeave") {
            summary.unPaidLeave += 1.0;
          } else {
            summary.absent += 1.0;
          }
        } else if (context === "UnPaid Leave") {
          summary.unPaidLeave += 1.0;
        } else if (context === "HolidayPresent") {
          summary.holidayPresent += dayValue;
        } else if (context === "WorkFromHome" || context === "WFH") {
          summary.workFromHome += dayValue;
        } else if (context === "Present On OD" || context === "P(OD)") {
          summary.onDuty += dayValue;
        } else if (context.includes("On Leave")) {
          if (context.includes("CL") || context.includes("Casual")) {
            summary.paidLeave += dayValue;
            record.leaveType = record.leaveType || "casualLeave";
          } else if (context.includes("SL") || context.includes("Sick")) {
            summary.paidLeave += dayValue;
            record.leaveType = record.leaveType || "sickLeave";
          } else if (context.includes("PL") || context.includes("Privilege")) {
            summary.paidLeave += dayValue;
            record.leaveType = record.leaveType || "privilegeLeave";
          } else {
            summary.paidLeave += dayValue;
          }
        } else {
          console.warn(
            `💠 Unmatched attendance context: "${record.attendanceContext}"`
          );
          switch (record.attendance) {
            case "present":
              summary.present += dayValue;
              break;
            case "absent":
              summary.absent += dayValue;
              break;
            case "weekOff":
              summary.weekOff += 1;
              break;
            case "holiday":
              summary.holiday += 1;
              break;
            case "onDuty":
              summary.onDuty += dayValue;
              break;
            case "workFromHome":
              summary.workFromHome += dayValue;
              break;
            case "halfDay":
              summary.halfDay += dayValue;
              summary.present += dayValue;
              summary.absent += 1 - dayValue;
              break;
            case "paidLeave":
              summary.paidLeave += dayValue;
              break;
            case "unPaidLeave":
              summary.unPaidLeave += dayValue;
              break;
            case "holidayPresent":
              summary.holidayPresent += dayValue;
              break;
            case "weekoffPresent":
              summary.weekoffPresent += dayValue;
              break;
          }
        }

        if (record.earlyDeparture && record.earlyDeparture !== "00:00:00") {
          summary.earlyLeaving += 1;
        }
        if (record.lateBy && record.lateBy !== "00:00:00") {
          summary.lateComing += 1;
        }
        if (record.overTime && record.overTime !== "00:00:00") {
          const context = record.attendanceContext
            ? record.attendanceContext
            : "";

          if (context === "Present" || context === "P") {
            summary.workingDayOT += 1;
          } else if (
            context === "WeeklyOff Present" ||
            context === "WOP" ||
            context === "WeeklyOff Present On OD" ||
            context === "WOP(OD)"
          ) {
            summary.weekoffPresentOT += 1;
          } else if (context === "HolidayPresent") {
            summary.holidayPresentOT += 1;
          } else if (context === "WorkFromHome" || context === "WFH") {
            summary.workFromHomeOT += 1;
          } else {
            switch (record.attendance) {
              case "present":
                summary.workingDayOT += 1;
                break;
              case "weekoffPresent":
                summary.weekoffPresentOT += 1;
                break;
              case "holidayPresent":
                summary.holidayPresentOT += 1;
                break;
              case "workFromHome":
                summary.workFromHomeOT += 1;
                break;
            }
          }
        }

        if (
          record.attendanceContext !== "Holiday" &&
          record.attendanceContext !== "WeeklyOff"
        ) {
          let payableDay = 0;

          if (
            record.attendance === "present" ||
            record.attendance === "onDuty" ||
            record.attendance === "workFromHome" ||
            record.attendance === "paidLeave" ||
            record.attendance === "halfDay" ||
            record.attendance === "holidayPresent" ||
            record.attendance === "weekoffPresent"
          ) {
            payableDay = dayValue;
          }

          summary.totalPayableDays += payableDay;
        }
      }
    });

    console.log("💠 Calculated summary:", summary);
    return summary;
  }

  function getAllDatesInRange(startDateStr, endDateStr) {
    const dates = [];
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error("❌ Invalid date range inputs:", {
        startDateStr,
        endDateStr,
      });
      throw new Error("Invalid date range for getAllDatesInRange");
    }

    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  }

  function getMonthName(monthNumber) {
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return months[monthNumber - 1] || "Unknown";
  }
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
