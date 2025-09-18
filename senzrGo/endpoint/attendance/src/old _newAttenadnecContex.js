function calculateAttendanceSummary(records, includeWeekoffs, includeHolidays) {
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
    // Handle Holiday and WeeklyOff first
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

    const dayValue =
      record.day && !isNaN(record.day) ? Number.parseFloat(record.day) : 0;
    let considerableDay = dayValue;
    if (dayValue === 0.75) {
      considerableDay = 1.0;
    } else if (dayValue > 1) {
      considerableDay = 1.0;
    }

    if (record.attendanceContext) {
      const context = record.attendanceContext;

      // Handle existing specific cases first
      if (
        [
          "1/2Present",
          "1/2P",
          "Present",
          "P",
          "Absent",
          "A",
          "WorkFromHome",
          "WFH",
          "Present On OD",
          "P(OD)",
          "WeeklyOff Present",
          "WOP",
          "WeeklyOff Present On OD",
          "WOP(OD)",
          "WeeklyOff 1/2Present",
          "WOA1/2P",
          "HolidayPresent",
        ].includes(context)
      ) {
        switch (context) {
          case "1/2Present":
          case "1/2P":
            summary.halfDay += 0.5;
            summary.absent += 0.5;
            summary.totalPayableDays += 0.5;
            break;
          case "Present":
          case "P":
            summary.present += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
          case "Absent":
          case "A":
            if (record.attendance === "unPaidLeave") {
              summary.unPaidLeave += considerableDay;
            } else {
              summary.absent += considerableDay;
            }
            break;
          case "WorkFromHome":
          case "WFH":
            summary.workFromHome += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
          case "Present On OD":
          case "P(OD)":
            summary.onDuty += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
          case "WeeklyOff Present":
          case "WOP":
          case "WeeklyOff Present On OD":
          case "WOP(OD)":
            summary.weekoffPresent += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
          case "WeeklyOff 1/2Present":
          case "WOA1/2P":
            summary.weekoffPresent += 0.5;
            summary.totalPayableDays += 0.5;
            break;
          case "HolidayPresent":
            summary.holidayPresent += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
        }
      } else {
        // Parse complex attendance contexts using regex
        const contextRegex =
          /(Present|WeekoffPresent|HolidayPresent)?(?:\((\d\/\d)?([A-Z]+)\)?(?:\((\w+)\))?)?/g;
        let matches;
        let parsedItems = [];
        let isPresent = false;
        let isWeekoffPresent = false;
        let isHolidayPresent = false;

        // Extract Ascertain if the context contains a status (Present, WeekoffPresent, HolidayPresent)
        if (
          context.includes("Present") ||
          context.includes("WeekoffPresent") ||
          context.includes("HolidayPresent")
        ) {
          isPresent =
            context.includes("Present") &&
            !context.includes("WeekoffPresent") &&
            !context.includes("HolidayPresent");
          isWeekoffPresent = context.includes("WeekoffPresent");
          isHolidayPresent = context.includes("HolidayPresent");
        }

        // Extract all deduction parts
        while ((matches = contextRegex.exec(context)) !== null) {
          const status = matches[1];
          const fraction = matches[2];
          const type = matches[3];
          const reason = matches[4];

          if (status) {
            if (status === "Present") isPresent = true;
            if (status === "WeekoffPresent") isWeekoffPresent = true;
            if (status === "HolidayPresent") isHolidayPresent = true;
          }
          if (type) {
            parsedItems.push({ fraction, type, reason });
          }
        }

        // Handle standalone leave types (e.g., 1/2CL, 1/4LOP, CL, LOP)
        const leaveMatch = context.match(/^(\d\/\d)?([A-Z]+)$/);
        if (
          leaveMatch &&
          !isPresent &&
          !isWeekoffPresent &&
          !isHolidayPresent
        ) {
          const fraction = leaveMatch[1];
          const leaveType = leaveMatch[2];
          let leaveValue = fraction
            ? parseFloat(fraction.split("/")[0]) /
              parseFloat(fraction.split("/")[1])
            : 1.0;

          if (leaveType === "LOP") {
            summary.unPaidLeave += leaveValue;
            summary.absent += leaveValue;
          } else {
            summary.paidLeave += leaveValue;
            summary.absent += leaveValue;
            record.leaveType = record.leaveType || leaveType.toLowerCase();
          }
          return;
        }

        // Handle existing leave-related contexts
        const leaveContextMatch = context.match(
          /(?:Present On Leave|On Leave|1\/2Present On Leave|Present On OD On Leave|1\/2Present On OD On Leave)\((.*?)\)/
        );
        if (leaveContextMatch && !parsedItems.length) {
          const leaveStr = leaveContextMatch[1];
          const leaveParts = leaveStr.match(/(\d\/\d)?([A-Z]+)(?:\((\w+)\))?/);
          if (leaveParts) {
            const fraction = leaveParts[1];
            const leaveType = leaveParts[2];
            const reason = leaveParts[3];
            let leaveValue = fraction
              ? parseFloat(fraction.split("/")[0]) /
                parseFloat(fraction.split("/")[1])
              : 1.0;

            if (leaveType === "LOP") {
              summary.unPaidLeave += leaveValue;
              summary.absent += leaveValue;
              if (reason === "DueToLate") summary.lateComing += 1;
              if (reason === "Early") summary.earlyLeaving += 1;
              if (reason === "WH") summary.absent += leaveValue;
            } else {
              if (context.includes("Present")) {
                summary.present += considerableDay - leaveValue;
                summary.totalPayableDays += considerableDay - leaveValue;
              }
              summary.paidLeave += leaveValue;
              record.leaveType = record.leaveType || leaveType.toLowerCase();
              if (reason === "DueToLate") summary.lateComing += 1;
              if (reason === "Early") summary.earlyLeaving += 1;
              if (reason === "WH") summary.absent += leaveValue;
            }
            return;
          }
        }

        // Handle new combined deduction cases (e.g., Present(1/2LOP)(DueToLate)(1/4LOP)(Early))
        if (parsedItems.length > 0) {
          let totalDeduction = 0;
          let leaveTypeAssigned = false;

          parsedItems.forEach(({ fraction, type, reason }) => {
            let value = fraction
              ? parseFloat(fraction.split("/")[0]) /
                parseFloat(fraction.split("/")[1])
              : 1.0;

            if (type === "LOP") {
              summary.unPaidLeave += value;
              summary.absent += value;
              totalDeduction += value;
            } else {
              summary.paidLeave += value;
              summary.absent += value;
              record.leaveType = record.leaveType || type.toLowerCase();
              leaveTypeAssigned = true;
              totalDeduction += value;
            }

            if (reason === "DueToLate") summary.lateComing += 1;
            if (reason === "Early") summary.earlyLeaving += 1;
            if (reason === "WH") summary.absent += value;
          });

          if (isPresent) {
            const presentValue = Math.max(0, considerableDay - totalDeduction);
            summary.present += presentValue;
            summary.totalPayableDays += presentValue;
          } else if (isWeekoffPresent) {
            const presentValue = Math.max(0, considerableDay - totalDeduction);
            summary.weekoffPresent += presentValue;
            summary.totalPayableDays += presentValue;
          } else if (isHolidayPresent) {
            const presentValue = Math.max(0, considerableDay - totalDeduction);
            summary.holidayPresent += presentValue;
            summary.totalPayableDays += presentValue;
          }
          return;
        }

        // Handle specific existing leave contexts
        if (
          [
            "1/2Present On Leave(1/4SL)",
            "1/4SL1/2P",
            "Present On Leave(1/4CL)",
            "1/4CLP",
            "Present On Leave(1/4PL)",
            "1/4PLP",
            "Present On Leave(1/4SL)",
            "1/4SLP",
            "On Leave(1/2PL)",
            "1/2PL",
            "On Leave(½CL)",
            "On Leave(1/2CL)",
            "1/2CL",
            "1/2Present On Leave(1/2CL)",
            "1/2CL1/2P",
            "1/2Present On Leave(1/2PL)",
            "1/2PL1/2P",
            "Present On Leave(1/2CL)",
            "1/2CLP",
            "Present On Leave(1/2PL)",
            "1/2PLP",
            "Present On OD On Leave(1/2PL)",
            "1/2PLP(OD)",
            "1/2Present On Leave(1/2SL)",
            "1/2SL1/2P",
            "Present On Leave(1/2SL)",
            "1/2SLP",
            "On Leave(3/4CL)",
            "3/4CL",
            "Present On Leave(3/4SL)",
            "3/4SLP",
            "1/2Present On Leave(CL)",
            "CL1/2P",
            "Present On Leave(CL)",
            "CLP",
            "On Leave(CL)",
            "Present On OD On Leave(CL)",
            "CLP(OD)",
            "On Leave(PL)",
            "PL",
            "Present On Leave(PL)",
            "PLP",
            "On Leave(SL)",
            "SL",
          ].includes(context)
        ) {
          const leaveMatch = context.match(/(\d\/\d)?([A-Z]+)(?:\((\w+)\))?/);
          if (leaveMatch) {
            const fraction = leaveMatch[1];
            const leaveType = leaveMatch[2];
            const reason = leaveMatch[3];
            let leaveValue = fraction
              ? parseFloat(fraction.split("/")[0]) /
                parseFloat(fraction.split("/")[1])
              : 1.0;

            if (context.includes("Present")) {
              summary.present += considerableDay - leaveValue;
              summary.totalPayableDays += considerableDay - leaveValue;
            } else if (context.includes("On Leave")) {
              summary.absent += leaveValue;
            }

            if (leaveType === "LOP") {
              summary.unPaidLeave += leaveValue;
            } else {
              summary.paidLeave += leaveValue;
              record.leaveType = record.leaveType || leaveType.toLowerCase();
            }

            if (reason === "DueToLate") summary.lateComing += 1;
            if (reason === "Early") summary.earlyLeaving += 1;
            if (reason === "WH") summary.absent += leaveValue;
            return;
          }
        }

        // Fallback for unmatched contexts
        console.warn(`💠 Unmatched attendance context: "${context}"`);
        switch (record.attendance) {
          case "present":
            summary.present += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
          case "absent":
            summary.absent += considerableDay;
            break;
          case "weekOff":
            summary.weekOff += 1;
            summary.totalPayableDays += includeWeekoffs ? 1 : 0;
            break;
          case "holiday":
            summary.holiday += 1;
            summary.totalPayableDays += includeHolidays ? 1 : 0;
            break;
          case "onDuty":
            summary.onDuty += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
          case "workFromHome":
            summary.workFromHome += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
          case "halfDay":
            summary.halfDay += considerableDay;
            summary.present += considerableDay;
            summary.absent += 1 - considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
          case "paidLeave":
            summary.paidLeave += considerableDay;
            break;
          case "unPaidLeave":
            summary.unPaidLeave += considerableDay;
            break;
          case "holidayPresent":
            summary.holidayPresent += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
          case "weekoffPresent":
            summary.weekoffPresent += considerableDay;
            summary.totalPayableDays += considerableDay;
            break;
        }
      }

      // Handle early departure, late coming, and overtime
      if (record.earlyDeparture && record.earlyDeparture !== "00:00:00") {
        summary.earlyLeaving += 1;
      }
      if (record.lateBy && record.lateBy !== "00:00:00") {
        summary.lateComing += 1;
      }
      if (record.overTime && record.overTime !== "00:00:00") {
        if (isPresent || context === "Present" || context === "P") {
          summary.workingDayOT += 1;
        } else if (
          isWeekoffPresent ||
          context === "WeeklyOff Present" ||
          context === "WOP" ||
          context === "WeeklyOff Present On OD" ||
          context === "WOP(OD)"
        ) {
          summary.weekoffPresentOT += 1;
        } else if (isHolidayPresent || context === "HolidayPresent") {
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
    }
  });

  console.log("💠 Calculated summary:", summary);
  return summary;
}
