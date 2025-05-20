export default ({ action }) => {
  
  const handleSalarySettingChange = async ({ keys }, { database }) => {
    console.log("caaled")
    const updatedId = keys[0];

    const personalRows = await database('personalModule')
      .select('employeeId', 'id')
      .where('salaryConfig', updatedId);

    const employeeIds = personalRows.map(row => row.employeeId);

    const salaryRows = await database('SalaryBreakdown')
      .join('personalModule', 'SalaryBreakdown.employee', 'personalModule.id')
      .select('SalaryBreakdown.ctc', 'personalModule.employeeId')
      .whereIn('personalModule.employeeId', employeeIds);

    

        const salarySetting = await database('salarySetting')
  .select('*')
  .where('id', updatedId)
  .first();

  const ctcs = salaryRows.map(row => row.ctc);
  
const monthlyCtcs = ctcs.map(ctc => ctc / 12);
console.log('monthlyCtcs:', monthlyCtcs);

      const earnings = salarySetting.earnings || [];

      const fixedEarningAppliedCtcs = {};
let fixedAmountTotal = 0;

earnings.forEach((earning) => {
  if (earning.calculations === "Fixed") {
    const fixedAmount = earning.Fixed || 0;

    fixedEarningAppliedCtcs[earning.name] = monthlyCtcs.map(() => fixedAmount);

    fixedAmountTotal += fixedAmount;
  }
});


      const remainingMonthlyCtcs = monthlyCtcs.map(
  ctc => ctc - fixedAmountTotal
);
console.log(`remainingMonthlyCtcs: ${remainingMonthlyCtcs}`);
     const basicPay = remainingMonthlyCtcs.map(
  ctc => ctc * ((salarySetting.basicPay || 0)/100)
);

console.log('Basic Pay:', basicPay);
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
console.log('HRA Applied CTCs:', hraAppliedCtcs);

const daAppliedCtcs = remainingMonthlyCtcs.map((ctc) => {
  const percentage = (daEarning?.Percentage || 0) / 100;
  return ctc * percentage;
});
console.log('DA Applied CTCs:', daAppliedCtcs);

const otherPercentageEarnings = earnings.filter(
  (e) =>
    e.calculations === "Percentage" && e.name !== "HRA" && e.name !== "Dearness Allowance"
);

const otherEarningAppliedCtcs = {};

otherPercentageEarnings.forEach((e) => {
  const percentage = (e.Percentage || 0) / 100;
  otherEarningAppliedCtcs[e.name] = remainingMonthlyCtcs.map(
    (ctc) => ctc * percentage
  );
});
console.log('Other Percentage Earnings Applied CTCs:', otherEarningAppliedCtcs);

const employerPFOption =
  salarySetting.employersContributions?.EmployerPF?.selectedOption;
const employerPFBaseNames = (
  salarySetting.employersContributions?.EmployerPF?.Calculations || []
).map((calc) => calc.name);
console.log('Employer PF Option:', employerPFOption);
console.log('Employer PF Base Names:', employerPFBaseNames);

const employerESIOption =
  salarySetting.employersContributions?.EmployerESI?.selectedOption;
const employerESIBaseNames = (
  salarySetting.employersContributions?.EmployerESI?.Calculations || []
).map((calc) => calc.name);
console.log('Employer ESI Option:', employerESIOption);
console.log('Employer ESI Base Names:', employerESIBaseNames);

const allEarningAmounts = {
  'Basic Pay': basicPay,
  'HRA': hraAppliedCtcs,
  'Dearness Allowance': daAppliedCtcs,
  ...otherEarningAppliedCtcs,
  ...fixedEarningAppliedCtcs
};

const pfBaseAmount = remainingMonthlyCtcs.map((_, index) =>
  employerPFBaseNames.reduce((sum, name) => {
    const earningArray = allEarningAmounts[name] || [];
    return sum + (earningArray[index] || 0);
  }, 0)
);
console.log('PF Base Amount:',pfBaseAmount);

const esiBaseAmount = remainingMonthlyCtcs.map((_, index) =>
  employerESIBaseNames.reduce((sum, name) => {
    const earningArray = allEarningAmounts[name] || [];
    return sum + (earningArray[index] || 0);
  }, 0)
);
console.log('ESI Base Amount:', esiBaseAmount);
const employerPFContributions = employerPFOption
  ? pfBaseAmount.map(base => {
      const percentage = 12 / 100;
      const calculated = base * percentage;
      return employerPFOption === 1800 ? Math.min(calculated, 1800) : calculated;
    })
  : pfBaseAmount.map(() => 0);
console.log('Employer PF Contributions:', employerPFContributions);

const employerESIContributions = employerESIOption
  ? esiBaseAmount.map(base => {
      const percentage = 3.25 / 100;
      const calculated = base * percentage;
      return employerESIOption === 1800 ? Math.min(calculated, 1800) : calculated;
    })
  : esiBaseAmount.map(() => 0);
console.log('Employer ESI Contributions:', employerESIContributions);


const adminChargeEnabled = salarySetting.adminCharges?.enable;
const adminChargeRate = parseFloat(salarySetting.adminCharges?.charge || '0') / 100;

const adminCharges = pfBaseAmount.map(base =>
  adminChargeEnabled ? base * adminChargeRate : 0
);
console.log('Admin Charges:', adminCharges);

const totalEmployerContributions = employerPFContributions.map((_, index) =>
  employerPFContributions[index] +
  employerESIContributions[index] +
  adminCharges[index]
);
console.log('Total Employer Contributions:', totalEmployerContributions);

const totalEarnings = basicPay.map((basic, i) => {
  let total = basic;

  // Add HRA
  if (hraAppliedCtcs[i] != null) {
    total += hraAppliedCtcs[i];
  }

  // Add DA
  if (daAppliedCtcs[i] != null) {
    total += daAppliedCtcs[i];
  }

  // Add other percentage-based earnings
  for (const arr of Object.values(otherEarningAppliedCtcs)) {
    if (arr[i] != null) {
      total += arr[i];
    }
  }

  for (const arr of Object.values(fixedEarningAppliedCtcs)) {
    if (arr[i] != null) total += arr[i];
  }

  return total;
});

console.log("Total Earnings Per User (with Fixed):", totalEarnings);
const calculatedCTC = totalEarnings.map((earning, i) => earning + totalEmployerContributions[i]);

console.log('Calculated CTC:', calculatedCTC);

calculatedCTC.forEach((ctc, i) => {
  const monthly = monthlyCtcs[i];
  console.log(`👤 User ${i + 1}:`);
  console.log(`   🧮 Calculated CTC: ₹${ctc.toFixed(2)}, 🧾 Monthly CTC: ₹${monthly.toFixed(2)}`);

  if (ctc > monthly) {
    console.log("⚠️ Calculated CTC is GREATER than monthly CTC.");
    let extraAmount = ctc - monthly;
    console.log(`💸 Extra amount to reduce: ₹${extraAmount.toFixed(2)}`);

    let hra = hraAppliedCtcs[i];
    let da = daAppliedCtcs[i];
    let basic = basicPay[i];

    const original = { hra, da, basic };
    let hraReduced = 0, daReduced = 0, basicReduced = 0;

    if (extraAmount > 0) {
      if (extraAmount <= hra) {
        hraReduced = extraAmount;
        hra -= extraAmount;
        extraAmount = 0;
      } else {
        hraReduced = hra;
        extraAmount -= hra;
        hra = 0;

        if (extraAmount <= da) {
          daReduced = extraAmount;
          da -= extraAmount;
          extraAmount = 0;
        } else {
          daReduced = da;
          extraAmount -= da;
          da = 0;

          if (extraAmount <= basic) {
            basicReduced = extraAmount;
            basic -= extraAmount;
            extraAmount = 0;
          } else {
            basicReduced = basic;
            basic = 0;
            extraAmount = 0;
          }
        }
      }
    }

    console.log(`   🔧 Adjustments:`);
    console.log(`     🏠 HRA reduced by ₹${hraReduced} (from ₹${original.hra} to ₹${hra})`);
    console.log(`     ⚙️ DA reduced by ₹${daReduced} (from ₹${original.da} to ₹${da})`);
    console.log(`     👔 Basic Pay reduced by ₹${basicReduced} (from ₹${original.basic} to ₹${basic})`);

  } else if (ctc < monthly) {
    console.log("ℹ️ Calculated CTC is LESS than monthly CTC.");
    let leftoverAmount = monthly - ctc;
    console.log(`💰 Amount to distribute: ₹${leftoverAmount.toFixed(2)}`);

    let hra = hraAppliedCtcs[i];
    let da = daAppliedCtcs[i];
    let basic = basicPay[i];

    const original = { hra, da, basic };
    const maxHra = hraAppliedCtcs[i];
    const maxDa = daAppliedCtcs[i];
    const maxBasic = basicPay[i];

    let hraAdded = 0, daAdded = 0, basicAdded = 0;

    if (leftoverAmount > 0) {
      hraAdded = Math.min(leftoverAmount, maxHra - hra);
      hra += hraAdded;
      leftoverAmount -= hraAdded;
    }

    if (leftoverAmount > 0) {
      daAdded = Math.min(leftoverAmount, maxDa - da);
      da += daAdded;
      leftoverAmount -= daAdded;
    }

    if (leftoverAmount > 0) {
      basicAdded = Math.min(leftoverAmount, maxBasic - basic);
      basic += basicAdded;
      leftoverAmount -= basicAdded;
    }

    console.log(`   🔧 Adjustments:`);
    console.log(`     🏠 HRA increased by ₹${hraAdded} (from ₹${original.hra} to ₹${hra})`);
    console.log(`     ⚙️ DA increased by ₹${daAdded} (from ₹${original.da} to ₹${da})`);
    console.log(`     👔 Basic Pay increased by ₹${basicAdded} (from ₹${original.basic} to ₹${basic})`);
  } else {
    console.log("✅ Calculated CTC matches Monthly CTC exactly. No adjustment needed.");
  }

  console.log("--------------------------------------------------");
});


  };


action('salarySetting.items.create', handleSalarySettingChange);
  action('salarySetting.items.update', handleSalarySettingChange);
  action('salarySetting.items.delete', handleSalarySettingChange);


}; 