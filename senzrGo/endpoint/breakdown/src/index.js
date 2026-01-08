
module.exports = function registerEndpoint(router, { services }) {
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

			const updates = [];
			const missed = [];

			const calculatedData = salaryBreakdownData.map((salaryData) => {
				const employeeData = personalModuleData.find(
					(emp) => emp.id === salaryData.employee?.id
				);

				if (!employeeData) {
					missed.push({
						id: salaryData.employee?.id || "unknown",
						reason: "Employee configuration not found",
					});
					return null;
				}

				const result = calculateMonthlySalaryBreakdown(
					employeeData,
					salaryData,
					date
				);

				if (!result) {
					missed.push({
						id: salaryData.employee?.id,
						reason: "Calculation returned null or Custom template",
					});
					return null;
				}

				const [year, month] = date.split("-").map(Number);
				const monthNum = Number(month);

				// Prepare persistence data
				const updatePayload = {
					earnings: { ...salaryData.earnings, [year]: { ...(salaryData.earnings?.[year] || {}), [monthNum]: result.persistence.earnings } },
					deduction: { ...salaryData.deduction, [year]: { ...(salaryData.deduction?.[year] || {}), [monthNum]: result.persistence.deductions } },
					employeeDeduction: { ...salaryData.employeeDeduction, [year]: { ...(salaryData.employeeDeduction?.[year] || {}), [monthNum]: result.persistence.employeeDeduction } },
					employersContribution: { ...salaryData.employersContribution, [year]: { ...(salaryData.employersContribution?.[year] || {}), [monthNum]: result.persistence.employersContribution } },
					statutory: { ...salaryData.statutory, [year]: { ...(salaryData.statutory?.[year] || {}), [monthNum]: result.persistence.statutory } },
					LWF: { ...salaryData.LWF, [year]: { ...(salaryData.LWF?.[year] || {}), [monthNum]: result.persistence.lwf } },
					PT: { ...salaryData.PT, [year]: { ...(salaryData.PT?.[year] || {}), [monthNum]: result.persistence.pt } },
					employeradmin: { ...salaryData.employeradmin, [year]: { ...(salaryData.employeradmin?.[year] || {}), [monthNum]: result.persistence.employeradmin } },
					voluntaryPF: result.persistence.voluntaryPF, // Voluntary PF usually has its own structure, keeping it consistent with the result
					netSalary: result.netSalary,
					totalEarnings: result.totalEarnings,
					totalDeductions: result.totalDeductions
				};

				updates.push({
					id: salaryData.id,
					...updatePayload
				});

				return {
					...result,
					employeeId: salaryData.employee?.id
				};
			}).filter(d => d !== null);

			console.log(`🚀 [BREAKDOWN] Prepared ${updates.length} updates for SalaryBreakdown.`);
			if (updates.length > 0) {
				const { ItemsService } = services;
				const salaryService = new ItemsService("SalaryBreakdown", {
					schema: req.schema,
					accountability: req.accountability,
				});

				console.log("📦 [DEBUG] update Payload Example:", JSON.stringify(updates[0], null, 2));

				try {
					await salaryService.updateMany(updates);
					console.log(`✅ [BREAKDOWN] Successfully updated ${updates.length} employees in SalaryBreakdown.`);
				} catch (updateError) {
					console.error("❌ [BREAKDOWN] Error during bulk update:", updateError.message);
				}
			}

			if (missed.length > 0) {
				console.log(`⚠️ [BREAKDOWN] ${missed.length} employees were missed.`);
			}

			return res.json({
				success: true,
				updated: updates.length,
				missed: missed.length,
				missedDetails: missed,
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

	const payrollExcelService = new ItemsService("payrollExcel", {
		schema,
		accountability,
	});

	const salaryResp = await salaryService.readByQuery({
		filter: { employee: { _in: employeeIds } },
		fields: [
			"id",
			"ctc",
			"employee.id",
			"voluntaryPF",
			"employersContribution",
			"salaryTracking",
			"earnings",
			"deduction",
			"employeeDeduction",
			"statutory",
			"LWF",
			"PT",
			"employeradmin"
		],
		limit: -1,
	});

	const payrollExcelResp = await payrollExcelService.readByQuery({
		filter: {
			employee: { _in: employeeIds },
			month: { _eq: monthYearParam },
		},
		fields: [
			"employeeId",
			"payrollFormat",
		],
		limit: -1,
	});

	const payrollCtcMap = new Map();

	payrollExcelResp.forEach(row => {
		const monthlyCtc = row.payrollFormat?.monthlyCTC;
		if (monthlyCtc != null) {
			payrollCtcMap.set(row.employeeId, monthlyCtc);
		}
	});

	const [targetMonth, targetYear] =
		monthYearParam?.split("/").map(Number) || [];

	return salaryResp.map(item => {
		const excelMonthlyCtc = payrollCtcMap.get(item.employeeId);

		if (excelMonthlyCtc != null) {
			return {
				...item,
				monthlyCtc: excelMonthlyCtc,
				originalCtc: item.ctc,
			};
		}

		const entries = item.salaryTracking
			? Object.entries(item.salaryTracking)
				.map(([monthYear, ctc]) => {
					const [month, year] = monthYear.split("/").map(Number);
					return { month, year, ctc };
				})
				.sort((a, b) => a.year - b.year || a.month - b.month)
			: [];

		const applicableEntry =
			entries.find(
				e => e.year === targetYear && e.month === targetMonth
			) ||
			entries
				.filter(
					e =>
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
		Object.values(item.salaryConfigTracking || {}).flatMap((year) =>
			Object.values(year)
		)
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
				"configName",
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

	if (salarySettings.length) {
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
		});
	}

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
	if (salaryConfig.configName === "Custom") return null;
	if (!monthlyCTC || isNaN(monthlyCTC) || !salaryConfig) {
		//   let pfTracking = true;
		//   if (date && employeeData.assignedUser?.pfTracking) {
		//     pfTracking = date >= employeeData.assignedUser.pfTracking;
		//   }

		//   let esiTracking = true;
		//   if (date && employeeData.assignedUser?.esiTracking) {
		//     esiTracking = date >= employeeData.assignedUser.esiTracking;
		//   }

		return null;
	}

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
		if (employerPFIncludedInCTC) {
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
		if (employerESIIncludedInCTC) {
			employerEsiTotal = Math.min(
				roundToOneDecimal(esiBaseAmount * 0.0325),
				682.5
			);
		}

		let epfAdmin = 0;
		if (employerPFIncludedInCTC) {
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
				(EMPLOYER_ESI_RATE || 0) +
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
					(EMPLOYER_ESI_RATE || 0) +
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
			if (Number(item.selectedOption) === 1800) {
				finalValue = Math.min((totalAmount + basicPayValue) * 0.12, 1800);
			} else {
				finalValue =
					(totalAmount + basicPayValue) * (item.selectedOption / 100);
			}
		} else if (key === "EmployerESI") {
			finalValue = Math.min((totalAmount + basicPayValue) * 0.0325, 682.5) || 0;
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

	const adminAmount = adminCharges?.enable
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
			if (Number(item.selectedOption) === 1800) {
				finalValue = Math.min((totalAmount + basicPayValue) * 0.12, 1800);
			} else {
				finalValue = (totalAmount + basicPayValue) * 0.12;
			}
		} else if (key === "EmployeeESI") {
			finalValue = Math.min((totalAmount + basicPayValue) * 0.0075, 157.5) || 0;
		}

		return { name: key, ...item, rupee: roundToOneDecimal(finalValue) };
	});
	const voluntary = salaryBreakdownData.voluntaryPF;

	let voluntaryPFAmount = 0;

	if (voluntary) {
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

		persistence: {
			earnings: {
				"Basic Pay": { Amount: roundToOneDecimal(basicPayValue), Condition: "On Attendance" },
				...earnings.reduce((acc, item) => {
					acc[item.name] = { Amount: roundToOneDecimal(item.amount || 0), Condition: "On Attendance" };
					return acc;
				}, {})
			},
			deductions: deductions.reduce((acc, item) => {
				acc[item.name] = { Amount: roundToOneDecimal(item.amount || 0) };
				return acc;
			}, {}),
			employeeDeduction: updatedEmployeeContributions.reduce((acc, item) => {
				acc[item.name] = {
					selectedOption: item.selectedOption,
					Calculations: item.calculations || item.Calculations || [],
					Amount: item.rupee
				};
				return acc;
			}, {}),
			employersContribution: updatedEmployerContributions.reduce((acc, item) => {
				acc[item.name] = {
					selectedOption: item.selectedOption,
					withinCTC: item.withinCTC,
					Calculations: item.calculations || item.Calculations || [],
					Amount: item.rupee
				};
				return acc;
			}, {}),
			statutory: {
				EmployerPF: updatedEmployerContributions.find(c => c.name === "EmployerPF")?.rupee || 0,
				EmployerESI: updatedEmployerContributions.find(c => c.name === "EmployerESI")?.rupee || 0,
				EmployeePF: updatedEmployeeContributions.find(c => c.name === "EmployeePF")?.rupee || 0,
				EmployeeESI: updatedEmployeeContributions.find(c => c.name === "EmployeeESI")?.rupee || 0,
			},
			lwf: { state: lwf.state || 0, employerAmount: roundToOneDecimal(employerLWF), employeeAmount: roundToOneDecimal(employeeLWF) },
			pt: { state: professionalTax.state || 0, amount: roundToOneDecimal(professionalTaxAmount) },
			employeradmin: { Enable: adminCharges.enable, Charge: adminAmount },
			voluntaryPF: {
				VoluntaryPF: {
					type: voluntary?.VoluntaryPF?.type,
					amount: voluntary?.VoluntaryPF?.amount,
					selectedOption: voluntary?.VoluntaryPF?.selectedOption,
					Calculations: voluntary?.VoluntaryPF?.Calculations,
					calculatedAmount: roundToOneDecimal(voluntaryPFAmount)
				}
			}
		}
	};
};
