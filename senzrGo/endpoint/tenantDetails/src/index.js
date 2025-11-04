// export default (router) => {
// 	router.get('/', (req, res) => res.send('Hello, World!'));
// };
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
dotenv.config();

export default (router, { services, database }) => {
  const { ItemsService } = services;

  // === 1️⃣ Create Folders ===
  router.post("/setup/folders", async (req, res) => {
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    try {
      const folders = [];
      const mainFolderId = uuidv4();

      await database("directus_folders").insert({
        id: mainFolderId,
        name: tenantId,
      });
      folders.push({ id: mainFolderId, name: tenantId, parent: null });

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

      for (const name of childFolders) {
        const id = uuidv4();
        await database("directus_folders").insert({
          id,
          name,
          parent: mainFolderId,
        });
        folders.push({ id, name, parent: mainFolderId });
      }

      await database("tenant")
        .update({ foldersId: JSON.stringify(folders) })
        .where("tenantId", tenantId);

      res.json({ message: "Folders created successfully", folders });
    } catch (error) {
      console.error("❌ Folder setup error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === 9️⃣ Add Folder (same I/O as /folders) ===
  router.post("/setup/existingfolder", async (req, res) => {
    const { tenantId, name, parentId = null } = req.body;

    if (!tenantId || !name) {
      return res.status(400).json({ error: "tenantId and name are required" });
    }

    try {
      // === 1. Load current folders from tenant row ===
      const tenantRow = await database("tenant")
        .select("foldersId")
        .where("tenantId", tenantId)
        .first();

      if (!tenantRow) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      let folders = [];
      try {
        folders = tenantRow.foldersId ? JSON.parse(tenantRow.foldersId) : [];
      } catch (e) {
        return res.status(500).json({ error: "Invalid foldersId JSON" });
      }

      // === 2. Determine effective parent ===
      let effectiveParent = null;

      if (parentId === null) {
        // Default: child of main folder (parent === null)
        const mainFolder = folders.find((f) => f.parent === null);
        if (!mainFolder) {
          return res
            .status(400)
            .json({ error: "Main folder missing. Run /folders setup first." });
        }
        effectiveParent = mainFolder.id;
      } else {
        // Validate parentId exists in this tenant's folders
        const parentExists = folders.some((f) => f.id === parentId);
        if (!parentExists) {
          return res
            .status(400)
            .json({ error: "Invalid parentId: folder not found in tenant" });
        }
        effectiveParent = parentId;
      }

      // === 3. Insert into directus_folders ===
      const newFolderId = uuidv4();
      await database("directus_folders").insert({
        id: newFolderId,
        name,
        parent: effectiveParent,
      });

      // === 4. Add to in-memory array ===
      const newFolder = { id: newFolderId, name, parent: effectiveParent };
      folders.push(newFolder);

      // === 5. Save back to tenant table ===
      await database("tenant")
        .update({ foldersId: JSON.stringify(folders) })
        .where("tenantId", tenantId);

      // === 6. Return SAME format as /folders ===
      res.json({
        message: "Folder added successfully",
        folders, // ← full updated list, just like original
      });
    } catch (error) {
      console.error("Folder add error:", error);
      res.status(500).json({ error: error.message });
    }
  });
  // === 2️⃣ Create Attendance Cycle ===
  router.post("/setup/attendance-cycle", async (req, res) => {
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    try {
      const service = new ItemsService("attendanceCycle", {
        schema: req.schema,
      });
      const payload = {
        fixedCycle: true,
        tenant: tenantId,
        multi_attendance_cycle: {
          cycles: [
            {
              cycleId: 1,
              cycleName: "Normal Employee",
              startDate: 1,
              endDate: "end of the month",
            },
            {
              cycleId: 2,
              cycleName: "Daily wages Employee",
              startDate: 14,
              endDate: 15,
            },
          ],
        },
      };

      const id = await service.createOne(payload);
      res.json({ message: "Attendance cycle created", id });
    } catch (error) {
      console.error("❌ Attendance cycle error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === 3️⃣ Create Shift ===
  router.post("/setup/shift", async (req, res) => {
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    try {
      const service = new ItemsService("shifts", { schema: req.schema });
      const payload = {
        shift: "GeneralShift",
        entryTime: "09:00:00",
        exitTime: "18:00:00",
        break: "00:30:00",
        status: "assigned",
        tenant: tenantId,
      };
      const id = await service.createOne(payload);
      res.json({ message: "Shift created successfully", id });
    } catch (error) {
      console.error("❌ Shift creation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === 4️⃣ Create Leave ===
  router.post("/setup/leave", async (req, res) => {
    const { tenantId, employeeId } = req.body;
    if (!tenantId || !employeeId)
      return res.status(400).json({ error: "tenantId & employeeId required" });

    try {
      const service = new ItemsService("leave", { schema: req.schema });
      const payload = {
        leaveBalance: {},
        CarryForwardleave: {},
        leaveTaken: {},
        monthLimit: {},
        assignedLeave: [],
        year: new Date().toISOString(),
        uniqueId: `${tenantId}-${employeeId}`,
        tenant: tenantId,
      };
      const id = await service.createOne(payload);
      res.json({ message: "Leave created successfully", id });
    } catch (error) {
      console.error("❌ Leave creation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === 5️⃣ Create Salary Breakdown ===
  router.post("/setup/salary", async (req, res) => {
    const { tenantId, personalId } = req.body;
    if (!tenantId || !personalId)
      return res.status(400).json({ error: "tenantId & personalId required" });

    try {
      const service = new ItemsService("SalaryBreakdown", {
        schema: req.schema,
      });
      const payload = { employee: personalId, tenant: tenantId };
      const id = await service.createOne(payload);
      res.json({ message: "Salary breakdown created", id });
    } catch (error) {
      console.error("❌ Salary breakdown error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === 6️⃣ Create Configs ===
  router.post("/setup/config", async (req, res) => {
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    const templates = [
      { name: "Regular Staff", type: "regular" },
      { name: "Housekeeping Employee", type: "housekeeping" },
      { name: "Security Staff", type: "security" },
      { name: "Flex Shifts", type: "flex" },
    ];

    try {
      const service = new ItemsService("config", { schema: req.schema });
      const created = [];
      for (const template of templates) {
        const payload = {
          configName: template.name,
          tenant: tenantId,
          attendancePolicies: { locationCentric: false },
          salarySettings: { status: "draft" },
        };
        const id = await service.createOne(payload);
        created.push({ id, name: template.name });
      }
      res.json({ message: "Configs created successfully", created });
    } catch (error) {
      console.error("❌ Config creation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === 7️⃣ Create Tenant Templates ===
  router.post("/setup/templates", async (req, res) => {
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    try {
      const formTemplateService = new ItemsService("form_template", {
        schema: req.schema,
        accountability: { admin: true },
      });
      const tenantTemplateService = new ItemsService("tenant_template", {
        schema: req.schema,
        accountability: { admin: true },
      });

      const availableTemplates = await formTemplateService.readByQuery({
        filter: { enableForm: { _eq: true } },
        fields: ["id", "formName", "custom_FormTemplate"],
        limit: -1,
      });

      const created = [];
      for (const template of availableTemplates) {
        const payload = {
          formName: template.formName,
          custom_FormTemplate: template.custom_FormTemplate,
          enableForm: true,
          tenant: tenantId,
          assignedOrgnization: null,
        };
        const id = await tenantTemplateService.createOne(payload);
        created.push({ id, formName: template.formName });
      }

      res.json({
        message: `Created ${created.length} tenant templates`,
        created,
      });
    } catch (error) {
      console.error("❌ Tenant template creation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === 8️⃣ Create s3 Tenant Templates  Folders===
  router.post("/setup/s3", async (req, res) => {
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    // === Configure from ENV ===
    const BUCKET = process.env.BUCKET;
    const ACCESS_KEY = process.env.ACCESS_KEY;
    const SECRET_KEY = process.env.SECRET_KEY;
    const REGION = process.env.REGION;

    // Load AWS SDK dynamically to avoid cold-start issues in some environments
    let s3 = null;
    try {
      const AWS = await import("aws-sdk");
      s3 = new AWS.S3({
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
        region: REGION,
      });
      console.log("☁️ AWS SDK initialized for S3");
    } catch (err) {
      console.error("❌ Failed to load AWS SDK:", err.message || err);
      return res.status(500).json({ error: "Failed to initialize S3 client" });
    }

    try {
      const tenantPrefix = `${tenantId}/`;

      // (Optional) Create a zero-length "folder" object. Not required but keeps listing neat.
      await s3
        .putObject({
          Bucket: BUCKET,
          Key: tenantPrefix,
          Body: "",
          ContentType: "application/x-directory",
        })
        .promise();
      console.log(`☁️ Created S3 folder prefix: ${tenantPrefix}`);

      // Files to create inside tenant folder
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

      const created = [];
      // Create each file with default content (empty object or array — adjust as needed)
      await Promise.all(
        files.map((file) =>
          s3
            .putObject({
              Bucket: BUCKET,
              Key: `${tenantPrefix}${file}`,
              Body: JSON.stringify({}), // change to "[]" if you prefer arrays
              ContentType: "application/json",
            })
            .promise()
            .then(() => {
              console.log(`☁️ Created S3 file: ${tenantPrefix}${file}`);
              created.push(`${tenantPrefix}${file}`);
            })
        )
      );

      return res.status(200).json({
        message: "S3 tenant folder and files created",
        bucket: BUCKET,
        createdFiles: created,
      });
    } catch (err) {
      console.error("❌ Error creating S3 files:", err.message || err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  });
};
