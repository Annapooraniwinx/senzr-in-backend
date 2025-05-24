module.exports = function registerEndpoint(router, { services }) {
  const { ItemsService } = services;

  const ALL_TYPES = {
    present: 0,
    absent: 0,
    weekOff: 0,
    holiday: 0,
    onDuty: 0,
    workFromHome: 0,
    halfDay: 0,
    paidLeave: 0,
    unpaidLeave: 0,
    holidayPresent: 0,
    weekoffPresent: 0,
    earlyLeaving: 0,
    lateComing: 0,
    workingDayOT: 0,
    weekOffOT: 0,
    holidayOT: 0,
    workFromHomeOT: 0,
    totalPayableDays: 0,
  };

  router.get("/", async (req, res) => {
    console.log("Request received:", req.url);
    const filter = req.query.filter || {};
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 500;
    const offset = (page - 1) * limit;

    try {
      console.log("Processing request with filter:", JSON.stringify(filter));

      const betweenDates = filter._and?.[0]?.date?._between;
      const employeeIdFilter = filter._and?.[1]?.employeeId;
      const tenantIdFilter = filter._and?.[2]?.tenant?.tenantId?._eq;

      console.log("Extracted filters:", {
        betweenDates,
        employeeIdFilter,
        tenantIdFilter,
      });

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

      console.log("Parsed employee IDs:", employeeIds);

      if (!employeeIds.length) {
        console.log("No employee IDs found");
        return res.status(400).json({ error: "Employee IDs required" });
      }
      let totalEmployees = employeeIds.length;
      console.log("Using total employees count:", totalEmployees);

      const paginatedEmployeeIds = employeeIds.slice(offset, offset + limit);
      console.log("Paginated employee IDs:", paginatedEmployeeIds);

      try {
        console.log("Creating attendance cycle service");
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
          ],
          limit: -1,
        });

        console.log(`Found ${records.length} attendance records`);

        const result = {};
        paginatedEmployeeIds.forEach((empId) => {
          result[empId] = { employeeId: empId, ...structuredClone(ALL_TYPES) };
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

          if (record.earlyDeparture && record.earlyDeparture !== "00:00:00") {
            empData.earlyLeaving += 1;
          }
          if (record.lateBy && record.lateBy !== "00:00:00") {
            empData.lateComing += 1;
          }
          if (record.overTime && record.overTime !== "00:00:00") {
            switch (record.attendance) {
              case "present":
                empData.workingDayOT += 1;
                break;
              case "weekOff":
              case "weekoffPresent":
                empData.weekOffOT += 1;
                break;
              case "holiday":
              case "holidayPresent":
                empData.holidayOT += 1;
                break;
              case "workFromHome":
                empData.workFromHomeOT += 1;
                break;
            }
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
