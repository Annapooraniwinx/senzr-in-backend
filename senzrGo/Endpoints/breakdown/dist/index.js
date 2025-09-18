function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var src;
var hasRequiredSrc;

function requireSrc () {
	if (hasRequiredSrc) return src;
	hasRequiredSrc = 1;
	src = function registerEndpoint(router, { services }) {
	  router.get("/", async (req, res) => {
	    try {
	      const employeeIdsParam = req.query.filter?.employee?._in;
	      const monthYearParam = req.query.date
	        ?.slice(0, 7)
	        .replace(/(\d{4})-(\d{2})/, "$2/$1");
	      const date = req.query.date;

	      if (!employeeIdsParam) {
	        return res.status(400).json({
	          error: "Missing required parameter",
	          message: "employeeIds is required",
	        });
	      }

	      const employeeIds = Array.isArray(employeeIdsParam)
	        ? employeeIdsParam.map((id) => String(id).trim())
	        : employeeIdsParam.split(",").map((id) => id.trim());

	      const salaryBreakdownData = await getSalaryBreakdownData(
	        employeeIds,
	        services,
	        req.schema,
	        req.accountability,
	        monthYearParam
	      );
	      const personalModuleData = await getPersonalModuleData(
	        employeeIds,
	        services,
	        req.schema,
	        req.accountability,
	        date
	      );

	      const calculatedData = salaryBreakdownData.map((salaryData) => {
	        const employeeData = personalModuleData.find(
	          (emp) => emp.id === salaryData.employee.id
	        );

	        if (!employeeData) {
	          return {
	            ...salaryData,
	            calculatedBreakdown: null,
	            error: "Employee configuration not found",
	          };
	        }

	        const calculatedBreakdown = calculateMonthlySalaryBreakdown(
	          employeeData,
	          salaryData,
	          date
	        );

	        if (!calculatedBreakdown) {
	          return null;
	        }

	        return calculatedBreakdown;
	      });

	      return res.json({
	        personalModuleData,
	        data: calculatedData,
	      });
	    } catch (error) {
	      return res.status(500).json({
	        error: "Internal server error",
	        message: error.message,
	        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
	      });
	    }
	  });
	};

	async function getSalaryBreakdownData(
	  employeeIds,
	  services,
	  schema,
	  accountability,
	  monthYearParam
	) {
	  const { ItemsService } = services;
	  const salaryService = new ItemsService("SalaryBreakdown", {
	    schema,
	    accountability,
	  });

	  const data = await salaryService.readByQuery({
	    filter: { employee: { _in: employeeIds } },
	    fields: [
	      "ctc",
	      "employee.id",
	      "id",
	      "voluntaryPF",
	      "employersContribution",
	      "salaryTracking",
	    ],
	    limit: -1,
	  });

	  const [targetMonth, targetYear] =
	    monthYearParam?.split("/").map(Number) || [];

	  return data.map((item) => {
	    const entries = item.salaryTracking
	      ? Object.entries(item.salaryTracking)
	          .map(([monthYear, ctc]) => {
	            const [month, year] = monthYear.split("/").map(Number);
	            return { month, year, ctc };
	          })
	          .sort((a, b) => a.year - b.year || a.month - b.month)
	      : [];

	    const applicableEntry =
	      entries.find((e) => e.year === targetYear && e.month === targetMonth) ||
	      entries
	        .filter(
	          (e) =>
	            e.year < targetYear ||
	            (e.year === targetYear && e.month < targetMonth)
	        )
	        .pop();

	    return {
	      ...item,
	      monthlyCtc: applicableEntry?.ctc || item.ctc,
	      originalCtc: item.ctc,
	    };
	  });
	}

	const getPersonalModuleData = async (
	  employeeIds,
	  services,
	  schema,
	  accountability,
	  date
	) => {
	  const { ItemsService } = services;

	  const personalModuleService = new ItemsService("personalModule", {
	    schema,
	    accountability,
	  });

	  const data = await personalModuleService.readByQuery({
	    filter: {
	      id: { _in: employeeIds },
	    },
	    fields: [
	      // "salaryConfig.basicPay",
	      // "salaryConfig.earnings",
	      // "salaryConfig.deductions",
	      // "salaryConfig.employerContribution",
	      // "salaryConfig.allowances",
	      // "salaryConfig.deduction",
	      // "salaryConfig.professionalTax",
	      // "salaryConfig.LWF",
	      // "salaryConfig.LWF.state",
	      // "salaryConfig.LWF.stateTaxRules",
	      // "salaryConfig.professionalTax.state",
	      // "salaryConfig.professionalTax.stateTaxRules",
	      // "salaryConfig.employersContributions",
	      // "salaryConfig.employeeDeductions",
	      // "salaryConfig.adminCharges",
	      // "salaryConfig.stateTaxes",
	      // "salaryConfig.id",
	      // "salaryConfig.professionalTax.id",
	      // "salaryConfig.professionalTax.state",
	      // "salaryConfig.professionalTax.stateTaxRules",
	      // "salaryConfig.LWF.id",
	      // "salaryConfig.LWF.state",
	      // "salaryConfig.LWF.stateTaxRules",
	      "assignedUser.PFAccountNumber",
	      "assignedUser.ESIAccountNumber",
	      "assignedUser.pfTracking",
	      "assignedUser.esiTracking",
	      "salaryConfigTracking",
	      "id",
	    ],

	    limit: -1,
	  });
	 
	const trackingIds = data.flatMap((item) =>
	  Object.values(item.salaryConfigTracking || {}).flatMap((year) => Object.values(year))
	);

	const allConfigIds = data.flatMap((item) => {
	  const [targetYear, targetMonth] = date
	    ? [Number(date.split("-")[0]), Number(date.split("-")[1])]
	    : [];

	  const tracking = item.salaryConfigTracking || {};
	  const id =
	    tracking[targetYear]?.[targetMonth] ||
	    Object.entries(tracking[targetYear] || {})
	      .filter(([m]) => Number(m) < targetMonth)
	      .pop()?.[1] ||
	    null;

	  return id ? [id] : [];
	});

	const allConfigIdsToFetch = [...new Set([...allConfigIds, ...trackingIds])];

	const salarySettingService = new ItemsService("salarySetting", {
	  schema,
	  accountability,
	});
	const salarySettings = allConfigIdsToFetch.length
	  ? await salarySettingService.readByQuery({
	      filter: { id: { _in: allConfigIdsToFetch } },
	      fields: [
	        "basicPay",
	        "earnings",
	        "deductions",
	        "employerContribution",
	        "allowances",
	        "deduction",
	        "professionalTax",
	        "LWF",
	        "LWF.state",
	        "LWF.stateTaxRules",
	        "professionalTax.state",
	        "professionalTax.stateTaxRules",
	        "employersContributions",
	        "employeeDeductions",
	        "adminCharges",
	        "stateTaxes",
	        "id",
	      ],
	      limit: -1,
	    })
	  : [];

	if (salarySettings.length){
	  data.forEach((item) => {
	    const [targetYear, targetMonth] = date
	      ? [Number(date.split("-")[0]), Number(date.split("-")[1])]
	      : [];

	    const tracking = item.salaryConfigTracking || {};
	    const directMatch =
	      tracking[targetYear]?.[String(targetMonth).padStart(2, "0")] || null;

	   const previousMatch =
	  Object.entries(tracking[targetYear] || {})
	    .map(([m, v]) => [Number(m), v])
	    .filter(([m]) => m < targetMonth)
	    .sort((a, b) => a[0] - b[0])
	    .pop()?.[1] || null;


	    const id = directMatch || previousMatch || null;


	    if (id) {
	      item.salaryConfig = salarySettings.find((cfg) => cfg.id == id) || null;
	    } else {
	      item.salaryConfig = null;
	    }
	  });}

	  return data;
	};
	const calculateMonthlySalaryBreakdown = (
	  employeeData,
	  salaryBreakdownData,
	  date
	) => {
	  const roundToOneDecimal = (value) => Math.round(value * 10) / 10;

	  const monthlyCTC = salaryBreakdownData?.monthlyCtc;
	  const salaryConfig = employeeData?.salaryConfig;

	  //   let pfTracking = true;
	  //   if (date && employeeData.assignedUser?.pfTracking) {
	  //     pfTracking = date >= employeeData.assignedUser.pfTracking;
	  //   }

	  //   let esiTracking = true;
	  //   if (date && employeeData.assignedUser?.esiTracking) {
	  //     esiTracking = date >= employeeData.assignedUser.esiTracking;
	  //   }

	  if (!monthlyCTC || isNaN(monthlyCTC) || !salaryConfig) {
	    return null;
	  }

	  const EMPLOYER_PF_RATE = 0.12;
	  const EMPLOYER_ESI_RATE = 0.0325;
	  const EPF_ADMIN_RATE = 0.01;
	  const ESI_THRESHOLD = 21000;

	  const basicPay = salaryConfig.basicPay || 40;
	  const earnings = JSON.parse(JSON.stringify(salaryConfig.earnings || []));
	  const deductions = JSON.parse(JSON.stringify(salaryConfig.deductions || []));
	  const employerContributions = salaryConfig.employersContributions;
	  const employeeContributions = salaryConfig.employeeDeductions;
	  const adminCharges = salaryConfig.adminCharges || { enable: false };
	  const lwf = salaryConfig.LWF || {};
	  const professionalTax = salaryConfig.professionalTax || {};

	  let fixedEarningsTotal = 0;
	  earnings.forEach((item) => {
	    if (item.calculations === "Fixed") {
	      let fixedAmount = Number(item.Fixed || 0);
	      fixedEarningsTotal += fixedAmount;
	      item.amount = fixedAmount;
	    }
	  });

	  let remainingCTC = monthlyCTC - fixedEarningsTotal;

	  let totalPercentageEarnings = 0;
	  earnings.forEach((item) => {
	    if (item.calculations === "Percentage") {
	      if (item.name === "HRA" || item.name === "Dearness Allowance") {
	        return;
	      } else {
	        let percentageAmount =
	          (Number(item.Percentage || 0) / 100) * remainingCTC;
	        totalPercentageEarnings += roundToOneDecimal(percentageAmount);
	        item.amount = roundToOneDecimal(percentageAmount);
	      }
	    }
	  });

	  fixedEarningsTotal += totalPercentageEarnings;

	  const employerLWF =
	    professionalTax?.stateTaxRules?.LWF?.EmployerLWF ||
	    lwf?.LWF?.EmployerLWF ||
	    0;
	  const employeeLWF =
	    professionalTax?.stateTaxRules?.LWF?.EmployeeLWF ||
	    lwf?.LWF?.EmployeeLWF ||
	    0;

	  const basicSalaryTarget = (basicPay / 100) * remainingCTC;

	  const hraEntry = earnings.find((e) => e.name === "HRA");
	  const daEntry = earnings.find((e) => e.name === "Dearness Allowance");

	  const hraPercentage = hraEntry?.Percentage || 0;
	  const daPercentage = daEntry?.Percentage || 0;

	  const hraTarget = (hraPercentage / 100) * remainingCTC;
	  const daTarget = (daPercentage / 100) * remainingCTC;

	  let basicPayValue = basicSalaryTarget;

	  if (hraEntry) {
	    hraEntry.amount = hraTarget;
	  }

	  if (daEntry) {
	    daEntry.amount = daTarget;
	  }

	  let pfCalculation = 0;
	  let esiCalculation = 0;

	  for (let iteration = 0; iteration < 10; iteration++) {
	    const grossSalary = roundToOneDecimal(
	      basicPayValue +
	        (hraEntry ? hraEntry.amount : 0) +
	        (daEntry ? daEntry.amount : 0) +
	        fixedEarningsTotal
	    );

	    const employerPF = employerContributions.EmployerPF;
	    const employerESI = employerContributions.EmployerESI;

	    if (employerPF) {
	      pfCalculation =
	        employerPF.Calculations?.reduce((sum, calc) => {
	          const earningName = earnings.find((earn) => earn.name === calc.name);
	          const earningAmount = earningName ? earningName.amount : 0;
	          return sum + earningAmount;
	        }, 0) || 0;
	    }

	    if (employerESI) {
	      esiCalculation =
	        employerESI.Calculations?.reduce((sum, calc) => {
	          const earningName = earnings.find((earn) => earn.name === calc.name);
	          const earningAmount = earningName ? earningName.amount : 0;
	          return sum + earningAmount;
	        }, 0) || 0;
	    }

	    let pfBaseAmount = basicPayValue + pfCalculation;
	    let esiBaseAmount = basicPayValue + esiCalculation;

	    let employerPfTotal = 0;
	    let employerEsiTotal = 0;

	    const employerPFIncludedInCTC =
	      salaryBreakdownData?.employersContribution?.EmployerPF?.includedInCTC ??
	      employerPF?.withinCTC;
	    if (employerPFIncludedInCTC && employeeData.assignedUser?.PFAccountNumber) {
	      if (Number(employerPF.selectedOption) === 1800) {
	        employerPfTotal = Math.min(
	          roundToOneDecimal(pfBaseAmount * 0.12),
	          1800
	        );
	      } else {
	        employerPfTotal = roundToOneDecimal(
	          pfBaseAmount * (employerPF.selectedOption / 100)
	        );
	      }
	    }

	    const employerESIIncludedInCTC =
	      salaryBreakdownData?.employersContribution?.EmployerESI?.includedInCTC ??
	      employerESI?.withinCTC;
	    if (
	      employerESIIncludedInCTC &&
	      employeeData.assignedUser?.ESIAccountNumber
	    ) {
	      if (monthlyCTC <= ESI_THRESHOLD) {
	        employerEsiTotal = Math.min(
	          roundToOneDecimal(esiBaseAmount * 0.0325),
	          682.5
	        );
	      }
	    }

	    let epfAdmin = 0;
	    if (employerPFIncludedInCTC && employeeData.assignedUser?.PFAccountNumber) {
	      epfAdmin = Math.min(
	        roundToOneDecimal(adminCharges?.enable ? 0.01 * pfBaseAmount : 0),
	        150
	      );
	    }

	    const employerContributionsTotal =
	      employerPfTotal + epfAdmin + employerEsiTotal;
	    const currentCTC = grossSalary + employerContributionsTotal;

	    if (Math.abs(currentCTC - monthlyCTC) < 1) {
	      break;
	    }

	    if (currentCTC > monthlyCTC) {
	      const excess = currentCTC - monthlyCTC;

	      const hraImpact = roundToOneDecimal(
	        1 +
	          (monthlyCTC <= ESI_THRESHOLD ? EMPLOYER_ESI_RATE : 0) +
	          EMPLOYER_PF_RATE +
	          (adminCharges?.enable ? EPF_ADMIN_RATE : 0)
	      );
	      const daImpact = hraImpact;
	      const basicImpact = hraImpact;

	      let remainingExcess = excess;

	      if (hraEntry && hraEntry.amount > 0 && remainingExcess > 0) {
	        const hraAvailable = hraEntry.amount;
	        const reductionNeeded = remainingExcess / hraImpact;
	        const hraReduction = Math.min(hraAvailable, reductionNeeded);

	        hraEntry.amount -= hraReduction;
	        remainingExcess -= hraReduction * hraImpact;
	      }

	      if (daEntry && daEntry.amount > 0 && remainingExcess > 0) {
	        const daReduction = Math.min(
	          daEntry.amount,
	          remainingExcess / daImpact
	        );

	        daEntry.amount -= daReduction;
	        remainingExcess -= daReduction * daImpact;
	      }

	      if (basicPayValue > 0 && remainingExcess > 0) {
	        const basicReduction = Math.min(
	          basicPayValue,
	          roundToOneDecimal(remainingExcess / basicImpact)
	        );

	        basicPayValue -= basicReduction;
	        remainingExcess -= basicReduction * basicImpact;
	      }
	    } else {
	      const shortage = monthlyCTC - currentCTC;

	      if (shortage > 0) {
	        const basicImpact =
	          1 +
	          (monthlyCTC <= ESI_THRESHOLD ? EMPLOYER_ESI_RATE : 0) +
	          EMPLOYER_PF_RATE +
	          (adminCharges?.enable ? EPF_ADMIN_RATE : 0);

	        const basicIncrease = Math.min(
	          roundToOneDecimal(shortage / basicImpact),
	          basicSalaryTarget - basicPayValue
	        );

	        basicPayValue += basicIncrease;

	        let remainingShortageCovered = basicIncrease * basicImpact;
	        let daIncrease = 0;
	        let hraIncrease = 0;

	        if (
	          daEntry &&
	          daEntry.amount < daTarget &&
	          remainingShortageCovered < shortage
	        ) {
	          const remainingShortageToCover = shortage - remainingShortageCovered;

	          daIncrease = Math.min(
	            roundToOneDecimal(remainingShortageToCover / basicImpact),
	            daTarget - daEntry.amount
	          );

	          if (daIncrease > 0) {
	            daEntry.amount += daIncrease;
	            remainingShortageCovered += daIncrease * basicImpact;
	          }
	        }

	        if (
	          (!daEntry || daEntry.amount >= daTarget) &&
	          remainingShortageCovered < shortage
	        ) {
	          const remainingShortageToCover = shortage - remainingShortageCovered;

	          if (hraEntry && hraEntry.amount < hraTarget) {
	            hraIncrease = Math.min(
	              roundToOneDecimal(remainingShortageToCover / basicImpact),
	              hraTarget - hraEntry.amount
	            );

	            if (hraIncrease > 0) {
	              hraEntry.amount += hraIncrease;
	            }
	          }
	        }
	      }
	    }
	  }

	  let professionalTaxAmount = 0;
	  let professionalTaxDebug = {
	    hasStateTaxRules: !!professionalTax?.stateTaxRules,
	    isArray: Array.isArray(professionalTax?.stateTaxRules),
	    taxRulesLength: professionalTax?.stateTaxRules?.length || 0,
	    monthlyCTC: monthlyCTC,
	    taxRules: professionalTax?.stateTaxRules || [],
	    matchedEntry: null,
	    finalAmount: 0,
	  };
	  if (
	    professionalTax?.stateTaxRules?.PT &&
	    Array.isArray(professionalTax.stateTaxRules.PT)
	  ) {
	    const taxRules = professionalTax.stateTaxRules.PT;
	    const taxEntry = taxRules.find((entry) => {
	      if (entry.salaryRange?.includes("and above")) {
	        return monthlyCTC >= parseInt(entry.salaryRange);
	      }
	      if (entry.salaryRange?.includes("-")) {
	        const [min, max] = entry.salaryRange.split("-").map(Number);
	        return monthlyCTC >= min && monthlyCTC <= (max || Infinity);
	      }
	      return false;
	    });

	    professionalTaxDebug.matchedEntry = taxEntry;
	    professionalTaxAmount = taxEntry
	      ? Number(taxEntry.professionalTax || 0)
	      : 0;
	    professionalTaxDebug.finalAmount = professionalTaxAmount;
	  }

	  const finalPfBaseAmount = basicPayValue + pfCalculation;

	  const updatedEmployerContributions = Object.entries(
	    employerContributions
	  ).map(([key, item]) => {
	    const includedInCTC =
	      salaryBreakdownData?.employersContribution?.[key]?.includedInCTC ??
	      item?.withinCTC;

	    const calculations = item.calculations || item.Calculations || [];

	    if (item.selectedOption === 0 || item.selectedOption === undefined) {
	      return { name: key, ...item, rupee: 0 };
	    }

	    const totalAmount = calculations.reduce((sum, calc) => {
	      const earningName = earnings.find((earn) => earn.name === calc.name);
	      const earningAmount = earningName ? earningName.amount : 0;
	      return sum + earningAmount;
	    }, 0);

	    let finalValue = 0;

	    if (key === "EmployerPF") {
	      if (employeeData.assignedUser?.PFAccountNumber) {
	        if (Number(item.selectedOption) === 1800) {
	          finalValue = Math.min((totalAmount + basicPayValue) * 0.12, 1800);
	        } else {
	          finalValue =
	            (totalAmount + basicPayValue) * (item.selectedOption / 100);
	        }
	      } else {
	        finalValue = 0;
	      }
	    } else if (key === "EmployerESI") {
	      if (employeeData.assignedUser?.ESIAccountNumber) {
	        finalValue =
	          monthlyCTC <= ESI_THRESHOLD
	            ? Math.min((totalAmount + basicPayValue) * 0.0325, 682.5)
	            : 0;
	      } else {
	        finalValue = 0;
	      }
	    } else {
	      finalValue = (totalAmount + basicPayValue) * (item.selectedOption / 100);
	    }

	    return {
	      name: key,
	      ...item,
	      rupee: roundToOneDecimal(finalValue),
	      includedInCTC,
	    };
	  });

	  const adminAmount =
	    adminCharges?.enable && employeeData.assignedUser?.PFAccountNumber
	      ? Math.min(roundToOneDecimal(finalPfBaseAmount * 0.01), 150)
	      : 0;
	  const updatedEmployeeContributions = Object.entries(
	    employeeContributions
	  ).map(([key, item]) => {
	    const calculations = item.calculations || item.Calculations || [];

	    if (item.selectedOption === 0 || item.selectedOption === undefined) {
	      return { name: key, ...item, rupee: 0 };
	    }

	    const totalAmount = calculations.reduce((sum, calc) => {
	      const earningName = earnings.find((earn) => earn.name === calc.name);
	      const earningAmount = earningName ? earningName.amount : 0;
	      return sum + earningAmount;
	    }, 0);

	    let finalValue = 0;

	    if (key === "EmployeePF") {
	      if (employeeData.assignedUser?.PFAccountNumber) {
	        if (Number(item.selectedOption) === 1800) {
	          finalValue = Math.min((totalAmount + basicPayValue) * 0.12, 1800);
	        } else {
	          finalValue = (totalAmount + basicPayValue) * 0.12;
	        }
	      } else {
	        finalValue = 0;
	      }
	    } else if (key === "EmployeeESI") {
	      if (employeeData.assignedUser?.ESIAccountNumber) {
	        finalValue =
	          monthlyCTC <= ESI_THRESHOLD
	            ? Math.min((totalAmount + basicPayValue) * 0.0075, 157.5)
	            : 0;
	      } else {
	        finalValue = 0;
	      }
	    }

	    return { name: key, ...item, rupee: roundToOneDecimal(finalValue) };
	  });
	  const voluntary = salaryBreakdownData.voluntaryPF;

	  let voluntaryPFAmount = 0;

	  if (voluntary) {
	    if (employeeData.assignedUser?.PFAccountNumber) {
	      const vp = voluntary.VoluntaryPF;

	      if (vp.type === "percentage") {
	        const totalAmount = vp.Calculations.reduce((sum, calc) => {
	          const earningEntry = earnings.find((earn) => earn.name === calc.name);
	          const earningAmount = earningEntry ? earningEntry.amount : 0;
	          return sum + earningAmount;
	        }, 0);

	        if (Number(vp.selectedOption) === 1800) {
	          const percentageOption = vp.options?.find(
	            (opt) => opt.label === "percentage"
	          );

	          if (percentageOption) {
	            const rawCalc = (totalAmount + basicPayValue) * (13 / 100);
	            voluntaryPFAmount = Math.min(rawCalc, 1800);
	          }
	        } else if (vp.selectedOption === null) {
	          voluntaryPFAmount = 0;
	        } else {
	          const percentageOption = vp.options?.find(
	            (opt) => opt.label === "percentage"
	          );

	          if (percentageOption) {
	            voluntaryPFAmount =
	              (totalAmount + basicPayValue) * (percentageOption.value / 100);
	          }
	        }
	      } else {
	        voluntaryPFAmount = vp.amount;
	      }
	    }
	  }

	  const totalEarnings =
	    earnings.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) +
	    basicPayValue;
	  const totalEmployer =
	    updatedEmployerContributions.reduce(
	      (sum, item) => sum + (Number(item.rupee) || 0),
	      0
	    ) + adminAmount;
	  const totalEmployee =
	    updatedEmployeeContributions.reduce(
	      (sum, item) => sum + (Number(item.rupee) || 0),
	      0
	    ) +
	    professionalTaxAmount +
	    Number(voluntaryPFAmount || 0);
	  const deductionsList = deductions.map(
	    (item) => `${item.name}: ${roundToOneDecimal(item.amount || 0)}`
	  );
	  const totalDeductions = deductions.reduce(
	    (sum, item) => sum + (Number(item.amount) || 0),
	    0
	  );
	  const netSalary =
	    totalEarnings +
	    totalEmployer -
	    (totalEmployee + totalDeductions + totalEmployer);

	  return {
	    id: salaryBreakdownData.id,

	    monthlyCTC: Math.round(monthlyCTC),
	    basicPayValue: roundToOneDecimal(basicPayValue),
	    totalEarnings: Math.round(totalEarnings),
	    totalEmployer: Math.round(totalEmployer),
	    totalEmployee: Math.round(totalEmployee),
	    totalDeductions: Math.round(totalDeductions),
	    adminAmount: roundToOneDecimal(adminAmount),
	    employerLWF: roundToOneDecimal(employerLWF),
	    employeeLWF: roundToOneDecimal(employeeLWF),
	    professionalTaxAmount: roundToOneDecimal(professionalTaxAmount),
	    professionalTaxDebug: professionalTaxDebug,
	    netSalary: Math.round(netSalary),
	    earnings: earnings.map(
	      (item) => `${item.name}: ${roundToOneDecimal(item.amount || 0)}`
	    ),
	    employerContributions: updatedEmployerContributions.reduce((acc, item) => {
	      acc[item.name] = {
	        amount: item.rupee,
	        includedInCTC: item.includedInCTC,
	      };
	      return acc;
	    }, {}),
	    employeeContributions: updatedEmployeeContributions.map(
	      (item) => `${item.name}: ${roundToOneDecimal(item.rupee || 0)}`
	    ),

	    voluntaryPFAmount: roundToOneDecimal(voluntaryPFAmount),
	    deductionsList,
	  };
	};
	return src;
}

var srcExports = requireSrc();
var index = /*@__PURE__*/getDefaultExportFromCjs(srcExports);

export { index as default };
