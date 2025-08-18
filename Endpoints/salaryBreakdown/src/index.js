module.exports = function registerEndpoint(router, { services }) {
  router.get("/", async (req, res) => {
    try {
      const employeeIdsParam = req.query.filter?.employee?._in;
      const monthYearParam = req.query.month?.replace(
        /(\d{4})-(\d{2})/,
        "$2/$1"
      );

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
        req.accountability
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
          salaryData
        );

        if (!calculatedBreakdown) {
          throw new Error(
            `Failed to calculate salary breakdown for employee ID: ${salaryData.employee.id}`
          );
        }

        return calculatedBreakdown;
      });

      return res.json({
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
      ctc: applicableEntry?.ctc || item.ctc,
      originalCtc: item.ctc,
    };
  });
}

const getPersonalModuleData = async (
  employeeIds,
  services,
  schema,
  accountability
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
      "salaryConfig.basicPay",
      "salaryConfig.earnings",
      "salaryConfig.deductions",
      "salaryConfig.employerContribution",
      "salaryConfig.allowances",
      "salaryConfig.deduction",
      "salaryConfig.professionalTax",
      "salaryConfig.LWF",
      "salaryConfig.LWF.state",
      "salaryConfig.LWF.stateTaxRules",
      "salaryConfig.professionalTax.state",
      "salaryConfig.professionalTax.stateTaxRules",
      "salaryConfig.employersContributions",
      "salaryConfig.employeeDeductions",
      "salaryConfig.adminCharges",
      "salaryConfig.stateTaxes",
      "salaryConfig.id",
      "salaryConfig.professionalTax.id",
      "salaryConfig.professionalTax.state",
      "salaryConfig.professionalTax.stateTaxRules",
      "salaryConfig.LWF.id",
      "salaryConfig.LWF.state",
      "salaryConfig.LWF.stateTaxRules",
      "assignedUser.PFAccountNumber",
      "assignedUser.ESIAccountNumber",
      "id",
    ],

    limit: -1,
  });

  return data;
};
const calculateMonthlySalaryBreakdown = (employeeData, salaryBreakdownData) => {
  const annualCTC = salaryBreakdownData?.ctc;
  const salaryConfig = employeeData?.salaryConfig;

  if (
    !annualCTC ||
    isNaN(annualCTC) ||
    Number(annualCTC) === 0 ||
    !salaryConfig
  ) {
    throw new Error(
      !annualCTC
        ? "Annual CTC is missing"
        : isNaN(annualCTC)
        ? "Annual CTC is not a valid number"
        : Number(annualCTC) === 0
        ? "Annual CTC cannot be zero"
        : "Salary configuration is missing"
    );
  }

  // Constants for calculations
  const EMPLOYER_PF_RATE = 0.12;
  const EMPLOYER_ESI_RATE = 0.0325;
  const EMPLOYEE_PF_RATE = 0.12;
  const EMPLOYEE_ESI_RATE = 0.0075;
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

  const monthlyCTC = Math.round(annualCTC / 12);

  // Step 2: Calculate fixed earnings
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
        totalPercentageEarnings += Math.round(percentageAmount);
        item.amount = Math.round(percentageAmount);
      }
    }
  });

  fixedEarningsTotal += totalPercentageEarnings;

  const employerLWF = lwf?.LWF?.EmployerLWF || 0;
  const employeeLWF = lwf?.LWF?.EmployeeLWF || 0;

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

  for (let iteration = 0; iteration < 5; iteration++) {
    const grossSalary = Math.round(
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
        employerPfTotal = Math.min(Math.round(pfBaseAmount * 0.12), 1800);
      } else {
        employerPfTotal = Math.round(
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
        employerEsiTotal = Math.min(Math.round(esiBaseAmount * 0.0325), 682.5);
      }
    }

    let epfAdmin = 0;
    if (employerPFIncludedInCTC && employeeData.assignedUser?.PFAccountNumber) {
      epfAdmin = Math.min(
        Math.round(adminCharges?.enable ? 0.01 * pfBaseAmount : 0),
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

      const hraImpact = Math.round(
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
          Math.round(remainingExcess / basicImpact)
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
          Math.round(shortage / basicImpact),
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
            Math.round(remainingShortageToCover / basicImpact),
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
              Math.round(remainingShortageToCover / basicImpact),
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
  if (
    professionalTax?.stateTaxRules &&
    Array.isArray(professionalTax.stateTaxRules)
  ) {
    const taxRules = professionalTax.stateTaxRules;
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
    professionalTaxAmount = taxEntry
      ? Number(taxEntry.professionalTax || 0)
      : 0;
  }

  const finalPfBaseAmount = basicPayValue + pfCalculation;
  const finalEsiBaseAmount = basicPayValue + esiCalculation;

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

    return { name: key, ...item, rupee: Math.round(finalValue), includedInCTC };
  });

  const adminAmount =
    adminCharges?.enable && employeeData.assignedUser?.PFAccountNumber
      ? Math.min(Math.round(finalPfBaseAmount * 0.01), 150)
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

    return { name: key, ...item, rupee: Math.round(finalValue) };
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
    (item) => `${item.name}: ${Math.round(item.amount || 0)}`
  );
  const totalDeductions = deductions.reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0
  );
  const netSalary =
    totalEarnings + totalEmployer - totalEmployee - totalDeductions;

  return {
    id: salaryBreakdownData.id,
    annualCTC: Math.round(annualCTC),
    monthlyCTC: Math.round(monthlyCTC),
    basicPayValue: Math.round(basicPayValue),
    totalEarnings: Math.round(totalEarnings),
    totalEmployer: Math.round(totalEmployer),
    totalEmployee: Math.round(totalEmployee),
    totalDeductions: Math.round(totalDeductions),
    adminAmount: Math.round(adminAmount),
    employerLWF: Math.round(employerLWF),
    employeeLWF: Math.round(employeeLWF),
    professionalTaxAmount: Math.round(professionalTaxAmount),
    netSalary: Math.round(netSalary),
    earnings: earnings.map(
      (item) => `${item.name}: ${Math.round(item.amount || 0)}`
    ),
    employerContributions: updatedEmployerContributions.reduce((acc, item) => {
      acc[item.name] = {
        amount: item.rupee,
        includedInCTC: item.includedInCTC,
      };
      return acc;
    }, {}),
    employeeContributions: updatedEmployeeContributions.map(
      (item) => `${item.name}: ${Math.round(item.rupee || 0)}`
    ),

    voluntaryPFAmount: Math.round(voluntaryPFAmount),
    deductionsList,
  };
};
