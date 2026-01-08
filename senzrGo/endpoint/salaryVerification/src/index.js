function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default")
    ? x["default"]
    : x;
}

// ==================== UTILITY FUNCTIONS ====================

function getYearMonth(date) {
  const d = new Date(date);
  return {
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, "0"),
  };
}

function findNearestPreviousMonth(dataByYear, targetYear, targetMonth) {
  if (!dataByYear || dataByYear === null) return null;
  if (!dataByYear[targetYear]) return null;

  const availableMonths = Object.keys(dataByYear[targetYear])
    .map(Number)
    .filter((m) => m <= Number(targetMonth))
    .sort((a, b) => b - a);

  if (availableMonths.length === 0) return null;

  const nearestMonth = String(availableMonths[0]).padStart(2, "0");
  return dataByYear[targetYear][nearestMonth];
}

// ==================== VALIDATION FUNCTIONS ====================

function validateQueryParameters(query) {
  const { startDate, endDate, totalDays } = query;

  if (!startDate || !endDate) {
    return {
      valid: false,
      error: "startDate and endDate are required in query parameters",
    };
  }

  if (!totalDays) {
    return { valid: false, error: "totalDays is required in query parameters" };
  }

  return { valid: true };
}

function extractEmployeeIds(query) {
  if (query.filter?.employeeIds?._in) {
    const ids = query.filter.employeeIds._in.split(",").map((id) => id.trim());
    return ids.length
      ? { valid: true, ids }
      : { valid: false, error: "Employee IDs required" };
  }
  return {
    valid: false,
    error: "Employee IDs required in filter[employeeIds][_in] parameter",
  };
}

// ==================== DATA FETCHING FUNCTIONS ====================

async function fetchPersonalModuleData(ItemsService, req, employeeIds) {
  const personalModuleService = new ItemsService("personalModule", {
    schema: req.schema,
    accountability: req.accountability,
  });

  return await personalModuleService.readByQuery({
    filter: { id: { _in: employeeIds } },
    fields: [
      "id",
      "employeeId",
      "assignedUser.first_name",
      "assignedUser.gender",
      "assignedUser.PFAccountNumber",
      "assignedUser.ESIAccountNumber",
      "config.attendancePolicies",
      "config.attendancePolicies.lateCommingFineType",
      "config.attendancePolicies.earlyExitAllowed",
      "config.attendancePolicies.earlyLeavingfineType",
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
      "config.attendancePolicies.workingHoursAmount",
      "config.attendancePolicies.wrkHoursFineType",
      "config.attendancePolicies.workinghrsDaysLimit",
      "config.attendancePolicies.earlyExitPenaltyAmt",
      "config.attendancePolicies.extraHoursPay",
      "config.attendancePolicies.weekOffPay",
      "config.attendancePolicies.publicHolidayPay",
      "config.attendancePolicies.weekOffType",
      "config.attendancePolicies.publicHolidayType",
      "config.attendancePolicies.extraHoursType",
      "config.attendancePolicies.TotalWorking_Hours",
      "config.attendanceSettings",
      "assignedUser.pfTracking",
      "assignedUser.esiTracking",
      "salaryConfigTracking",
    ],
    sort: ["-date_updated"],
    limit: -1,
  });
}

async function fetchSalaryBreakdown(ItemsService, req, employeeIds) {
  const salaryBreakdownService = new ItemsService("SalaryBreakdown", {
    schema: req.schema,
    accountability: req.accountability,
  });

  return await salaryBreakdownService.readByQuery({
    filter: { employee: { _in: employeeIds } },
    fields: [
      "ctc",
      "employee.id",
      "employee.employeeId",
      "basicSalary",
      "basicPay",
      "earnings",
      "employersContribution",
      "employeeDeduction",
      "individualDeduction",
      "voluntaryPF",
      "salaryArrears",
      "totalEarnings",
      "deduction",
      "totalDeductions",
      "netSalary",
      "professionalTax",
      "LWF",
      "PT",
      "employerLwf",
      "employeeLwf",
      "employeradmin",
      "anualEarnings",
      "annualDeduction",
      "bonus",
      "incentive",
      "retentionPay",
      "loanDebit",
      "loanCredit",
      "advance",
      "id",
      "salaryTracking",
      "statutory",
      "country",
    ],
    limit: -1,
  });
}

async function fetchPayrollVerification(
  ItemsService,
  req,
  employeeIds,
  startDate,
  endDate
) {
  const payrollVerificationService = new ItemsService("payrollVerification", {
    schema: req.schema,
    accountability: req.accountability,
  });

  return await payrollVerificationService.readByQuery({
    filter: {
      employee: { id: { _in: employeeIds } },
      startDate: {
        _between: [
          new Date(startDate).toISOString(),
          new Date(endDate).toISOString(),
        ],
      },
    },
    fields: ["payableDays", "employee.id", "id", "totalAttendanceCount"],
    limit: -1,
  });
}
// ====================  FETCH ESI LIMIT FROM MINIMUM WAGES ====================

async function fetchEsiLimit(ItemsService, req, year) {
  const service = new ItemsService("minimumWages", {
    schema: req.schema,
    accountability: req.accountability,
  });

  const records = await service.readByQuery({
    fields: ["esiLimit"],
    limit: 1,
  });

  if (!records.length || !records[0].esiLimit) return null;

  const esiLimitData = records[0].esiLimit;

  // Try exact year match first
  if (esiLimitData[year]) {
    return esiLimitData[year].esiLimit;
  }

  // Find nearest previous year
  const availableYears = Object.keys(esiLimitData)
    .map(Number)
    .filter((y) => y <= Number(year))
    .sort((a, b) => b - a);

  if (availableYears.length > 0) {
    return esiLimitData[availableYears[0]].esiLimit;
  }

  return null;
}
// ====================  STATE TAX RULES FETCHING ====================

async function fetchStateTaxRules(ItemsService, req, stateIds) {
  const idsForFilter = Array.isArray(stateIds)
    ? Array.isArray(stateIds[0])
      ? stateIds.flat()
      : stateIds
    : [stateIds];

  if (idsForFilter.length === 0) return {};

  const service = new ItemsService("tax", {
    schema: req.schema,
    accountability: req.accountability,
  });

  const records = await service.readByQuery({
    filter: { id: { _in: idsForFilter } },
    fields: ["id", "stateTaxRules"],
    limit: -1,
  });

  // ✅ ONLY THIS
  console.log(
    "[fetchStateTaxRules] Response records:",
    JSON.stringify(records, null, 2)
  );

  return JSON.stringify(records, null, 2);
}

// LWF ID
function extractStateIdFromBreakdown(salaryBreakdown, endDate, field = "LWF") {
  // ADD NULL CHECK
  if (!salaryBreakdown?.[field] || salaryBreakdown[field] === null) {
    return null;
  }

  const { year, month } = getYearMonth(endDate);

  const data =
    salaryBreakdown[field][year]?.[month] ||
    findNearestPreviousMonth(salaryBreakdown[field], year, month) ||
    {};

  return data.state ?? null;
}

// REPLACE THE ENTIRE FUNCTION:
function calculatePTFromRules(stateTaxRules, gender, monthlyCtc, currentMonth) {
  console.log(
    `[calculatePTFromRules] INPUT - gender: ${gender}, monthlyCtc: ${monthlyCtc}, month: ${currentMonth}`
  ); // CHANGED
  console.log(
    `[calculatePTFromRules] stateTaxRules structure:`,
    JSON.stringify(stateTaxRules, null, 2)
  ); // ADD THIS

  // CHANGED: Extract PT array from the rules object
  const ptArray = stateTaxRules?.PT || [];

  console.log(
    `[calculatePTFromRules] Extracted PT array (${ptArray.length} rules):`,
    JSON.stringify(ptArray, null, 2)
  ); // ADD THIS

  if (!ptArray.length || monthlyCtc == null) {
    console.log(
      `[calculatePTFromRules] ❌ No PT array or invalid CTC - returning 0`
    ); // CHANGED
    return 0;
  }

  // Filter by gender
  const candidates = gender
    ? ptArray.filter((r) => r.gender?.toLowerCase() === gender.toLowerCase())
    : ptArray.filter((r) => !r.gender);

  console.log(
    `[calculatePTFromRules] Gender filter (${gender}) → ${candidates.length} candidates:`,
    JSON.stringify(candidates, null, 2)
  ); // CHANGED

  // Find matching salary range
  const rule = candidates.find((r) => {
    const match = r.salaryRange.match(/(\d+)?\s*-?\s*(\d+)?\s*(and above)?/i);
    if (!match) {
      console.log(
        `[calculatePTFromRules] ⚠️ Invalid range format: "${r.salaryRange}"`
      ); // ADD THIS
      return false;
    }

    const low = match[1] ? Number(match[1]) : 0;
    const high = match[2] ? Number(match[2]) : Infinity;
    const above = !!match[3];

    const isMatch = above
      ? monthlyCtc >= low
      : monthlyCtc >= low && monthlyCtc <= high;
    console.log(
      `[calculatePTFromRules] Range "${r.salaryRange
      }": low=${low}, high=${high}, CTC=${monthlyCtc} → ${isMatch ? "✅ MATCH" : "❌"
      }`
    ); // CHANGED
    return isMatch;
  });

  const amount = rule?.professionalTax || 0;
  console.log(
    `[calculatePTFromRules] ✅ FINAL RESULT:`,
    rule
      ? `Rule matched: ${rule.salaryRange} → PT = ${amount}`
      : `No rule matched → PT = 0`
  ); // CHANGED
  return amount;
}

function getLWFFromBreakdown(salaryBreakdown, endDate, stateTaxRulesById) {
  const { year, month } = getYearMonth(endDate);

  // ADD NULL CHECK
  if (!salaryBreakdown?.LWF || salaryBreakdown.LWF === null) {
    return { employerLWF: 0, employeeLWF: 0, state: null };
  }

  const storedExact =
    salaryBreakdown.LWF[year]?.[month] ||
    findNearestPreviousMonth(salaryBreakdown.LWF, year, month) ||
    {};

  const storedStateId = storedExact.state ?? null;
  const stored = {
    employerLWF: storedExact.employer || 0,
    employeeLWF: storedExact.employee || 0,
    state: storedStateId,
  };

  const normalizedStateId = storedStateId ? Number(storedStateId) : null;

  console.log(
    `[getLWFFromBreakdown] storedStateId: ${storedStateId}, normalizedStateId: ${normalizedStateId}`
  ); // ADD THIS

  if (
    normalizedStateId &&
    !isNaN(normalizedStateId) &&
    stateTaxRulesById[normalizedStateId]
  ) {
    const rules = stateTaxRulesById[normalizedStateId];
    console.log(
      `[getLWFFromBreakdown] Found rules for state ${normalizedStateId}:`,
      JSON.stringify(rules, null, 2)
    ); // ADD THIS
    return getLWFFromRules(rules, endDate); // CHANGED: Pass endDate
  }

  console.log(
    `[getLWFFromBreakdown] No rules found, returning stored values:`,
    stored
  ); // ADD THIS
  return stored;
}
// REPLACE THE ENTIRE FUNCTION

function getLWFFromRules(stateTaxRules, startDate, endDate) {
  console.log(
    `[getLWFFromRules] Input rules:`,
    JSON.stringify(stateTaxRules, null, 2)
  );
  console.log(`[getLWFFromRules] Date range: ${startDate} to ${endDate}`); // ADD THIS

  if (!stateTaxRules?.LWF) {
    console.log(`[getLWFFromRules] No LWF in rules`); // ADD THIS
    return { employerLWF: 0, employeeLWF: 0, state: null };
  }

  const lwfData = stateTaxRules.LWF;
  // REPLACE the date checking logic:
  const deductionDates = lwfData.Deduction || [];

  console.log(
    `[getLWFFromRules] Deduction dates:`,
    deductionDates,
    `| startDate: ${startDate}, endDate: ${endDate}`
  ); // CHANGED

  let isWithinDeductionPeriod = false;

  if (deductionDates.length === 2) {
    const [startDeduction, endDeduction] = deductionDates;

    // Parse dates (format: "DD-MM")
    const [startDay, startMonth] = startDeduction.split("-").map(Number);
    const [endDay, endMonth] = endDeduction.split("-").map(Number);

    // CHANGED: Use both startDate and endDate from parameters
    const payrollStart = new Date(startDate);
    const payrollEnd = new Date(endDate);
    const year = payrollEnd.getFullYear();

    const rangeStart = new Date(year, startMonth - 1, startDay);
    const rangeEnd = new Date(year, endMonth - 1, endDay);

    console.log(
      `[getLWFFromRules] Payroll period: ${payrollStart.toISOString().split("T")[0]
      } to ${payrollEnd.toISOString().split("T")[0]}`
    ); // ADD THIS
    console.log(
      `[getLWFFromRules] LWF deduction period: ${rangeStart.toISOString().split("T")[0]
      } to ${rangeEnd.toISOString().split("T")[0]}`
    ); // ADD THIS

    // CHANGED: Check if payroll period overlaps with deduction period
    isWithinDeductionPeriod =
      payrollStart <= rangeEnd && payrollEnd >= rangeStart;
  }

  console.log(
    `[getLWFFromRules] Is within deduction period: ${isWithinDeductionPeriod}`
  );

  if (!isWithinDeductionPeriod) {
    console.log(`[getLWFFromRules] Not in deduction period, returning 0`); // ADD THIS
    return {
      employerLWF: 0,
      employeeLWF: 0,
      state: stateTaxRules.stateId ?? null,
    };
  }

  const employerLWF = lwfData.EmployerLWF || 0;
  const employeeLWF = lwfData.EmployeeLWF || 0;

  console.log(
    `[getLWFFromRules] Returning LWF: Employer=${employerLWF}, Employee=${employeeLWF}`
  ); // ADD THIS

  return {
    employerLWF: employerLWF,
    employeeLWF: employeeLWF,
    state: stateTaxRules.stateId ?? null,
  };
}
// MONTHLY CTC
function getMonthlyCTCFromTracking(salaryTracking, endDate) {
  const { year, month } = getYearMonth(endDate);

  // Try to find exact month match
  const monthKey = `${month}/${year}`;
  if (salaryTracking?.[monthKey]) {
    return Number(salaryTracking[monthKey]);
  }

  // If no exact match, find nearest previous month
  if (!salaryTracking) return 0;

  const entries = Object.entries(salaryTracking)
    .map(([key, value]) => {
      const [m, y] = key.split("/");
      return {
        year: y,
        month: m.padStart(2, "0"),
        value: Number(value),
        date: new Date(`${y}-${m.padStart(2, "0")}-01`),
      };
    })
    .filter((entry) => entry.date <= new Date(`${year}-${month}-01`))
    .sort((a, b) => b.date - a.date);

  return entries.length > 0 ? entries[0].value : 0;
}
function getCountryFromBreakdown(salaryBreakdown, endDate) {
  const { year, month } = getYearMonth(endDate);

  if (!salaryBreakdown?.country || salaryBreakdown.country === null) {
    return null;
  }

  const countryExact =
    salaryBreakdown.country[year]?.[month] ||
    findNearestPreviousMonth(salaryBreakdown.country, year, month);

  return countryExact || null;
}
// ==================== EARNINGS & DEDUCTIONS FROM SALARY BREAKDOWN ====================

function getEarningsFromBreakdown(salaryBreakdown, endDate) {
  const { year, month } = getYearMonth(endDate);

  const earnings =
    salaryBreakdown?.earnings?.[year]?.[month] ||
    findNearestPreviousMonth(salaryBreakdown?.earnings, year, month) ||
    {};

  return earnings;
}

function getDeductionsFromBreakdown(salaryBreakdown, endDate) {
  const { year, month } = getYearMonth(endDate);

  const deductions =
    salaryBreakdown?.deduction?.[year]?.[month] ||
    findNearestPreviousMonth(salaryBreakdown?.deduction, year, month) ||
    {};

  return deductions;
}
function getEmployeeDeductionsFromBreakdown(
  salaryBreakdown,
  endDate,
  adjustedEarnings,
  monthlyCtc,
  esiLimit
) {
  const { year, month } = getYearMonth(endDate);

  console.log("🗓 Processing Employee Deductions for:", { year, month });

  const monthlyData =
    salaryBreakdown?.employeeDeduction?.[year]?.[month] ||
    findNearestPreviousMonth(salaryBreakdown?.employeeDeduction, year, month) ||
    {};

  console.log("📦 Employee Monthly Data:", monthlyData);

  const fallback = {
    EmployeePF: salaryBreakdown?.employeeDeduction?.EmployeePF || 0,
    EmployeeESI: salaryBreakdown?.employeeDeduction?.EmployeeESI || 0,
    VoluntaryPF: salaryBreakdown?.employeeDeduction?.VoluntaryPF || 0,
  };

  const resolveCalculationAmount = (config) => {
    if (!config?.Calculations || !Array.isArray(config.Calculations)) return 0;

    let total = 0;
    config.Calculations.forEach((compName) => {
      const amount = adjustedEarnings[compName];
      console.log(`🧮 Resolving Component [${compName}]:`, amount);
      if (typeof amount === "number") total += amount;
    });
    return total;
  };

  // Calculate Employee PF
  const pfConfig = monthlyData.EmployeePF || {};
  console.log("🧩 Employee PF Config:", pfConfig);
  console.log("🧾 Adjusted Earnings for PF:", adjustedEarnings);

  let employeePF = 0;
  let employeePFBase = 0;
  const pfConfigData = {};
  if (pfConfig.selectedOption != null) {
    const baseAmount = resolveCalculationAmount(pfConfig);
    console.log("📊 Employee PF Base Amount Calculated:", baseAmount);
    employeePFBase = baseAmount;
    Object.assign(pfConfigData, pfConfig);
    if (pfConfig.selectedOption === 1800) {
      employeePF = Math.min(baseAmount * 0.12, 1800);
    } else if (pfConfig.selectedOption === 12) {
      const percentage = 12 / 100;
      employeePF = baseAmount * percentage;
    }
  } else {
    employeePF = fallback.EmployeePF;
    console.warn("⚠️ Employee PF using fallback value:", employeePF);
  }

  // Calculate Employee ESI
  const esiConfig = monthlyData.EmployeeESI || {};
  console.log("🧩 Employee ESI Config:", esiConfig);
  console.log("🧾 Adjusted Earnings for ESI:", adjustedEarnings);

  let employeeESI = 0;
  let employeeESIBase = 0;
  const esiConfigData = {};
  if (esiConfig.selectedOption === 0.75) {
    const baseAmount = resolveCalculationAmount(esiConfig);
    console.log("📊 Employee ESI Base Amount Calculated:", baseAmount);
    employeeESIBase = baseAmount;
    Object.assign(esiConfigData, esiConfig);

    if (esiLimit != null && monthlyCtc > esiLimit) {
      console.warn("⚠️ Skipping Employee ESI (CTC exceeds limit)", {
        monthlyCtc,
        esiLimit,
      });
      employeeESI = 0;
    } else {
      const percentage = 0.75 / 100;
      employeeESI = baseAmount * percentage;
    }
  } else {
    console.warn("⚠️ Employee ESI config missing or invalid.");
    employeeESI = 0;
  }

  const voluntaryPF = monthlyData.VoluntaryPF ?? fallback.VoluntaryPF;

  console.log("✅ Employee Deductions Calculated:", {
    employeePF,
    employeePFBase,
    employeeESI,
    employeeESIBase,
    voluntaryPF,
  });

  return {
    employeePF: Math.round(employeePF),
    employeePFBase: Math.round(employeePFBase),
    employeePFConfig: pfConfigData,
    employeeESI: Math.round(employeeESI),
    employeeESIBase: Math.round(employeeESIBase),
    employeeESIConfig: esiConfigData,
    voluntaryPF: Math.round(voluntaryPF),
  };
}

async function getEmployerContributionsFromBreakdown(
  salaryBreakdown,
  endDate,
  adjustedEarnings,
  ItemsService,
  req,
  monthlyCtc
) {
  const { year, month } = getYearMonth(endDate);
  console.log("🗓 Processing Employer Contributions for:", { year, month });

  const monthlyData =
    salaryBreakdown?.employersContribution?.[year]?.[month] ||
    findNearestPreviousMonth(
      salaryBreakdown?.employersContribution,
      year,
      month
    ) ||
    {};

  console.log("📦 Employer Monthly Data:", monthlyData);

  const resolveCalculationAmount = (config) => {
    if (!config?.Calculations || !Array.isArray(config.Calculations)) return 0;

    let total = 0;
    config.Calculations.forEach((compName) => {
      const amount = adjustedEarnings[compName];
      console.log(`🧮 Resolving Employer Component [${compName}]:`, amount);
      if (typeof amount === "number") total += amount;
    });
    return total;
  };

  // Calculate Employer PF
  const pfConfig = monthlyData.EmployerPF || {};
  console.log("🧩 Employer PF Config:", pfConfig);
  console.log("🧾 Adjusted Earnings for Employer PF:", adjustedEarnings);

  let employerPF = { amount: 0, baseAmount: 0, includedInCTC: false };

  if (pfConfig.selectedOption != null) {
    const baseAmount = resolveCalculationAmount(pfConfig);
    console.log("📊 Employer PF Base Amount Calculated:", baseAmount);
    let calculated = 0;

    if (pfConfig.selectedOption === 1800) {
      calculated = Math.min(baseAmount * 0.12, 1800);
    } else if (pfConfig.selectedOption === 12) {
      const percentage = 12 / 100;
      calculated = baseAmount * percentage;
    }

    employerPF = {
      amount: Math.round(calculated),
      baseAmount: Math.round(baseAmount),
      includedInCTC:
        pfConfig.withinCTC === "true" || pfConfig.withinCTC === true,
    };
  } else {
    console.warn("⚠️ Employer PF config missing or null.");
  }

  // Calculate Employer ESI
  const esiConfig = monthlyData.EmployerESI || {};
  console.log("🧩 Employer ESI Config:", esiConfig);
  console.log("🧾 Adjusted Earnings for Employer ESI:", adjustedEarnings);

  let employerESI = { amount: 0, baseAmount: 0, includedInCTC: false };
  let esiLimit = null;

  if (esiConfig.selectedOption === 3.25) {
    const baseAmount = resolveCalculationAmount(esiConfig);
    console.log("📊 Employer ESI Base Amount Calculated:", baseAmount);
    const percentage = 3.25 / 100;
    let calculated = 0;

    if (esiConfig.capped === true) {
      esiLimit = await fetchEsiLimit(ItemsService, req, year);
      console.log("📏 ESI Limit Retrieved:", esiLimit);

      if (esiLimit != null && monthlyCtc > esiLimit) {
        console.warn("⚠️ Skipping Employer ESI (CTC exceeds limit)", {
          monthlyCtc,
          esiLimit,
        });
        calculated = 0;
      } else {
        calculated = baseAmount * percentage;
      }
    } else {
      calculated = baseAmount * percentage;
    }

    employerESI = {
      amount: Math.round(calculated),
      baseAmount: Math.round(baseAmount),
      includedInCTC:
        esiConfig.withinCTC === "true" || esiConfig.withinCTC === true,
    };
  } else {
    console.warn("⚠️ Employer ESI config missing or invalid.");
  }

  console.log("✅ Employer Contributions Calculated:", {
    employerPF,
    employerESI,
    esiLimit,
  });

  return {
    employerPF,
    employerESI,
    esiLimit,
  };
}
// ADD THIS NEW FUNCTION after getEmployerContributionsFromBreakdown:

function getStatutoryContributionsFromBreakdown(
  salaryBreakdown,
  endDate,
  adjustedEarnings
) {
  const { year, month } = getYearMonth(endDate);

  console.log("🗓 Processing Statutory Contributions for:", { year, month });

  const monthlyData =
    salaryBreakdown?.statutory?.[year]?.[month] ||
    findNearestPreviousMonth(salaryBreakdown?.statutory, year, month) ||
    {};

  console.log("📦 Statutory Monthly Data:", monthlyData);

  const resolveCalculationAmount = (config) => {
    if (!config?.components || !Array.isArray(config.components)) return 0;

    let total = 0;
    config.components.forEach((compName) => {
      const amount = adjustedEarnings[compName];
      console.log(`🧮 Resolving Statutory Component [${compName}]:`, amount);
      if (typeof amount === "number") total += amount;
    });
    return total;
  };

  // Calculate Employee PF from statutory
  const empPFConfig = monthlyData.EmployeePF || {};
  console.log("🧩 Statutory Employee PF Config:", empPFConfig);

  let employeePF = 0;
  let employeePFBase = 0;
  const empPFConfigData = {};

  if (empPFConfig.selectedOption && empPFConfig.selectedOption !== "No Value") {
    const baseAmount = resolveCalculationAmount(empPFConfig);
    console.log("📊 Statutory Employee PF Base Amount:", baseAmount);
    employeePFBase = baseAmount;
    Object.assign(empPFConfigData, empPFConfig);

    const percentageMatch = empPFConfig.selectedOption.match(/[\d.]+/);
    if (percentageMatch) {
      const percentage = parseFloat(percentageMatch[0]) / 100;
      employeePF = baseAmount * percentage;
    }
  }

  // Calculate Employer PF from statutory
  const empRPFConfig = monthlyData.EmployerPF || {};
  console.log("🧩 Statutory Employer PF Config:", empRPFConfig);

  let employerPF = 0;
  let employerPFBase = 0;
  const empRPFConfigData = {};

  if (
    empRPFConfig.selectedOption &&
    empRPFConfig.selectedOption !== "No Value"
  ) {
    const baseAmount = resolveCalculationAmount(empRPFConfig);
    console.log("📊 Statutory Employer PF Base Amount:", baseAmount);
    employerPFBase = baseAmount;
    Object.assign(empRPFConfigData, empRPFConfig);

    const percentageMatch = empRPFConfig.selectedOption.match(/[\d.]+/);
    if (percentageMatch) {
      const percentage = parseFloat(percentageMatch[0]) / 100;
      employerPF = baseAmount * percentage;
    }
  }

  // Calculate Government PF from statutory
  const govPFConfig = monthlyData.GovernmentPF || {};
  console.log("🧩 Statutory Government PF Config:", govPFConfig);

  let governmentPF = 0;
  let governmentPFBase = 0;
  const govPFConfigData = {};

  if (govPFConfig.selectedOption && govPFConfig.selectedOption !== "No Value") {
    const baseAmount = resolveCalculationAmount(govPFConfig);
    governmentPFBase = baseAmount;
    Object.assign(govPFConfigData, govPFConfig);

    const percentageMatch = govPFConfig.selectedOption.match(/[\d.]+/);
    if (percentageMatch) {
      const percentage = parseFloat(percentageMatch[0]) / 100;
      governmentPF = baseAmount * percentage;
    }
  }

  return {
    employeePF: Math.round(employeePF),
    employeePFBase: Math.round(employeePFBase),
    employeePFConfig: empPFConfigData,
    employerPF: Math.round(employerPF),
    employerPFBase: Math.round(employerPFBase),
    employerPFConfig: empRPFConfigData,
    governmentPF: Math.round(governmentPF),
    governmentPFBase: Math.round(governmentPFBase),
    governmentPFConfig: govPFConfigData,
  };
}

// ==================== ADJUSTMENT FOR PAYABLE DAYS ====================

function adjustAmountsForPayableDays(amounts, totalDays, payableDays) {
  const adjusted = {};
  const ratio = payableDays / Number(totalDays);

  for (const [key, value] of Object.entries(amounts)) {
    if (typeof value === "object" && value !== null && "Amount" in value) {
      if (value.Condition === "On Attendance") {
        adjusted[key] = value.Amount * ratio;
      } else {
        adjusted[key] = value.Amount;
      }
    } else {
      adjusted[key] = value * ratio;
    }
  }

  return adjusted;
}

// ==================== ADMIN CHARGE CALCULATION ====================

function calculateAdminChargeFromBreakdown(
  employerContributions,
  salaryBreakdown,
  endDate
) {
  const { year, month } = getYearMonth(endDate);

  const adminData =
    salaryBreakdown?.employeradmin?.[year]?.[month] ||
    findNearestPreviousMonth(salaryBreakdown?.employeradmin, year, month) ||
    {};

  if (!adminData.Enable) {
    return { name: "AdminCharge", rupee: 0 };
  }

  const chargePercentage = adminData.Charge || 0;
  const employerPFBaseAmount = employerContributions.employerPF.baseAmount;
  console.log("employerPFBaseAmount", employerPFBaseAmount);
  const calculated = (chargePercentage / 100) * employerPFBaseAmount;

  return {
    name: "AdminCharge",
    rupee: Math.round(Math.min(calculated, 150)),
  };
}

function extractOtherDeductions(salaryBreakdown, endDate) {
  const { year, month } = getYearMonth(endDate);
  const otherDeductions = {};

  if (salaryBreakdown?.individualDeduction) {
    const deductionsForMonth =
      salaryBreakdown.individualDeduction?.[year]?.[month] || {};

    Object.entries(deductionsForMonth).forEach(([key, deduction]) => {
      if (key !== "totalAmount") {
        otherDeductions[deduction.name] = deduction.amount;
      }
    });
  }

  return otherDeductions;
}

function extractMonthlyAmount(data, endDate, key = "totalAmount") {
  const { year, month } = getYearMonth(endDate);
  const amounts = {};

  if (data) {
    const monthData = data?.[year]?.[month] || {};

    Object.entries(monthData).forEach(([k, value]) => {
      if (k === key) {
        amounts[key] = value;
      }
    });
  }

  return amounts;
}

function extractSalaryArrears(salaryBreakdown, endDate) {
  const { year, month } = getYearMonth(endDate);
  const pendingEarnings = {};
  let totalAmount = 0;

  if (salaryBreakdown?.salaryArrears) {
    const arrearsForMonth =
      salaryBreakdown.salaryArrears?.[year]?.[month] || {};

    Object.entries(arrearsForMonth).forEach(([key, arrear]) => {
      if (key !== "totalAmount") {
        const amount = parseFloat(arrear.amount || 0);
        pendingEarnings[arrear.name] = amount;
        totalAmount += amount;
      }
    });
  }

  return { pendingEarnings, totalAmount };
}

function extractBonusIncentiveDetails(salaryBreakdown, endDate) {
  const { year, month } = getYearMonth(endDate);

  const extractDetails = (data) => {
    return (
      (data?.[year]?.[month] &&
        Object.entries(data[year][month])
          .filter(([key]) => key !== "totalAmount")
          .map(([, value]) => ({
            reason: value.reason,
            amount: value.amount,
          }))) ||
      []
    );
  };

  return {
    bonusDetails: extractDetails(salaryBreakdown?.bonus),
    incentiveDetails: extractDetails(salaryBreakdown?.incentive),
    retentionDetails: extractDetails(salaryBreakdown?.retentionPay),
  };
}

// ==================== ATTENDANCE PENALTIES & OT ====================

function calculateLateEntryPenalty(
  attendancePolicy,
  totalAttendanceCount,
  perHourSalary
) {
  if (attendancePolicy?.lateComingType !== "fixed") return 0;

  const penaltyAmount = Number(attendancePolicy.lateEntryPenaltyAmt || 0);
  const hoursOnly = Number(
    (totalAttendanceCount?.totalLateDuration || "0:0").split(":")[0]
  );

  if (attendancePolicy.lateCommingFineType === "Custom Multiplier") {
    return penaltyAmount * perHourSalary * hoursOnly;
  }
  return penaltyAmount * hoursOnly;
}

function calculateEarlyLeavingPenalty(
  attendancePolicy,
  totalAttendanceCount,
  perHourSalary
) {
  if (attendancePolicy?.earlyLeavingType !== "fixed") return 0;

  const penaltyAmount = Number(attendancePolicy.earlyExitPenaltyAmt || 0);
  const hoursOnly = Number(
    (totalAttendanceCount?.totalEarlyDuration || "0:0").split(":")[0]
  );

  if (attendancePolicy.earlyLeavingfineType === "Custom Multiplier") {
    return penaltyAmount * perHourSalary * hoursOnly;
  }
  return penaltyAmount * hoursOnly;
}

function calculateWorkingHourPenalty(
  attendancePolicy,
  totalAttendanceCount,
  perHourSalary
) {
  const workingHoursShortage = totalAttendanceCount?.workingHours || 0;

  if (!workingHoursShortage) return 0;

  const penaltyType = attendancePolicy?.workingHoursType;
  const penaltyAmount = Number(attendancePolicy?.workingHoursAmount || 0);
  const penaltyMode = attendancePolicy?.wrkHoursFineType;

  if (penaltyType !== "fixed") return 0;

  if (penaltyMode === "Custom Multiplier") {
    return workingHoursShortage * (penaltyAmount * perHourSalary);
  } else {
    return workingHoursShortage * penaltyAmount;
  }
}

function calculateOvertimePay(
  attendancePolicy,
  totalAttendanceCount,
  perHourSalary
) {
  const parseHours = (timeString) =>
    parseInt((timeString || "0:0").split(":")[0]) || 0;

  const workingHoursOT = parseHours(totalAttendanceCount?.workingDayOTHours);
  const weekOffOT = parseHours(totalAttendanceCount?.weekOffOTHours);
  const holidayOT = parseHours(totalAttendanceCount?.holidayOTHours);

  let workingHoursOTPay = 0;
  if (workingHoursOT > 0) {
    const otType = attendancePolicy?.extraHoursType;
    const otPayValue = Number(attendancePolicy?.extraHoursPay || 0);

    if (otType === "Custom Multiplier") {
      workingHoursOTPay = workingHoursOT * (otPayValue * perHourSalary);
    } else if (otType === "Fixed Hourly Rate") {
      workingHoursOTPay = workingHoursOT * otPayValue;
    }
  }

  let weekOffOTPay = 0;
  if (weekOffOT > 0) {
    const otType = attendancePolicy?.weekOffType;
    const otPayValue = Number(attendancePolicy?.weekOffPay || 0);

    if (otType === "Custom Multiplier") {
      weekOffOTPay = weekOffOT * (otPayValue * perHourSalary);
    } else if (otType === "Fixed Hourly Rate") {
      weekOffOTPay = weekOffOT * otPayValue;
    }
  }

  let holidayOTPay = 0;
  if (holidayOT > 0) {
    const otType = attendancePolicy?.publicHolidayType;
    const otPayValue = Number(attendancePolicy?.publicHolidayPay || 0);

    if (otType === "Custom Multiplier") {
      holidayOTPay = holidayOT * (otPayValue * perHourSalary);
    } else if (otType === "Fixed Hourly Rate") {
      holidayOTPay = holidayOT * otPayValue;
    }
  }

  return {
    workingHoursOTPay,
    weekOffOTPay,
    holidayOTPay,
  };
}

function extractLeaveData(totalAttendanceCount) {
  const extractLeave = (leaveData, countField) => {
    if (leaveData?.leave) {
      return {
        count: totalAttendanceCount?.[countField] || 0,
        leave: leaveData.leave,
      };
    }
    return {};
  };

  return {
    lateLeave: extractLeave(totalAttendanceCount?.lateData, "lateComing"),
    earlyLeave: extractLeave(
      totalAttendanceCount?.earlyLeavingData,
      "earlyLeaving"
    ),
    workingHourLeave: extractLeave(
      totalAttendanceCount?.workingHoursData,
      "workingHours"
    ),
  };
}

// ==================== MAIN PROCESSING FUNCTION (UPDATED) ====================

async function processEmployeeData(
  personal,
  salaryBreakdown,
  payrollData,
  startDate,
  endDate,
  totalDays,
  stateTaxRules,
  ItemsService,
  req
) {
  const payableDays = payrollData?.payableDays || 0;
  const gender = personal?.assignedUser?.gender || null;
  const salaryTracking = salaryBreakdown?.salaryTracking;
  const monthlyCtc = getMonthlyCTCFromTracking(salaryTracking, endDate) || 0;
  const country = getCountryFromBreakdown(salaryBreakdown, endDate);
  // ===== STEP 1: Extract data from SalaryBreakdown =====

  const rawEarnings = getEarningsFromBreakdown(salaryBreakdown, endDate);
  const rawDeductions = getDeductionsFromBreakdown(salaryBreakdown, endDate);

  // === LWF ===

  const lwfStateId = extractStateIdFromBreakdown(
    salaryBreakdown,
    endDate,
    "LWF"
  );
  const lwf =
    lwfStateId && stateTaxRules[lwfStateId]
      ? getLWFFromRules(stateTaxRules[lwfStateId], startDate, endDate) // CHANGED: Pass startDate
      : { employerLWF: 0, employeeLWF: 0, state: null };
  const { month } = getYearMonth(endDate);
  // === PT: Special month override ===

  const ptStateId = extractStateIdFromBreakdown(salaryBreakdown, endDate, "PT");

  let pt = 0;

  if (ptStateId && stateTaxRules[ptStateId]) {
    const rules = stateTaxRules[ptStateId];

    // Check for special month override FIRST
    if (rules.PtMonth?.Month === month) {
      pt = rules.PtMonth.professionalTax || 0;
      // CHANGED
    } else {
      pt = calculatePTFromRules(rules, gender, monthlyCtc, month);
    }
  }

  // ===== STEP 3: Adjust earnings and deductions for payable days =====
  const adjustedEarnings = adjustAmountsForPayableDays(
    rawEarnings,
    totalDays,
    payableDays
  );
  const adjustedDeductions = adjustAmountsForPayableDays(
    rawDeductions,
    totalDays,
    payableDays
  );
  const employerContributionsResult =
    await getEmployerContributionsFromBreakdown(
      salaryBreakdown,
      endDate,
      adjustedEarnings,
      ItemsService,
      req,
      monthlyCtc
    );
  const { employerPF, employerESI, esiLimit } = employerContributionsResult;
  const employerContributions = { employerPF, employerESI };
  const employeeDeductions = getEmployeeDeductionsFromBreakdown(
    salaryBreakdown,
    endDate,
    adjustedEarnings,
    monthlyCtc,
    esiLimit
  );
  const statutoryContributions = getStatutoryContributionsFromBreakdown(
    salaryBreakdown,
    endDate,
    adjustedEarnings
  );

  // ===== STEP 4: Calculate Admin Charges =====
  const adminConfig = personal?.config?.adminCharges;
  const adminCharge = calculateAdminChargeFromBreakdown(
    employerContributions,
    salaryBreakdown,
    endDate
  );

  // ===== STEP 5: Extract other deductions and amounts =====
  const otherDeductions = extractOtherDeductions(salaryBreakdown, endDate);
  const advanceAmounts = extractMonthlyAmount(
    salaryBreakdown?.advance,
    endDate
  );
  const loanDebitAmounts = extractMonthlyAmount(
    salaryBreakdown?.loanDebit,
    endDate
  );
  const loanCreditAmounts = extractMonthlyAmount(
    salaryBreakdown?.loanCredit,
    endDate
  );

  // ===== STEP 6: Extract salary arrears and bonus/incentive =====
  const { pendingEarnings, totalAmount: totalSalaryArrearAmount } =
    extractSalaryArrears(salaryBreakdown, endDate);
  const { bonusDetails, incentiveDetails, retentionDetails } =
    extractBonusIncentiveDetails(salaryBreakdown, endDate);

  // ===== STEP 7: Calculate attendance penalties and OT =====
  const attendancePolicy = personal?.config?.attendancePolicies;
  const totalAttendanceCount = payrollData?.totalAttendanceCount || {};
  const perDaySalary =
    (salaryBreakdown?.totalEarnings || 0) / Number(totalDays);
  const perHourSalary = perDaySalary / attendancePolicy?.TotalWorking_Hours;

  const lateEntryPenalty = calculateLateEntryPenalty(
    attendancePolicy,
    totalAttendanceCount,
    perHourSalary
  );
  const earlyLeavingPenalty = calculateEarlyLeavingPenalty(
    attendancePolicy,
    totalAttendanceCount,
    perHourSalary
  );
  const workingHourPenalty = calculateWorkingHourPenalty(
    attendancePolicy,
    totalAttendanceCount
  );

  const { workingHoursOTPay, weekOffOTPay, holidayOTPay } =
    calculateOvertimePay(attendancePolicy, totalAttendanceCount, perHourSalary);

  const { lateLeave, earlyLeave, workingHourLeave } =
    extractLeaveData(totalAttendanceCount);

  // ===== STEP 8: Calculate totals =====
  const totalEarnings =
    Object.values(adjustedEarnings).reduce((sum, val) => sum + val, 0) +
    (employerContributions.employerPF.includedInCTC
      ? employerContributions.employerPF.amount
      : 0) +
    (employerContributions.employerESI.includedInCTC
      ? employerContributions.employerESI.amount
      : 0) +
    adminCharge.rupee +
    lwf.employerLWF +
    totalSalaryArrearAmount +
    holidayOTPay +
    workingHoursOTPay +
    weekOffOTPay;

  const totalDeductions =
    Object.values(adjustedDeductions).reduce((sum, val) => sum + val, 0) +
    employeeDeductions.employeePF +
    employeeDeductions.employeeESI +
    employeeDeductions.voluntaryPF +
    pt +
    lwf.employeeLWF +
    Object.values(otherDeductions).reduce((sum, val) => sum + val, 0);

  const totalBenefits =
    bonusDetails.reduce((sum, b) => sum + (b.amount || 0), 0) +
    incentiveDetails.reduce((sum, i) => sum + (i.amount || 0), 0) +
    retentionDetails.reduce((sum, r) => sum + (r.amount || 0), 0);

  // ===== STEP 9: Format employer contributions for response =====
  const employerContributionsFormatted = [
    {
      name: "EmployerPF",
      amount: Math.round(employerContributions.employerPF.amount),
      baseAmount: Math.round(employerContributions.employerPF.baseAmount), // ADD THIS
      includedInCTC: employerContributions.employerPF.includedInCTC,
    },
    {
      name: "EmployerESI",
      amount: Math.round(employerContributions.employerESI.amount),
      baseAmount: Math.round(employerContributions.employerESI.baseAmount), // ADD THIS
      includedInCTC: employerContributions.employerESI.includedInCTC,
    },
  ];

  const employeeDeductionsFormatted = [
    {
      name: "EmployeePF",
      amount: Math.round(employeeDeductions.employeePF),
      baseAmount: Math.round(employeeDeductions.employeePFBase),
      ...employeeDeductions.employeePFConfig,
    },
    {
      name: "EmployeeESI",
      amount: Math.round(employeeDeductions.employeeESI),
      baseAmount: Math.round(employeeDeductions.employeeESIBase),
      ...employeeDeductions.employeeESIConfig,
    },
    {
      name: "VoluntaryPF",
      amount: Math.round(employeeDeductions.voluntaryPF),
    },
  ];

  // ===== STEP 10: Return processed data =====
  return {
    payrollId: payrollData?.id || null,
    id: personal?.id || null,
    employeeId: personal?.employeeId || null,
    name: personal?.assignedUser?.first_name || "",
    monthlyCtc: monthlyCtc || 0,
    country: country,
    earnings: adjustedEarnings,
    deduction: adjustedDeductions,

    employerContributions: employerContributionsFormatted,
    employeeDeductions: employeeDeductionsFormatted,

    statutoryContributions: {
      employeePF: {
        amount: statutoryContributions.employeePF,
        baseAmount: statutoryContributions.employeePFBase,
        ...statutoryContributions.employeePFConfig,
      },
      employerPF: {
        amount: statutoryContributions.employerPF,
        baseAmount: statutoryContributions.employerPFBase,
        ...statutoryContributions.employerPFConfig,
      },
      governmentPF: {
        amount: statutoryContributions.governmentPF,
        baseAmount: statutoryContributions.governmentPFBase,
        ...statutoryContributions.governmentPFConfig,
      },
    },

    adminCharge: adminCharge,
    employerLwf: lwf.employerLWF,
    employeeLwf: lwf.employeeLWF,
    pt: pt,

    otherDeductions,
    advanceAmounts,
    loanDebitAmounts,
    loanCreditAmounts,
    salaryArrears: pendingEarnings,

    bonusDetails,
    incentiveDetails,
    retentionDetails,

    latePenalty: Math.round(lateEntryPenalty),
    lateLeave,
    earlyLeavingPenalty: Math.round(earlyLeavingPenalty),
    earlyLeave,
    workingHourPenalty: Math.round(workingHourPenalty),
    workingHourLeave,

    workingHoursOTPay: Math.round(workingHoursOTPay),
    weekOffOTPay: Math.round(weekOffOTPay),
    holidayOTPay: Math.round(holidayOTPay),

    payableDays,
    totalEarnings: Math.round(totalEarnings),
    totalDeductions: Math.round(totalDeductions),
    totalBenefits: Math.round(totalBenefits),
    netSalary: Math.round(totalEarnings - totalDeductions + totalBenefits),

    perHourSalary: Math.round(perHourSalary),
    perDaySalary: Math.round(perDaySalary),
  };
}

// ==================== MAIN ENDPOINT (UPDATED) ====================

var src = function registerEndpoint(router, { services }) {
  const { ItemsService } = services;

  router.get("/", async (req, res) => {
    try {
      const { startDate, endDate, totalDays } = req.query;

      // ===== VALIDATION =====
      const validation = validateQueryParameters(req.query);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const employeeIdsResult = extractEmployeeIds(req.query);
      if (!employeeIdsResult.valid) {
        return res.status(400).json({ error: employeeIdsResult.error });
      }
      const employeeIds = employeeIdsResult.ids;

      // ===== FETCH DATA =====
      const personalModuleData = await fetchPersonalModuleData(
        ItemsService,
        req,
        employeeIds
      );

      if (!personalModuleData.length) {
        return res.status(404).json({
          error: "No employee records found",
          details: "Could not find any employees matching the provided IDs",
        });
      }

      const salaryBreakdownData = await fetchSalaryBreakdown(
        ItemsService,
        req,
        employeeIds
      );

      if (!salaryBreakdownData.length) {
        return res.status(404).json({
          error: "Salary configuration missing",
          details:
            "No salary breakdown records found for the provided employees",
        });
      }
      const stateIds = new Set();

      salaryBreakdownData.forEach((breakdown) => {
        const lwfStateId = extractStateIdFromBreakdown(
          breakdown,
          endDate,
          "LWF"
        );
        const ptStateId = extractStateIdFromBreakdown(breakdown, endDate, "PT");

        // Only add valid state IDs (not null, undefined, or NaN)
        if (lwfStateId && !isNaN(lwfStateId)) stateIds.add(lwfStateId);
        if (ptStateId && !isNaN(ptStateId)) stateIds.add(ptStateId);
      });

      console.log(
        "Collected state IDs from salaryBreakdown:",
        Array.from(stateIds)
      );

      // Only fetch state tax rules if we have valid state IDs
      // === REPLACE THE ENTIRE BLOCK (from stateIds.size > 0) ===
      const stateTaxRulesString =
        stateIds.size > 0
          ? await fetchStateTaxRules(ItemsService, req, Array.from(stateIds))
          : "{}";

      // REPLACE THIS ENTIRE BLOCK:
      let stateTaxRules = {};
      if (stateTaxRulesString && stateTaxRulesString !== "{}") {
        try {
          const records = JSON.parse(stateTaxRulesString);
          console.log(
            "[DEBUG] Parsed records from fetchStateTaxRules:",
            JSON.stringify(records, null, 2)
          ); // ADD THIS

          records.forEach((r) => {
            if (r.id && r.stateTaxRules) {
              let rules = r.stateTaxRules;
              if (typeof rules === "string") {
                try {
                  rules = JSON.parse(rules);
                } catch (e) {
                  console.error(
                    `[ERROR] Invalid JSON in stateTaxRules for state ${r.id}`
                  );
                  return;
                }
              }

              // CHANGED: Store the rules directly (PT, PtMonth, LWF object)
              stateTaxRules[r.id] = rules;
              console.log(
                `[DEBUG] Stored rules for state ${r.id}:`,
                JSON.stringify(stateTaxRules[r.id], null, 2)
              );
            }
          });
          console.log(
            "[DEBUG] Final stateTaxRules keys:",
            Object.keys(stateTaxRules)
          ); // ADD THIS
        } catch (e) {
          console.error("[ERROR] Failed to parse stateTaxRulesString:", e);
        }
      }
      const payrollVerificationData = await fetchPayrollVerification(
        ItemsService,
        req,
        employeeIds,
        startDate,
        endDate
      );

      // ===== PROCESS DATA =====
      const combinedData = await Promise.all(
        personalModuleData.map((personal) => {
          const salaryBreakdown = salaryBreakdownData.find(
            (salary) => salary.employee?.id === personal.id
          );
          const payrollData = payrollVerificationData.find(
            (p) => p.employee?.id === personal.id
          );

          return processEmployeeData(
            personal,
            salaryBreakdown,
            payrollData,
            startDate,
            endDate,
            totalDays,
            stateTaxRules,
            ItemsService,
            req
          );
        })
      );

      return res.json({
        success: true,
        data: combinedData,
      });
    } catch (err) {
      console.error("Error processing request:", err);
      console.error("Error stack:", err.stack);
      return res.status(500).json({
        error: "Internal server error",
        message: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  });
};

var index = /*@__PURE__*/ getDefaultExportFromCjs(src);

export { index as default };
