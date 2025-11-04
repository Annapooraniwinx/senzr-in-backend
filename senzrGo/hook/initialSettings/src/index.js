import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
dotenv.config();

export default ({ action }, { services, database }) => {
  const { ItemsService } = services;

  action("items.create", async (meta, context) => {
    const { collection, key } = meta;
    const { accountability, schema } = context;

    // Only run for tenant collection
    if (collection !== "tenant") return;

    console.log("🏁 Heina Jeson Tenant created! Starting additional setup...");

    const tenantId = key;
    let employeeId = null;
    let personalId = null;
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
      tenantTemplates: [],
    };

    // === DYNAMIC AWS SDK LOADING (INSIDE ACTION) ===
    let s3 = null;

    // ✅ Load from .env (secure way)
    const BUCKET = process.env.BUCKET;
    const ACCESS_KEY = process.env.ACCESS_KEY;
    const SECRET_KEY = process.env.SECRET_KEY;
    const REGION = process.env.REGION;

    try {
      const AWS = await import("aws-sdk");
      s3 = new AWS.S3({
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
        region: REGION,
      });
      console.log("AWS SDK loaded successfully");
    } catch (err) {
      console.error(
        "❌ Failed to load AWS SDK (S3 will be skipped):",
        err.message
      );
    }

    const cleanupResources = async (errorMessage) => {
      console.log(
        "🗑️ Cleaning up resources (except tenant and personalModule)..."
      );
      try {
        // Delete tenant templates
        for (const templateId of createdResources.tenantTemplates) {
          try {
            await new ItemsService("tenant_template", {
              schema,
              accountability,
            }).deleteOne(templateId);
          } catch (err) {
            console.error(
              `❌ Error deleting tenant template ${templateId}:`,
              err
            );
          }
        }
        // Delete configs
        for (const configId of createdResources.configs) {
          try {
            await new ItemsService("config", {
              schema,
              accountability,
            }).deleteOne(configId);
          } catch (err) {
            console.error(`❌ Error deleting config ${configId}:`, err);
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
              `❌ Error deleting salary breakdown ${createdResources.salaryBreakdown}:`,
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
              `❌ Error deleting shift ${createdResources.shift}:`,
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
              `❌ Error deleting attendance cycle ${createdResources.attendanceCycle}:`,
              err
            );
          }
        }
        // Delete leaves
        if (createdResources.leaves) {
          try {
            await new ItemsService("leave", {
              schema,
              accountability,
            }).deleteOne(createdResources.leaves);
          } catch (err) {
            console.error(
              `❌ Error deleting leaves ${createdResources.leaves}:`,
              err
            );
          }
        }
        // Delete folders in reverse order
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
            console.error(`❌ Error deleting folder ${deleteQueue[i]}:`, err);
          }
        }
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "cleanup",
          error_response: {
            message: errorMessage.message || errorMessage,
            stack: errorMessage.stack || new Error().stack,
          },
          pending_collections: pendingCollections,
        });
      } catch (cleanupErr) {
        console.error("❌ Error during cleanup:", cleanupErr);
      }
    };

    // Wait for personal module
    const waitForPersonalModule = async () => {
      try {
        const personalService = new ItemsService("personalModule", {
          schema,
          accountability: { admin: true },
        });

        // Initial attempt
        let personalItems = await personalService.readByQuery({
          filter: { assignedUser: { tenant: { _eq: tenantId } } },
          fields: ["id", "employeeId"],
          limit: 1,
        });

        if (personalItems.length > 0) {
          return personalItems[0];
        }

        console.log(
          `⌛ Personal module not found yet. Waiting 1 minute before retrying...`
        );
        await new Promise((resolve) => setTimeout(resolve, 60000));

        // Then attempt 2 more times
        for (let attempt = 1; attempt <= 2; attempt++) {
          personalItems = await personalService.readByQuery({
            filter: { assignedUser: { tenant: { _eq: tenantId } } },
            fields: ["id", "employeeId"],
            limit: 1,
          });

          if (personalItems.length > 0) {
            return personalItems[0];
          }

          console.log(
            `⌛ Personal module still not found. Retry attempt ${attempt}/2`
          );
        }

        throw new Error(
          `Personal module not found after 1 minute wait and 2 additional attempts for tenantId: ${tenantId}`
        );
      } catch (error) {
        console.error("❌ Error during retry fetch:", error);
        throw error;
      }
    };

    try {
      // Fetch personalModule with modified retry
      try {
        const personalItem = await waitForPersonalModule();
        personalId = personalItem.id;
        employeeId = personalItem.employeeId;
        createdResources.personalModule = personalId;
        pendingCollections.push("personalModule");
        console.log(
          `🔍 Fetched personalModule: { id: ${personalId}, employeeId: ${employeeId} }`
        );
      } catch (error) {
        console.error("❌ Error fetching personal module:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "personalModule",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "directus_folders",
            "attendanceCycle",
            "shifts",
            "leave",
            "SalaryBreakdown",
            "config",
            "tenant_template",
          ],
        });
        await cleanupResources(error);
        return;
      }

      // === FOLDER STRUCTURE ===
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

        await database("tenant")
          .update({ foldersId: JSON.stringify(folders) })
          .where("tenantId", tenantId);
        console.log(
          `📁 Created folders: ${JSON.stringify(
            folders.map((f) => ({ id: f.id, name: f.name, parent: f.parent })),
            null,
            2
          )}`
        );
      } catch (error) {
        console.error("❌ Error creating folders:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "directus_folders",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "attendanceCycle",
            "shifts",
            "leave",
            "SalaryBreakdown",
            "config",
            "tenant_template",
          ],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("directus_folders");

      // === S3: Create tenant folder + 8 JSON files ===
      if (s3) {
        try {
          const tenantPrefix = `${tenantId}/`;

          await s3
            .putObject({
              Bucket: BUCKET,
              Key: tenantPrefix,
              Body: "",
              ContentType: "application/x-directory",
            })
            .promise();

          const files = [
            "employees.json",
            "faces.json",
            "fingerprints.json",
            "rfid.json",
            "doors.json",
            "devices.json",
            "access_levels.json",
            "four_door_controller.json",
          ];

          for (const file of files) {
            await s3
              .putObject({
                Bucket: BUCKET,
                Key: tenantPrefix + file,
                Body: "[]",
                ContentType: "application/json",
              })
              .promise();
          }

          console.log(
            `S3 tenant folder & 8 JSON files created for ${tenantId}`
          );
        } catch (s3Err) {
          console.error("S3 Error (non-fatal):", s3Err);
          await errorService.createOne({
            tenantId,
            employeeId: personalId || null,
            failed_collection: "s3_device_config",
            error_response: { message: s3Err.message, stack: s3Err.stack },
            pending_collections: pendingCollections.slice(),
          });
          // Continue — S3 is optional
        }
      } else {
        console.warn("AWS SDK not available — skipping S3 setup");
      }

      // === ATTENDANCE CYCLE ===
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
        console.log(
          `⏰ Created attendanceCycle: { id: ${attendanceCycleId}, tenant: ${tenantId}, cycles: ${JSON.stringify(
            cyclePayload.multi_attendance_cycle.cycles,
            null,
            2
          )} }`
        );
      } catch (error) {
        console.error("Error creating attendance cycle:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "attendanceCycle",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "shifts",
            "leave",
            "SalaryBreakdown",
            "config",
            "tenant_template",
          ],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("attendanceCycle");

      // === SHIFT ===
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
        console.log(
          `🕒 Created shift: { id: ${shiftId}, shift: ${shiftPayload.shift}, tenant: ${tenantId} }`
        );
      } catch (error) {
        console.error("❌ Error creating shift:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "shifts",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "leave",
            "SalaryBreakdown",
            "config",
            "tenant_template",
          ],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("shifts");

      // === LEAVES ===
      let leavesId = null;
      try {
        const leavesService = new ItemsService("leave", {
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
        console.log(
          `🍃 Created leave: { id: ${leavesId}, uniqueId: ${leavesPayload.uniqueId}, tenant: ${tenantId} }`
        );
      } catch (error) {
        console.error("❌ Error creating leaves:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "leave",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["SalaryBreakdown", "config", "tenant_template"],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("leave");

      // === PATCH PERSONAL MODULE ===
      try {
        const personalService = new ItemsService("personalModule", {
          schema,
          accountability,
        });
        const personalUpdatePayload = {
          status: "active",
          accessOn: true,
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
          leaves: leavesId,
        };
        await personalService.updateOne(personalId, personalUpdatePayload);
        console.log(
          `🧑‍💼 Patched personalModule: { id: ${personalId}, uniqueId: ${personalUpdatePayload.uniqueId}, leaves: ${leavesId} }`
        );
      } catch (error) {
        console.error("❌ Error patching personal module:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "personalModule",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["SalaryBreakdown", "config", "tenant_template"],
        });
        await cleanupResources(error);
        return;
      }

      // === SALARY BREAKDOWN ===
      try {
        const salaryService = new ItemsService("SalaryBreakdown", {
          schema,
          accountability,
        });
        const salaryPayload = {
          employee: personalId,
          tenant: tenantId,
        };
        const salaryId = await salaryService.createOne(salaryPayload);
        createdResources.salaryBreakdown = salaryId;
        console.log(
          `💰 Created SalaryBreakdown: { id: ${salaryId}, employee: ${personalId}, tenant: ${tenantId} }`
        );
      } catch (error) {
        console.error("❌ Error creating salary breakdown:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "SalaryBreakdown",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["config", "tenant_template"],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("SalaryBreakdown");

      // Create default templates (configs)
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
          const configPayload = {
            configName: template.name,
            tenant: tenantId,
            attendancePolicies: { locationCentric: false },
            salarySettings: { status: "draft" },
          };
          const configId = await configService.createOne(configPayload);
          createdResources.configs.push(configId);
          console.log(
            `⚙️ Created config: { id: ${configId}, configName: ${template.name}, tenant: ${tenantId} }`
          );
        } catch (error) {
          console.error(`❌ Error creating config ${template.name}:`, error);
          await errorService.createOne({
            tenantId,
            employeeId: personalId || null,
            failed_collection: "config",
            error_response: { message: error.message, stack: error.stack },
            pending_collections: ["tenant_template"],
          });
          await cleanupResources(error);
          return;
        }
      }
      pendingCollections.push("config");

      // === TENANT TEMPLATES ===
      try {
        const formTemplateService = new ItemsService("form_template", {
          schema,
          accountability: { admin: true },
        });
        const tenantTemplateService = new ItemsService("tenant_template", {
          schema,
          accountability: { admin: true },
        });

        const availableTemplates = await formTemplateService.readByQuery({
          filter: { enableForm: { _eq: true } },
          fields: ["id", "formName", "custom_FormTemplate", "enableForm"],
          limit: -1,
        });

        for (const template of availableTemplates || []) {
          const tenantTemplatePayload = {
            formName: template.formName,
            custom_FormTemplate: template.custom_FormTemplate,
            enableForm: template.enableForm || true,
            tenant: tenantId,
            assignedOrgnization: null,
          };
          const tenantTemplateId = await tenantTemplateService.createOne(
            tenantTemplatePayload
          );
          createdResources.tenantTemplates.push(tenantTemplateId);
          console.log(
            `📄 Created tenant_template: { id: ${tenantTemplateId}, formName: ${template.formName}, tenant: ${tenantId} }`
          );
        }
        console.log(
          `✅ Created ${createdResources.tenantTemplates.length} tenant templates`
        );
      } catch (error) {
        console.error(
          "❌ Error creating tenant templates from form templates:",
          error
        );
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "tenant_template",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [],
        });
        await cleanupResources(error);
        return;
      }
      pendingCollections.push("tenant_template");

      console.log(
        `🎉 All resources created successfully for tenant: ${tenantId}`
      );
    } catch (error) {
      console.error("❌ Unexpected error in hook:", error);
      await errorService.createOne({
        tenantId,
        employeeId: personalId || null,
        failed_collection: "unknown",
        error_response: { message: error.message, stack: error.stack },
        pending_collections: pendingCollections,
      });
      await cleanupResources(error);
    }
  });
};
