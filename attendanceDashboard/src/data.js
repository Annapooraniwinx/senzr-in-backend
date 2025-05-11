// module.exports = function registerEndpoint(router, { services }) {
//   const { ItemsService } = services;

//   const ALL_TYPES = {
//     present: 0,
//     absent: 0,
//     weekOff: 0,
//     holiday: 0,
//     onDuty: 0,
//     workFromHome: 0,
//     halfDay: 0,
//     paidLeave: 0,
//     unpaidLeave: 0,
//     holidayPresent: 0,
//     weekoffPresent: 0,
//     earlyLeaving: 0,
//     lateComing: 0,
//     workingDayOT: 0,
//     weekOffOT: 0,
//     holidayOT: 0,
//     workFromHomeOT: 0,
//     totalPayableDays: 0,
//     totalConsiderableDays: 0,
//   };

//   router.get("/", async (req, res) => {
//     console.log("Request received:", req.url);
//     const filter = req.query.filter || {};
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 500;
//     const searchTerm = req.query.search;
//     const offset = (page - 1) * limit;

//     try {
//       console.log("Processing request with filter:", JSON.stringify(filter));

//       let betweenDates = filter._and?.[0]?.date?._between;
//       if (!betweenDates) {
//         const startDate = req.query.startDate || filter.startDate;
//         const endDate = req.query.endDate || filter.endDate;
//         if (startDate && endDate) betweenDates = [startDate, endDate];
//       }

//       const tenantIdFilter = filter._and?.[1]?.tenant?.tenantId?._eq;

//       console.log("Extracted filters:", {
//         betweenDates,
//         tenantIdFilter,
//         searchTerm,
//       });

//       if (!betweenDates || betweenDates.length !== 2) {
//         return res.status(400).json({ error: "Invalid date range" });
//       }

//       if (!tenantIdFilter) {
//         return res.status(400).json({ error: "Tenant ID required" });
//       }

//       let employeeIds = [];
//       if (searchTerm) {
//         const personalModuleService = new ItemsService("personalModule", {
//           schema: req.schema,
//           accountability: req.accountability,
//         });

//         const searchResults = await personalModuleService.readByQuery({
//           filter: {
//             _and: [
//               {
//                 assignedUser: {
//                   tenant: { tenantId: { _eq: tenantIdFilter } },
//                 },
//               },
//               {
//                 _or: [
//                   { employeeId: { _icontains: searchTerm } },
//                   { assignedUser: { first_name: { _icontains: searchTerm } } },
//                 ],
//               },
//             ],
//           },
//           fields: ["id"],
//           limit: -1,
//         });

//         employeeIds = searchResults.map((emp) => emp.id);
//         console.log("Search results employee IDs:", employeeIds);

//         if (employeeIds.length === 0) {
//           return res.json({
//             data: { summary: [], detailedRecords: [] },
//             meta: { total: 0, page, limit, totalPages: 0 },
//           });
//         }
//       } else {
//         const employeeIdFilter = filter._and?.[2]?.employeeId?.id?._eq;
//         if (employeeIdFilter) {
//           employeeIds = [employeeIdFilter];
//         } else if (filter._and?.[2]?.employeeId?.id?._in) {
//           employeeIds =
//             typeof filter._and[2].employeeId.id._in === "string"
//               ? filter._and[2].employeeId.id._in
//                   .split(",")
//                   .map((id) => parseInt(id.trim(), 10))
//                   .filter((id) => !isNaN(id))
//               : Array.isArray(filter._and[2].employeeId.id._in)
//               ? filter._and[2].employeeId.id._in
//                   .map((id) => parseInt(id, 10))
//                   .filter((id) => !isNaN(id))
//               : [];
//         }
//       }

//       console.log("Final employee IDs:", employeeIds);

//       if (!employeeIds.length) {
//         console.log("No employee IDs found");
//         return res.status(400).json({ error: "Employee IDs required" });
//       }
//       let totalEmployees = employeeIds.length;
//       console.log("Using total employees count:", totalEmployees);

//       const paginatedEmployeeIds = employeeIds.slice(offset, offset + limit);
//       console.log("Paginated employee IDs:", paginatedEmployeeIds);

//       try {
//         console.log("Creating attendance cycle service");
//         const attendanceCycleService = new ItemsService("attendanceCycle", {
//           schema: req.schema,
//           accountability: req.accountability,
//         });

//         console.log("Querying cycle settings for tenant:", tenantIdFilter);
//         const cycleSettings = await attendanceCycleService.readByQuery({
//           filter: { tenant: { tenantId: { _eq: tenantIdFilter } } },
//           fields: ["includeWeekoffs", "includeHolidays"],
//           limit: 1,
//         });

//         console.log("Cycle settings query result:", cycleSettings);

//         if (!cycleSettings?.length) {
//           console.log("No cycle settings found for tenant:", tenantIdFilter);
//           return res.status(400).json({ error: "No cycle settings found" });
//         }

//         const { includeWeekoffs, includeHolidays } = cycleSettings[0];
//         console.log("Cycle settings:", { includeWeekoffs, includeHolidays });

//         // Get employee details from personalModule
//         console.log("Creating personalModule service");
//         const personalModuleService = new ItemsService("personalModule", {
//           schema: req.schema,
//           accountability: req.accountability,
//         });

//         console.log("Fetching employee details for IDs:", paginatedEmployeeIds);
//         const employeeDetails = await personalModuleService.readByQuery({
//           filter: { id: { _in: paginatedEmployeeIds } },
//           fields: [
//             "id",
//             "employeeId",
//             "assignedUser.first_name",
//             "assignedDepartment.department_id.departmentName",
//             "assignedBranch.branch_id.branchName",
//           ],
//           limit: -1,
//         });

//         console.log(`Found ${employeeDetails.length} employee details`);

//         // Create a map of employee details for quick lookup
//         const employeeDetailsMap = {};
//         employeeDetails.forEach((emp) => {
//           employeeDetailsMap[emp.id] = {
//             employeeId: emp.employeeId,
//             firstName: emp.assignedUser?.first_name || "Unknown",
//             department:
//               emp.assignedDepartment?.department_id?.departmentName ||
//               "Unknown",
//             branch: emp.assignedBranch?.branch_id?.branchName || "Unknown",
//           };
//         });

//         console.log("Creating attendance service");
//         const attendanceService = new ItemsService("attendance", {
//           schema: req.schema,
//           accountability: req.accountability,
//         });

//         console.log("Querying attendance records with filter:", {
//           date: { _between: betweenDates },
//           "employeeId.id": { _in: paginatedEmployeeIds },
//           tenant: { tenantId: { _eq: tenantIdFilter } },
//         });

//         const records = await attendanceService.readByQuery({
//           filter: {
//             _and: [
//               { date: { _between: betweenDates } },
//               {
//                 employeeId: { id: { _in: paginatedEmployeeIds } },
//               },
//               { tenant: { tenantId: { _eq: tenantIdFilter } } },
//             ],
//           },
//           fields: [
//             "id",
//             "date",
//             "attendance",
//             "day",
//             "tenant.tenantName",
//             "tenant.tenantId",
//             "leaveType",
//             "employeeId.employeeId",
//             "employeeId.id",
//             "overTime",
//             "breakTime",
//             "lateBy",
//             "earlyDeparture",
//             "workHours",
//             "attendanceContext",
//           ],
//           sort: req.query.sort || ["date"],
//           limit: -1,
//         });

//         console.log(`Found ${records.length} attendance records`);

//         // Create detailed records response
//         const detailedRecords = records.map((record) => ({
//           id: record.id,
//           date: record.date,
//           attendance: record.attendance,
//           day: record.day,
//           tenantName: record.tenant?.tenantName,
//           tenantId: record.tenant?.tenantId,
//           leaveType: record.leaveType,
//           employeeId: record.employeeId?.employeeId,
//           employeeDbId: record.employeeId?.id,
//           overTime: record.overTime,
//           breakTime: record.breakTime,
//           lateBy: record.lateBy,
//           earlyDeparture: record.earlyDeparture,
//           workHours: record.workHours,
//           attendanceContext: record.attendanceContext,
//         }));

//         // Create summary counts with employee details
//         const result = {};
//         paginatedEmployeeIds.forEach((empId) => {
//           const empDetails = employeeDetailsMap[empId] || {
//             employeeId: empId.toString(),
//             firstName: "Unknown",
//             lastName: "Unknown",
//             department: "Unknown",
//             branch: "Unknown",
//           };

//           result[empId] = {
//             ...empDetails,
//             ...structuredClone(ALL_TYPES),
//           };
//         });

//         console.log("Processing attendance records for summary");
//         records.forEach((record) => {
//           const empId = record.employeeId?.id;
//           if (!empId) return;

//           const empData = result[empId];
//           if (!empData) {
//             console.log(`No employee data found for: ${empId}`);
//             return;
//           }

//           // Get the day value (default to 0 if invalid)
//           let dayValue =
//             record.day && !isNaN(record.day) ? parseFloat(record.day) : 0;

//           // Apply considerable day rules
//           let considerableDay = dayValue;
//           if (dayValue === 0.75) {
//             considerableDay = 1.0;
//           } else if (dayValue > 1) {
//             considerableDay = 1.0;
//           }

//           // Handle special cases from attendanceContext first
//           if (record.attendanceContext) {
//             const context = record.attendanceContext.toLowerCase();

//             // ¼ Cases (0.25 increments)
//             if (context.includes("¼cl½p") || context.includes("1/4cl1/2p")) {
//               empData.present += 0.5;
//               empData.absent += 0.25;
//               empData.paidLeave += 0.25;
//               empData.leaveType = "casualLeave";
//             } else if (context.includes("¼clp") || context.includes("1/4clp")) {
//               empData.present += 1.0;
//               empData.paidLeave += 0.25;
//               empData.leaveType = "casualLeave";
//             } else if (context.includes("¼plp") || context.includes("1/4plp")) {
//               empData.present += 1.0;
//               empData.paidLeave += 0.25;
//               empData.leaveType = "privilegeLeave";
//             } else if (
//               context.includes("¼sl½p") ||
//               context.includes("1/4sl1/2p")
//             ) {
//               empData.present += 0.5;
//               empData.absent += 0.25;
//               empData.paidLeave += 0.25;
//               empData.leaveType = "sickLeave";
//             } else if (context.includes("¼slp") || context.includes("1/4slp")) {
//               empData.present += 1.0;
//               empData.paidLeave += 0.25;
//               empData.leaveType = "sickLeave";
//             }

//             // ½ Cases (0.5 increments)
//             else if (context.includes("½p") || context.includes("1/2p")) {
//               if (
//                 context.includes("due to continous late") ||
//                 context.includes("(od)")
//               ) {
//                 empData.present += 0.5;
//                 empData.absent += 0.5;
//               } else {
//                 empData.halfDay += 1.0;
//                 empData.present += 0.5;
//                 empData.absent += 0.5;
//               }
//             } else if (context.includes("½pl") || context.includes("1/2pl")) {
//               empData.paidLeave += 0.5;
//               empData.leaveType = "privilegeLeave";
//             } else if (
//               context.includes("½cl½p") ||
//               context.includes("1/2cl1/2p")
//             ) {
//               empData.present += 0.5;
//               empData.paidLeave += 0.5;
//               empData.leaveType = "casualLeave";
//             } else if (context.includes("½clp") || context.includes("1/2clp")) {
//               empData.present += 1.0;
//               empData.paidLeave += 0.5;
//               empData.leaveType = "casualLeave";
//             } else if (
//               context.includes("½pl½p") ||
//               context.includes("1/2pl1/2p")
//             ) {
//               empData.present += 0.5;
//               empData.paidLeave += 0.5;
//               empData.leaveType = "privilegeLeave";
//             } else if (context.includes("½plp") || context.includes("1/2plp")) {
//               empData.present += 1.0;
//               empData.paidLeave += 0.5;
//               empData.leaveType = "privilegeLeave";
//             } else if (
//               context.includes("½sl½p") ||
//               context.includes("1/2sl1/2p")
//             ) {
//               empData.present += 0.5;
//               empData.paidLeave += 0.5;
//               empData.leaveType = "sickLeave";
//             } else if (context.includes("½slp") || context.includes("1/2slp")) {
//               empData.present += 1.0;
//               empData.paidLeave += 0.5;
//               empData.leaveType = "sickLeave";
//             }

//             // ¾ Cases (0.75 increments)
//             else if (context.includes("¾cl") || context.includes("3/4cl")) {
//               empData.paidLeave += 0.75;
//               empData.leaveType = "casualLeave";
//             } else if (context.includes("¾slp") || context.includes("3/4slp")) {
//               empData.present += 1.0;
//               empData.paidLeave += 0.75;
//               empData.leaveType = "sickLeave";
//             }

//             // Full day cases
//             else if (context.includes("cl½p") || context.includes("cl1/2p")) {
//               empData.present += 0.5;
//               empData.paidLeave += 1.0;
//               empData.leaveType = "casualLeave";
//             } else if (context.includes("clp") && !context.includes("(od)")) {
//               empData.paidLeave += 1.0;
//               empData.leaveType = "casualLeave";
//             } else if (context.includes("pl")) {
//               empData.paidLeave += 1.0;
//               empData.leaveType = "privilegeLeave";
//             } else if (context.includes("sl")) {
//               empData.paidLeave += 1.0;
//               empData.leaveType = "sickLeave";
//             }

//             // Weekly off cases
//             else if (context.includes("wo½p") || context.includes("wo1/2p")) {
//               empData.weekoffPresent += 0.5;
//             } else if (context.includes("wop")) {
//               empData.weekoffPresent += 1.0;
//             }

//             // Basic cases
//             else if (
//               context.includes("present") &&
//               !context.includes("leave")
//             ) {
//               empData.present += 1.0;
//             } else if (context.includes("absent")) {
//               empData.absent += 1.0;
//             } else if (
//               context.includes("weeklyoff") ||
//               context.includes("weekoff")
//             ) {
//               empData.weekOff += 1.0;
//             } else if (context.includes("holiday")) {
//               if (context.includes("present")) {
//                 empData.holidayPresent += 1.0;
//               } else {
//                 empData.holiday += 1.0;
//               }
//             } else if (
//               context.includes("workfromhome") ||
//               context.includes("wfh")
//             ) {
//               empData.workFromHome += 1.0;
//             }
//           }
//           // Fallback to standard attendance field if no context
//           else {
//             switch (record.attendance) {
//               case "present":
//                 empData.present += dayValue;
//                 break;
//               case "absent":
//                 empData.absent += dayValue;
//                 break;
//               case "weekOff":
//                 empData.weekOff += dayValue;
//                 break;
//               case "holiday":
//                 empData.holiday += dayValue;
//                 break;
//               case "onDuty":
//                 empData.onDuty += dayValue;
//                 break;
//               case "workFromHome":
//                 empData.workFromHome += dayValue;
//                 break;
//               case "halfDay":
//                 empData.halfDay += dayValue;
//                 empData.present += dayValue;
//                 empData.absent += 1 - dayValue;
//                 break;
//               case "paidLeave":
//                 empData.paidLeave += dayValue;
//                 break;
//               case "unpaidLeave":
//                 empData.unpaidLeave += dayValue;
//                 break;
//               case "holidayPresent":
//                 empData.holidayPresent += dayValue;
//                 break;
//               case "weekoffPresent":
//                 empData.weekoffPresent += dayValue;
//                 break;
//             }
//           }

//           // Handle early leaving and late coming
//           if (record.earlyDeparture && record.earlyDeparture !== "00:00:00") {
//             empData.earlyLeaving += 1;
//           }
//           if (record.lateBy && record.lateBy !== "00:00:00") {
//             empData.lateComing += 1;
//           }

//           // Handle overtime
//           if (record.overTime && record.overTime !== "00:00:00") {
//             switch (record.attendance) {
//               case "present":
//                 empData.workingDayOT += 1;
//                 break;
//               case "weekOff":
//               case "weekoffPresent":
//                 empData.weekOffOT += 1;
//                 break;
//               case "holiday":
//               case "holidayPresent":
//                 empData.holidayOT += 1;
//                 break;
//               case "workFromHome":
//                 empData.workFromHomeOT += 1;
//                 break;
//             }
//           }

//           let payableDay = considerableDay;

//           if (
//             includeWeekoffs &&
//             (record.attendance === "weekOff" ||
//               record.attendance === "weekoffPresent")
//           ) {
//             payableDay = considerableDay;
//           } else if (
//             includeHolidays &&
//             (record.attendance === "holiday" ||
//               record.attendance === "holidayPresent")
//           ) {
//             payableDay = considerableDay;
//           } else if (
//             record.attendance === "absent" ||
//             record.attendance === "unpaidLeave" ||
//             (record.attendance === "paidLeave" &&
//               !includeWeekoffs &&
//               !includeHolidays)
//           ) {
//             payableDay = 0;
//           }

//           empData.totalPayableDays += payableDay;
//           empData.totalConsiderableDays += considerableDay;
//         });

//         const summaryArray = Object.values(result);
//         console.log(
//           `Returning ${summaryArray.length} employee attendance summaries`
//         );

//         return res.json({
//           data: {
//             // detailedRecords,
//             summary: summaryArray,
//           },
//           meta: {
//             totalEmployees: totalEmployees,
//             page: page,
//             limit: limit,
//             totalPages: Math.ceil(totalEmployees / limit),
//           },
//         });
//       } catch (serviceError) {
//         console.error("Error in service operations:", serviceError);
//         console.error("Error stack:", serviceError.stack);
//         return res.status(500).json({
//           error: "Service error",
//           message: serviceError.message,
//         });
//       }
//     } catch (err) {
//       console.error("Error details:", err);
//       console.error("Error stack:", err.stack);
//       return res.status(500).json({
//         error: "Internal server error",
//         message: err.message,
//         stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
//       });
//     }
//   });
// };

// module.exports = function registerEndpoint(router, { services }) {
//   const { ItemsService } = services;

//   const DEFAULT_SUMMARY = {
//     present: 0,
//     absent: 0,
//     weekOff: 0,
//     holiday: 0,
//     onDuty: 0,
//     workFromHome: 0,
//     halfDay: 0,
//     paidLeave: 0,
//     unpaidLeave: 0,
//     holidayPresent: 0,
//     weekoffPresent: 0,
//     earlyLeaving: 0,
//     lateComing: 0,
//     workingDayOT: 0,
//     weekOffOT: 0,
//     holidayOT: 0,
//     workFromHomeOT: 0,
//     totalPayableDays: 0,
//     totalConsiderableDays: 0,
//   };

//   router.get("/", async (req, res) => {
//     try {
//       console.log("Attendance summary request received:", req.query);

//       // Parse filter parameter
//       let filter = {};
//       if (req.query.filter) {
//         if (typeof req.query.filter === "string") {
//           try {
//             filter = JSON.parse(req.query.filter);
//           } catch (e) {
//             console.log("Error parsing filter:", e);
//           }
//         } else if (typeof req.query.filter === "object") {
//           filter = req.query.filter;
//         }
//       }

//       // Handle both _and and and formats in the filter
//       const filterAnd = filter._and || filter.and || [];

//       // Extract parameters using optional chaining
//       const employeeId = filterAnd[1]?.employeeId?.id?._eq;
//       const tenantId = filterAnd[0]?.tenant?.tenantId?._eq;
//       const year = filterAnd[2]?.["year(date)"]?._eq;
//       const month = filterAnd[3]?.["month(date)"]?._eq;
//       const startDate = filterAnd[0]?.date?._gte || req.query.startDate;
//       const endDate = filterAnd[0]?.date?._lte || req.query.endDate;

//       // Log extracted parameters for debugging
//       console.log("Extracted parameters:", {
//         employeeId,
//         tenantId,
//         year,
//         month,
//         startDate,
//         endDate,
//         filterAnd,
//       });

//       const searchTerm = req.query.search || "";
//       const page = parseInt(req.query.page) || 1;
//       const limit = parseInt(req.query.limit) || 50;
//       const offset = (page - 1) * limit;

//       if (!tenantId) {
//         return res.status(400).json({
//           error: "Missing required parameter",
//           message: "tenantId is required",
//         });
//       }

//       console.log("Processing request with params:", {
//         employeeId,
//         tenantId,
//         year,
//         month,
//         startDate,
//         endDate,
//         searchTerm,
//         page,
//         limit,
//       });

//       const attendanceCycleService = new ItemsService("attendanceCycle", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const attendanceService = new ItemsService("attendance", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const personalModuleService = new ItemsService("personalModule", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const cycleSettings = await attendanceCycleService.readByQuery({
//         filter: { tenant: { tenantId: { _eq: tenantId } } },
//         fields: [
//           "startDate",
//           "endDate",
//           "fixedCycle",
//           "includeWeekoffs",
//           "includeHolidays",
//         ],
//         limit: 1,
//       });

//       if (!cycleSettings?.length) {
//         return res.status(400).json({
//           error: "Configuration error",
//           message: "No attendance cycle settings found for this tenant",
//         });
//       }

//       const {
//         startDate: cycleStartDay,
//         endDate: cycleEndDay,
//         fixedCycle,
//         includeWeekoffs,
//         includeHolidays,
//       } = cycleSettings[0];

//       console.log("Attendance cycle settings:", {
//         cycleStartDay,
//         cycleEndDay,
//         fixedCycle,
//         includeWeekoffs,
//         includeHolidays,
//       });

//       if (!employeeId && !startDate && !endDate && !year && !month) {
//         return await getCurrentMonthAllEmployees(
//           req,
//           res,
//           attendanceService,
//           personalModuleService,
//           tenantId,
//           fixedCycle,
//           cycleStartDay,
//           cycleEndDay,
//           includeWeekoffs,
//           includeHolidays,
//           searchTerm,
//           page,
//           limit,
//           offset
//         );
//       } else if (!employeeId && startDate && endDate) {
//         return await getDateRangeAllEmployees(
//           req,
//           res,
//           attendanceService,
//           personalModuleService,
//           tenantId,
//           startDate,
//           endDate,
//           includeWeekoffs,
//           includeHolidays,
//           searchTerm,
//           page,
//           limit,
//           offset
//         );
//       } else if (employeeId && tenantId && year && !month) {
//         return await getYearlySummary(
//           req,
//           res,
//           attendanceService,
//           employeeId,
//           tenantId,
//           parseInt(year),
//           fixedCycle,
//           cycleStartDay,
//           cycleEndDay,
//           includeWeekoffs,
//           includeHolidays
//         );
//       } else if (employeeId && tenantId && year && month) {
//         return await getMonthlyDetailedAttendance(
//           req,
//           res,
//           attendanceService,
//           employeeId,
//           tenantId,
//           parseInt(year),
//           parseInt(month),
//           fixedCycle,
//           cycleStartDay,
//           cycleEndDay,
//           includeWeekoffs,
//           includeHolidays
//         );
//       } else {
//         return res.status(400).json({
//           error: "Invalid parameter combination",
//           message: "Please provide valid parameter combination",
//         });
//       }
//     } catch (error) {
//       console.error("Error in attendance summary endpoint:", error);
//       return res.status(500).json({
//         error: "Internal server error",
//         message: error.message,
//         stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
//       });
//     }
//   });

//   async function getCurrentMonthAllEmployees(
//     req,
//     res,
//     attendanceService,
//     personalModuleService,
//     tenantId,
//     fixedCycle,
//     cycleStartDay,
//     cycleEndDay,
//     includeWeekoffs,
//     includeHolidays,
//     searchTerm,
//     page,
//     limit,
//     offset
//   ) {
//     try {
//       const now = new Date();
//       const currentYear = now.getFullYear();
//       const currentMonth = now.getMonth() + 1;

//       const { startDate, endDate } = calculateDateRange(
//         currentYear,
//         currentMonth,
//         fixedCycle,
//         cycleStartDay,
//         cycleEndDay
//       );

//       console.log(`Current month date range:`, { startDate, endDate });

//       let personalModuleFilter = {
//         _and: [
//           {
//             assignedUser: {
//               tenant: { tenantId: { _eq: tenantId } },
//             },
//           },
//         ],
//       };

//       if (searchTerm) {
//         personalModuleFilter._and.push({
//           _or: [
//             { employeeId: { _icontains: searchTerm } },
//             { assignedUser: { first_name: { _icontains: searchTerm } } },
//             { assignedUser: { last_name: { _icontains: searchTerm } } },
//           ],
//         });
//       }

//       const totalEmployeesResult = await personalModuleService.readByQuery({
//         filter: personalModuleFilter,
//         fields: ["id"],
//         limit: -1,
//       });

//       const totalEmployees = totalEmployeesResult.length;
//       console.log(`Found ${totalEmployees} total employees matching criteria`);

//       const paginatedEmployees = await personalModuleService.readByQuery({
//         filter: personalModuleFilter,
//         fields: [
//           "id",
//           "employeeId",
//           "assignedUser.first_name",
//           "assignedUser.last_name",
//           "assignedDepartment.department_id.departmentName",
//           "assignedBranch.branch_id.branchName",
//         ],
//         limit: limit,
//         offset: offset,
//       });

//       console.log(`Retrieved ${paginatedEmployees.length} paginated employees`);

//       const employeeIds = paginatedEmployees.map((emp) => emp.id);

//       if (employeeIds.length === 0) {
//         return res.json({
//           data: [],
//           meta: {
//             tenantId,
//             month: currentMonth,
//             year: currentYear,
//             cycleStartDate: startDate,
//             cycleEndDate: endDate,
//             cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//             totalEmployees: 0,
//             page,
//             limit,
//             totalPages: 0,
//             search: searchTerm,
//           },
//         });
//       }

//       const records = await attendanceService.readByQuery({
//         filter: {
//           _and: [
//             { date: { _between: [startDate, endDate] } },
//             { employeeId: { id: { _in: employeeIds } } },
//             { tenant: { tenantId: { _eq: tenantId } } },
//           ],
//         },
//         fields: [
//           "id",
//           "date",
//           "attendance",
//           "day",
//           "leaveType",
//           "overTime",
//           "lateBy",
//           "earlyDeparture",
//           "attendanceContext",
//           "employeeId.id",
//         ],
//         sort: ["date"],
//         limit: -1,
//       });

//       console.log(
//         `Found ${records.length} attendance records for current month`
//       );

//       const employeeDetailsMap = {};
//       paginatedEmployees.forEach((emp) => {
//         employeeDetailsMap[emp.id] = {
//           employeeId: emp.employeeId,
//           firstName: emp.assignedUser?.first_name || "Unknown",
//           lastName: emp.assignedUser?.last_name || "",
//           department:
//             emp.assignedDepartment?.department_id?.departmentName || "Unknown",
//           branch: emp.assignedBranch?.branch_id?.branchName || "Unknown",
//         };
//       });

//       const employeeRecords = {};

//       records.forEach((record) => {
//         const empId = record.employeeId?.id;
//         if (!empId) return;

//         if (!employeeRecords[empId]) {
//           employeeRecords[empId] = [];
//         }

//         employeeRecords[empId].push(record);
//       });

//       const employeeSummaries = [];

//       for (const empId of employeeIds) {
//         const empDetails = employeeDetailsMap[empId];
//         if (!empDetails) continue;

//         const empRecords = employeeRecords[empId] || [];
//         const summary = calculateAttendanceSummary(
//           empRecords,
//           includeWeekoffs,
//           includeHolidays
//         );

//         employeeSummaries.push({
//           employeeId: empId,
//           employeeCode: empDetails.employeeId,
//           firstName: empDetails.firstName,
//           lastName: empDetails.lastName,
//           department: empDetails.department,
//           branch: empDetails.branch,
//           month: currentMonth,
//           monthName: getMonthName(currentMonth),
//           year: currentYear,
//           cycleStartDate: startDate,
//           cycleEndDate: endDate,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           ...summary,
//         });
//       }

//       return res.json({
//         data: employeeSummaries,
//         meta: {
//           tenantId,
//           month: currentMonth,
//           year: currentYear,
//           cycleStartDate: startDate,
//           cycleEndDate: endDate,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           totalEmployees,
//           page,
//           limit,
//           totalPages: Math.ceil(totalEmployees / limit),
//           search: searchTerm,
//         },
//       });
//     } catch (error) {
//       console.error("Error in current month all employees:", error);
//       throw error;
//     }
//   }

//   async function getDateRangeAllEmployees(
//     req,
//     res,
//     attendanceService,
//     personalModuleService,
//     tenantId,
//     startDate,
//     endDate,
//     includeWeekoffs,
//     includeHolidays,
//     searchTerm,
//     page,
//     limit,
//     offset
//   ) {
//     try {
//       console.log(`Date range:`, { startDate, endDate });

//       let personalModuleFilter = {
//         _and: [
//           {
//             assignedUser: {
//               tenant: { tenantId: { _eq: tenantId } },
//             },
//           },
//         ],
//       };

//       if (searchTerm) {
//         personalModuleFilter._and.push({
//           _or: [
//             { employeeId: { _icontains: searchTerm } },
//             { assignedUser: { first_name: { _icontains: searchTerm } } },
//             { assignedUser: { last_name: { _icontains: searchTerm } } },
//           ],
//         });
//       }

//       const totalEmployeesResult = await personalModuleService.readByQuery({
//         filter: personalModuleFilter,
//         fields: ["id"],
//         limit: -1,
//       });

//       const totalEmployees = totalEmployeesResult.length;
//       console.log(`Found ${totalEmployees} total employees matching criteria`);

//       const paginatedEmployees = await personalModuleService.readByQuery({
//         filter: personalModuleFilter,
//         fields: [
//           "id",
//           "employeeId",
//           "assignedUser.first_name",
//           "assignedUser.last_name",
//           "assignedDepartment.department_id.departmentName",
//           "assignedBranch.branch_id.branchName",
//         ],
//         limit: limit,
//         offset: offset,
//       });

//       console.log(`Retrieved ${paginatedEmployees.length} paginated employees`);

//       const employeeIds = paginatedEmployees.map((emp) => emp.id);

//       if (employeeIds.length === 0) {
//         return res.json({
//           data: [],
//           meta: {
//             tenantId,
//             startDate,
//             endDate,
//             startMonth: new Date(startDate).getMonth() + 1,
//             startYear: new Date(startDate).getFullYear(),
//             endMonth: new Date(endDate).getMonth() + 1,
//             endYear: new Date(endDate).getFullYear(),
//             totalEmployees: 0,
//             page,
//             limit,
//             totalPages: 0,
//             search: searchTerm,
//           },
//         });
//       }

//       const records = await attendanceService.readByQuery({
//         filter: {
//           _and: [
//             { date: { _between: [startDate, endDate] } },
//             { employeeId: { id: { _in: employeeIds } } },
//             { tenant: { tenantId: { _eq: tenantId } } },
//           ],
//         },
//         fields: [
//           "id",
//           "date",
//           "attendance",
//           "day",
//           "leaveType",
//           "overTime",
//           "lateBy",
//           "earlyDeparture",
//           "attendanceContext",
//           "employeeId.id",
//         ],
//         sort: ["date"],
//         limit: -1,
//       });

//       console.log(`Found ${records.length} attendance records for date range`);

//       const employeeDetailsMap = {};
//       paginatedEmployees.forEach((emp) => {
//         employeeDetailsMap[emp.id] = {
//           employeeId: emp.employeeId,
//           firstName: emp.assignedUser?.first_name || "Unknown",
//           lastName: emp.assignedUser?.last_name || "",
//           department:
//             emp.assignedDepartment?.department_id?.departmentName || "Unknown",
//           branch: emp.assignedBranch?.branch_id?.branchName || "Unknown",
//         };
//       });

//       const employeeRecords = {};

//       records.forEach((record) => {
//         const empId = record.employeeId?.id;
//         if (!empId) return;

//         if (!employeeRecords[empId]) {
//           employeeRecords[empId] = [];
//         }

//         employeeRecords[empId].push(record);
//       });

//       const employeeSummaries = [];

//       for (const empId of employeeIds) {
//         const empDetails = employeeDetailsMap[empId];
//         if (!empDetails) continue;

//         const empRecords = employeeRecords[empId] || [];
//         const summary = calculateAttendanceSummary(
//           empRecords,
//           includeWeekoffs,
//           includeHolidays
//         );

//         employeeSummaries.push({
//           employeeId: empId,
//           employeeCode: empDetails.employeeId,
//           firstName: empDetails.firstName,
//           lastName: empDetails.lastName,
//           department: empDetails.department,
//           branch: empDetails.branch,
//           dateRangeStart: startDate,
//           dateRangeEnd: endDate,
//           ...summary,
//         });
//       }

//       const startDateObj = new Date(startDate);
//       const endDateObj = new Date(endDate);

//       return res.json({
//         data: employeeSummaries,
//         meta: {
//           tenantId,
//           startDate,
//           endDate,
//           startMonth: startDateObj.getMonth() + 1,
//           startYear: startDateObj.getFullYear(),
//           endMonth: endDateObj.getMonth() + 1,
//           endYear: endDateObj.getFullYear(),
//           totalEmployees,
//           page,
//           limit,
//           totalPages: Math.ceil(totalEmployees / limit),
//           search: searchTerm,
//         },
//       });
//     } catch (error) {
//       console.error("Error in date range all employees:", error);
//       throw error;
//     }
//   }

//   async function getYearlySummary(
//     req,
//     res,
//     attendanceService,
//     employeeId,
//     tenantId,
//     year,
//     fixedCycle,
//     cycleStartDay,
//     cycleEndDay,
//     includeWeekoffs,
//     includeHolidays
//   ) {
//     try {
//       const monthlySummaries = [];

//       for (let month = 1; month <= 12; month++) {
//         const { startDate, endDate } = calculateDateRange(
//           year,
//           month,
//           fixedCycle,
//           cycleStartDay,
//           cycleEndDay
//         );

//         console.log(`Month ${month} date range:`, { startDate, endDate });

//         const records = await attendanceService.readByQuery({
//           filter: {
//             _and: [
//               { date: { _between: [startDate, endDate] } },
//               { employeeId: { id: { _eq: employeeId } } },
//               { tenant: { tenantId: { _eq: tenantId } } },
//             ],
//           },
//           fields: [
//             "id",
//             "date",
//             "attendance",
//             "day",
//             "leaveType",
//             "overTime",
//             "lateBy",
//             "earlyDeparture",
//             "attendanceContext",
//           ],
//           sort: ["date"],
//           limit: -1,
//         });

//         console.log(
//           `Found ${records.length} attendance records for month ${month}`
//         );

//         const monthlySummary = calculateAttendanceSummary(
//           records,
//           includeWeekoffs,
//           includeHolidays
//         );

//         monthlySummaries.push({
//           month,
//           monthName: getMonthName(month),
//           year,
//           cycleStartDate: startDate,
//           cycleEndDate: endDate,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           ...monthlySummary,
//         });
//       }

//       return res.json({
//         data: monthlySummaries,
//         meta: {
//           employeeId,
//           tenantId,
//           year,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           totalMonths: monthlySummaries.length,
//           includeWeekoffs,
//           includeHolidays,
//         },
//       });
//     } catch (error) {
//       console.error("Error in yearly summary:", error);
//       throw error;
//     }
//   }

//   async function getMonthlyDetailedAttendance(
//     req,
//     res,
//     attendanceService,
//     employeeId,
//     tenantId,
//     year,
//     month,
//     fixedCycle,
//     cycleStartDay,
//     cycleEndDay,
//     includeWeekoffs,
//     includeHolidays
//   ) {
//     try {
//       const { startDate, endDate } = calculateDateRange(
//         year,
//         month,
//         fixedCycle,
//         cycleStartDay,
//         cycleEndDay
//       );

//       console.log(`Month ${month} detailed date range:`, {
//         startDate,
//         endDate,
//       });

//       const records = await attendanceService.readByQuery({
//         filter: {
//           _and: [
//             { date: { _between: [startDate, endDate] } },
//             { employeeId: { id: { _eq: employeeId } } },
//             { tenant: { tenantId: { _eq: tenantId } } },
//           ],
//         },
//         fields: [
//           "id",
//           "date",
//           "attendance",
//           "day",
//           "leaveType",
//           "overTime",
//           "breakTime",
//           "lateBy",
//           "earlyDeparture",
//           "workHours",
//           "attendanceContext",
//         ],
//         sort: ["date"],
//         limit: -1,
//       });

//       console.log(`Found ${records.length} detailed attendance records`);

//       const allDates = getAllDatesInRange(startDate, endDate);

//       const dailyAttendance = allDates.map((date) => {
//         const dateStr = date.toISOString().split("T")[0];
//         const record = records.find((r) => r.date === dateStr);

//         if (record) {
//           return {
//             date: dateStr,
//             dayOfWeek: getDayOfWeek(date),
//             status: record.attendance,
//             day: record.day,
//             leaveType: record.leaveType || null,
//             overTime: record.overTime || null,
//             breakTime: record.breakTime || null,
//             lateBy: record.lateBy || null,
//             earlyDeparture: record.earlyDeparture || null,
//             workHours: record.workHours || null,
//             attendanceContext: record.attendanceContext || null,
//           };
//         } else {
//           return {
//             date: dateStr,
//             dayOfWeek: getDayOfWeek(date),
//             status: "noRecord",
//             day: 0,
//             leaveType: null,
//             overTime: null,
//             breakTime: null,
//             lateBy: null,
//             earlyDeparture: null,
//             workHours: null,
//             attendanceContext: null,
//           };
//         }
//       });

//       const monthlySummary = calculateAttendanceSummary(
//         records,
//         includeWeekoffs,
//         includeHolidays
//       );

//       return res.json({
//         data: {
//           summary: {
//             month,
//             monthName: getMonthName(month),
//             year,
//             cycleStartDate: startDate,
//             cycleEndDate: endDate,
//             cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//             ...monthlySummary,
//           },
//           dailyRecords: dailyAttendance,
//         },
//         meta: {
//           employeeId,
//           tenantId,
//           year,
//           month,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           totalDays: dailyAttendance.length,
//           includeWeekoffs,
//           includeHolidays,
//         },
//       });
//     } catch (error) {
//       console.error("Error in monthly detailed attendance:", error);
//       throw error;
//     }
//   }

//   function calculateDateRange(
//     year,
//     month,
//     fixedCycle,
//     cycleStartDay,
//     cycleEndDay
//   ) {
//     let startDate, endDate;

//     if (fixedCycle) {
//       startDate = new Date(year, month - 1, 1);
//       endDate = new Date(year, month, 0);
//     } else {
//       const prevMonth = month === 1 ? 12 : month - 1;
//       const prevMonthYear = month === 1 ? year - 1 : year;

//       startDate = new Date(prevMonthYear, prevMonth - 1, cycleStartDay);
//       endDate = new Date(year, month - 1, cycleEndDay);
//     }

//     return {
//       startDate: startDate.toISOString().split("T")[0],
//       endDate: endDate.toISOString().split("T")[0],
//     };
//   }

//   function calculateAttendanceSummary(
//     records,
//     includeWeekoffs,
//     includeHolidays
//   ) {
//     const summary = { ...DEFAULT_SUMMARY };

//     records.forEach((record) => {
//       let dayValue =
//         record.day && !isNaN(record.day) ? parseFloat(record.day) : 0;

//       let considerableDay = dayValue;
//       if (dayValue === 0.75) {
//         considerableDay = 1.0;
//       } else if (dayValue > 1) {
//         considerableDay = 1.0;
//       }

//       if (record.attendanceContext) {
//         const context = record.attendanceContext.toLowerCase();

//         if (context.includes("¼cl½p") || context.includes("1/4cl1/2p")) {
//           summary.present += 0.5;
//           summary.absent += 0.25;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("¼clp") || context.includes("1/4clp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("¼plp") || context.includes("1/4plp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("¼sl½p") || context.includes("1/4sl1/2p")) {
//           summary.present += 0.5;
//           summary.absent += 0.25;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("¼slp") || context.includes("1/4slp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("½p") || context.includes("1/2p")) {
//           if (
//             context.includes("due to continous late") ||
//             context.includes("(od)")
//           ) {
//             summary.present += 0.5;
//             summary.absent += 0.5;
//           } else {
//             summary.halfDay += 1.0;
//             summary.present += 0.5;
//             summary.absent += 0.5;
//           }
//         } else if (context.includes("½pl") || context.includes("1/2pl")) {
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½cl½p") || context.includes("1/2cl1/2p")) {
//           summary.present += 0.5;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½clp") || context.includes("1/2clp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½pl½p") || context.includes("1/2pl1/2p")) {
//           summary.present += 0.5;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½plp") || context.includes("1/2plp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½sl½p") || context.includes("1/2sl1/2p")) {
//           summary.present += 0.5;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½slp") || context.includes("1/2slp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("¾cl") || context.includes("3/4cl")) {
//           summary.paidLeave += 0.75;
//         } else if (context.includes("¾slp") || context.includes("3/4slp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.75;
//         } else if (context.includes("cl½p") || context.includes("cl1/2p")) {
//           summary.present += 0.5;
//           summary.paidLeave += 1.0;
//         } else if (context.includes("clp") && !context.includes("(od)")) {
//           summary.paidLeave += 1.0;
//         } else if (context.includes("pl")) {
//           summary.paidLeave += 1.0;
//         } else if (context.includes("sl")) {
//           summary.paidLeave += 1.0;
//         } else if (context.includes("wo½p") || context.includes("wo1/2p")) {
//           summary.weekoffPresent += 0.5;
//         } else if (context.includes("wop")) {
//           summary.weekoffPresent += 1.0;
//         } else if (context.includes("present") && !context.includes("leave")) {
//           summary.present += 1.0;
//         } else if (context.includes("absent")) {
//           summary.absent += 1.0;
//         } else if (
//           context.includes("weeklyoff") ||
//           context.includes("weekoff")
//         ) {
//           summary.weekOff += 1.0;
//         } else if (context.includes("holiday")) {
//           if (context.includes("present")) {
//             summary.holidayPresent += 1.0;
//           } else {
//             summary.holiday += 1.0;
//           }
//         } else if (
//           context.includes("workfromhome") ||
//           context.includes("wfh")
//         ) {
//           summary.workFromHome += 1.0;
//         }
//       } else {
//         switch (record.attendance) {
//           case "present":
//             summary.present += dayValue;
//             break;
//           case "absent":
//             summary.absent += dayValue;
//             break;
//           case "weekOff":
//             summary.weekOff += dayValue;
//             break;
//           case "holiday":
//             summary.holiday += dayValue;
//             break;
//           case "onDuty":
//             summary.onDuty += dayValue;
//             break;
//           case "workFromHome":
//             summary.workFromHome += dayValue;
//             break;
//           case "halfDay":
//             summary.halfDay += dayValue;
//             summary.present += dayValue;
//             summary.absent += 1 - dayValue;
//             break;
//           case "paidLeave":
//             summary.paidLeave += dayValue;
//             break;
//           case "unpaidLeave":
//             summary.unpaidLeave += dayValue;
//             break;
//           case "holidayPresent":
//             summary.holidayPresent += dayValue;
//             break;
//           case "weekoffPresent":
//             summary.weekoffPresent += dayValue;
//             break;
//         }
//       }

//       if (record.earlyDeparture && record.earlyDeparture !== "00:00:00") {
//         summary.earlyLeaving += 1;
//       }
//       if (record.lateBy && record.lateBy !== "00:00:00") {
//         summary.lateComing += 1;
//       }

//       if (record.overTime && record.overTime !== "00:00:00") {
//         switch (record.attendance) {
//           case "present":
//             summary.workingDayOT += 1;
//             break;
//           case "weekOff":
//           case "weekoffPresent":
//             summary.weekOffOT += 1;
//             break;
//           case "holiday":
//           case "holidayPresent":
//             summary.holidayOT += 1;
//             break;
//           case "workFromHome":
//             summary.workFromHomeOT += 1;
//             break;
//         }
//       }

//       let payableDay = considerableDay;

//       if (
//         includeWeekoffs &&
//         (record.attendance === "weekOff" ||
//           record.attendance === "weekoffPresent")
//       ) {
//         payableDay = considerableDay;
//       } else if (
//         includeHolidays &&
//         (record.attendance === "holiday" ||
//           record.attendance === "holidayPresent")
//       ) {
//         payableDay = considerableDay;
//       } else if (
//         record.attendance === "absent" ||
//         record.attendance === "unpaidLeave" ||
//         (record.attendance === "paidLeave" &&
//           !includeWeekoffs &&
//           !includeHolidays)
//       ) {
//         payableDay = 0;
//       }

//       summary.totalPayableDays += payableDay;
//       summary.totalConsiderableDays += considerableDay;
//     });

//     return summary;
//   }

//   function getAllDatesInRange(startDateStr, endDateStr) {
//     const dates = [];
//     const startDate = new Date(startDateStr);
//     const endDate = new Date(endDateStr);

//     let currentDate = new Date(startDate);

//     while (currentDate <= endDate) {
//       dates.push(new Date(currentDate));
//       currentDate.setDate(currentDate.getDate() + 1);
//     }

//     return dates;
//   }

//   function getDayOfWeek(date) {
//     const days = [
//       "Sunday",
//       "Monday",
//       "Tuesday",
//       "Wednesday",
//       "Thursday",
//       "Friday",
//       "Saturday",
//     ];
//     return days[date.getDay()];
//   }

//   function getMonthName(monthNumber) {
//     const months = [
//       "January",
//       "February",
//       "March",
//       "April",
//       "May",
//       "June",
//       "July",
//       "August",
//       "September",
//       "October",
//       "November",
//       "December",
//     ];
//     return months[monthNumber - 1];
//   }
// };

module.exports = function registerEndpoint(router, { services }) {
  const { ItemsService } = services;

  const DEFAULT_SUMMARY = {
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
    totalConsiderableDays: 0,
  };

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
          lastName: emp.assignedUser?.last_name || "",
          department:
            emp.assignedDepartment?.department_id?.departmentName || "Unknown",
          branch: emp.assignedBranch?.branch_id?.branchName || "Unknown",
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

        employeeSummaries.push({
          employeeId: empId,
          employeeCode: empDetails.employeeId,
          firstName: empDetails.firstName,
          lastName: empDetails.lastName,
          department: empDetails.department,
          branch: empDetails.branch,
          month: currentMonth,
          monthName: getMonthName(currentMonth),
          year: currentYear,
          cycleStartDate: startDate,
          cycleEndDate: endDate,
          cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
          lastName: emp.assignedUser?.last_name || "",
          department:
            emp.assignedDepartment?.department_id?.departmentName || "Unknown",
          branch: emp.assignedBranch?.branch_id?.branchName || "Unknown",
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

        employeeSummaries.push({
          employeeId: empId,
          employeeCode: empDetails.employeeId,
          firstName: empDetails.firstName,
          lastName: empDetails.lastName,
          department: empDetails.department,
          branch: empDetails.branch,
          dateRangeStart: startDate,
          dateRangeEnd: endDate,
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

        monthlySummaries.push({
          month,
          monthName: getMonthName(month),
          year,
          cycleStartDate: startDate,
          cycleEndDate: endDate,
          cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
          "breakTime",
          "lateBy",
          "earlyDeparture",
          "workHours",
          "attendanceContext",
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
            date: dateStr,
            dayOfWeek: getDayOfWeek(date),
            status: record.attendance,
            day: record.day,
            leaveType: record.leaveType || null,
            overTime: record.overTime || null,
            breakTime: record.breakTime || null,
            lateBy: record.lateBy || null,
            earlyDeparture: record.earlyDeparture || null,
            workHours: record.workHours || null,
            attendanceContext: record.attendanceContext || null,
          };
        } else {
          return {
            date: dateStr,
            dayOfWeek: getDayOfWeek(date),
            status: "noRecord",
            day: 0,
            leaveType: null,
            overTime: null,
            breakTime: null,
            lateBy: null,
            earlyDeparture: null,
            workHours: null,
            attendanceContext: null,
          };
        }
      });

      const monthlySummary = calculateAttendanceSummary(
        records,
        includeWeekoffs,
        includeHolidays
      );

      return res.json({
        data: {
          summary: {
            month,
            monthName: getMonthName(month),
            year,
            cycleStartDate: startDate,
            cycleEndDate: endDate,
            cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
        },
      });
    } catch (error) {
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

  function calculateAttendanceSummary(
    records,
    includeWeekoffs,
    includeHolidays
  ) {
    const summary = { ...DEFAULT_SUMMARY };

    records.forEach((record) => {
      let dayValue =
        record.day && !isNaN(record.day) ? parseFloat(record.day) : 0;

      let considerableDay = dayValue;
      if (dayValue === 0.75) {
        considerableDay = 1.0;
      } else if (dayValue > 1) {
        considerableDay = 1.0;
      }

      if (record.attendanceContext) {
        const context = record.attendanceContext.toLowerCase();

        if (context.includes("¼cl½p") || context.includes("1/4cl1/2p")) {
          summary.present += 0.5;
          summary.absent += 0.25;
          summary.paidLeave += 0.25;
        } else if (context.includes("¼clp") || context.includes("1/4clp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.25;
        } else if (context.includes("¼plp") || context.includes("1/4plp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.25;
        } else if (context.includes("¼sl½p") || context.includes("1/4sl1/2p")) {
          summary.present += 0.5;
          summary.absent += 0.25;
          summary.paidLeave += 0.25;
        } else if (context.includes("¼slp") || context.includes("1/4slp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.25;
        } else if (context.includes("½p") || context.includes("1/2p")) {
          if (
            context.includes("due to continous late") ||
            context.includes("(od)")
          ) {
            summary.present += 0.5;
            summary.absent += 0.5;
          } else {
            summary.halfDay += 1.0;
            summary.present += 0.5;
            summary.absent += 0.5;
          }
        } else if (context.includes("½pl") || context.includes("1/2pl")) {
          summary.paidLeave += 0.5;
        } else if (context.includes("½cl½p") || context.includes("1/2cl1/2p")) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
        } else if (context.includes("½clp") || context.includes("1/2clp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
        } else if (context.includes("½pl½p") || context.includes("1/2pl1/2p")) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
        } else if (context.includes("½plp") || context.includes("1/2plp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
        } else if (context.includes("½sl½p") || context.includes("1/2sl1/2p")) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
        } else if (context.includes("½slp") || context.includes("1/2slp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
        } else if (context.includes("¾cl") || context.includes("3/4cl")) {
          summary.paidLeave += 0.75;
        } else if (context.includes("¾slp") || context.includes("3/4slp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.75;
        } else if (context.includes("cl½p") || context.includes("cl1/2p")) {
          summary.present += 0.5;
          summary.paidLeave += 1.0;
        } else if (context.includes("clp") && !context.includes("(od)")) {
          summary.paidLeave += 1.0;
        } else if (context.includes("pl")) {
          summary.paidLeave += 1.0;
        } else if (context.includes("sl")) {
          summary.paidLeave += 1.0;
        } else if (context.includes("wo½p") || context.includes("wo1/2p")) {
          summary.weekoffPresent += 0.5;
        } else if (context.includes("wop")) {
          summary.weekoffPresent += 1.0;
        } else if (context.includes("present") && !context.includes("leave")) {
          summary.present += 1.0;
        } else if (context.includes("absent")) {
          summary.absent += 1.0;
        } else if (
          context.includes("weeklyoff") ||
          context.includes("weekoff")
        ) {
          summary.weekOff += 1.0;
        } else if (context.includes("holiday")) {
          if (context.includes("present")) {
            summary.holidayPresent += 1.0;
          } else {
            summary.holiday += 1.0;
          }
        } else if (
          context.includes("workfromhome") ||
          context.includes("wfh")
        ) {
          summary.workFromHome += 1.0;
        } else if (context.includes("on leave") || context.includes("leave")) {
          if (context.includes("cl") || context.includes("casual")) {
            summary.paidLeave += dayValue;
          } else if (context.includes("sl") || context.includes("sick")) {
            summary.paidLeave += dayValue;
          } else if (context.includes("pl") || context.includes("privilege")) {
            summary.paidLeave += dayValue;
          } else {
            summary.paidLeave += dayValue;
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
            summary.weekOff += dayValue;
            break;
          case "holiday":
            summary.holiday += dayValue;
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
          case "unpaidLeave":
            summary.unpaidLeave += dayValue;
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
        switch (record.attendance) {
          case "present":
            summary.workingDayOT += 1;
            break;
          case "weekOff":
          case "weekoffPresent":
            summary.weekOffOT += 1;
            break;
          case "holiday":
          case "holidayPresent":
            summary.holidayOT += 1;
            break;
          case "workFromHome":
            summary.workFromHomeOT += 1;
            break;
        }
      }

      let payableDay = considerableDay;

      if (
        includeWeekoffs &&
        (record.attendance === "weekOff" ||
          record.attendance === "weekoffPresent")
      ) {
        payableDay = considerableDay;
      } else if (
        includeHolidays &&
        (record.attendance === "holiday" ||
          record.attendance === "holidayPresent")
      ) {
        payableDay = considerableDay;
      } else if (
        record.attendance === "absent" ||
        record.attendance === "unpaidLeave"
      ) {
        payableDay = 0;
      } else if (record.attendance === "paidLeave") {
        payableDay = considerableDay;
      }

      summary.totalPayableDays += payableDay;
      summary.totalConsiderableDays += considerableDay;
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

  function getDayOfWeek(date) {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[date.getDay()];
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

////////////////////////////////////////////////////////////////////////

// module.exports = function registerEndpoint(router, { services }) {
//   const { ItemsService } = services;

//   const DEFAULT_SUMMARY = {
//     present: 0,
//     absent: 0,
//     weekOff: 0,
//     holiday: 0,
//     onDuty: 0,
//     workFromHome: 0,
//     halfDay: 0,
//     paidLeave: 0,
//     unpaidLeave: 0,
//     holidayPresent: 0,
//     weekoffPresent: 0,
//     earlyLeaving: 0,
//     lateComing: 0,
//     workingDayOT: 0,
//     weekOffOT: 0,
//     holidayOT: 0,
//     workFromHomeOT: 0,
//     totalPayableDays: 0,
//     totalConsiderableDays: 0,
//   };

//   router.get("/", async (req, res) => {
//     try {
//       let filter = {};
//       if (req.query.filter) {
//         if (typeof req.query.filter === "string") {
//           try {
//             filter = JSON.parse(req.query.filter);
//           } catch (e) {}
//         } else if (typeof req.query.filter === "object") {
//           filter = req.query.filter;
//         }
//       }

//       const filterAnd = filter._and || filter.and || [];

//       const employeeId = filterAnd[1]?.employeeId?.id?._eq;
//       const tenantId = filterAnd[0]?.tenant?.tenantId?._eq;
//       const year = filterAnd[2]?.["year(date)"]?._eq;
//       const month = filterAnd[3]?.["month(date)"]?._eq;
//       const startDate = filterAnd[0]?.date?._gte || req.query.startDate;
//       const endDate = filterAnd[0]?.date?._lte || req.query.endDate;

//       const searchTerm = req.query.search || "";
//       const page = parseInt(req.query.page) || 1;
//       const limit = parseInt(req.query.limit) || 50;
//       const offset = (page - 1) * limit;

//       if (!tenantId) {
//         return res.status(400).json({
//           error: "Missing required parameter",
//           message: "tenantId is required",
//         });
//       }

//       const attendanceCycleService = new ItemsService("attendanceCycle", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const attendanceService = new ItemsService("attendance", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const personalModuleService = new ItemsService("personalModule", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const cycleSettings = await attendanceCycleService.readByQuery({
//         filter: { tenant: { tenantId: { _eq: tenantId } } },
//         fields: [
//           "startDate",
//           "endDate",
//           "fixedCycle",
//           "includeWeekoffs",
//           "includeHolidays",
//         ],
//         limit: 1,
//       });

//       if (!cycleSettings?.length) {
//         return res.status(400).json({
//           error: "Configuration error",
//           message: "No attendance cycle settings found for this tenant",
//         });
//       }

//       const {
//         startDate: cycleStartDay,
//         endDate: cycleEndDay,
//         fixedCycle,
//         includeWeekoffs,
//         includeHolidays,
//       } = cycleSettings[0];

//       if (!employeeId && !startDate && !endDate && !year && !month) {
//         return await getCurrentMonthAllEmployees(
//           req,
//           res,
//           attendanceService,
//           personalModuleService,
//           tenantId,
//           fixedCycle,
//           cycleStartDay,
//           cycleEndDay,
//           includeWeekoffs,
//           includeHolidays,
//           searchTerm,
//           page,
//           limit,
//           offset
//         );
//       } else if (!employeeId && startDate && endDate) {
//         return await getDateRangeAllEmployees(
//           req,
//           res,
//           attendanceService,
//           personalModuleService,
//           tenantId,
//           startDate,
//           endDate,
//           includeWeekoffs,
//           includeHolidays,
//           searchTerm,
//           page,
//           limit,
//           offset
//         );
//       } else if (employeeId && tenantId && year && !month) {
//         return await getYearlySummary(
//           req,
//           res,
//           attendanceService,
//           employeeId,
//           tenantId,
//           parseInt(year),
//           fixedCycle,
//           cycleStartDay,
//           cycleEndDay,
//           includeWeekoffs,
//           includeHolidays
//         );
//       } else if (employeeId && tenantId && year && month) {
//         return await getMonthlyDetailedAttendance(
//           req,
//           res,
//           attendanceService,
//           employeeId,
//           tenantId,
//           parseInt(year),
//           parseInt(month),
//           fixedCycle,
//           cycleStartDay,
//           cycleEndDay,
//           includeWeekoffs,
//           includeHolidays
//         );
//       } else {
//         return res.status(400).json({
//           error: "Invalid parameter combination",
//           message: "Please provide valid parameter combination",
//         });
//       }
//     } catch (error) {
//       return res.status(500).json({
//         error: "Internal server error",
//         message: error.message,
//         stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
//       });
//     }
//   });

//   async function getCurrentMonthAllEmployees(
//     req,
//     res,
//     attendanceService,
//     personalModuleService,
//     tenantId,
//     fixedCycle,
//     cycleStartDay,
//     cycleEndDay,
//     includeWeekoffs,
//     includeHolidays,
//     searchTerm,
//     page,
//     limit,
//     offset
//   ) {
//     try {
//       const now = new Date();
//       const currentYear = now.getFullYear();
//       const currentMonth = now.getMonth() + 1;

//       const { startDate, endDate } = calculateDateRange(
//         currentYear,
//         currentMonth,
//         fixedCycle,
//         cycleStartDay,
//         cycleEndDay
//       );

//       let personalModuleFilter = {
//         _and: [
//           {
//             assignedUser: {
//               tenant: { tenantId: { _eq: tenantId } },
//             },
//           },
//         ],
//       };

//       if (searchTerm) {
//         personalModuleFilter._and.push({
//           _or: [
//             { employeeId: { _icontains: searchTerm } },
//             { assignedUser: { first_name: { _icontains: searchTerm } } },
//             { assignedUser: { last_name: { _icontains: searchTerm } } },
//           ],
//         });
//       }

//       const totalEmployeesResult = await personalModuleService.readByQuery({
//         filter: personalModuleFilter,
//         fields: ["id"],
//         limit: -1,
//       });

//       const totalEmployees = totalEmployeesResult.length;

//       const paginatedEmployees = await personalModuleService.readByQuery({
//         filter: personalModuleFilter,
//         fields: [
//           "id",
//           "employeeId",
//           "assignedUser.first_name",
//           "assignedUser.last_name",
//           "assignedDepartment.department_id.departmentName",
//           "assignedBranch.branch_id.branchName",
//         ],
//         limit: limit,
//         offset: offset,
//       });

//       const employeeIds = paginatedEmployees.map((emp) => emp.id);

//       if (employeeIds.length === 0) {
//         return res.json({
//           data: [],
//           meta: {
//             tenantId,
//             month: currentMonth,
//             year: currentYear,
//             cycleStartDate: startDate,
//             cycleEndDate: endDate,
//             cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//             totalEmployees: 0,
//             page,
//             limit,
//             totalPages: 0,
//             search: searchTerm,
//           },
//         });
//       }

//       const records = await attendanceService.readByQuery({
//         filter: {
//           _and: [
//             { date: { _between: [startDate, endDate] } },
//             { employeeId: { id: { _in: employeeIds } } },
//             { tenant: { tenantId: { _eq: tenantId } } },
//           ],
//         },
//         fields: [
//           "id",
//           "date",
//           "attendance",
//           "day",
//           "leaveType",
//           "overTime",
//           "lateBy",
//           "earlyDeparture",
//           "attendanceContext",
//           "employeeId.id",
//         ],
//         sort: ["date"],
//         limit: -1,
//       });

//       const employeeDetailsMap = {};
//       paginatedEmployees.forEach((emp) => {
//         employeeDetailsMap[emp.id] = {
//           employeeId: emp.employeeId,
//           firstName: emp.assignedUser?.first_name || "Unknown",
//           lastName: emp.assignedUser?.last_name || "",
//           department:
//             emp.assignedDepartment?.department_id?.departmentName || "Unknown",
//           branch: emp.assignedBranch?.branch_id?.branchName || "Unknown",
//         };
//       });

//       const employeeRecords = {};

//       records.forEach((record) => {
//         const empId = record.employeeId?.id;
//         if (!empId) return;

//         if (!employeeRecords[empId]) {
//           employeeRecords[empId] = [];
//         }

//         employeeRecords[empId].push(record);
//       });

//       const employeeSummaries = [];

//       for (const empId of employeeIds) {
//         const empDetails = employeeDetailsMap[empId];
//         if (!empDetails) continue;

//         const empRecords = employeeRecords[empId] || [];
//         const summary = calculateAttendanceSummary(
//           empRecords,
//           includeWeekoffs,
//           includeHolidays
//         );

//         employeeSummaries.push({
//           employeeId: empId,
//           employeeCode: empDetails.employeeId,
//           firstName: empDetails.firstName,
//           lastName: empDetails.lastName,
//           department: empDetails.department,
//           branch: empDetails.branch,
//           month: currentMonth,
//           monthName: getMonthName(currentMonth),
//           year: currentYear,
//           cycleStartDate: startDate,
//           cycleEndDate: endDate,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           ...summary,
//         });
//       }

//       return res.json({
//         data: employeeSummaries,
//         meta: {
//           tenantId,
//           month: currentMonth,
//           year: currentYear,
//           cycleStartDate: startDate,
//           cycleEndDate: endDate,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           totalEmployees,
//           page,
//           limit,
//           totalPages: Math.ceil(totalEmployees / limit),
//           search: searchTerm,
//         },
//       });
//     } catch (error) {
//       throw error;
//     }
//   }

//   async function getDateRangeAllEmployees(
//     req,
//     res,
//     attendanceService,
//     personalModuleService,
//     tenantId,
//     startDate,
//     endDate,
//     includeWeekoffs,
//     includeHolidays,
//     searchTerm,
//     page,
//     limit,
//     offset
//   ) {
//     try {
//       let personalModuleFilter = {
//         _and: [
//           {
//             assignedUser: {
//               tenant: { tenantId: { _eq: tenantId } },
//             },
//           },
//         ],
//       };

//       if (searchTerm) {
//         personalModuleFilter._and.push({
//           _or: [
//             { employeeId: { _icontains: searchTerm } },
//             { assignedUser: { first_name: { _icontains: searchTerm } } },
//             { assignedUser: { last_name: { _icontains: searchTerm } } },
//           ],
//         });
//       }

//       const totalEmployeesResult = await personalModuleService.readByQuery({
//         filter: personalModuleFilter,
//         fields: ["id"],
//         limit: -1,
//       });

//       const totalEmployees = totalEmployeesResult.length;

//       const paginatedEmployees = await personalModuleService.readByQuery({
//         filter: personalModuleFilter,
//         fields: [
//           "id",
//           "employeeId",
//           "assignedUser.first_name",
//           "assignedUser.last_name",
//           "assignedDepartment.department_id.departmentName",
//           "assignedBranch.branch_id.branchName",
//         ],
//         limit: limit,
//         offset: offset,
//       });

//       const employeeIds = paginatedEmployees.map((emp) => emp.id);

//       if (employeeIds.length === 0) {
//         return res.json({
//           data: [],
//           meta: {
//             tenantId,
//             startDate,
//             endDate,
//             startMonth: new Date(startDate).getMonth() + 1,
//             startYear: new Date(startDate).getFullYear(),
//             endMonth: new Date(endDate).getMonth() + 1,
//             endYear: new Date(endDate).getFullYear(),
//             totalEmployees: 0,
//             page,
//             limit,
//             totalPages: 0,
//             search: searchTerm,
//           },
//         });
//       }

//       const records = await attendanceService.readByQuery({
//         filter: {
//           _and: [
//             { date: { _between: [startDate, endDate] } },
//             { employeeId: { id: { _in: employeeIds } } },
//             { tenant: { tenantId: { _eq: tenantId } } },
//           ],
//         },
//         fields: [
//           "id",
//           "date",
//           "attendance",
//           "day",
//           "leaveType",
//           "overTime",
//           "lateBy",
//           "earlyDeparture",
//           "attendanceContext",
//           "employeeId.id",
//         ],
//         sort: ["date"],
//         limit: -1,
//       });

//       const employeeDetailsMap = {};
//       paginatedEmployees.forEach((emp) => {
//         employeeDetailsMap[emp.id] = {
//           employeeId: emp.employeeId,
//           firstName: emp.assignedUser?.first_name || "Unknown",
//           lastName: emp.assignedUser?.last_name || "",
//           department:
//             emp.assignedDepartment?.department_id?.departmentName || "Unknown",
//           branch: emp.assignedBranch?.branch_id?.branchName || "Unknown",
//         };
//       });

//       const employeeRecords = {};

//       records.forEach((record) => {
//         const empId = record.employeeId?.id;
//         if (!empId) return;

//         if (!employeeRecords[empId]) {
//           employeeRecords[empId] = [];
//         }

//         employeeRecords[empId].push(record);
//       });

//       const employeeSummaries = [];

//       for (const empId of employeeIds) {
//         const empDetails = employeeDetailsMap[empId];
//         if (!empDetails) continue;

//         const empRecords = employeeRecords[empId] || [];
//         const summary = calculateAttendanceSummary(
//           empRecords,
//           includeWeekoffs,
//           includeHolidays
//         );

//         employeeSummaries.push({
//           employeeId: empId,
//           employeeCode: empDetails.employeeId,
//           firstName: empDetails.firstName,
//           lastName: empDetails.lastName,
//           department: empDetails.department,
//           branch: empDetails.branch,
//           dateRangeStart: startDate,
//           dateRangeEnd: endDate,
//           ...summary,
//         });
//       }

//       const startDateObj = new Date(startDate);
//       const endDateObj = new Date(endDate);

//       return res.json({
//         data: employeeSummaries,
//         meta: {
//           tenantId,
//           startDate,
//           endDate,
//           startMonth: startDateObj.getMonth() + 1,
//           startYear: startDateObj.getFullYear(),
//           endMonth: endDateObj.getMonth() + 1,
//           endYear: endDateObj.getFullYear(),
//           totalEmployees,
//           page,
//           limit,
//           totalPages: Math.ceil(totalEmployees / limit),
//           search: searchTerm,
//         },
//       });
//     } catch (error) {
//       throw error;
//     }
//   }

//   async function getYearlySummary(
//     req,
//     res,
//     attendanceService,
//     employeeId,
//     tenantId,
//     year,
//     fixedCycle,
//     cycleStartDay,
//     cycleEndDay,
//     includeWeekoffs,
//     includeHolidays
//   ) {
//     try {
//       const monthlySummaries = [];

//       for (let month = 1; month <= 12; month++) {
//         const { startDate, endDate } = calculateDateRange(
//           year,
//           month,
//           fixedCycle,
//           cycleStartDay,
//           cycleEndDay
//         );

//         const records = await attendanceService.readByQuery({
//           filter: {
//             _and: [
//               { date: { _between: [startDate, endDate] } },
//               { employeeId: { id: { _eq: employeeId } } },
//               { tenant: { tenantId: { _eq: tenantId } } },
//             ],
//           },
//           fields: [
//             "id",
//             "date",
//             "attendance",
//             "day",
//             "leaveType",
//             "overTime",
//             "lateBy",
//             "earlyDeparture",
//             "attendanceContext",
//           ],
//           sort: ["date"],
//           limit: -1,
//         });

//         const monthlySummary = calculateAttendanceSummary(
//           records,
//           includeWeekoffs,
//           includeHolidays
//         );

//         monthlySummaries.push({
//           month,
//           monthName: getMonthName(month),
//           year,
//           cycleStartDate: startDate,
//           cycleEndDate: endDate,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           ...monthlySummary,
//         });
//       }

//       return res.json({
//         data: monthlySummaries,
//         meta: {
//           employeeId,
//           tenantId,
//           year,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           totalMonths: monthlySummaries.length,
//           includeWeekoffs,
//           includeHolidays,
//         },
//       });
//     } catch (error) {
//       throw error;
//     }
//   }

//   async function getMonthlyDetailedAttendance(
//     req,
//     res,
//     attendanceService,
//     employeeId,
//     tenantId,
//     year,
//     month,
//     fixedCycle,
//     cycleStartDay,
//     cycleEndDay,
//     includeWeekoffs,
//     includeHolidays
//   ) {
//     try {
//       const { startDate, endDate } = calculateDateRange(
//         year,
//         month,
//         fixedCycle,
//         cycleStartDay,
//         cycleEndDay
//       );

//       const records = await attendanceService.readByQuery({
//         filter: {
//           _and: [
//             { date: { _between: [startDate, endDate] } },
//             { employeeId: { id: { _eq: employeeId } } },
//             { tenant: { tenantId: { _eq: tenantId } } },
//           ],
//         },
//         fields: [
//           "id",
//           "date",
//           "attendance",
//           "day",
//           "leaveType",
//           "overTime",
//           "breakTime",
//           "lateBy",
//           "earlyDeparture",
//           "workHours",
//           "attendanceContext",
//         ],
//         sort: ["date"],
//         limit: -1,
//       });

//       const allDates = getAllDatesInRange(startDate, endDate);

//       const dailyAttendance = allDates.map((date) => {
//         const dateStr = date.toISOString().split("T")[0];
//         const record = records.find((r) => r.date === dateStr);

//         if (record) {
//           return {
//             date: dateStr,
//             dayOfWeek: getDayOfWeek(date),
//             status: record.attendance,
//             day: record.day,
//             leaveType: record.leaveType || null,
//             overTime: record.overTime || null,
//             breakTime: record.breakTime || null,
//             lateBy: record.lateBy || null,
//             earlyDeparture: record.earlyDeparture || null,
//             workHours: record.workHours || null,
//             attendanceContext: record.attendanceContext || null,
//           };
//         } else {
//           return {
//             date: dateStr,
//             dayOfWeek: getDayOfWeek(date),
//             status: "noRecord",
//             day: 0,
//             leaveType: null,
//             overTime: null,
//             breakTime: null,
//             lateBy: null,
//             earlyDeparture: null,
//             workHours: null,
//             attendanceContext: null,
//           };
//         }
//       });

//       const monthlySummary = calculateAttendanceSummary(
//         records,
//         includeWeekoffs,
//         includeHolidays
//       );

//       return res.json({
//         data: {
//           summary: {
//             month,
//             monthName: getMonthName(month),
//             year,
//             cycleStartDate: startDate,
//             cycleEndDate: endDate,
//             cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//             ...monthlySummary,
//           },
//           dailyRecords: dailyAttendance,
//         },
//         meta: {
//           employeeId,
//           tenantId,
//           year,
//           month,
//           cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
//           totalDays: dailyAttendance.length,
//           includeWeekoffs,
//           includeHolidays,
//         },
//       });
//     } catch (error) {
//       throw error;
//     }
//   }

//   function calculateDateRange(
//     year,
//     month,
//     fixedCycle,
//     cycleStartDay,
//     cycleEndDay
//   ) {
//     let startDate, endDate;

//     if (fixedCycle) {
//       startDate = new Date(year, month - 1, 1);
//       endDate = new Date(year, month, 0);
//     } else {
//       const prevMonth = month === 1 ? 12 : month - 1;
//       const prevMonthYear = month === 1 ? year - 1 : year;

//       startDate = new Date(prevMonthYear, prevMonth - 1, cycleStartDay);
//       endDate = new Date(year, month - 1, cycleEndDay);
//     }

//     return {
//       startDate: startDate.toISOString().split("T")[0],
//       endDate: endDate.toISOString().split("T")[0],
//     };
//   }

//   function calculateAttendanceSummary(
//     records,
//     includeWeekoffs,
//     includeHolidays
//   ) {
//     const summary = { ...DEFAULT_SUMMARY };

//     records.forEach((record) => {
//       let dayValue =
//         record.day && !isNaN(record.day) ? parseFloat(record.day) : 0;

//       let considerableDay = dayValue;
//       if (dayValue === 0.75) {
//         considerableDay = 1.0;
//       } else if (dayValue > 1) {
//         considerableDay = 1.0;
//       }

//       if (record.attendanceContext) {
//         const context = record.attendanceContext.toLowerCase();

//         if (context.includes("¼cl½p") || context.includes("1/4cl1/2p")) {
//           summary.present += 0.5;
//           summary.absent += 0.25;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("¼clp") || context.includes("1/4clp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("¼plp") || context.includes("1/4plp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("¼sl½p") || context.includes("1/4sl1/2p")) {
//           summary.present += 0.5;
//           summary.absent += 0.25;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("¼slp") || context.includes("1/4slp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.25;
//         } else if (context.includes("½p") || context.includes("1/2p")) {
//           if (
//             context.includes("due to continous late") ||
//             context.includes("(od)")
//           ) {
//             summary.present += 0.5;
//             summary.absent += 0.5;
//           } else {
//             summary.halfDay += 1.0;
//             summary.present += 0.5;
//             summary.absent += 0.5;
//           }
//         } else if (context.includes("½pl") || context.includes("1/2pl")) {
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½cl½p") || context.includes("1/2cl1/2p")) {
//           summary.present += 0.5;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½clp") || context.includes("1/2clp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½pl½p") || context.includes("1/2pl1/2p")) {
//           summary.present += 0.5;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½plp") || context.includes("1/2plp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½sl½p") || context.includes("1/2sl1/2p")) {
//           summary.present += 0.5;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("½slp") || context.includes("1/2slp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.5;
//         } else if (context.includes("¾cl") || context.includes("3/4cl")) {
//           summary.paidLeave += 0.75;
//         } else if (context.includes("¾slp") || context.includes("3/4slp")) {
//           summary.present += 1.0;
//           summary.paidLeave += 0.75;
//         } else if (context.includes("cl½p") || context.includes("cl1/2p")) {
//           summary.present += 0.5;
//           summary.paidLeave += 1.0;
//         } else if (context.includes("clp") && !context.includes("(od)")) {
//           summary.paidLeave += 1.0;
//         } else if (context.includes("pl")) {
//           summary.paidLeave += 1.0;
//         } else if (context.includes("sl")) {
//           summary.paidLeave += 1.0;
//         } else if (context.includes("wo½p") || context.includes("wo1/2p")) {
//           summary.weekoffPresent += 0.5;
//         } else if (context.includes("wop")) {
//           summary.weekoffPresent += 1.0;
//         } else if (context.includes("present") && !context.includes("leave")) {
//           summary.present += 1.0;
//         } else if (context.includes("absent")) {
//           summary.absent += 1.0;
//         } else if (
//           context.includes("weeklyoff") ||
//           context.includes("weekoff")
//         ) {
//           summary.weekOff += 1.0;
//         } else if (context.includes("holiday")) {
//           if (context.includes("present")) {
//             summary.holidayPresent += 1.0;
//           } else {
//             summary.holiday += 1.0;
//           }
//         } else if (
//           context.includes("workfromhome") ||
//           context.includes("wfh")
//         ) {
//           summary.workFromHome += 1.0;
//         } else if (context.includes("on leave") || context.includes("leave")) {
//           if (context.includes("cl") || context.includes("casual")) {
//             summary.paidLeave += dayValue;
//           } else if (context.includes("sl") || context.includes("sick")) {
//             summary.paidLeave += dayValue;
//           } else if (context.includes("pl") || context.includes("privilege")) {
//             summary.paidLeave += dayValue;
//           } else {
//             summary.paidLeave += dayValue;
//           }
//         }
//       } else {
//         switch (record.attendance) {
//           case "present":
//             summary.present += dayValue;
//             break;
//           case "absent":
//             summary.absent += dayValue;
//             break;
//           case "weekOff":
//             summary.weekOff += dayValue;
//             break;
//           case "holiday":
//             summary.holiday += dayValue;
//             break;
//           case "onDuty":
//             summary.onDuty += dayValue;
//             break;
//           case "workFromHome":
//             summary.workFromHome += dayValue;
//             break;
//           case "halfDay":
//             summary.halfDay += dayValue;
//             summary.present += dayValue;
//             summary.absent += 1 - dayValue;
//             break;
//           case "paidLeave":
//             summary.paidLeave += dayValue;
//             break;
//           case "unpaidLeave":
//             summary.unpaidLeave += dayValue;
//             break;
//           case "holidayPresent":
//             summary.holidayPresent += dayValue;
//             break;
//           case "weekoffPresent":
//             summary.weekoffPresent += dayValue;
//             break;
//         }
//       }

//       if (record.earlyDeparture && record.earlyDeparture !== "00:00:00") {
//         summary.earlyLeaving += 1;
//       }
//       if (record.lateBy && record.lateBy !== "00:00:00") {
//         summary.lateComing += 1;
//       }

//       if (record.overTime && record.overTime !== "00:00:00") {
//         switch (record.attendance) {
//           case "present":
//             summary.workingDayOT += 1;
//             break;
//           case "weekOff":
//           case "weekoffPresent":
//             summary.weekOffOT += 1;
//             break;
//           case "holiday":
//           case "holidayPresent":
//             summary.holidayOT += 1;
//             break;
//           case "workFromHome":
//             summary.workFromHomeOT += 1;
//             break;
//         }
//       }

//       let payableDay = considerableDay;

//       if (
//         includeWeekoffs &&
//         (record.attendance === "weekOff" ||
//           record.attendance === "weekoffPresent")
//       ) {
//         payableDay = considerableDay;
//       } else if (
//         includeHolidays &&
//         (record.attendance === "holiday" ||
//           record.attendance === "holidayPresent")
//       ) {
//         payableDay = considerableDay;
//       } else if (
//         record.attendance === "absent" ||
//         record.attendance === "unpaidLeave"
//       ) {
//         payableDay = 0;
//       } else if (record.attendance === "paidLeave") {
//         payableDay = considerableDay;
//       }

//       summary.totalPayableDays += payableDay;
//       summary.totalConsiderableDays += considerableDay;
//     });

//     return summary;
//   }

//   function getAllDatesInRange(startDateStr, endDateStr) {
//     const dates = [];
//     const startDate = new Date(startDateStr);
//     const endDate = new Date(endDateStr);

//     let currentDate = new Date(startDate);

//     while (currentDate <= endDate) {
//       dates.push(new Date(currentDate));
//       currentDate.setDate(currentDate.getDate() + 1);
//     }

//     return dates;
//   }

//   function getDayOfWeek(date) {
//     const days = [
//       "Sunday",
//       "Monday",
//       "Tuesday",
//       "Wednesday",
//       "Thursday",
//       "Friday",
//       "Saturday",
//     ];
//     return days[date.getDay()];
//   }

//   function getMonthName(monthNumber) {
//     const months = [
//       "January",
//       "February",
//       "March",
//       "April",
//       "May",
//       "June",
//       "July",
//       "August",
//       "September",
//       "October",
//       "November",
//       "December",
//     ];
//     return months[monthNumber - 1];
//   }
// };
module.exports = function registerEndpoint(router, { services }) {
  const { ItemsService } = services;

  const DEFAULT_SUMMARY = {
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
    totalDaysOfMonth: 0,
  };

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
          lastName: emp.assignedUser?.last_name || "",
          department:
            emp.assignedDepartment?.department_id?.departmentName || "Unknown",
          branch: emp.assignedBranch?.branch_id?.branchName || "Unknown",
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

        employeeSummaries.push({
          employeeId: empId,
          employeeCode: empDetails.employeeId,
          firstName: empDetails.firstName,
          lastName: empDetails.lastName,
          department: empDetails.department,
          branch: empDetails.branch,
          month: currentMonth,
          monthName: getMonthName(currentMonth),
          year: currentYear,
          cycleStartDate: startDate,
          cycleEndDate: endDate,
          cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
          lastName: emp.assignedUser?.last_name || "",
          department:
            emp.assignedDepartment?.department_id?.departmentName || "Unknown",
          branch: emp.assignedBranch?.branch_id?.branchName || "Unknown",
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

        employeeSummaries.push({
          employeeId: empId,
          employeeCode: empDetails.employeeId,
          firstName: empDetails.firstName,
          lastName: empDetails.lastName,
          department: empDetails.department,
          branch: empDetails.branch,
          dateRangeStart: startDate,
          dateRangeEnd: endDate,
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

        monthlySummaries.push({
          month,
          monthName: getMonthName(month),
          year,
          cycleStartDate: startDate,
          cycleEndDate: endDate,
          cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
          "breakTime",
          "lateBy",
          "earlyDeparture",
          "workHours",
          "attendanceContext",
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
            date: dateStr,
            attendance: record.attendance,
          };
        } else {
          return {
            date: dateStr,
            attendance: "noRecord",
          };
        }
      });

      const monthlySummary = calculateAttendanceSummary(
        records,
        includeWeekoffs,
        includeHolidays
      );

      return res.json({
        data: {
          summary: {
            month,
            monthName: getMonthName(month),
            year,
            cycleStartDate: startDate,
            cycleEndDate: endDate,
            cycleType: fixedCycle ? "Fixed Cycle" : "Custom Cycle",
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
        },
      });
    } catch (error) {
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

  function calculateAttendanceSummary(
    records,
    includeWeekoffs,
    includeHolidays
  ) {
    const summary = { ...DEFAULT_SUMMARY };

    records.forEach((record) => {
      let dayValue =
        record.day && !isNaN(record.day) ? parseFloat(record.day) : 0;

      let considerableDay = dayValue;
      if (dayValue === 0.75) {
        considerableDay = 1.0;
      } else if (dayValue > 1) {
        considerableDay = 1.0;
      }

      if (record.attendanceContext) {
        const context = record.attendanceContext.toLowerCase();

        if (context.includes("¼cl½p") || context.includes("1/4cl1/2p")) {
          summary.present += 0.5;
          summary.absent += 0.25;
          summary.paidLeave += 0.25;
        } else if (context.includes("¼clp") || context.includes("1/4clp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.25;
        } else if (context.includes("¼plp") || context.includes("1/4plp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.25;
        } else if (context.includes("¼sl½p") || context.includes("1/4sl1/2p")) {
          summary.present += 0.5;
          summary.absent += 0.25;
          summary.paidLeave += 0.25;
        } else if (context.includes("¼slp") || context.includes("1/4slp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.25;
        } else if (context.includes("½p") || context.includes("1/2p")) {
          if (
            context.includes("due to continous late") ||
            context.includes("(od)")
          ) {
            summary.present += 0.5;
            summary.absent += 0.5;
          } else {
            summary.halfDay += 1.0;
            summary.present += 0.5;
            summary.absent += 0.5;
          }
        } else if (context.includes("½pl") || context.includes("1/2pl")) {
          summary.paidLeave += 0.5;
        } else if (context.includes("½cl½p") || context.includes("1/2cl1/2p")) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
        } else if (context.includes("½clp") || context.includes("1/2clp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
        } else if (context.includes("½pl½p") || context.includes("1/2pl1/2p")) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
        } else if (context.includes("½plp") || context.includes("1/2plp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
        } else if (context.includes("½sl½p") || context.includes("1/2sl1/2p")) {
          summary.present += 0.5;
          summary.paidLeave += 0.5;
        } else if (context.includes("½slp") || context.includes("1/2slp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.5;
        } else if (context.includes("¾cl") || context.includes("3/4cl")) {
          summary.paidLeave += 0.75;
        } else if (context.includes("¾slp") || context.includes("3/4slp")) {
          summary.present += 1.0;
          summary.paidLeave += 0.75;
        } else if (context.includes("cl½p") || context.includes("cl1/2p")) {
          summary.present += 0.5;
          summary.paidLeave += 1.0;
        } else if (context.includes("clp") && !context.includes("(od)")) {
          summary.paidLeave += 1.0;
        } else if (context.includes("pl")) {
          summary.paidLeave += 1.0;
        } else if (context.includes("sl")) {
          summary.paidLeave += 1.0;
        } else if (context.includes("wo½p") || context.includes("wo1/2p")) {
          summary.weekoffPresent += 0.5;
        } else if (context.includes("wop")) {
          summary.weekoffPresent += 1.0;
        } else if (context.includes("present") && !context.includes("leave")) {
          summary.present += 1.0;
        } else if (context.includes("absent")) {
          summary.absent += 1.0;
        } else if (
          context.includes("weeklyoff") ||
          context.includes("weekoff")
        ) {
          summary.weekOff += 1.0;
        } else if (context.includes("holiday")) {
          if (context.includes("present")) {
            summary.holidayPresent += 1.0;
          } else {
            summary.holiday += 1.0;
          }
        } else if (
          context.includes("workfromhome") ||
          context.includes("wfh")
        ) {
          summary.workFromHome += 1.0;
        } else if (context.includes("on leave") || context.includes("leave")) {
          if (context.includes("cl") || context.includes("casual")) {
            summary.paidLeave += dayValue;
          } else if (context.includes("sl") || context.includes("sick")) {
            summary.paidLeave += dayValue;
          } else if (context.includes("pl") || context.includes("privilege")) {
            summary.paidLeave += dayValue;
          } else {
            summary.paidLeave += dayValue;
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
            summary.weekOff += dayValue;
            break;
          case "holiday":
            summary.holiday += dayValue;
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
          case "unpaidLeave":
            summary.unpaidLeave += dayValue;
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
        switch (record.attendance) {
          case "present":
            summary.workingDayOT += 1;
            break;
          case "weekOff":
          case "weekoffPresent":
            summary.weekOffOT += 1;
            break;
          case "holiday":
          case "holidayPresent":
            summary.holidayOT += 1;
            break;
          case "workFromHome":
            summary.workFromHomeOT += 1;
            break;
        }
      }

      let payableDay = considerableDay;

      if (
        includeWeekoffs &&
        (record.attendance === "weekOff" ||
          record.attendance === "weekoffPresent")
      ) {
        payableDay = considerableDay;
      } else if (
        includeHolidays &&
        (record.attendance === "holiday" ||
          record.attendance === "holidayPresent")
      ) {
        payableDay = considerableDay;
      } else if (
        record.attendance === "absent" ||
        record.attendance === "unpaidLeave"
      ) {
        payableDay = 0;
      } else if (record.attendance === "paidLeave") {
        payableDay = considerableDay;
      }

      summary.totalPayableDays += payableDay;
      summary.totalDaysOfMonth += considerableDay;
    });

    if (records.length > 0) {
      const firstRecordDate = new Date(records[0].date);
      const year = firstRecordDate.getFullYear();
      const month = firstRecordDate.getMonth() + 1;

      const totalDaysInMonth = new Date(year, month, 0).getDate();
      summary.totalDaysOfMonth = totalDaysInMonth;
    } else {
      const now = new Date();
      const totalDaysInMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0
      ).getDate();
      summary.totalDaysOfMonth = totalDaysInMonth;
    }

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

  function getDayOfWeek(date) {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[date.getDay()];
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
