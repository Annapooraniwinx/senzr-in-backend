module.exports = function registerEndpoint(router, { services }) {
  const { ItemsService } = services;

  // Attendance dashboard
  router.get("/monthly-dashboard", async (req, res) => {
    try {
      console.log("🚀 Starting /monthly-dashboard route");

      // Filter parsing
      let filter = {};
      console.log("🔍 Parsing filter...");
      if (req.query.filter) {
        if (typeof req.query.filter === "string") {
          try {
            filter = JSON.parse(req.query.filter);
            console.log(
              "✅ Filter parsed from string:",
              JSON.stringify(filter)
            );
          } catch (e) {
            console.error("❌ Failed to parse filter JSON", e);
          }
        } else if (typeof req.query.filter === "object") {
          filter = req.query.filter;
          console.log("✅ Filter received as object:", JSON.stringify(filter));
        }
      }

      // Tenant ID extraction
      let tenantId = req.query.tenantId;
      console.log("🔍 Extracting tenantId...");
      if (!tenantId) {
        const filterAnd = filter._and || [];
        tenantId = filterAnd.find((f) => f.tenant)?.tenant?.tenantId?._eq;
        console.log("🔍 TenantId from filter:", tenantId);
      }
      console.log("✅ Final tenantId:", tenantId);

      // Year extraction
      let year = req.query.year ? parseInt(req.query.year) : null;
      console.log("🔍 Extracting year...");
      if (!year) {
        const filterAnd = filter._and || [];
        year = filterAnd.find((f) => f["year(date)"])?.["year(date)"]?._eq;
        console.log("🔍 Year from filter:", year);
      }
      console.log("✅ Final year:", year);

      // Month extraction
      let month = req.query.month ? parseInt(req.query.month) : null;
      console.log("🔍 Extracting month...");
      if (!month) {
        const filterAnd = filter._and || [];
        month = filterAnd.find((f) => f["month(date)"])?.["month(date)"]?._eq;
        console.log("🔍 Month from filter:", month);
      }
      console.log("✅ Final month:", month);

      // Start date extraction
      let startDate = req.query.startDate;
      console.log("🔍 Extracting startDate...");
      if (!startDate) {
        const filterAnd = filter._and || [];
        startDate = filterAnd.find((f) => f.date?._gte)?.date?._gte;
        console.log("🔍 StartDate from filter:", startDate);
      }
      console.log("✅ Final startDate:", startDate);

      // End date extraction
      let endDate = req.query.endDate;
      console.log("🔍 Extracting endDate...");
      if (!endDate) {
        const filterAnd = filter._and || [];
        endDate = filterAnd.find((f) => f.date?._lte)?.date?._lte;
        console.log("🔍 EndDate from filter:", endDate);
      }
      console.log("✅ Final endDate:", endDate);

      // Employee IDs extraction
      let employeeIds = [];
      console.log("🔍 Extracting employeeIds...");
      if (req.query.employeeId) {
        employeeIds = req.query.employeeId.split(",").map((id) => id.trim());
        console.log("🔍 EmployeeIds from query:", employeeIds);
      } else {
        const filterAnd = filter._and || [];
        const employeeFilter = filterAnd.find((f) => f.employeeId);
        if (employeeFilter?.employeeId?.id?._in) {
          employeeIds = employeeFilter.employeeId.id._in
            .split(",")
            .map((id) => id.trim());
          console.log("🔍 EmployeeIds from filter _in:", employeeIds);
        } else if (employeeFilter?.employeeId?.id?._eq) {
          employeeIds = [employeeFilter.employeeId.id._eq];
          console.log("🔍 EmployeeIds from filter _eq:", employeeIds);
        }
      }
      console.log("✅ Final employeeIds:", employeeIds);

      // Other query parameters
      const organizationId = req.query.organizationId;
      const branchLocationId = req.query.branchLocationId;
      const departmentId = req.query.departmentId;
      const cycleTypeFilter = req.query.cycleTypeFilter;
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

      // Validate tenantId
      console.log("🔍 Validating tenantId...");
      if (!tenantId) {
        console.log("❌ tenantId missing, returning error");
        return res.status(400).json({
          error: "Missing required parameter",
          message: "tenantId is required",
        });
      }
      console.log("✅ tenantId validated");

      // Initialize services
      console.log("🔍 Initializing services...");
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
      console.log("✅ Services initialized");

      // Fetch cycle settings
      console.log("🔍 Fetching cycle settings...");
      const cycleSettings = await attendanceCycleService.readByQuery({
        filter: { tenant: { tenantId: { _eq: tenantId } } },
        fields: ["multi_attendance_cycle"],
        limit: 1,
      });
      console.log(
        "✅ Cycle settings fetched:",
        JSON.stringify(cycleSettings, null, 2)
      );

      const cycles = cycleSettings[0]?.multi_attendance_cycle?.cycles || [];
      console.log("💠 Fetched cycles:", JSON.stringify(cycles, null, 2));

      // Handle no cycles case
      console.log("🔍 Checking cycles...");
      if (!cycles.length) {
        console.warn("💠 No cycles found, using default cycle");
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        console.log(
          "🔍 Calling getCurrentMonthAllEmployees with default cycle..."
        );
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
      console.log("✅ Cycles found, proceeding...");

      let isSingleEmployee = employeeIds.length === 1;
      let employeeId = isSingleEmployee ? employeeIds[0] : null;
      console.log(
        "🔍 Employee check: isSingleEmployee =",
        isSingleEmployee,
        "employeeId =",
        employeeId
      );

      if (employeeIds.length === 0) {
        console.log("🔍 No employeeIds, handling all employees...");
        if (startDate && endDate) {
          console.log("🔍 Calling getDateRangeAllEmployees...");
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
          console.log("🔍 Calling getCurrentMonthAllEmployees...");
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
        console.log("🔍 Handling single employee...");
        // Fetch employee's cycleType
        let employeeCycleType = cycleTypeFilter;
        console.log("🔍 Fetching employee cycleType...");
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
          console.log(
            "✅ Employee data fetched:",
            JSON.stringify(employeeData, null, 2)
          );
          employeeCycleType = employeeData[0]?.cycleType;
          console.log("💠 Fetched employee cycleType:", employeeCycleType);
          if (!employeeCycleType) {
            console.warn("❌ No cycleType found for employeeId:", employeeId);
            return res.status(400).json({
              error: "Invalid employee data",
              message: "No cycleType found for the specified employee",
            });
          }
        }

        if (year && month) {
          console.log("🔍 Calling getMonthlyDetailedAttendance...");
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
          console.log("🔍 Calling getYearlySummary...");
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
          console.log("🔍 Calling getDateRangeDetailedForEmployee...");
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
          console.log("🔍 Defaulting to current month for single employee...");
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
          console.log(
            "🔍 Calculated date range: start =",
            calcStart,
            "end =",
            calcEnd
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
        console.log("🔍 Handling multiple employees...");
        if (year && month) {
          console.log("🔍 Calculating date range for multiple employees...");
          const { startDate: calcStart, endDate: calcEnd } =
            calculateDateRangeFromCycles(
              Number.parseInt(year),
              Number.parseInt(month),
              cycles,
              cycleTypeFilter
            );
          console.log(
            "🔍 Calculated date range: start =",
            calcStart,
            "end =",
            calcEnd
          );
          console.log("🔍 Calling getDateRangeAllEmployees...");
          return await getDateRangeAllEmployees(
            req,
            res,
            attendanceService,
            personalModuleService,
            tenantId,
            calcStart,
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
        } else if (year) {
          console.log("❌ Yearly summary not supported for multiple employees");
          return res.status(400).json({
            error: "Unsupported",
            message: "Yearly summary only supported for single employee",
          });
        } else if (startDate && endDate) {
          console.log("🔍 Calling getDateRangeAllEmployees...");
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
          console.log(
            "🔍 Calling getCurrentMonthAllEmployees for multiple employees..."
          );
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
      console.log("🚀 Entered getCurrentMonthAllEmployees");
      console.log("🔍 Input parameters:", {
        tenantId,
        organizationId,
        branchLocationId,
        departmentId,
        cycleTypeFilter,
        searchTerm,
        page,
        limit,
        offset,
        cyclesLength: cycles.length,
        employeeIds,
      });

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      console.log("🔍 Current date info:", { currentYear, currentMonth });

      // Parse cycleTypeFilter if it's in JSON format
      let cycleTypeValue = cycleTypeFilter;
      console.log("🔍 Parsing cycleTypeFilter...");
      if (typeof cycleTypeFilter === "string") {
        try {
          const parsedFilter = JSON.parse(cycleTypeFilter);
          if (parsedFilter.cycleType && parsedFilter.cycleType._contains) {
            cycleTypeValue = parsedFilter.cycleType._contains;
            console.log("✅ Parsed cycleTypeValue from JSON:", cycleTypeValue);
          }
        } catch (e) {
          console.warn(
            "💠 Failed to parse cycleTypeFilter JSON, using raw value:",
            cycleTypeFilter
          );
        }
      }
      console.log("✅ Final cycleTypeValue:", cycleTypeValue);

      // Find the matching cycle from multi_attendance_cycle
      console.log("🔍 Finding matching cycle...");
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
      console.log("✅ Selected cycle:", selectedCycle);

      console.log("🔍 Calculating date range...");
      const { startDate, endDate } = calculateDateRangeFromCycles(
        currentYear,
        currentMonth,
        [selectedCycle],
        cycleTypeValue
      );
      console.log("💠 Calculated date range:", { startDate, endDate });

      // Build personalModuleFilter
      console.log("🔍 Building personalModuleFilter...");
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
        console.log("🔍 Added organizationId filter:", organizationId);
      }

      if (branchLocationId) {
        personalModuleFilter._and.push({
          branchLocation: { id: { _eq: branchLocationId } },
        });
        console.log("🔍 Added branchLocationId filter:", branchLocationId);
      }

      if (departmentId) {
        personalModuleFilter._and.push({
          department: { id: { _eq: departmentId } },
        });
        console.log("🔍 Added departmentId filter:", departmentId);
      }

      if (cycleTypeValue) {
        personalModuleFilter._and.push({
          cycleType: { _eq: cycleTypeValue },
        });
        console.log("🔍 Added cycleType filter:", cycleTypeValue);
      } else {
        personalModuleFilter._and.push({
          cycleType: { _nnull: true },
        });
        console.log("🔍 Added cycleType _nnull filter");
      }

      if (searchTerm) {
        personalModuleFilter._and.push({
          _or: [
            { employeeId: { _icontains: searchTerm } },
            { assignedUser: { first_name: { _icontains: searchTerm } } },
            { assignedUser: { last_name: { _icontains: searchTerm } } },
          ],
        });
        console.log("🔍 Added searchTerm filter:", searchTerm);
      }

      if (employeeIds) {
        personalModuleFilter._and.push({
          id: { _in: employeeIds },
        });
        console.log("🔍 Added employeeIds filter:", employeeIds);
      }

      console.log(
        "🔍 Final personalModuleFilter:",
        JSON.stringify(personalModuleFilter, null, 2)
      );

      // Fetch total employees
      console.log("🔍 Fetching totalEmployeesResult...");
      const totalEmployeesResult = await personalModuleService.readByQuery({
        filter: personalModuleFilter,
        fields: ["id"],
        limit: -1,
      });
      console.log(
        "✅ totalEmployeesResult fetched, length:",
        totalEmployeesResult.length
      );

      const totalEmployees = totalEmployeesResult.length;
      console.log("✅ totalEmployees:", totalEmployees);

      // Fetch paginated employees
      console.log("🔍 Fetching paginatedEmployees...");
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
      console.log(
        "✅ paginatedEmployees fetched, length:",
        paginatedEmployees.length
      );
      console.log(
        "🔍 paginatedEmployees data:",
        JSON.stringify(paginatedEmployees, null, 2)
      );

      const employeeIdsFetched = paginatedEmployees.map((emp) => emp.id);
      console.log("✅ employeeIdsFetched:", employeeIdsFetched);

      if (employeeIdsFetched.length === 0) {
        console.log("🔍 No employees fetched, returning empty response");
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

      // Fetch attendance records
      console.log("🔍 Fetching attendance records...");
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
      console.log("✅ Attendance records fetched, length:", records.length);
      console.log(
        "🔍 Attendance records data:",
        JSON.stringify(records, null, 2)
      );

      console.log("🔍 Building employeeDetailsMap...");
      const employeeDetailsMap = {};
      paginatedEmployees.forEach((emp, index) => {
        console.log(
          `🔍 Processing employee ${index + 1}/${paginatedEmployees.length}:`,
          emp.id
        );
        employeeDetailsMap[emp.id] = {
          employeeId: emp.employeeId,
          firstName: emp.assignedUser?.first_name || "Unknown",
          department: emp.department?.departmentName || "Finance",
          userId: emp?.assignedUser?.id,
          reportingManager: emp?.reportingManager,
          cycleType: emp?.cycleType,
        };
      });
      console.log(
        "✅ employeeDetailsMap created:",
        Object.keys(employeeDetailsMap).length,
        "entries"
      );

      console.log("🔍 Building employeeRecords...");
      const employeeRecords = {};
      records.forEach((record, index) => {
        const empId = record.employeeId?.id;
        if (!empId) {
          console.warn("💠 Skipping record with missing empId:", record);
          return;
        }
        console.log(
          `🔍 Processing record ${index + 1}/${records.length} for empId:`,
          empId
        );
        if (!employeeRecords[empId]) {
          employeeRecords[empId] = [];
        }
        employeeRecords[empId].push(record);
      });
      console.log(
        "✅ employeeRecords created:",
        Object.keys(employeeRecords).length,
        "employees"
      );

      console.log("🔍 Generating employeeSummaries...");
      const employeeSummaries = [];
      for (const empId of employeeIdsFetched) {
        console.log("🔍 Processing summary for empId:", empId);
        const empDetails = employeeDetailsMap[empId];
        if (!empDetails) {
          console.warn("💠 Skipping empId with no details:", empId);
          continue;
        }

        const empRecords = employeeRecords[empId] || [];
        console.log("🔍 Calculating attendance summary for empId:", empId);
        const summary = calculateAttendanceSummaryWithCycles(
          empRecords,
          cycles,
          empDetails.cycleType
        );
        console.log("✅ Summary calculated for empId:", empId, summary);

        const leaveTypes = empRecords
          .filter((record) => record.leaveType)
          .map((record) => record.leaveType);
        const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";
        console.log("🔍 LeaveType for empId:", empId, leaveType);

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
        console.log("✅ Added to employeeSummaries for empId:", empId);
      }
      console.log(
        "✅ employeeSummaries created, length:",
        employeeSummaries.length
      );

      console.log("🔍 Preparing final response...");
      const response = {
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
      };
      console.log(
        "✅ Final response prepared:",
        JSON.stringify(response.meta, null, 2)
      );
      return res.json(response);
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
      console.log("🚀 Entered getDateRangeAllEmployees");
      console.log("🔍 Input parameters:", {
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
        cyclesLength: cycles.length,
        employeeIds,
      });

      // Parse cycleTypeFilter if it's in JSON format
      let cycleTypeValue = cycleTypeFilter;
      console.log("🔍 Parsing cycleTypeFilter...");
      if (typeof cycleTypeFilter === "string") {
        try {
          const parsedFilter = JSON.parse(cycleTypeFilter);
          if (parsedFilter.cycleType && parsedFilter.cycleType._contains) {
            cycleTypeValue = parsedFilter.cycleType._contains;
            console.log("✅ Parsed cycleTypeValue from JSON:", cycleTypeValue);
          }
        } catch (e) {
          console.warn(
            "💠 Failed to parse cycleTypeFilter JSON, using raw value:",
            cycleTypeFilter
          );
        }
      }
      console.log("✅ Final cycleTypeValue:", cycleTypeValue);

      // Build personalModuleFilter
      console.log("🔍 Building personalModuleFilter...");
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
        console.log("🔍 Added organizationId filter:", organizationId);
      }

      if (branchLocationId) {
        personalModuleFilter._and.push({
          branchLocation: { id: { _eq: branchLocationId } },
        });
        console.log("🔍 Added branchLocationId filter:", branchLocationId);
      }

      if (departmentId) {
        personalModuleFilter._and.push({
          department: { id: { _eq: departmentId } },
        });
        console.log("🔍 Added departmentId filter:", departmentId);
      }

      if (cycleTypeValue) {
        personalModuleFilter._and.push({
          cycleType: { _eq: cycleTypeValue },
        });
        console.log("🔍 Added cycleType filter:", cycleTypeValue);
      } else {
        personalModuleFilter._and.push({
          cycleType: { _nnull: true },
        });
        console.log("🔍 Added cycleType _nnull filter");
      }

      if (searchTerm) {
        personalModuleFilter._and.push({
          _or: [
            { employeeId: { _icontains: searchTerm } },
            { assignedUser: { first_name: { _icontains: searchTerm } } },
            { assignedUser: { last_name: { _icontains: searchTerm } } },
          ],
        });
        console.log("🔍 Added searchTerm filter:", searchTerm);
      }

      if (employeeIds) {
        personalModuleFilter._and.push({
          id: { _in: employeeIds },
        });
        console.log("🔍 Added employeeIds filter:", employeeIds);
      }

      console.log(
        "🔍 Final personalModuleFilter:",
        JSON.stringify(personalModuleFilter, null, 2)
      );

      // Fetch total employees
      console.log("🔍 Fetching totalEmployeesResult...");
      const totalEmployeesResult = await personalModuleService.readByQuery({
        filter: personalModuleFilter,
        fields: ["id"],
        limit: -1,
      });
      console.log(
        "✅ totalEmployeesResult fetched, length:",
        totalEmployeesResult.length
      );

      const totalEmployees = totalEmployeesResult.length;
      console.log("✅ totalEmployees:", totalEmployees);

      // Fetch paginated employees
      console.log("🔍 Fetching paginatedEmployees...");
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
      console.log(
        "✅ paginatedEmployees fetched, length:",
        paginatedEmployees.length
      );
      console.log(
        "🔍 paginatedEmployees data:",
        JSON.stringify(paginatedEmployees, null, 2)
      );

      const employeeIdsFetched = paginatedEmployees.map((emp) => emp.id);
      console.log("✅ employeeIdsFetched:", employeeIdsFetched);

      if (employeeIdsFetched.length === 0) {
        console.log("🔍 No employees fetched, returning empty response");
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

      // Fetch attendance records
      console.log("🔍 Fetching attendance records...");
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
      console.log("✅ Attendance records fetched, length:", records.length);
      console.log(
        "🔍 Attendance records data:",
        JSON.stringify(records, null, 2)
      );

      console.log("🔍 Building employeeDetailsMap...");
      const employeeDetailsMap = {};
      paginatedEmployees.forEach((emp, index) => {
        console.log(
          `🔍 Processing employee ${index + 1}/${paginatedEmployees.length}:`,
          emp.id
        );
        employeeDetailsMap[emp.id] = {
          employeeId: emp.employeeId,
          firstName: emp.assignedUser?.first_name || "Unknown",
          department: emp.department?.departmentName || "Finance",
          cycleType: emp?.cycleType,
        };
      });
      console.log(
        "✅ employeeDetailsMap created:",
        Object.keys(employeeDetailsMap).length,
        "entries"
      );

      console.log("🔍 Building employeeRecords...");
      const employeeRecords = {};
      records.forEach((record, index) => {
        const empId = record.employeeId?.id;
        if (!empId) {
          console.warn("💠 Skipping record with missing empId:", record);
          return;
        }
        console.log(
          `🔍 Processing record ${index + 1}/${records.length} for empId:`,
          empId
        );
        if (!employeeRecords[empId]) {
          employeeRecords[empId] = [];
        }
        employeeRecords[empId].push(record);
      });
      console.log(
        "✅ employeeRecords created:",
        Object.keys(employeeRecords).length,
        "employees"
      );

      console.log("🔍 Generating employeeSummaries...");
      const employeeSummaries = [];
      for (const empId of employeeIdsFetched) {
        console.log("🔍 Processing summary for empId:", empId);
        const empDetails = employeeDetailsMap[empId];
        if (!empDetails) {
          console.warn("💠 Skipping empId with no details:", empId);
          continue;
        }

        const empRecords = employeeRecords[empId] || [];
        console.log("🔍 Calculating attendance summary for empId:", empId);
        const summary = calculateAttendanceSummaryWithCycles(
          empRecords,
          cycles,
          empDetails.cycleType
        );
        console.log("✅ Summary calculated for empId:", empId, summary);

        const leaveTypes = empRecords
          .filter((record) => record.leaveType)
          .map((record) => record.leaveType);
        const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";
        console.log("🔍 LeaveType for empId:", empId, leaveType);

        employeeSummaries.push({
          employeeId: empId,
          employeeCode: empDetails.employeeId,
          firstName: empDetails.firstName,
          department: empDetails.department,
          cycleType: empDetails.cycleType,
          leaveType: leaveType,
          ...summary,
        });
        console.log("✅ Added to employeeSummaries for empId:", empId);
      }
      console.log(
        "✅ employeeSummaries created, length:",
        employeeSummaries.length
      );

      console.log("🔍 Preparing final response...");
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      const response = {
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
      };
      console.log(
        "✅ Final response prepared:",
        JSON.stringify(response.meta, null, 2)
      );
      return res.json(response);
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
      console.log("🚀 Entered getDateRangeDetailedForEmployee");
      console.log("🔍 Input parameters:", {
        employeeId,
        tenantId,
        startDate,
        endDate,
        cycleType,
        cyclesLength: cycles.length,
      });

      let lockedMonthAttendance = false;
      console.log("🔍 Checking payroll verification...");
      if (tenantId && employeeId) {
        try {
          console.log("🔍 Initializing payrollVerificationService...");
          const payrollVerificationService = new ItemsService(
            "payrollVerification",
            {
              schema: req.schema,
              accountability: req.accountability,
            }
          );
          console.log("✅ payrollVerificationService initialized");

          console.log("🔍 Fetching payroll verification records...");
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
          console.log(
            "✅ Payroll verification records fetched, length:",
            payrollVerificationRecords.length
          );
          console.log(
            "🔍 Payroll records:",
            JSON.stringify(payrollVerificationRecords, null, 2)
          );

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
          { tenantId, employeeId }
        );
      }

      console.log("🔍 Fetching attendance records...");
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
      console.log("✅ Attendance records fetched, length:", records.length);
      console.log(
        "🔍 Attendance records data:",
        JSON.stringify(records, null, 2)
      );

      console.log("🔍 Generating all dates in range...");
      const allDates = getAllDatesInRange(startDate, endDate);
      console.log("✅ All dates generated, length:", allDates.length);

      console.log("🔍 Building dailyAttendance...");
      const dailyAttendance = allDates.map((date, index) => {
        const dateStr = date.toISOString().split("T")[0];
        console.log(
          `🔍 Processing date ${index + 1}/${allDates.length}:`,
          dateStr
        );
        const record = records.find((r) => r.date === dateStr);

        if (record) {
          console.log("🔍 Found record for date:", dateStr);
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
          console.log("🔍 No record found for date:", dateStr);
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
      console.log(
        "✅ dailyAttendance created, length:",
        dailyAttendance.length
      );

      console.log("🔍 Calculating monthly summary...");
      const monthlySummary = calculateAttendanceSummaryWithCycles(
        records,
        cycles,
        cycleType
      );
      console.log("✅ Monthly summary calculated:", monthlySummary);

      const leaveTypes = records
        .filter((record) => record.leaveType)
        .map((record) => record.leaveType);
      const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";
      console.log("🔍 LeaveType:", leaveType);

      console.log("🔍 Preparing final response...");
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      const response = {
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
      };
      console.log(
        "✅ Final response prepared:",
        JSON.stringify(response.meta, null, 2)
      );
      return res.json(response);
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
      console.log("🚀 Entered getYearlySummary");
      console.log("🔍 Input parameters:", {
        employeeId,
        tenantId,
        year,
        cycleType,
        cyclesLength: cycles.length,
      });

      console.log("🔍 Initializing monthlySummaries...");
      const monthlySummaries = [];

      for (let month = 1; month <= 12; month++) {
        console.log(`🔍 Processing month ${month}/12...`);
        const { startDate, endDate } = calculateDateRangeFromCycles(
          year,
          month,
          cycles,
          cycleType
        );
        console.log("🔍 Date range for month:", { month, startDate, endDate });

        console.log("🔍 Fetching attendance records for month:", month);
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
        console.log(
          `✅ Attendance records fetched for month ${month}, length:`,
          records.length
        );
        console.log(
          "🔍 Attendance records data:",
          JSON.stringify(records, null, 2)
        );

        console.log(`🔍 Calculating summary for month ${month}...`);
        const monthlySummary = calculateAttendanceSummaryWithCycles(
          records,
          cycles,
          cycleType
        );
        console.log(
          `✅ Monthly summary calculated for month ${month}:`,
          monthlySummary
        );

        const leaveTypes = records
          .filter((record) => record.leaveType)
          .map((record) => record.leaveType);
        const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";
        console.log(`🔍 LeaveType for month ${month}:`, leaveType);

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
        console.log(`✅ Added summary for month ${month} to monthlySummaries`);
      }
      console.log(
        "✅ monthlySummaries created, length:",
        monthlySummaries.length
      );

      console.log("🔍 Preparing final response...");
      const response = {
        data: monthlySummaries,
        meta: {
          employeeId,
          tenantId,
          year,
          cycleType: cycleType || "Multi Attendance Cycle",
          totalMonths: monthlySummaries.length,
        },
      };
      console.log(
        "✅ Final response prepared:",
        JSON.stringify(response.meta, null, 2)
      );
      return res.json(response);
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
      console.log("🚀 Entered getMonthlyDetailedAttendance");
      console.log("🔍 Input parameters:", {
        employeeId,
        tenantId,
        year,
        month,
        cycleType,
        cyclesLength: cycles.length,
      });

      console.log("🔍 Calculating date range...");
      const { startDate, endDate } = calculateDateRangeFromCycles(
        year,
        month,
        cycles,
        cycleType
      );
      console.log("✅ Date range calculated:", { startDate, endDate });

      let lockedMonthAttendance = false;
      console.log("🔍 Checking payroll verification...");
      if (tenantId && employeeId && month && year) {
        try {
          console.log("🔍 Initializing payrollVerificationService...");
          const payrollVerificationService = new ItemsService(
            "payrollVerification",
            {
              schema: req.schema,
              accountability: req.accountability,
            }
          );
          console.log("✅ payrollVerificationService initialized");

          console.log("🔍 Fetching payroll verification records...");
          const payrollVerificationRecords =
            await payrollVerificationService.readByQuery({
              filter: {
                tenant: { tenantId: { _eq: tenantId } },
                startDate: { _between: [startDate, endDate] },
                employee: { id: { _eq: employeeId } },
              },
              fields: ["id", "employee", "salaryPaid", "startDate", "endDate"],
            });
          console.log(
            "✅ Payroll verification records fetched, length:",
            payrollVerificationRecords.length
          );
          console.log(
            "🔍 Payroll records:",
            JSON.stringify(payrollVerificationRecords, null, 2)
          );

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
          { tenantId, employeeId, month, year }
        );
      }

      console.log("🔍 Fetching attendance records...");
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
      console.log("✅ Attendance records fetched, length:", records.length);
      console.log(
        "🔍 Attendance records data:",
        JSON.stringify(records, null, 2)
      );

      console.log("🔍 Generating all dates in range...");
      const allDates = getAllDatesInRange(startDate, endDate);
      console.log("✅ All dates generated, length:", allDates.length);

      console.log("🔍 Building dailyAttendance...");
      const dailyAttendance = allDates.map((date, index) => {
        const dateStr = date.toISOString().split("T")[0];
        console.log(
          `🔍 Processing date ${index + 1}/${allDates.length}:`,
          dateStr
        );
        const record = records.find((r) => r.date === dateStr);

        if (record) {
          console.log("🔍 Found record for date:", dateStr);
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
          console.log("🔍 No record found for date:", dateStr);
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
      console.log(
        "✅ dailyAttendance created, length:",
        dailyAttendance.length
      );

      console.log("🔍 Calculating monthly summary...");
      const monthlySummary = calculateAttendanceSummaryWithCycles(
        records,
        cycles,
        cycleType
      );
      console.log("✅ Monthly summary calculated:", monthlySummary);

      const leaveTypes = records
        .filter((record) => record.leaveType)
        .map((record) => record.leaveType);
      const leaveType = leaveTypes.length > 0 ? leaveTypes[0] : "none";
      console.log("🔍 LeaveType:", leaveType);

      console.log("🔍 Preparing final response...");
      const response = {
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
      };
      console.log(
        "✅ Final response prepared:",
        JSON.stringify(response.meta, null, 2)
      );
      return res.json(response);
    } catch (error) {
      console.error("❌ Error in getMonthlyDetailedAttendance:", error);
      throw error;
    }
  }

  function calculateDateRangeFromCycles(year, month, cycles, cycleType = null) {
    console.log("🚀 Entered calculateDateRangeFromCycles");
    console.log("🔍 Input parameters:", {
      year,
      month,
      cycleType,
      cyclesLength: cycles.length,
    });

    let selectedCycle = cycles[0]; // Default to first cycle
    console.log("🔍 Defaulting to first cycle:", selectedCycle);

    if (cycleType) {
      console.log("🔍 Searching for cycle matching cycleType:", cycleType);
      const foundCycle = cycles.find((cycle) => cycle.cycleId == cycleType);
      if (foundCycle) {
        selectedCycle = foundCycle;
        console.log("✅ Found matching cycle:", selectedCycle);
      } else {
        console.warn("💠 No matching cycle found for cycleType:", cycleType);
      }
    }

    let { startDate: cycleStartDay, endDate: cycleEndDay } = selectedCycle;
    console.log("🔍 Cycle dates:", { cycleStartDay, cycleEndDay });

    cycleStartDay = parseInt(cycleStartDay);
    if (isNaN(cycleStartDay) || cycleStartDay < 1 || cycleStartDay > 31) {
      console.warn(
        "💠 Invalid cycle startDate, defaulting to 1:",
        cycleStartDay
      );
      cycleStartDay = 1;
    }
    console.log("✅ Parsed cycleStartDay:", cycleStartDay);

    let endDay;
    if (
      typeof cycleEndDay === "string" &&
      cycleEndDay.toLowerCase().includes("end")
    ) {
      endDay = new Date(year, month, 0).getDate();
      console.log("🔍 Using end of month for endDay:", endDay);
    } else {
      endDay = parseInt(cycleEndDay);
      if (isNaN(endDay) || endDay < 1 || endDay > 31) {
        console.warn(
          "💠 Invalid cycle endDate, defaulting to last day:",
          cycleEndDay
        );
        endDay = new Date(year, month, 0).getDate();
      }
      console.log("✅ Parsed endDay:", endDay);
    }

    let startYear = year;
    let startMonth = month - 1;
    if (startMonth === 0) {
      startMonth = 12;
      startYear -= 1;
      console.log("🔍 Adjusted start date to previous year:", {
        startYear,
        startMonth,
      });
    }

    if (cycleStartDay === 1) {
      startMonth = month;
      startYear = year;
      console.log("🔍 Using same month for start date:", {
        startYear,
        startMonth,
      });
    }

    const startDate = new Date(startYear, startMonth - 1, cycleStartDay);
    const endDate = new Date(year, month - 1, endDay);
    console.log("🔍 Calculated dates:", { startDate, endDate });

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error("❌ Invalid date calculated:", { startDate, endDate });
      throw new Error("Invalid date values in cycle calculation");
    }

    const result = {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    };
    console.log("💠 Calculated date range:", result);
    return result;
  }

  function calculateAttendanceSummaryWithCycles(
    records,
    cycles,
    cycleType = null
  ) {
    console.log("🚀 Entered calculateAttendanceSummaryWithCycles");
    console.log("🔍 Input parameters:", {
      recordsLength: records.length,
      cycleType,
      cyclesLength: cycles.length,
    });

    let selectedCycle = cycles[0];
    console.log("🔍 Defaulting to first cycle:", selectedCycle);

    if (cycleType) {
      console.log("🔍 Searching for cycle matching cycleType:", cycleType);
      const foundCycle = cycles.find((cycle) => cycle.cycleId == cycleType);
      if (foundCycle) {
        selectedCycle = foundCycle;
        console.log("✅ Found matching cycle:", selectedCycle);
      } else {
        console.warn("💠 No matching cycle found for cycleType:", cycleType);
      }
    }

    const { includeWeekends, includeHolidays } = selectedCycle;
    console.log("🔍 Cycle settings:", { includeWeekends, includeHolidays });

    console.log("🔍 Calling calculateAttendanceSummary...");
    const summary = calculateAttendanceSummary(
      records,
      includeWeekends,
      includeHolidays
    );
    console.log("✅ Summary calculated:", summary);
    return summary;
  }

  function calculateAttendanceSummary(
    records,
    includeWeekoffs,
    includeHolidays
  ) {
    console.log("🚀 Entered calculateAttendanceSummary");
    console.log("🔍 Input parameters:", {
      recordsLength: records.length,
      includeWeekoffs,
      includeHolidays,
    });

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
    console.log("🔍 Initialized summary:", summary);

    if (records.length > 0) {
      const firstRecord = records[0];
      if (firstRecord && firstRecord.date) {
        const date = new Date(firstRecord.date);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        summary.totalDaysOfMonth = new Date(year, month, 0).getDate();
        console.log("🔍 Set totalDaysOfMonth:", summary.totalDaysOfMonth);
      }
    }

    console.log("🔍 Processing records...");
    records.forEach((record, index) => {
      console.log(
        `🔍 Processing record ${index + 1}/${records.length}:`,
        record
      );

      // Handle Holiday and WeeklyOff first
      if (record.attendanceContext === "Holiday") {
        summary.holiday += 1;
        const payableDay = includeHolidays ? 1 : 0;
        summary.totalPayableDays += payableDay;
        console.log("🔍 Processed Holiday, updated summary:", {
          holiday: summary.holiday,
          totalPayableDays: summary.totalPayableDays,
        });
        return;
      }

      if (record.attendanceContext === "WeeklyOff") {
        summary.weekOff += 1;
        const payableDay = includeWeekoffs ? 1 : 0;
        summary.totalPayableDays += payableDay;
        console.log("🔍 Processed WeeklyOff, updated summary:", {
          weekOff: summary.weekOff,
          totalPayableDays: summary.totalPayableDays,
        });
        return;
      }

      if (record.attendanceContext === "Unpaid Leave") {
        summary.unPaidLeave += 1;
        console.log("🔍 Processed Unpaid Leave, updated summary:", {
          unPaidLeave: summary.unPaidLeave,
        });
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
      console.log("🔍 Calculated day values:", { dayValue, considerableDay });

      if (record.attendanceContext) {
        const context = record.attendanceContext;
        console.log("🔍 Processing attendanceContext:", context);

        // Regular expression to parse attendance context
        const contextRegex =
          /(Present|WeekoffPresent|HolidayPresent)?(?:\((.*?)\))?(?:\((\w+)\))?/g;
        let matches;
        let parsedItems = [];
        let isPresent = false;
        let isWeekoffPresent = false;
        let isHolidayPresent = false;
        let deductions = [];

        console.log("🔍 Parsing context with regex...");
        while ((matches = contextRegex.exec(context)) !== null) {
          const status = matches[1];
          const deduction = matches[2];
          const reason = matches[3];
          console.log("🔍 Regex match:", { status, deduction, reason });

          if (status === "Present") isPresent = true;
          if (status === "WeekoffPresent") isWeekoffPresent = true;
          if (status === "HolidayPresent") isHolidayPresent = true;
          if (deduction) {
            parsedItems.push({ deduction, reason });
          }
        }

        // If no status is explicitly mentioned, check for standalone leave types
        if (!isPresent && !isWeekoffPresent && !isHolidayPresent) {
          console.log("🔍 Checking for standalone leave types...");
          const leaveMatch = context.match(/(\d\/\d)?([A-Z]+)(?:\((\w+)\))?/);
          if (leaveMatch) {
            const fraction = leaveMatch[1];
            const leaveType = leaveMatch[2];
            const reason = leaveMatch[3];
            console.log("🔍 Leave match:", { fraction, leaveType, reason });

            let leaveValue = fraction
              ? parseFloat(fraction.split("/")[0]) /
                parseFloat(fraction.split("/")[1])
              : 1.0;
            console.log("🔍 Calculated leaveValue:", leaveValue);

            if (leaveType === "LOP") {
              summary.unPaidLeave += leaveValue;
              summary.absent += leaveValue;
              if (reason === "DueToLate") summary.lateComing += 1;
              if (reason === "Early") summary.earlyLeaving += 1;
              if (reason === "WH") summary.absent += leaveValue;
              console.log("🔍 Processed LOP, updated summary:", {
                unPaidLeave: summary.unPaidLeave,
                absent: summary.absent,
                lateComing: summary.lateComing,
                earlyLeaving: summary.earlyLeaving,
              });
            } else {
              summary.paidLeave += leaveValue;
              record.leaveType = record.leaveType || leaveType.toLowerCase();
              summary.absent += leaveValue;
              if (reason === "DueToLate") summary.lateComing += 1;
              if (reason === "Early") summary.earlyLeaving += 1;
              if (reason === "WH") summary.absent += leaveValue;
              console.log("🔍 Processed paid leave, updated summary:", {
                paidLeave: summary.paidLeave,
                absent: summary.absent,
                leaveType: record.leaveType,
                lateComing: summary.lateComing,
                earlyLeaving: summary.earlyLeaving,
              });
            }
            return;
          }
        }

        // Handle combined deductions
        let totalDeduction = 0;
        let leaveTypeAssigned = false;
        console.log("🔍 Processing parsedItems for deductions...");
        parsedItems.forEach(({ deduction, reason }, idx) => {
          console.log(
            `🔍 Processing deduction ${idx + 1}/${parsedItems.length}:`,
            { deduction, reason }
          );
          const [fraction, type] = deduction.split(/([A-Z]+)/);
          let value = fraction
            ? parseFloat(fraction.split("/")[0]) /
              parseFloat(fraction.split("/")[1])
            : 1.0;
          console.log("🔍 Deduction value:", value);

          if (type === "LOP") {
            summary.unPaidLeave += value;
            summary.absent += value;
            totalDeduction += value;
            console.log("🔍 Processed LOP deduction, updated summary:", {
              unPaidLeave: summary.unPaidLeave,
              absent: summary.absent,
              totalDeduction,
            });
          } else {
            summary.paidLeave += value;
            summary.absent += value;
            record.leaveType = record.leaveType || type.toLowerCase();
            leaveTypeAssigned = true;
            totalDeduction += value;
            console.log("🔍 Processed paid leave deduction, updated summary:", {
              paidLeave: summary.paidLeave,
              absent: summary.absent,
              leaveType: record.leaveType,
              totalDeduction,
            });
          }

          if (reason === "DueToLate") summary.lateComing += 1;
          if (reason === "Early") summary.earlyLeaving += 1;
          if (reason === "WH") summary.absent += value;
          console.log("🔍 Updated reasons:", {
            lateComing: summary.lateComing,
            earlyLeaving: summary.earlyLeaving,
            absent: summary.absent,
          });
        });

        // Adjust based on status
        if (isPresent) {
          const presentValue = Math.max(0, considerableDay - totalDeduction);
          summary.present += presentValue;
          summary.totalPayableDays += presentValue;
          console.log("🔍 Processed Present, updated summary:", {
            present: summary.present,
            totalPayableDays: summary.totalPayableDays,
          });
        } else if (isWeekoffPresent) {
          const presentValue = Math.max(0, considerableDay - totalDeduction);
          summary.weekoffPresent += presentValue;
          summary.totalPayableDays += presentValue;
          console.log("🔍 Processed WeekoffPresent, updated summary:", {
            weekoffPresent: summary.weekoffPresent,
            totalPayableDays: summary.totalPayableDays,
          });
        } else if (isHolidayPresent) {
          const presentValue = Math.max(0, considerableDay - totalDeduction);
          summary.holidayPresent += presentValue;
          summary.totalPayableDays += presentValue;
          console.log("🔍 Processed HolidayPresent, updated summary:", {
            holidayPresent: summary.holidayPresent,
            totalPayableDays: summary.totalPayableDays,
          });
        }

        // Handle specific known contexts
        if (context === "1/2Present" || context === "1/2P") {
          summary.halfDay += 0.5;
          summary.absent += 0.5;
          summary.totalPayableDays += 0.5;
          console.log("🔍 Processed half-day present, updated summary:", {
            halfDay: summary.halfDay,
            absent: summary.absent,
            totalPayableDays: summary.totalPayableDays,
          });
        } else if (context === "Present" || context === "P") {
          summary.present += considerableDay;
          summary.totalPayableDays += considerableDay;
          console.log("🔍 Processed Present, updated summary:", {
            present: summary.present,
            totalPayableDays: summary.totalPayableDays,
          });
        } else if (context === "Absent" || context === "A") {
          if (record.attendance === "unPaidLeave") {
            summary.unPaidLeave += considerableDay;
            console.log("🔍 Processed unPaidLeave, updated summary:", {
              unPaidLeave: summary.unPaidLeave,
            });
          } else {
            summary.absent += considerableDay;
            console.log("🔍 Processed Absent, updated summary:", {
              absent: summary.absent,
            });
          }
        } else if (context === "WorkFromHome" || context === "WFH") {
          summary.workFromHome += considerableDay;
          summary.totalPayableDays += considerableDay;
          console.log("🔍 Processed WorkFromHome, updated summary:", {
            workFromHome: summary.workFromHome,
            totalPayableDays: summary.totalPayableDays,
          });
        } else if (context === "Present On OD" || context === "P(OD)") {
          summary.onDuty += considerableDay;
          summary.totalPayableDays += considerableDay;
          console.log("🔍 Processed OnDuty, updated summary:", {
            onDuty: summary.onDuty,
            totalPayableDays: summary.totalPayableDays,
          });
        } else if (
          context === "WeeklyOff Present" ||
          context === "WOP" ||
          context === "WeeklyOff Present On OD" ||
          context === "WOP(OD)"
        ) {
          summary.weekoffPresent += considerableDay;
          summary.totalPayableDays += considerableDay;
          console.log("🔍 Processed WeeklyOff Present, updated summary:", {
            weekoffPresent: summary.weekoffPresent,
            totalPayableDays: summary.totalPayableDays,
          });
        } else if (
          context === "WeeklyOff 1/2Present" ||
          context === "WOA1/2P"
        ) {
          summary.weekoffPresent += 0.5;
          summary.totalPayableDays += 0.5;
          console.log("🔍 Processed WeeklyOff half-day, updated summary:", {
            weekoffPresent: summary.weekoffPresent,
            totalPayableDays: summary.totalPayableDays,
          });
        } else if (context === "HolidayPresent") {
          summary.holidayPresent += considerableDay;
          summary.totalPayableDays += considerableDay;
          console.log("🔍 Processed HolidayPresent, updated summary:", {
            holidayPresent: summary.holidayPresent,
            totalPayableDays: summary.totalPayableDays,
          });
        } else if (context.includes("On Leave")) {
          const leaveMatch = context.match(/(\d\/\d)?([A-Z]+)(?:\((\w+)\))?/);
          if (leaveMatch) {
            const fraction = leaveMatch[1];
            const leaveType = leaveMatch[2];
            let leaveValue = fraction
              ? parseFloat(fraction.split("/")[0]) /
                parseFloat(fraction.split("/")[1])
              : 1.0;
            console.log("🔍 Leave match for On Leave:", {
              fraction,
              leaveType,
              leaveValue,
            });

            if (leaveType === "LOP") {
              summary.unPaidLeave += leaveValue;
              summary.absent += leaveValue;
              console.log("🔍 Processed LOP leave, updated summary:", {
                unPaidLeave: summary.unPaidLeave,
                absent: summary.absent,
              });
            } else {
              summary.paidLeave += leaveValue;
              record.leaveType = record.leaveType || leaveType.toLowerCase();
              console.log("🔍 Processed paid leave, updated summary:", {
                paidLeave: summary.paidLeave,
                leaveType: record.leaveType,
              });
            }
          } else {
            summary.paidLeave += considerableDay;
            console.log("🔍 Processed default paid leave, updated summary:", {
              paidLeave: summary.paidLeave,
            });
          }
        } else {
          console.warn(`💠 Unmatched attendance context: "${context}"`);
          switch (record.attendance) {
            case "present":
              summary.present += considerableDay;
              summary.totalPayableDays += considerableDay;
              console.log("🔍 Processed default present, updated summary:", {
                present: summary.present,
                totalPayableDays: summary.totalPayableDays,
              });
              break;
            case "absent":
              summary.absent += considerableDay;
              console.log("🔍 Processed default absent, updated summary:", {
                absent: summary.absent,
              });
              break;
            case "weekOff":
              summary.weekOff += 1;
              summary.totalPayableDays += includeWeekoffs ? 1 : 0;
              console.log("🔍 Processed default weekOff, updated summary:", {
                weekOff: summary.weekOff,
                totalPayableDays: summary.totalPayableDays,
              });
              break;
            case "holiday":
              summary.holiday += 1;
              summary.totalPayableDays += includeHolidays ? 1 : 0;
              console.log("🔍 Processed default holiday, updated summary:", {
                holiday: summary.holiday,
                totalPayableDays: summary.totalPayableDays,
              });
              break;
            case "onDuty":
              summary.onDuty += considerableDay;
              summary.totalPayableDays += considerableDay;
              console.log("🔍 Processed default onDuty, updated summary:", {
                onDuty: summary.onDuty,
                totalPayableDays: summary.totalPayableDays,
              });
              break;
            case "workFromHome":
              summary.workFromHome += considerableDay;
              summary.totalPayableDays += considerableDay;
              console.log(
                "🔍 Processed default workFromHome, updated summary:",
                {
                  workFromHome: summary.workFromHome,
                  totalPayableDays: summary.totalPayableDays,
                }
              );
              break;
            case "halfDay":
              summary.halfDay += considerableDay;
              summary.present += considerableDay;
              summary.absent += 1 - considerableDay;
              summary.totalPayableDays += considerableDay;
              console.log("🔍 Processed default halfDay, updated summary:", {
                halfDay: summary.halfDay,
                present: summary.present,
                absent: summary.absent,
                totalPayableDays: summary.totalPayableDays,
              });
              break;
            case "paidLeave":
              summary.paidLeave += considerableDay;
              console.log("🔍 Processed default paidLeave, updated summary:", {
                paidLeave: summary.paidLeave,
              });
              break;
            case "unPaidLeave":
              summary.unPaidLeave += considerableDay;
              console.log(
                "🔍 Processed default unPaidLeave, updated summary:",
                { unPaidLeave: summary.unPaidLeave }
              );
              break;
            case "holidayPresent":
              summary.holidayPresent += considerableDay;
              summary.totalPayableDays += considerableDay;
              console.log(
                "🔍 Processed default holidayPresent, updated summary:",
                {
                  holidayPresent: summary.holidayPresent,
                  totalPayableDays: summary.totalPayableDays,
                }
              );
              break;
            case "weekoffPresent":
              summary.weekoffPresent += considerableDay;
              summary.totalPayableDays += considerableDay;
              console.log(
                "🔍 Processed default weekoffPresent, updated summary:",
                {
                  weekoffPresent: summary.weekoffPresent,
                  totalPayableDays: summary.totalPayableDays,
                }
              );
              break;
          }
        }

        // Handle early departure, late coming, and overtime
        if (record.earlyDeparture && record.earlyDeparture !== "00:00:00") {
          summary.earlyLeaving += 1;
          console.log("🔍 Processed earlyDeparture, updated summary:", {
            earlyLeaving: summary.earlyLeaving,
          });
        }
        if (record.lateBy && record.lateBy !== "00:00:00") {
          summary.lateComing += 1;
          console.log("🔍 Processed lateComing, updated summary:", {
            lateComing: summary.lateComing,
          });
        }
        if (record.overTime && record.overTime !== "00:00:00") {
          if (isPresent) {
            summary.workingDayOT += 1;
            console.log("🔍 Processed workingDayOT, updated summary:", {
              workingDayOT: summary.workingDayOT,
            });
          } else if (isWeekoffPresent) {
            summary.weekoffPresentOT += 1;
            console.log("🔍 Processed weekoffPresentOT, updated summary:", {
              weekoffPresentOT: summary.weekoffPresentOT,
            });
          } else if (isHolidayPresent) {
            summary.holidayPresentOT += 1;
            console.log("🔍 Processed holidayPresentOT, updated summary:", {
              holidayPresentOT: summary.holidayPresentOT,
            });
          } else if (
            record.attendanceContext === "WorkFromHome" ||
            record.attendance === "workFromHome"
          ) {
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
      }
    });
    console.log("✅ Completed processing records, final summary:", summary);
    return summary;
  }

  function getAllDatesInRange(startDate, endDate) {
    console.log("🚀 Entered getAllDatesInRange");
    console.log("🔍 Input parameters:", { startDate, endDate });

    const dates = [];
    let currentDate = new Date(startDate);
    const end = new Date(endDate);
    console.log("🔍 Start date:", currentDate.toISOString());
    console.log("🔍 End date:", end.toISOString());

    if (isNaN(currentDate.getTime()) || isNaN(end.getTime())) {
      console.error("❌ Invalid date inputs:", { startDate, endDate });
      throw new Error("Invalid date range");
    }

    console.log("🔍 Generating date range...");
    while (currentDate <= end) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
      console.log(
        `🔍 Added date: ${dates[dates.length - 1].toISOString().split("T")[0]}`
      );
    }

    console.log("✅ Date range generated, length:", dates.length);
    return dates;
  }

  function getMonthName(month) {
    console.log("🚀 Entered getMonthName");
    console.log("🔍 Input parameter:", { month });

    const monthNames = [
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

    if (month < 1 || month > 12 || isNaN(month)) {
      console.warn("💠 Invalid month, defaulting to January:", month);
      return monthNames[0];
    }

    const monthName = monthNames[month - 1];
    console.log("✅ Month name:", monthName);
    return monthName;
  }
};
