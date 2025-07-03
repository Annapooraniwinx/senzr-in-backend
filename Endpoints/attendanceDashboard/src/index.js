module.exports = function registerEndpoint(router, { services }) {
  const { ItemsService } = services;

  router.get("/", async (req, res) => {
    try {
      let filter = {};
      if (req.query.filter) {
        if (typeof req.query.filter === "string") {
          try {
            filter = JSON.parse(req.query.filter);
          } catch (e) {}
        } else if (typeof req.query.filter === "object") {
          filter = req.query.filter;
        }
      }

      const filterAnd = filter._and || filter.and || [];

      const employeeId = filterAnd[1]?.employeeId?.id?._eq;
      const tenantId = filterAnd[0]?.tenant?.tenantId?._eq;
      const year = filterAnd[2]?.["year(date)"]?._eq;
      const month = filterAnd[3]?.["month(date)"]?._eq;
      const startDate = filterAnd[0]?.date?._gte || req.query.startDate;
      const endDate = filterAnd[0]?.date?._lte || req.query.endDate;

      const searchTerm = req.query.search || "";
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const offset = (page - 1) * limit;

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
        fields: [
          "startDate",
          "endDate",
          "fixedCycle",
          "includeWeekoffs",
          "includeHolidays",
        ],
        limit: 1,
      });

      if (!cycleSettings?.length) {
        return res.status(400).json({
          error: "Configuration error",
          message: "No attendance cycle settings found for this tenant",
        });
      }

      const {
        startDate: cycleStartDay,
        endDate: cycleEndDay,
        fixedCycle,
        includeWeekoffs,
        includeHolidays,
      } = cycleSettings[0];

      if (!employeeId && !startDate && !endDate && !year && !month) {
        return await getCurrentMonthAllEmployees(
          req,
          res,
          attendanceService,
          personalModuleService,
          tenantId,
          fixedCycle,
          cycleStartDay,
          cycleEndDay,
          includeWeekoffs,
          includeHolidays,
          searchTerm,
          page,
          limit,
          offset
        );
      } else if (!employeeId && startDate && endDate) {
        return await getDateRangeAllEmployees(
          req,
          res,
          attendanceService,
          personalModuleService,
          tenantId,
          startDate,
          endDate,
          includeWeekoffs,
          includeHolidays,
          searchTerm,
          page,
          limit,
          offset
        );
      } else if (employeeId && tenantId && year && !month) {
        return await getYearlySummary(
          req,
          res,
          attendanceService,
          employeeId,
          tenantId,
          parseInt(year),
          fixedCycle,
          cycleStartDay,
          cycleEndDay,
          includeWeekoffs,
          includeHolidays
        );
      } else if (employeeId && tenantId && year && month) {
        return await getMonthlyDetailedAttendance(
          req,
          res,
          attendanceService,
          employeeId,
          tenantId,
          parseInt(year),
          parseInt(month),
          fixedCycle,
          cycleStartDay,
          cycleEndDay,
          includeWeekoffs,
          includeHolidays
        );
      } else {
        return res.status(400).json({
          error: "Invalid parameter combination",
          message: "Please provide valid parameter combination",
        });
      }
    } catch (error) {
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
    fixedCycle,
    cycleStartDay,
    cycleEndDay,
    includeWeekoffs,
    includeHolidays,
    searchTerm,
    page,
    limit,
    offset
  ) {
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      const { startDate, endDate } = calculateDateRange(
        currentYear,
        currentMonth,
        fixedCycle,
        cycleStartDay,
        cycleEndDay
      );

      let personalModuleFilter = {
        _and: [
          {
            assignedUser: {
              tenant: { tenantId: { _eq: tenantId } },
            },
          },
        ],
      };

      if (searchTerm) {
        personalModuleFilter._and.push({
          _or: [
            { employeeId: { _icontains: searchTerm } },
            { assignedUser: { first_name: { _icontains: searchTerm } } },
            { assignedUser: { last_name: { _icontains: searchTerm } } },
          ],
        });
      }

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
          "assignedDepartment.department_id.departmentName",
          "assignedBranch.branch_id.branchName",
        ],
        limit: limit,
        offset: offset,
      });

      const employeeIds = paginatedEmployees.map((emp) => emp.id);

      if (employeeIds.length === 0) {
        return res.json({
          data: [],
          meta: {
            tenantId,
            month: currentMonth,
            year: currentYear,
            cycleStartDate: startDate,
            cycleEndDate: endDate,
            cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
            { employeeId: { id: { _in: employeeIds } } },
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
          department:
            emp.assignedDepartment?.department_id?.departmentName || "Finance",
          branch: emp.assignedBranch?.branch_id?.branchName || "Bangalore",
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

      for (const empId of employeeIds) {
        const empDetails = employeeDetailsMap[empId];
        if (!empDetails) continue;

        const empRecords = employeeRecords[empId] || [];
        const summary = calculateAttendanceSummary(
          empRecords,
          includeWeekoffs,
          includeHolidays
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
          branch: empDetails.branch,
          month: currentMonth,
          monthName: getMonthName(currentMonth),
          year: currentYear,
          cycleStartDate: startDate,
          cycleEndDate: endDate,
          cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
          cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
          totalEmployees,
          page,
          limit,
          totalPages: Math.ceil(totalEmployees / limit),
          search: searchTerm,
        },
      });
    } catch (error) {
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
    includeWeekoffs,
    includeHolidays,
    searchTerm,
    page,
    limit,
    offset
  ) {
    try {
      let personalModuleFilter = {
        _and: [
          {
            assignedUser: {
              tenant: { tenantId: { _eq: tenantId } },
            },
          },
        ],
      };

      if (searchTerm) {
        personalModuleFilter._and.push({
          _or: [
            { employeeId: { _icontains: searchTerm } },
            { assignedUser: { first_name: { _icontains: searchTerm } } },
            { assignedUser: { last_name: { _icontains: searchTerm } } },
          ],
        });
      }

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
          "assignedDepartment.department_id.departmentName",
          "assignedBranch.branch_id.branchName",
        ],
        limit: limit,
        offset: offset,
      });

      const employeeIds = paginatedEmployees.map((emp) => emp.id);

      if (employeeIds.length === 0) {
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
            { employeeId: { id: { _in: employeeIds } } },
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
          department:
            emp.assignedDepartment?.department_id?.departmentName || "Finance",
          branch: emp.assignedBranch?.branch_id?.branchName || "Bangalore",
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

      for (const empId of employeeIds) {
        const empDetails = employeeDetailsMap[empId];
        if (!empDetails) continue;

        const empRecords = employeeRecords[empId] || [];
        const summary = calculateAttendanceSummary(
          empRecords,
          includeWeekoffs,
          includeHolidays
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
          branch: empDetails.branch,
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
    fixedCycle,
    cycleStartDay,
    cycleEndDay,
    includeWeekoffs,
    includeHolidays
  ) {
    try {
      const monthlySummaries = [];

      for (let month = 1; month <= 12; month++) {
        const { startDate, endDate } = calculateDateRange(
          year,
          month,
          fixedCycle,
          cycleStartDay,
          cycleEndDay
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

        const monthlySummary = calculateAttendanceSummary(
          records,
          includeWeekoffs,
          includeHolidays
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
          cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
          cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
          totalMonths: monthlySummaries.length,
          includeWeekoffs,
          includeHolidays,
        },
      });
    } catch (error) {
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
    fixedCycle,
    cycleStartDay,
    cycleEndDay,
    includeWeekoffs,
    includeHolidays
  ) {
    try {
      const { startDate, endDate } = calculateDateRange(
        year,
        month,
        fixedCycle,
        cycleStartDay,
        cycleEndDay
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
                "Found paid salary record - locking attendance:",
                payrollRecord
              );
            } else {
              const unpaidRecord = payrollVerificationRecords.find(
                (record) => record.salaryPaid === "unpaid"
              );
              if (unpaidRecord) {
                lockedMonthAttendance = false;
                console.log(
                  "Found unpaid salary record - attendance unlocked:",
                  unpaidRecord
                );
              }
            }
          } else {
            console.log("No payroll verification records found");
          }
        } catch (error) {
          console.error("Error fetching payroll verification data:", error);
        }
      } else {
        console.log(
          "Missing required parameters for payroll verification query:",
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
          "employeeId.employeeId",
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

      const monthlySummary = calculateAttendanceSummary(
        records,
        includeWeekoffs,
        includeHolidays
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
            cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
          cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
          totalDays: dailyAttendance.length,
          includeWeekoffs,
          includeHolidays,
          lockedMonthAttendance,
        },
      });
    } catch (error) {
      console.error("Error in getMonthlyDetailedAttendance:", error);
      throw error;
    }
  }

  function calculateDateRange(
    year,
    month,
    fixedCycle,
    cycleStartDay,
    cycleEndDay
  ) {
    let startDate, endDate;

    if (fixedCycle) {
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0);
    } else {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevMonthYear = month === 1 ? year - 1 : year;

      startDate = new Date(prevMonthYear, prevMonth - 1, cycleStartDay);
      endDate = new Date(year, month - 1, cycleEndDay);
    }

    return {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    };
  }

  // Updated calculateAttendanceSummary function with correct payable days calculation
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

      let dayValue =
        record.day && !isNaN(record.day) ? parseFloat(record.day) : 0;
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
            `Unmatched attendance context: "${record.attendanceContext}"`
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
      } else {
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

      // Calculate payable days for non-holiday/weekoff records
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
    });

    return summary;
  }

  function getAllDatesInRange(startDateStr, endDateStr) {
    const dates = [];
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    let currentDate = new Date(startDate);

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
    return months[monthNumber - 1];
  }
};
