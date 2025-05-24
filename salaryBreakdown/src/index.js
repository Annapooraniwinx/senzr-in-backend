export default ({ action }, { services }) => {
  const handleSalarySettingChange = async (event, { database, schema }) => {
    const { keys } = event;
    const { ItemsService } = services;

    const updatedId = keys[0];

    const personalRows = await database("personalModule")
      .join(
        "directus_users",
        "personalModule.assignedUser",
        "directus_users.id"
      )
      .select(
        "personalModule.employeeId",
        "personalModule.id",
        "personalModule.allowPF",
        "personalModule.allowESI",
        "directus_users.PFAccountNumber as assignedUserPF",
        "directus_users.ESIAccountNumber as assignedUserESI"
      )
      .where("personalModule.salaryConfig", updatedId);

    const employeeIds = personalRows.map((row) => row.employeeId);

    const salaryRows = await database("SalaryBreakdown")
      .join("personalModule", "SalaryBreakdown.employee", "personalModule.id")
      .select(
        "SalaryBreakdown.ctc",
        "personalModule.employeeId",
        "SalaryBreakdown.id"
      )
      .whereIn("personalModule.employeeId", employeeIds);
    const salaryBreakdownIds = personalRows.map((pr) => {
      const matched = salaryRows.find((sr) => sr.employeeId === pr.employeeId);
      return matched?.id || null;
    });

    const salarySetting = await database("salarySetting")
      .select("*")
      .where("id", updatedId)
      .first();
    const ctcs = personalRows.map((pr) => {
      const matched = salaryRows.find((sr) => sr.employeeId === pr.employeeId);
      return matched?.ctc || 0;
    });

    const monthlyCtcs = ctcs.map((ctc) => ctc / 12);

    const salaryBreakdown = calculateSalaryBreakdown(
      personalRows,
      monthlyCtcs,
      salarySetting
    );
    updateSalaryBreakdown(
      salaryRows,
      monthlyCtcs,
      salaryBreakdown,
      ItemsService,
      database,
      salaryBreakdownIds,
      schema
    );
  };

  const handlePersonalModuleUpdate = async (event, { database }) => {
    const personalModuleId = event.keys?.[0];

    const { payload } = event;

    const shouldRun =
      "allowPF" in payload ||
      "allowESI" in payload ||
      "salaryConfig" in payload ||
      payload?.assignedUser?.PFAccountNumber ||
      payload?.assignedUser?.ESIAccountNumber;

    if (!shouldRun) {
      console.log(
        "⚠️ No relevant fields changed. Skipping salary breakdown logic."
      );
      return;
    }

    if (!personalModuleId) {
      console.log("❌ No personalModule ID found in event context");
      return;
    }

    const personalRow = await database("personalModule")
      .join(
        "directus_users",
        "personalModule.assignedUser",
        "directus_users.id"
      )
      .select(
        "personalModule.employeeId",
        "personalModule.id",
        "personalModule.allowPF",
        "personalModule.allowESI",
        "personalModule.salaryConfig",
        "directus_users.PFAccountNumber as assignedUserPF",
        "directus_users.ESIAccountNumber as assignedUserESI"
      )
      .where("personalModule.id", personalModuleId)
      .first();

    if (!personalRow) {
      console.log("⚠️ No personalModule row found for ID:", personalModuleId);
      return;
    }

    console.log("✅ personalRow fetched:", personalRow);

    const { salaryConfig } = personalRow;

    if (!salaryConfig) {
      console.log("❌ No salaryConfig found in personalModule");
      return;
    }

    // Step 2: Fetch salarySetting
    const salarySetting = await database("salarySetting")
      .select("*")
      .where("id", salaryConfig)
      .first();

    if (!salarySetting) {
      console.log("⚠️ No salarySetting found for ID:", salaryConfig);
      return;
    }

    console.log("✅ salarySettings fetched:", salarySetting);

    // Step 3: Fetch CTC from SalaryBreakdown
    const salaryRow = await database("SalaryBreakdown")
      .select("ctc")
      .where("employee", personalModuleId)
      .first();

    if (!salaryRow) {
      console.log(
        "⚠️ No SalaryBreakdown found for employee ID:",
        personalModuleId
      );
      return;
    }

    const monthlyCtcs = [salaryRow.ctc / 12];

    // Step 4: Calculate salary breakdown
    const salaryBreakdown = calculateSalaryBreakdown(
      [personalRow], // wrap single object as array
      monthlyCtcs,
      salarySetting
    );

    updateSalaryBreakdown([personalRow], monthlyCtcs, salaryBreakdown);

    console.log("✅ Salary breakdown calculated:", salaryBreakdown);

    return salarySetting;
  };

  const handleSalaryBreakdownUpdate = async (event, { database }) => {
    const personalModuleId = event.keys?.[0];
    const { payload } = event;

    const shouldRun = "ctc" in payload;

    if (!shouldRun) {
      console.log(
        "⚠️ No relevant fields changed. Skipping salary breakdown logic."
      );
      return;
    }
    if (!("salaryBreakdown" in payload)) {
      console.log("⚠️ salaryBreakdown not updated. Skipping logic.");
      return;
    }

    if (!personalModuleId) {
      console.log("❌ No personalModule ID found in event context");
      return;
    }

    const personalRow = await database("personalModule")
      .join(
        "directus_users",
        "personalModule.assignedUser",
        "directus_users.id"
      )
      .select(
        "personalModule.employeeId",
        "personalModule.id",
        "personalModule.salaryConfig",
        "directus_users.first_name as userName"
      )
      .where("personalModule.id", personalModuleId)
      .first();

    if (!personalRow) {
      console.log("⚠️ No personalModule row found for ID:", personalModuleId);
      return;
    }

    console.log("✅ personalRow fetched:", personalRow);

    const { salaryConfig } = personalRow;

    if (!salaryConfig) {
      console.log("❌ No salaryConfig found in personalModule");
      return;
    }

    // Step 2: Fetch salarySetting
    const salarySetting = await database("salarySetting")
      .select("*")
      .where("id", salaryConfig)
      .first();

    if (!salarySetting) {
      console.log("⚠️ No salarySetting found for ID:", salaryConfig);
      return;
    }

    console.log("✅ salarySettings fetched:", salarySetting);

    // Step 3: Calculate salary breakdown again (if needed)
    const salaryRow = await database("SalaryBreakdown")
      .select("ctc")
      .where("employee", personalModuleId)
      .first();

    if (!salaryRow) {
      console.log(
        "⚠️ No SalaryBreakdown found for employee ID:",
        personalModuleId
      );
      return;
    }

    const monthlyCtcs = [salaryRow.ctc / 12];

    // Step 4: Calculate salary breakdown (using your logic)
    const salaryBreakdown = calculateSalaryBreakdown(
      [personalRow],
      monthlyCtcs,
      salarySetting
    );

    updateSalaryBreakdown([personalRow], monthlyCtcs, salaryBreakdown);

    console.log("✅ New salary breakdown calculated:", salaryBreakdown);

    return salaryBreakdown;
  };
  action("salarySetting.items.update", handleSalarySettingChange);
  action("salarySetting.items.delete", handleSalarySettingChange);
  // action("personalModule.items.update", handlePersonalModuleUpdate);
  // action("personalModule.items.update", handleSalaryBreakdownUpdate);
};

const calculateSalaryBreakdown = (personalRows, monthlyCtcs, salarySetting) => {
  const earnings = salarySetting.earnings || [];

  const fixedEarningAppliedCtcs = {};
  let fixedAmountTotal = 0;
  console.log(
    "📆 Monthly CTCs with employeeId:",
    personalRows.map((p, i) => ({
      employeeId: p.employeeId,
      monthlyCTC: monthlyCtcs[i],
    }))
  );

  console.log("Starting calculations for earnings...");

  earnings.forEach((earning) => {
    if (earning.calculations === "Fixed") {
      const fixedAmount = earning.Fixed || 0;

      fixedEarningAppliedCtcs[earning.name] = monthlyCtcs.map(
        () => fixedAmount
      );

      fixedAmountTotal += fixedAmount;

      console.log(`Fixed earning applied: ${earning.name} = ${fixedAmount}`);
    }
  });

  console.log(`Total fixed amount applied: ${fixedAmountTotal}`);

  const remainingMonthlyCtcs = monthlyCtcs.map((ctc) => ctc - fixedAmountTotal);
  console.log(
    "Remaining Monthly CTCs after fixed earnings applied:",
    remainingMonthlyCtcs
  );

  const basicPay = remainingMonthlyCtcs.map(
    (ctc) => ctc * ((salarySetting.basicPay || 0) / 100)
  );
  console.log("Calculated Basic Pay:", basicPay);

  const hraEarning = earnings.find(
    (e) => e.calculations === "Percentage" && e.name === "HRA"
  );
  const daEarning = earnings.find(
    (e) => e.calculations === "Percentage" && e.name === "Dearness Allowance"
  );

  const hraAppliedCtcs = remainingMonthlyCtcs.map((ctc) => {
    const percentage = (hraEarning?.Percentage || 0) / 100;
    return ctc * percentage;
  });
  console.log("HRA Applied CTCs:", hraAppliedCtcs);

  const daAppliedCtcs = remainingMonthlyCtcs.map((ctc) => {
    const percentage = (daEarning?.Percentage || 0) / 100;
    return ctc * percentage;
  });
  console.log("DA Applied CTCs:", daAppliedCtcs);

  const otherPercentageEarnings = earnings.filter(
    (e) =>
      e.calculations === "Percentage" &&
      e.name !== "HRA" &&
      e.name !== "Dearness Allowance"
  );

  const otherEarningAppliedCtcs = {};

  otherPercentageEarnings.forEach((e) => {
    const percentage = (e.Percentage || 0) / 100;
    otherEarningAppliedCtcs[e.name] = remainingMonthlyCtcs.map(
      (ctc) => ctc * percentage
    );
    console.log(
      `Other earning applied: ${e.name} = ${otherEarningAppliedCtcs[e.name]}`
    );
  });

  const employerPFOption =
    salarySetting.employersContributions?.EmployerPF?.selectedOption;
  const employerPFBaseNames = (
    salarySetting.employersContributions?.EmployerPF?.Calculations || []
  ).map((calc) => calc.name);

  const employerESIOption =
    salarySetting.employersContributions?.EmployerESI?.selectedOption;
  const employerESIBaseNames = (
    salarySetting.employersContributions?.EmployerESI?.Calculations || []
  ).map((calc) => calc.name);

  const employeePFOption =
    salarySetting.employeeDeductions?.EmployeePF?.selectedOption;
  const employeePFBaseNames = (
    salarySetting.employeeDeductions?.EmployeePF?.Calculations || []
  ).map((calc) => calc.name);

  const employeeESIOption =
    salarySetting.employeeDeductions?.EmployeeESI?.selectedOption;
  const employeeESIBaseNames = (
    salarySetting.employeeDeductions?.EmployeeESI?.Calculations || []
  ).map((calc) => calc.name);

  const voluntaryPFOption =
    salarySetting.employeeDeductions?.VoluntaryPF?.selectedOption;
  const voluntaryPFBaseNames = (
    salarySetting.employeeDeductions?.VoluntaryPF?.Calculations || []
  ).map((calc) => calc.name);

  const originalBasicPay = [...basicPay];
  const originalDAAppliedCtcs = [...daAppliedCtcs];
  const originalHRAAppliedCtcs = [...hraAppliedCtcs];

  let workingBasicPay = [...basicPay];
  let workingDAAppliedCtcs = [...daAppliedCtcs];
  let workingHRAAppliedCtcs = [...hraAppliedCtcs];

  const allEarningAmounts = {
    "Basic Pay": workingBasicPay,
    HRA: workingHRAAppliedCtcs,
    "Dearness Allowance": workingDAAppliedCtcs,
    ...otherEarningAppliedCtcs,
    ...fixedEarningAppliedCtcs,
  };

  console.log("All earning amounts:", allEarningAmounts);

  const tolerance = 0.4;
  const convergedFlags = personalRows.map(() => false);
  console.log("Converged flags initialized:", convergedFlags);

  let iter = 0;
  let finalEmployerPF = [];
  let finalEmployerESI = [];
  let finalAdminCharges = [];
  let finalTotalEmployerContributions = [];
  let finalTotalEarnings = [];

  while (true) {
    const activeIndices = convergedFlags
      .map((flag, idx) => (!flag ? idx : -1))
      .filter((idx) => idx !== -1);

    if (activeIndices.length === 0) break;

    const pfBaseAmount = activeIndices.map((index) => {
      let total = 0;
      for (const name of employerPFBaseNames) {
        const val = allEarningAmounts[name]?.[index] || 0;
        if (val > 0) total += val;
      }
      return total;
    });

    const esiBaseAmount = activeIndices.map((index) => {
      let total = 0;
      for (const name of employerESIBaseNames) {
        const val = allEarningAmounts[name]?.[index] || 0;
        if (val > 0) total += val;
      }
      return total;
    });

    const employerPFContributions = pfBaseAmount.map((base, i) => {
      const index = activeIndices[i];
      const user = personalRows.find(
        (u) =>
          u.employeeId === personalRows[index]?.employeeId &&
          (u.allowPF || u.assignedUserPF)
      );
      const percent = 0.12;
      const calculated = base * percent;
      const value =
        !employerPFOption || !user
          ? 0
          : employerPFOption === 1800
          ? Math.min(calculated, 1800)
          : calculated;
      finalEmployerPF[index] = value;
      return value;
    });

    const employerESIContributions = esiBaseAmount.map((base, i) => {
      const index = activeIndices[i];
      const user = personalRows.find(
        (u) =>
          u.employeeId === personalRows[index]?.employeeId &&
          (u.allowESI || u.assignedUserESI)
      );
      const value =
        !employerESIOption || !user || monthlyCtcs[index] > 21000
          ? 0
          : Math.min(base * 0.0325, 682.5);
      finalEmployerESI[index] = value;
      return value;
    });

    const adminChargeEnabled = salarySetting.adminCharges?.enable;
    const adminChargeRate =
      parseFloat(salarySetting.adminCharges?.charge || "0") / 100;

    const adminCharges = pfBaseAmount.map((base, i) => {
      const index = activeIndices[i];
      const user = personalRows.find(
        (u) =>
          u.employeeId === personalRows[index]?.employeeId &&
          (u.allowPF || u.assignedUserPF)
      );
      const value =
        !adminChargeEnabled || !user
          ? 0
          : Math.min(base * adminChargeRate, 150);
      finalAdminCharges[index] = value;
      return value;
    });

    const totalEmployerContributions = employerPFContributions.map((_, i) => {
      const total =
        employerPFContributions[i] +
        employerESIContributions[i] +
        adminCharges[i];
      finalTotalEmployerContributions[activeIndices[i]] = total;
      return total;
    });

    const totalEarnings = activeIndices.map((i) => {
      let total = workingBasicPay[i] || 0;
      if (workingHRAAppliedCtcs[i] != null) total += workingHRAAppliedCtcs[i];
      if (workingDAAppliedCtcs[i] != null) total += workingDAAppliedCtcs[i];
      for (const arr of Object.values(otherEarningAppliedCtcs)) {
        if (arr[i] != null) total += arr[i];
      }
      for (const arr of Object.values(fixedEarningAppliedCtcs)) {
        if (arr[i] != null) total += arr[i];
      }
      finalTotalEarnings[i] = total;
      return total;
    });

    const calculatedCTC = totalEarnings.map((earning, i) => {
      return earning + totalEmployerContributions[i];
    });

    calculatedCTC.forEach((ctc, i) => {
      const index = activeIndices[i];
      const monthly = monthlyCtcs[index];
      const diff = Math.abs(ctc - monthly);

      if (diff <= tolerance) {
        convergedFlags[index] = true;
        return;
      }

      let extraAmount = Math.abs(ctc - monthly);
      let hra = workingHRAAppliedCtcs[index];
      let da = workingDAAppliedCtcs[index];
      let basic = workingBasicPay[index];

      const originalBasicVal = originalBasicPay[index];
      const originalDAVal = originalDAAppliedCtcs[index];
      const originalHRAVal = originalHRAAppliedCtcs[index];

      if (ctc > monthly) {
        if (extraAmount > 0 && hra > 0) {
          const reduced = Math.min(hra, extraAmount);
          hra -= reduced;
          extraAmount -= reduced;
        }

        if (extraAmount > 0 && da > 0) {
          const reduced = Math.min(da, extraAmount);
          da -= reduced;
          extraAmount -= reduced;
        }

        if (extraAmount > 0 && basic > 0) {
          const reduced = Math.min(basic, extraAmount);
          basic -= reduced;
          extraAmount -= reduced;
        }
      } else {
        if (extraAmount > 0 && basic < originalBasicVal) {
          const canAdd = Math.min(originalBasicVal - basic, extraAmount);
          basic += canAdd;
          extraAmount -= canAdd;
        }

        if (extraAmount > 0 && da < originalDAVal) {
          const canAdd = Math.min(originalDAVal - da, extraAmount);
          da += canAdd;
          extraAmount -= canAdd;
        }

        if (extraAmount > 0 && hra < originalHRAVal) {
          const canAdd = Math.min(originalHRAVal - hra, extraAmount);
          hra += canAdd;
          extraAmount -= canAdd;
        }
      }

      workingBasicPay[index] = basic;
      workingDAAppliedCtcs[index] = da;
      workingHRAAppliedCtcs[index] = hra;
    });
  }
  const employeePFBaseAmount = monthlyCtcs.map((_, index) => {
    let total = 0;
    for (const name of employeePFBaseNames) {
      const val = allEarningAmounts[name]?.[index] || 0;
      if (val > 0) total += val;
    }
    return total;
  });

  const employeeESIBaseAmount = monthlyCtcs.map((_, index) => {
    let total = 0;
    for (const name of employeeESIBaseNames) {
      const val = allEarningAmounts[name]?.[index] || 0;
      if (val > 0) total += val;
    }
    return total;
  });

  const voluntaryPFBaseAmount = monthlyCtcs.map((_, index) => {
    let total = 0;
    for (const name of voluntaryPFBaseNames) {
      const val = allEarningAmounts[name]?.[index] || 0;
      if (val > 0) total += val;
    }
    return total;
  });

  const employeePFContributions = employeePFBaseAmount.map((base, index) => {
    const user = personalRows.find(
      (u) =>
        u.employeeId === personalRows[index]?.employeeId &&
        (u.allowPF || u.assignedUserPF)
    );
    const calculated = base * 0.12;
    return !employeePFOption || !user
      ? 0
      : employeePFOption === 1800
      ? Math.min(calculated, 1800)
      : calculated;
  });

  const employeeESIContributions = employeeESIBaseAmount.map((base, index) => {
    const user = personalRows.find(
      (u) =>
        u.employeeId === personalRows[index]?.employeeId &&
        (u.allowESI || u.assignedUserESI)
    );
    return !employeeESIOption || !user || monthlyCtcs[index] > 21000
      ? 0
      : Math.min(base * 0.0075, 157.5);
  });

  const voluntaryPFContributions = voluntaryPFBaseAmount.map((base, index) => {
    const user = personalRows.find(
      (u) =>
        u.employeeId === personalRows[index]?.employeeId &&
        (u.allowPF || u.assignedUserPF)
    );
    const calculated = base * 0.13;
    return !voluntaryPFOption || !user
      ? 0
      : voluntaryPFOption === 1800
      ? Math.min(calculated, 1800)
      : calculated;
  });

  return {
    basicPay: workingBasicPay,
    hraAppliedCtcs: workingHRAAppliedCtcs,
    daAppliedCtcs: workingDAAppliedCtcs,
    otherEarningAppliedCtcs,
    fixedEarningAppliedCtcs,
    allEarningAmounts: {
      "Basic Pay": workingBasicPay,
      HRA: workingHRAAppliedCtcs,
      "Dearness Allowance": workingDAAppliedCtcs,
      ...otherEarningAppliedCtcs,
      ...fixedEarningAppliedCtcs,
    },
    employerPFContributions: finalEmployerPF,
    employerESIContributions: finalEmployerESI,
    adminCharges: finalAdminCharges,
    totalEmployerContributions: finalTotalEmployerContributions,
    totalEarnings: finalTotalEarnings,
    employeePFContributions,
    employeeESIContributions,
    voluntaryPFContributions,
  };
};

const updateSalaryBreakdown = async (
  salaryRows,
  monthlyCtcs,
  salaryBreakdown,
  ItemsService,
  database,
  id,
  schema
) => {
  const salaryService = new ItemsService("SalaryBreakdown", {
    knex: database,
    schema: schema,
  });
  console.log("🔍 Service schema :", database.schema);
  console.log("🔍 Service schema collections:", database.schema.collections);
  console.log(
    "🔍 Service methods:",
    Object.getOwnPropertyNames(Object.getPrototypeOf(salaryService))
  );

for (let i = 0; i < salaryRows.length; i += 100) {
  const batch = salaryRows.slice(i, i + 100);

  const updateDataArray = batch.map((person, index) => {
    const actualIndex = i + index;

    return {
      id: person.id,

      basicPay:"0.00",
      netSalary: "0.00",
      totalEarnings: "0.00",
      ctc:  "0.00",

      professionalTax: "0.00",
      totalDeductions: "0.00",
      employerLwf: person.allowPF ? 40 : 0,
      employeeLwf: person.allowPF ? 20 : 0,
    };
  });

  console.log(`📦 Attempting batch update ${i / 100 + 1} with ${updateDataArray.length} records`);
  console.log("🔎 Payload sent to updateMany:", JSON.stringify(updateDataArray, null, 2));

  try {
    const result = await salaryService.updateMany(updateDataArray);
    console.log(`✅ Batch ${i / 100 + 1} update successful`, result);
  } catch (error) {
    console.error(`❌ Batch ${i / 100 + 1} failed`);
    console.error("🛑 Failed Payload:", JSON.stringify(updateDataArray, null, 2));
    console.error("🔐 Error stack:", error);
    //  for (const record of updateDataArray) {
    //   try {
    //     await salaryService.updateOne(record.id, record);
    //     console.log(`✅ Record ${record.id} updated individually`);
    //   } catch (err) {
    //     console.error(`❌ Record ${record.id} failed individually`);
    //     console.error("⛔ Error:", err.message || err);
    //   }
    // }
  }
}





};
