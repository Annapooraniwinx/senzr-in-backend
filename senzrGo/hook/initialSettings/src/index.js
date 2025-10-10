import { v4 as uuidv4 } from "uuid";

export default ({ action }, { services, database }) => {
  const { ItemsService } = services;

  action("items.create", async (meta, context) => {
    const { collection, payload, key } = meta;
    const { accountability, schema } = context;

    // Only run for tenant collection
    if (collection !== "tenant") return;

    console.log("Heina Tenant created! Starting additional setup...");

    const tenantId = key;
    const employeeId = payload.employeeId;
    const errorService = new ItemsService("registration_errors", {
      schema,
      accountability,
    });
    const pendingCollections = [];
    const createdResources = {
      tenant: tenantId,
      folders: [],
      attendanceCycle: null,
      shift: null,
      personalModule: null,
      salaryBreakdown: null,
      configs: [],
      leaves: null,
    };

    const cleanupResources = async (errorMessage) => {
      console.log(
        "Cleaning up resources (except tenant and personalModule)..."
      );
      try {
        // Delete configs
        for (const configId of createdResources.configs) {
          try {
            await new ItemsService("config", {
              schema,
              accountability,
            }).deleteOne(configId);
          } catch (err) {
            console.error(`Error deleting config ${configId}:`, err);
          }
        }
        // Delete salary breakdown
        if (createdResources.salaryBreakdown) {
          try {
            await new ItemsService("SalaryBreakdown", {
              schema,
              accountability,
            }).deleteOne(createdResources.salaryBreakdown);
          } catch (err) {
            console.error(
              `Error deleting salary breakdown ${createdResources.salaryBreakdown}:`,
              err
            );
          }
        }
        // Delete shift
        if (createdResources.shift) {
          try {
            await new ItemsService("shifts", {
              schema,
              accountability,
            }).deleteOne(createdResources.shift);
          } catch (err) {
            console.error(
              `Error deleting shift ${createdResources.shift}:`,
              err
            );
          }
        }
        // Delete attendance cycle
        if (createdResources.attendanceCycle) {
          try {
            await new ItemsService("attendanceCycle", {
              schema,
              accountability,
            }).deleteOne(createdResources.attendanceCycle);
          } catch (err) {
            console.error(
              `Error deleting attendance cycle ${createdResources.attendanceCycle}:`,
              err
            );
          }
        }
        // Delete leaves
        if (createdResources.leaves) {
          try {
            await new ItemsService("leaves", {
              schema,
              accountability,
            }).deleteOne(createdResources.leaves);
          } catch (err) {
            console.error(
              `Error deleting leaves ${createdResources.leaves}:`,
              err
            );
          }
        }
        // Delete folders in reverse order to handle parent-child dependencies
        const foldersByParent = {};
        for (const folder of createdResources.folders) {
          foldersByParent[folder.parent] = (
            foldersByParent[folder.parent] || []
          ).concat(folder);
        }
        const deleteQueue = [];
        const visited = new Set();
        const collectFoldersToDelete = (folderId) => {
          if (visited.has(folderId)) return;
          visited.add(folderId);
          const children = foldersByParent[folderId] || [];
          for (const child of children) collectFoldersToDelete(child.id);
          deleteQueue.push(folderId);
        };
        const mainFolder = createdResources.folders.find((f) => !f.parent);
        if (mainFolder) collectFoldersToDelete(mainFolder.id);
        for (let i = deleteQueue.length - 1; i >= 0; i--) {
          try {
            await database("directus_folders")
              .where("id", deleteQueue[i])
              .del();
          } catch (err) {
            console.error(`Error deleting folder ${deleteQueue[i]}:`, err);
          }
        }
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "cleanup",
          error_response: {
            message: errorMessage,
            stack: errorMessage.stack || new Error().stack,
          },
          pending_collections: pendingCollections,
        });
      } catch (cleanupErr) {
        console.error("Error during cleanup:", cleanupErr);
      }
    };

    try {
      // === Folder Structure ===
      const folders = [];
      try {
        const mainFolderId = uuidv4();
        await database("directus_folders").insert({
          id: mainFolderId,
          name: tenantId,
        });
        folders.push({ id: mainFolderId, name: tenantId, parent: null });
        createdResources.folders.push({
          id: mainFolderId,
          name: tenantId,
          parent: null,
        });

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

        const folderIds = {};
        for (const folderName of childFolders) {
          const folderId = uuidv4();
          await database("directus_folders").insert({
            id: folderId,
            name: folderName,
            parent: mainFolderId,
          });
          folderIds[folderName] = folderId;
          folders.push({
            id: folderId,
            name: folderName,
            parent: mainFolderId,
          });
          createdResources.folders.push({
            id: folderId,
            name: folderName,
            parent: mainFolderId,
          });
        }

        const importedFilesSubFolders = ["EmployeeDatas", "AttendanceRecords"];
        for (const subFolder of importedFilesSubFolders) {
          const folderId = uuidv4();
          await database("directus_folders").insert({
            id: folderId,
            name: subFolder,
            parent: folderIds["Imported Files"],
          });
          folders.push({
            id: folderId,
            name: subFolder,
            parent: folderIds["Imported Files"],
          });
          createdResources.folders.push({
            id: folderId,
            name: subFolder,
            parent: folderIds["Imported Files"],
          });
        }

        const documentsSubFolders = ["OnboardDocuments", "OffBoardDocuments"];
        for (const subFolder of documentsSubFolders) {
          const folderId = uuidv4();
          await database("directus_folders").insert({
            id: folderId,
            name: subFolder,
            parent: folderIds["Documents"],
          });
          folders.push({
            id: folderId,
            name: subFolder,
            parent: folderIds["Documents"],
          });
          createdResources.folders.push({
            id: folderId,
            name: subFolder,
            parent: folderIds["Documents"],
          });
        }

        // Update tenant with folder structure
        await database("tenant")
          .update({ foldersId: JSON.stringify(folders) })
          .where("tenantId", tenantId);
      } catch (error) {
        console.error("Error creating folders:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "directus_folders",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "attendanceCycle",
            "shifts",
            "leaves",
            "personalModule",
            "SalaryBreakdown",
            "config",
          ],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("directus_folders");

      // Create attendance cycle
      let attendanceCycleId = null;
      try {
        const cycleService = new ItemsService("attendanceCycle", {
          schema,
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
        attendanceCycleId = await cycleService.createOne(cyclePayload);
        createdResources.attendanceCycle = attendanceCycleId;
      } catch (error) {
        console.error("Error creating attendance cycle:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "attendanceCycle",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "shifts",
            "leaves",
            "personalModule",
            "SalaryBreakdown",
            "config",
          ],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("attendanceCycle");

      // Create shift
      let shiftId = null;
      try {
        const shiftService = new ItemsService("shifts", {
          schema,
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
        shiftId = await shiftService.createOne(shiftPayload);
        createdResources.shift = shiftId;
      } catch (error) {
        console.error("Error creating shift:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "shifts",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "leaves",
            "personalModule",
            "SalaryBreakdown",
            "config",
          ],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("shifts");

      // Create leaves
      let leavesId = null;
      try {
        const leavesService = new ItemsService("leaves", {
          schema,
          accountability,
        });
        const leavesPayload = {
          leaveBalance: {},
          CarryForwardleave: {},
          leaveTaken: {},
          monthLimit: {},
          assignedLeave: [],
          year: new Date().toISOString(),
          uniqueId: `${tenantId}-${employeeId}`,
          tenant: tenantId,
        };
        leavesId = await leavesService.createOne(leavesPayload);
        createdResources.leaves = leavesId;
      } catch (error) {
        console.error("Error creating leaves:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "leaves",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["personalModule", "SalaryBreakdown", "config"],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("leaves");

      // Create personal module with leaves reference
      try {
        const personalService = new ItemsService("personalModule", {
          schema,
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
            userApp: "fieldeasy",
          },
          leaves: leavesId,
        };
        const personalId = await personalService.createOne(personalPayload);
        createdResources.personalModule = personalId;
      } catch (error) {
        console.error("Error creating personal module:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "personalModule",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["SalaryBreakdown", "config"],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("personalModule");

      // Create salary breakdown
      try {
        const salaryService = new ItemsService("SalaryBreakdown", {
          schema,
          accountability,
        });
        const salaryId = await salaryService.createOne({
          employee: employeeId,
          tenant: tenantId,
        });
        createdResources.salaryBreakdown = salaryId;
      } catch (error) {
        console.error("Error creating salary breakdown:", error);
        await errorService.createOne({
          tenantId,
          employeeId,
          failed_collection: "SalaryBreakdown",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["config"],
        });
        await cleanupResources(error);
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
            schema,
            accountability,
          });
          const configId = await configService.createOne({
            configName: template.name,
            tenant: tenantId,
            attendancePolicies: { locationCentric: false },
            salarySettings: { status: "draft" },
          });
          createdResources.configs.push(configId);
        } catch (error) {
          console.error(`Error creating config ${template.name}:`, error);
          await errorService.createOne({
            tenantId,
            employeeId,
            failed_collection: "config",
            error_response: { message: error.message, stack: error.stack },
            pending_collections: [],
          });
          await cleanupResources(error);
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
      await cleanupResources(error);
    }
  });
};
