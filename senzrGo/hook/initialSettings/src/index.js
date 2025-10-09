export default ({ filter, action, services, database }) => {
  const { ItemsService } = services;

  action("items.create", async (meta, context) => {
    const { collection, payload, key } = meta;
    const { accountability } = context;

    if (collection !== "tenant") return;

    console.log("Tenant created! Starting additional setup...");

    const tenantId = key;
    const employeeId = payload.employeeId;

    const errorService = new ItemsService("registration_errors", {
      schema: context.schema,
      accountability,
    });
    const pendingCollections = [];

    try {
      // Create folder structure
      const folderIds = [];
      try {
        const mainFolder = await database("directus_folders")
          .insert({ name: tenantId })
          .returning("id");
        folderIds.push(mainFolder[0].id);
        const childFolders = [
          "Profiles",
          "Faces",
          "Fingers",
          "Imported Files",
          "Documents",
          "DeviceImages",
          "TDS Documents",
          "Leave Documents",
          "Asserts",
          "Workorders",
          "rfidCard",
        ];
        for (const folderName of childFolders) {
          const folder = await database("directus_folders")
            .insert({ name: folderName, parent: mainFolder[0].id })
            .returning("id");
          folderIds.push(folder[0].id);
        }
        const importedFilesSubFolders = ["EmployeeDatas", "AttendanceRecords"];
        for (const subFolder of importedFilesSubFolders) {
          const folder = await database("directus_folders")
            .insert({
              name: subFolder,
              parent: folderIds[childFolders.indexOf("Imported Files") + 1],
            })
            .returning("id");
          folderIds.push(folder[0].id);
        }
        const documentsSubFolders = ["OnboardDocuments", "OffBoardDocuments"];
        for (const subFolder of documentsSubFolders) {
          const folder = await database("directus_folders")
            .insert({
              name: subFolder,
              parent: folderIds[childFolders.indexOf("Documents") + 1],
            })
            .returning("id");
          folderIds.push(folder[0].id);
        }
        await database("tenant")
          .update({ foldersId: folderIds })
          .where("tenantId", tenantId);
      } catch (error) {
        console.error("Error creating folders:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "directus_folders",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "locationManagement",
            "organization",
            "attendanceCycle",
            "shifts",
            "personalModule",
            "SalaryBreakdregistration_errorsown",
            "config",
          ],
        });
        return; // Stop further processing but don't delete
      }

      // Create location
      let locationId = null;
      try {
        const locationService = new ItemsService("locationManagement", {
          schema: context.schema,
          accountability,
        });
        const locationPayload = {
          status: "active",
          locType: "branch",
          locdetail: {
            locationName: payload.tenantName,
            address: payload.companyAddress || "N/A",
            pincode: payload.companyAddress
              ? payload.companyAddress.match(/\b\d{6}\b/)?.[0] || ""
              : "",
          },
          tenant: tenantId,
        };
        const location = await locationService.createOne(locationPayload);
        locationId = location.id;
      } catch (error) {
        console.error("Error creating location:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "locationManagement",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "organization",
            "attendanceCycle",
            "shifts",
            "personalModule",
            "SalaryBreakdown",
            "config",
          ],
        });
        return;
      }
      pendingCollections.push("locationManagement");

      // Create organization
      let organizationId = null;
      try {
        const orgService = new ItemsService("organization", {
          schema: context.schema,
          accountability,
        });
        const orgPayload = {
          orgName: payload.tenantName,
          orgNumber: payload.mobileNumber ? `+91${payload.mobileNumber}` : null,
          orgGst: payload.panOrGst || null,
          orgType: "main tenant",
          orgAddress: payload.companyAddress || "N/A",
          tenant: tenantId,
          orgLocation: locationId,
        };
        organizationId = (await orgService.createOne(orgPayload)).id;
        if (locationId) {
          const locationService = new ItemsService("locationManagement", {
            schema: context.schema,
            accountability,
          });
          await locationService.updateOne(locationId, {
            orgLocation: organizationId,
          });
        }
      } catch (error) {
        console.error("Error creating organization:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "organization",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "attendanceCycle",
            "shifts",
            "personalModule",
            "SalaryBreakdown",
            "config",
          ],
        });
        return;
      }
      pendingCollections.push("organization");

      // Create attendance cycle
      let attendanceCycleId = null;
      try {
        const cycleService = new ItemsService("attendanceCycle", {
          schema: context.schema,
          accountability,
        });
        const cyclePayload = {
          fixedCycle: true,
          tenant: tenantId,
          multi_attendance_cycle: {
            cycles: [
              {
                cycleId: 1,
                cycleName: "Normal Employee",
                startDate: 1,
                endDate: "end of the month",
                includeWeekends: true,
                includeHolidays: true,
              },
              {
                cycleId: 2,
                cycleName: "Daily wages Employee",
                startDate: 14,
                endDate: 15,
                includeWeekends: true,
                includeHolidays: true,
              },
            ],
          },
        };
        attendanceCycleId = (await cycleService.createOne(cyclePayload)).id;
      } catch (error) {
        console.error("Error creating attendance cycle:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "attendanceCycle",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "shifts",
            "personalModule",
            "SalaryBreakdown",
            "config",
          ],
        });
        return;
      }
      pendingCollections.push("attendanceCycle");

      // Create shift
      let shiftId = null;
      try {
        const shiftService = new ItemsService("shifts", {
          schema: context.schema,
          accountability,
        });
        const shiftPayload = {
          shift: "GeneralShift",
          entryTime: "09:00:00",
          exitTime: "18:00:00",
          break: "00:30:00",
          status: "assigned",
          tenant: tenantId,
        };
        shiftId = (await shiftService.createOne(shiftPayload)).id;
      } catch (error) {
        console.error("Error creating shift:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "shifts",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["personalModule", "SalaryBreakdown", "config"],
        });
        return;
      }
      pendingCollections.push("shifts");

      // Create personal module
      try {
        const personalService = new ItemsService("personalModule", {
          schema: context.schema,
          accountability,
        });
        const adminRole = await database("directus_roles")
          .select("id")
          .where("name", "Admin")
          .first();
        const adminRoleId =
          adminRole?.id || "ea2303aa-1662-43ca-a7f7-ab84924a7e0a";
        const personalPayload = {
          status: "active",
          accessOn: true,
          employeeId: employeeId,
          cycleType: 1,
          uniqueId: `${tenantId}-${employeeId}`,
          attendanceSettings: {
            isMonday: false,
            monJ: { shifts: [shiftId] },
            isTuesday: false,
            tueJ: { shifts: [shiftId] },
            isWednesday: false,
            wedJ: { shifts: [shiftId] },
            isThursday: false,
            thuJ: { shifts: [shiftId] },
            isFriday: false,
            friJ: { shifts: [shiftId] },
            isSaturday: false,
            satJ: { shifts: [shiftId] },
            isSunday: true,
            sunJ: { shifts: [] },
          },
          assignedUser: {
            first_name: payload.fullName,
            email: payload.email,
            phone: payload.mobileNumber ? `+91${payload.mobileNumber}` : null,
            role: adminRoleId,
            tenant: tenantId,
            appAccess: true,
            organization: organizationId,
            userApp: "fieldeasy",
          },
        };
        await personalService.createOne(personalPayload);
      } catch (error) {
        console.error("Error creating personal module:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "personalModule",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["SalaryBreakdown", "config"],
        });
        return;
      }
      pendingCollections.push("personalModule");

      // Create salary breakdown
      try {
        const salaryService = new ItemsService("SalaryBreakdown", {
          schema: context.schema,
          accountability,
        });
        await salaryService.createOne({
          employee: employeeId,
          tenant: tenantId,
        });
      } catch (error) {
        console.error("Error creating salary breakdown:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "SalaryBreakdown",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["config"],
        });
        return;
      }
      pendingCollections.push("SalaryBreakdown");

      // Create default templates
      const defaultTemplates = [
        { name: "Regular Staff", type: "regular" },
        { name: "Housekeeping Employee", type: "housekeeping" },
        { name: "Security Staff", type: "security" },
        { name: "Flex Shifts", type: "flex" },
      ];
      for (const template of defaultTemplates) {
        try {
          const configService = new ItemsService("config", {
            schema: context.schema,
            accountability,
          });
          await configService.createOne({
            configName: template.name,
            tenant: tenantId,
            attendancePolicies: { locationCentric: false },
            salarySettings: { status: "draft" },
          });
        } catch (error) {
          console.error(`Error creating config ${template.name}:`, error);
          await errorService.createOne({
            tenantId,
            employeeId,
            failed_collection: "config",
            error_response: { message: error.message, stack: error.stack },
            pending_collections: [],
          });
          return;
        }
      }
      pendingCollections.push("config");

      console.log("All resources created successfully for tenant:", tenantId);
    } catch (error) {
      console.error("Unexpected error in hook:", error);
      await errorService.createOne({
        tenantId,
        employeeId,
        failed_collection: "unknown",
        error_response: { message: error.message, stack: error.stack },
        pending_collections: pendingCollections,
      });
    }
  });
};
