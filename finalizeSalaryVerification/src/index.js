module.exports = function registerEndpoint(router, { services }) {
  const { ItemsService } = services;

  router.get("/", async (req, res) => {
    console.log("Request received:", req.url);
    console.log("Full query object:", JSON.stringify(req.query));
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "startDate and endDate are required in query parameters",
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
          id: { _in: employeeIds },
        },
        fields: [
          "ctc",
          "employee.id",
          "employee.employeeId",
          "basicSalary",
          "basicPay",
          "earnings",
          "employersContribution",
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
          "benefitsDetails",
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
          fields: ["payableDays", "employee.id", "id"],
          limit: -1,
        });

      console.log(
        `Found ${payrollVerificationData.length} payroll verification records`
      );

      const combinedData = personalModuleData.map((personal) => {
        const salaryInfo = salaryBreakdownData.find(
          (salary) => salary.employee && salary.employee.id === personal.id
        );

        return {
          ...personal,
          salaryBreakdown: salaryInfo || null,
          payrollVerificationData,
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
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  });
};
