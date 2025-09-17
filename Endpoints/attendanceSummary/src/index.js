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

  router.get("/", async (req, res) => {
    const filter = req.query.filter || {};
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 500;
    const offset = (page - 1) * limit;

    try {
      const betweenDates = filter._and?.[0]?.date?._between;
      const employeeIdFilter = filter._and?.[1]?.employeeId;
      const tenantIdFilter = filter._and?.[2]?.tenant?.tenantId?._eq;

      if (!betweenDates || betweenDates.length !== 2) {
        console.log("Invalid date range:", betweenDates);
        return res.status(400).json({ error: "Invalid date range" });
      }

      if (!tenantIdFilter) {
        console.log("Missing tenant ID");
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

        console.log("Querying cycle settings for tenant:", tenantIdFilter);
        const cycleSettings = await attendanceCycleService.readByQuery({
          filter: { tenant: { tenantId: { _eq: tenantIdFilter } } },
          fields: ["includeWeekoffs", "includeHolidays"],
          limit: 1,
        });

        console.log("Cycle settings query result:", cycleSettings);

        if (!cycleSettings?.length) {
          console.log("No cycle settings found for tenant:", tenantIdFilter);
          return res.status(400).json({ error: "No cycle settings found" });
        }

        const { includeWeekoffs, includeHolidays } = cycleSettings[0];
        console.log("Cycle settings:", { includeWeekoffs, includeHolidays });

        console.log("Creating attendance service");
        const attendanceService = new ItemsService("attendance", {
          schema: req.schema,
          accountability: req.accountability,
        });

        console.log("Querying attendance records with filter:", {
          date: { _between: betweenDates },
          employeeId: { _in: paginatedEmployeeIds },
          tenant: { tenantId: { _eq: tenantIdFilter } },
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
          filter: {
            id: { _in: paginatedEmployeeIds },
          },
          fields: [
            "id",
            "employeeId",
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

        console.log(`Found ${records.length} attendance records`);

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

        console.log("Processing attendance records");
        records.forEach((record) => {
          const empData = result[record.employeeId];
          if (!empData) {
            console.log(`No employee data found for: ${record.employeeId}`);
            return;
          }

          if (record.attendance && empData.hasOwnProperty(record.attendance)) {
            empData[record.attendance] += 1;
          }

          let payableDay =
            record.day && !isNaN(record.day) ? parseFloat(record.day) : 0;

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

              empData.lateData = { leave: leaveType, lateBy: record.lateBy };

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
                lateBy: record.lateBy,
                leave: empData.totalLateDuration,
              };
            }
          }

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
              empData.weekOff += 1;
              break;
            case "weekoffPresent":
              empData.weekOffOT += 1;
              empData.totalPayableDays += 1;
              empData.weekOffOTHours = addTime(
                empData.weekOffOTHours || "00:00:00",
                fullDayTime
              );
              break;
            case "holiday":
              empData.holiday += 1;
              break;
            case "holidayPresent":
              empData.holidayOT += 1;
              empData.totalPayableDays += 1;
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
        console.log(
          `Returning ${resultArray.length} employee attendance summaries`
        );

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
        console.error("Error in service operations:", serviceError);
        console.error("Error stack:", serviceError.stack);
        return res.status(500).json({
          error: "Service error",
          message: serviceError.message,
        });
      }
    } catch (err) {
      console.error("Error details:", err);
      console.error("Error stack:", err.stack);
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
