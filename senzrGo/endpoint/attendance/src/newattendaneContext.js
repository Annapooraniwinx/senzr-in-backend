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

      // Regular expression to parse attendance context
      const contextRegex =
        /(Present|WeekoffPresent|HolidayPresent)?(?:\((.*?)\))?(?:\((\w+)\))?/g;
      let matches;
      let parsedItems = [];
      let isPresent = false;
      let isWeekoffPresent = false;
      let isHolidayPresent = false;
      let deductions = [];

      // Extract all parts of the context
      while ((matches = contextRegex.exec(context)) !== null) {
        const status = matches[1];
        const deduction = matches[2];
        const reason = matches[3];

        if (status === "Present") isPresent = true;
        if (status === "WeekoffPresent") isWeekoffPresent = true;
        if (status === "HolidayPresent") isHolidayPresent = true;
        if (deduction) {
          parsedItems.push({ deduction, reason });
        }
      }

      // If no status is explicitly mentioned, check for standalone leave types
      if (!isPresent && !isWeekoffPresent && !isHolidayPresent) {
        const leaveMatch = context.match(/(\d\/\d)?([A-Z]+)(?:\((\w+)\))?/);
        if (leaveMatch) {
          const fraction = leaveMatch[1];
          const leaveType = leaveMatch[2];
          const reason = leaveMatch[3];

          let leaveValue = fraction
            ? parseFloat(fraction.split("/")[0]) /
              parseFloat(fraction.split("/")[1])
            : 1.0;

          if (leaveType === "LOP") {
            summary.unPaidLeave += leaveValue;
            summary.absent += leaveValue;
            if (reason === "DueToLate") summary.lateComing += 1;
            if (reason === "Early") summary.earlyLeaving += 1;
            if (reason === "WH") summary.absent += leaveValue; // WH impacts absent
          } else {
            summary.paidLeave += leaveValue;
            record.leaveType = record.leaveType || leaveType.toLowerCase();
            summary.absent += leaveValue;
            if (reason === "DueToLate") summary.lateComing += 1;
            if (reason === "Early") summary.earlyLeaving += 1;
            if (reason === "WH") summary.absent += leaveValue;
          }
          return;
        }
      }

      // Handle combined deductions (e.g., Present(1/2LOP)(DueToLate)(1/4LOP)(Early))
      let totalDeduction = 0;
      let leaveTypeAssigned = false;

      parsedItems.forEach(({ deduction, reason }) => {
        const [fraction, type] = deduction.split(/([A-Z]+)/);
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

      // Adjust based on status
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

      // Handle specific known contexts
      if (context === "1/2Present" || context === "1/2P") {
        summary.halfDay += 0.5;
        summary.absent += 0.5;
        summary.totalPayableDays += 0.5;
      } else if (context === "Present" || context === "P") {
        summary.present += considerableDay;
        summary.totalPayableDays += considerableDay;
      } else if (context === "Absent" || context === "A") {
        if (record.attendance === "unPaidLeave") {
          summary.unPaidLeave += considerableDay;
        } else {
          summary.absent += considerableDay;
        }
      } else if (context === "WorkFromHome" || context === "WFH") {
        summary.workFromHome += considerableDay;
        summary.totalPayableDays += considerableDay;
      } else if (context === "Present On OD" || context === "P(OD)") {
        summary.onDuty += considerableDay;
        summary.totalPayableDays += considerableDay;
      } else if (
        context === "WeeklyOff Present" ||
        context === "WOP" ||
        context === "WeeklyOff Present On OD" ||
        context === "WOP(OD)"
      ) {
        summary.weekoffPresent += considerableDay;
        summary.totalPayableDays += considerableDay;
      } else if (context === "WeeklyOff 1/2Present" || context === "WOA1/2P") {
        summary.weekoffPresent += 0.5;
        summary.totalPayableDays += 0.5;
      } else if (context === "HolidayPresent") {
        summary.holidayPresent += considerableDay;
        summary.totalPayableDays += considerableDay;
      } else if (context.includes("On Leave")) {
        const leaveMatch = context.match(/(\d\/\d)?([A-Z]+)(?:\((\w+)\))?/);
        if (leaveMatch) {
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
            record.leaveType = record.leaveType || leaveType.toLowerCase();
          }
        } else {
          summary.paidLeave += considerableDay;
        }
      } else {
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
        if (isPresent) {
          summary.workingDayOT += 1;
        } else if (isWeekoffPresent) {
          summary.weekoffPresentOT += 1;
        } else if (isHolidayPresent) {
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
