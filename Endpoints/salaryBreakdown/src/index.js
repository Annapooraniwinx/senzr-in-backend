export default (router, { services, getSchema }) => {
  router.get("/salary-breakdown", async (req, res) => {
    try {
      const employeeIdsParam = req.query.employeeIds;

      if (!employeeIdsParam) {
        return res
          .status(400)
          .json({ error: "Missing employeeIds query param" });
      }

      const employeeIds = employeeIdsParam.split(",").map((id) => id.trim());

      const salaryBreakdownData = await getSalaryBreakdownData(
        employeeIds,
        services,
        getSchema,
        req.accountability
      );

      res.json({ success: true, data: salaryBreakdownData });
    } catch (err) {
      console.error("Error:", err);
      res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  });
};
async function getSalaryBreakdownData(
  employeeIds,
  services,
  getSchema,
  accountability
) {
  const { ItemsService } = services;
  const schema = await getSchema();

  const salaryBreakdownService = new ItemsService("salaryBreakdown", {
    schema,
    accountability,
  });

  const data = await salaryBreakdownService.readByQuery({
    filter: {
      employee: { _in: employeeIds },
    },
    fields: ["ctc", "employee.id", "id"],
    limit: -1,
  });

  return data;
}
