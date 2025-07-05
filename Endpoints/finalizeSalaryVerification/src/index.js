function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default")
    ? x["default"]
    : x;
}

var src = function registerEndpoint(router, { services }) {
  const { ItemsService } = services;

  router.get("/", async (req, res) => {
    console.log("Request received:", req.url);
    console.log("Full query object:", JSON.stringify(req.query));
    const { startDate, endDate, totalDays } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "startDate and endDate are required in query parameters",
      });
    }

    if (!totalDays) {
      return res.status(400).json({
        error: "totalDays is required in query parameters",
      });
    }

    try {
      let employeeIds = [];

      if (
        req.query.filter &&
        req.query.filter.employeeIds &&
        req.query.filter.employeeIds._in
      ) {
        employeeIds = req.query.filter.employeeIds._in
          .split(",")
          .map((id) => id.trim());
        console.log("Extracted employee IDs:", employeeIds);
      } else {
        console.log(
          "No employee IDs provided in filter[employeeIds][_in] parameter"
        );
        return res.status(400).json({
          error: "Employee IDs required in filter[employeeIds][_in] parameter",
        });
      }

      console.log("Processing request for employee IDs:", employeeIds);

      if (!employeeIds.length) {
        console.log("No employee IDs provided");
        return res.status(400).json({ error: "Employee IDs required" });
      }
      const personalModuleService = new ItemsService("personalModule", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const salaryBreakdownService = new ItemsService("SalaryBreakdown", {
        schema: req.schema,
        accountability: req.accountability,
      });
      console.log("Fetching personal module data for employees:", employeeIds);
      const personalModuleData = await personalModuleService.readByQuery({
        filter: {
          id: { _in: employeeIds },
        },
        fields: [
          "id",
          "employeeId",
          "assignedUser.first_name",
          "assignedUser.gender",
          "salaryConfig.basicPay",
          "salaryConfig.stateTaxes.state",
          "salaryConfig.bonusConfig",
          "salaryConfig.id",
          "salaryConfig.earnings",
          "salaryConfig.deductions",
          "salaryConfig.employerContribution",
          "salaryConfig.advancedMode",
          "salaryConfig.allowances",
          "salaryConfig.deduction",
          "salaryConfig.professionalTax.highlySkilled",
          "salaryConfig.professionalTax.skilled",
          "salaryConfig.professionalTax.stateTaxRules",
          "salaryConfig.professionalTax.state",
          "salaryConfig.professionalTax.id",
          "salaryConfig.LWF.state",
          "salaryConfig.LWF.stateTaxRules",
          "salaryConfig.LWF.skilled",
          "salaryConfig.LWF.highlySkilled",
          "salaryConfig.LWF.id",
          "salaryConfig.employersContributions",
          "salaryConfig.employeeDeductions",
          "salaryConfig.configName",
          "salaryConfig.adminCharges",
          "salaryConfig.stateTaxes.stateTaxRules",
          "salaryConfig.stateTaxes.id",
          "salaryConfig.stateTaxes.skilled",
          "salaryConfig.stateTaxes.highlySkilled",
          "salaryConfig.zone",
          "salaryConfig.skillLevel",
          "salaryConfig.retentionPayConfig",
          "salaryConfig.incentiveConfig",
          "salaryConfig.shopEstablishment",
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
          "config.attendancePolicies.earlyExitPenaltyAmt",
          "config.attendancePolicy.extraHoursPay ",
          "config.attendancePolicy.weekOffPay",
          "config.attendancePolicy.publicHolidayPay",
          "config.attendanceSettings",
        ],
        sort: ["-date_updated"],
        limit: -1,
      });

      console.log(`Found ${personalModuleData.length} personal module records`);

      const personalIds = personalModuleData.map((item) => item.id);

      console.log(
        "Fetching salary breakdown data for personal IDs:",
        personalIds
      );
      const salaryBreakdownData = await salaryBreakdownService.readByQuery({
        filter: {
          employee: { _in: employeeIds },
        },
        fields: [
          "ctc",
          "employee.id",
          "employee.employeeId",
          "basicSalary",
          "basicPay",
          "earnings",
          "employersContribution",
          "individualDeduction",
          "voluntaryPF",
          "salaryArrears",
          "totalEarnings",
          "employeeDeduction",
          "deduction",
          "totalDeductions",
          "netSalary",
          "professionalTax",
          "employerLwf",
          "employeeLwf",
          "employeradmin",
          "anualEarnings",
          "annualDeduction",
          "benefitsManual",
          "id",
        ],
        limit: -1,
      });

      console.log(
        `Found ${salaryBreakdownData.length} salary breakdown records`
      );

      console.log("Fetching payroll verification data...");
      const payrollVerificationService = new ItemsService(
        "payrollVerification",
        {
          schema: req.schema,
          accountability: req.accountability,
        }
      );

      const payrollVerificationData =
        await payrollVerificationService.readByQuery({
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

      console.log(
        `Found ${payrollVerificationData.length} payroll verification records`
      );
      const shouldIncludeManualBenefit = (item) => {
        if (!item || !item.amount || !item.month) return false;
        return item.month === new Date(endDate).getMonth() + 1;
      };

      const combinedData = personalModuleData.map((personal) => {
        const salaryInfo = salaryBreakdownData.find(
          (salary) => salary.employee && salary.employee.id === personal.id
        );

        const payrollData = payrollVerificationData.find(
          (p) => p.employee && p.employee.id === personal.id
        );

        const payableDays = payrollData?.payableDays || 0;
        const earnings = salaryInfo?.earnings || {};
        const deductions = salaryInfo?.deduction || {};
        const basicPay = Number(salaryInfo?.basicPay || 0);
        const adjustedBasicPay = (basicPay / Number(totalDays)) * payableDays;
        const stateTax = personal?.salaryConfig?.stateTaxes?.stateTaxRules;
        const monthlyCTC = salaryInfo?.basicSalary;

        const adjustedEarnings = {};
        for (const key in earnings) {
          adjustedEarnings[key] =
            (earnings[key] / Number(totalDays)) * payableDays;
        }
        adjustedEarnings["Basic Pay"] = adjustedBasicPay;

        const adjustedDeductions = {};
        for (const key in deductions) {
          adjustedDeductions[key] =
            (deductions[key] / Number(totalDays)) * payableDays;
        }
        let employerPFContribution = 0;
        const employerContributionsConfig =
          personal?.salaryConfig?.employersContributions ?? {};

        const employerContributions = ["EmployerPF", "EmployerESI"].map(
          (type) => {
            const config = employerContributionsConfig[type];
            if (
              !config ||
              config.selectedOption === null ||
              !config.withinCTC
            ) {
              return {
                name: type,
                rupee: 0,
              };
            }
            const calculations = Array.isArray(config.Calculations)
              ? config.Calculations
              : [];
            const totalAmount = calculations.reduce((sum, calc) => {
              const earningAmount = adjustedEarnings[calc.name] || 0;
              return sum + earningAmount;
            }, 0);
            employerPFContribution = totalAmount;
            let finalValue = 0;
            if (type === "EmployerPF") {
              if (config.selectedOption === 1800) {
                finalValue = Math.min(totalAmount * (12 / 100), 1800);
              } else {
                finalValue = totalAmount * (config.selectedOption / 100);
              }
            } else if (type === "EmployerESI") {
              if (monthlyCTC.value <= 21000) {
                finalValue = Math.min(
                  totalAmount * (config.selectedOption / 100),
                  682.5
                );
              } else {
                finalValue = 0;
              }
            }
            return {
              name: type,
              totalAmount: totalAmount,
              rupee: Math.round(finalValue),
            };
          }
        );

        const employeeDeductionsConfig =
          personal?.salaryConfig?.employeeDeductions ?? {};
        const employeeDeductions = ["EmployeePF", "EmployeeESI"].map((type) => {
          const config = employeeDeductionsConfig[type];
          if (!config || config.selectedOption === null) {
            return {
              name: type,
              rupee: 0,
            };
          }
          const calculations = Array.isArray(config.Calculations)
            ? config.Calculations
            : [];
          const totalAmount = calculations.reduce((sum, calc) => {
            const earningAmount = adjustedEarnings[calc.name] || 0;
            return sum + earningAmount;
          }, 0);
          let finalValue = 0;
          if (type === "EmployeePF") {
            if (config.selectedOption === 1800) {
              finalValue = Math.min(totalAmount * (12 / 100), 1800);
            } else {
              finalValue = totalAmount * (config.selectedOption / 100);
            }
          } else if (type === "EmployeeESI") {
            if (monthlyCTC.value <= 21000) {
              finalValue = totalAmount * (config.selectedOption / 100);
            } else {
              finalValue = 0;
            }
          }
          return {
            name: type,
            totalAmount: totalAmount,
            rupee: Math.round(finalValue),
          };
        });

        const adminConfig = personal?.salaryConfig?.adminCharges;

        let adminChargeContribution = { name: "AdminCharge", rupee: 0 };
        if (employerContributionsConfig["EmployerPF"]?.withinCTC) {
          if (adminConfig?.enable) {
            const calculated =
              (Number(adminConfig.charge) / 100) * employerPFContribution;
            adminChargeContribution.rupee = Math.round(
              Math.min(calculated, 150)
            );
          }
        }

        const deductionDates = stateTax?.LWF?.Deduction || [];
        const lwfApplicable = deductionDates.some((date) => {
          const year = new Date(startDate).getFullYear();
          const deductionDate = new Date(`${year}-${date}`);
          return (
            deductionDate >= new Date(startDate) &&
            deductionDate <= new Date(endDate)
          );
        });
        const employerLwf = lwfApplicable ? stateTax?.LWF?.EmployerLWF : 0;
        const employeeLwf = lwfApplicable ? stateTax?.LWF?.EmployeeLWF : 0;

        const otherDeductions = {};
        if (salaryInfo.individualDeduction) {
          Object.entries(salaryInfo.individualDeduction).forEach(
            ([key, deduction]) => {
              const deductionDate = new Date(deduction.date);
              if (
                deductionDate >= new Date(startDate) &&
                deductionDate <= new Date(endDate)
              ) {
                otherDeductions[deduction.name] = deduction.amount;
              }
            }
          );
        }

        let pendingEarnings = {};
        let totalSalaryArrearAmount = 0;
        if (salaryInfo.salaryArrears) {
          Object.values(salaryInfo.salaryArrears).forEach((arrear) => {
            const arrearDate = new Date(arrear.date);
            if (
              arrearDate >= new Date(startDate) &&
              arrearDate <= new Date(endDate)
            ) {
              const amount = parseFloat(arrear.amount || 0);
              pendingEarnings[arrear.name] = amount;
              totalSalaryArrearAmount += amount;
            }
          });
        }

        let voluntaryPFAmount = 0;
        const voluntary = personal?.salaryConfig?.voluntaryPF;
        if (voluntary?.VoluntaryPF?.type === "percentage") {
          const vp = voluntary.VoluntaryPF;
          const calculations = Array.isArray(vp.Calculations)
            ? vp.Calculations
            : [];
          const totalAmount =
            calculations.reduce((sum, calc) => {
              const earningAmount = adjustedEarnings[calc.name] || 0;
              return sum + earningAmount;
            }, 0) + totalSalaryArrearAmount;

          if (Number(vp.selectedOption) === 1800) {
            const percentageOption = vp.options?.find(
              (opt) => opt.label === "percentage"
            );
            if (percentageOption) {
              voluntaryPFAmount = Math.min(totalAmount * (13 / 100), 1800);
            }
          } else if (vp.selectedOption === null) {
            voluntaryPFAmount = 0;
          } else {
            const percentageOption = vp.options?.find(
              (opt) => opt.label === "percentage"
            );
            if (percentageOption) {
              voluntaryPFAmount = totalAmount * (percentageOption.value / 100);
            }
          }
        } else if (voluntary?.VoluntaryPF?.type === "amount") {
          voluntaryPFAmount = voluntary.VoluntaryPF.amount || 0;
        }

        if (voluntaryPFAmount) {
          voluntaryPFAmount = 0;
        }

        const bonusManual =
          salaryInfo.benefitsManual?.bonusManual &&
          Array.isArray(salaryInfo.benefitsManual.bonusManual)
            ? salaryInfo.benefitsManual.bonusManual
                .filter((item) => shouldIncludeManualBenefit(item))
                .reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)
            : 0;

        const incentiveManual =
          salaryInfo.benefitsManual?.incentiveManual &&
          Array.isArray(salaryInfo.benefitsManual.incentiveManual)
            ? salaryInfo.benefitsManual.incentiveManual
                .filter((item) => shouldIncludeManualBenefit(item))
                .reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)
            : 0;

        const retentionPayManual =
          salaryInfo.benefitsManual?.retentionPayManual &&
          Array.isArray(salaryInfo.benefitsManual.retentionPayManual)
            ? salaryInfo.benefitsManual.retentionPayManual
                .filter((item) => shouldIncludeManualBenefit(item))
                .reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)
            : 0;

        let allowedLateEntry = 0;
        let actualLateEntryCount = 0;
        let lateEntryPenalty = 0;

        const attendancePolicy = personal?.config?.attendancePolicies;
        const totalAttendanceCount = payrollData?.totalAttendanceCount || {};

        if (
          attendancePolicy?.lateComingType === "fixed" &&
          Number(attendancePolicy.lateEntryAllowed) > 0
        ) {
          allowedLateEntry = Number(attendancePolicy.lateEntryAllowed);
          const lateComingCount = totalAttendanceCount.lateComing || 0;
          actualLateEntryCount = Math.max(
            lateComingCount - allowedLateEntry,
            0
          );
          const penaltyAmount = Number(
            attendancePolicy.lateEntryPenaltyAmt || 0
          );
          lateEntryPenalty = actualLateEntryCount * penaltyAmount;
        }

        let allowedEarlyLeaving = 0;
        let actualEarlyLeavingCount = 0;
        let earlyLeavingPenalty = 0;

        if (
          attendancePolicy?.earlyLeavingType === "fixed" &&
          Number(attendancePolicy.earlyExitAllowed) > 0
        ) {
          allowedEarlyLeaving = Number(attendancePolicy.earlyExitAllowed);
          const earlyLeavingCount = totalAttendanceCount.earlyLeaving || 0;
          actualEarlyLeavingCount = Math.max(
            earlyLeavingCount - allowedEarlyLeaving,
            0
          );
          const penaltyAmount = Number(
            attendancePolicy.earlyExitPenaltyAmt || 0
          );
          earlyLeavingPenalty = actualEarlyLeavingCount * penaltyAmount;
        }

        const workingDayOT = totalAttendanceCount.workingDayOT || 0;
        const weekOffOT = totalAttendanceCount.weekOffOT || 0;
        const holidayOT = totalAttendanceCount.holidayOT || 0;

        const workingDayOTPay =
          workingDayOT * Number(attendancePolicy?.extraHoursPay || 0);
        const weekOffOTPay =
          weekOffOT * Number(attendancePolicy?.weekOffPay || 0);
        const holidayOTPay =
          holidayOT * Number(attendancePolicy?.publicHolidayPay || 0);

        const totalEarnings =
          Object.values(adjustedEarnings).reduce((sum, val) => sum + val, 0) +
          employerContributions.reduce(
            (sum, item) => sum + (item?.rupee || 0),
            0
          ) +
          (adminChargeContribution?.rupee || 0) +
          (employerLwf || 0) +
          totalSalaryArrearAmount;

        const endMonth = new Date(endDate).getMonth() + 1;
        let pt = 0;
        if (stateTax?.PtMonth?.Month == endMonth) {
          pt = stateTax.PtMonth.professionalTax;
        } else {
          const userGender = personal?.assignedUser?.gender;
          const salary = totalEarnings || 0;
          const matchedPT = (stateTax?.PT || []).find(
            ({ salaryRange, gender }) => {
              if (gender) {
                if (!userGender) return false;
                if (gender !== userGender) return false;
              }
              if (!salaryRange) return false;
              if (salaryRange.includes("and above"))
                return salary >= parseInt(salaryRange);
              if (salaryRange.includes("-")) {
                const [min, max] = salaryRange.split("-").map(Number);
                return salary >= min && salary <= max;
              }
              return salary == parseInt(salaryRange, 10);
            }
          );
          if (matchedPT) {
            pt = matchedPT.professionalTax;
          }
        }

        const totalDeductions =
          Object.values(adjustedDeductions).reduce((sum, val) => sum + val, 0) +
          employerContributions.reduce(
            (sum, item) => sum + (item?.rupee || 0),
            0
          ) +
          employeeDeductions.reduce(
            (sum, item) => sum + (item?.rupee || 0),
            0
          ) +
          (adminChargeContribution?.rupee || 0) +
          Object.values(otherDeductions).reduce((sum, val) => sum + val, 0) +
          (pt || 0) +
          (employeeLwf || 0);
        return {
          // ...personal,
          data: payrollVerificationData,
          salaryBreakdown: salaryInfo || null,
          monthlyCtc: salaryInfo.basicSalary,
          payrollId: payrollData?.id || null,
          id: payrollData?.employee?.id || null,
          name: personal.assignedUser.first_name,
          earnings: adjustedEarnings,
          deduction: adjustedDeductions,
          employerContributions,
          employeeDeductions,
          employerLwf,
          employeeLwf,
          pt,
          otherDeductions,
          salaryArrears: pendingEarnings,
          adminCharge: adminChargeContribution,
          voluntaryPFAmount,
          bonusManual,
          incentiveManual,
          retentionPayManual,
          latePenalty: lateEntryPenalty,
          earlyLeavingPenalty: earlyLeavingPenalty,
          workingDayOTPay,
          weekOffOTPay,
          holidayOTPay,
          payableDays,
          totalEarnings,
          totalDeductions,
        };
      });

      console.log(`Returning ${combinedData.length} combined employee records`);

      return res.json({
        data: combinedData,
      });
    } catch (err) {
      console.error("Error processing request:", err);
      console.error("Error stack:", err.stack);
      return res.status(500).json({
        error: "Internal server error",
        message: err.message,
        stack: undefined,
      });
    }
  });
};

var index = /*@__PURE__*/ getDefaultExportFromCjs(src);

export { index as default };
