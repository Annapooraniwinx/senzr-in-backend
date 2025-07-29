export default ({ filter, action }) => {
  action(
    "cardManagement.items.create",
    async (input, { services, schema, accountability }) => {
      console.log("🆕 [CARD] Create event triggered");
      await handleRFIDJson(input, { services, schema, accountability });
    }
  );

  action(
    "cardManagement.items.update",
    async (input, { services, schema, accountability }) => {
      console.log("♻️ [CARD] Update event triggered");
      await handleRFIDJson(input, { services, schema, accountability });
    }
  );

  async function handleRFIDJson(input, { services, schema, accountability }) {
    const { ItemsService, FilesService } = services;
    const items = input.items || (input.payload ? [input.payload] : []);
    console.log("📦 Processing items:", items.length);

    const tenantIds = Array.from(
      new Set(
        items
          .map((i) =>
            typeof i.tenant === "object" ? i.tenant?.tenantId : i.tenant
          )
          .filter(Boolean)
      )
    );

    console.log("🏢 Unique tenant IDs:", tenantIds);

    for (const tenantId of tenantIds) {
      console.log("🚀 [CARD] Building RFID JSON for tenant:", tenantId);

      const cardService = new ItemsService("cardManagement", {
        schema,
        accountability,
      });
      const accessLevelService = new ItemsService("accesslevels", {
        schema,
        accountability,
      });
      const tenantService = new ItemsService("tenant", {
        schema,
        accountability,
      });
      const filesService = new FilesService({ schema, accountability });

      const cards = await cardService.readByQuery({
        filter: { tenant: tenantId },
        fields: [
          "id",
          "tenant.tenantId",
          "accessLevelsId",
          "cardAccessLevelArray",
          "cardAccessLevelHex",
          "employeeId.employeeId",
        ],
        limit: -1,
      });
      console.log(`🎴 Cards fetched for tenant ${tenantId}:`, cards.length);

      const levels = await accessLevelService.readByQuery({
        filter: { tenant: tenantId },
        fields: [
          "tenant.tenantId",
          "doorBitmap",
          "accessLevelBitmap",
          "accessLevelNumber",
          "id",
        ],
        limit: -1,
      });
      console.log(
        `📊 Access levels fetched for tenant ${tenantId}:`,
        levels.length
      );

      const rfidcardsHex = [];

      for (const card of cards) {
        const employeeId = card.employeeId?.employeeId;
        const level = levels.find((lvl) => lvl.id === card.accessLevelsId);
        const accessLevelBitmap = level?.accessLevelBitmap;

        if (employeeId && accessLevelBitmap) {
          const hex = `${employeeId}-${accessLevelBitmap}`;
          rfidcardsHex.push(hex);
          console.log("🔐 RFID entry created:", hex);
        }
      }

      const accesslevels = levels.map((l) => ({
        accessLevelNumber: l.accessLevelNumber,
        AccessLevelBitmap: l.accessLevelBitmap,
        DoorBitmap: l.doorBitmap,
      }));

      const formattedData = { rfidcardsHex, accesslevels };
      console.log("📄 Final JSON data prepared");

      const tenantData = await tenantService.readOne(tenantId, {
        fields: ["tenantName", "tenantId", "rfidacrd_JsonFileID", "foldersId"],
      });
      console.log("📁 Tenant folder info loaded:", tenantData.tenantName);

      const folders = tenantData.foldersId || [];
      const fingersFolder = folders.find((f) => f.name === "Fingers");
      const rootFolder = folders.find((f) => f.id === fingersFolder?.parent);

      if (!fingersFolder || !rootFolder) {
        console.error("❌ Fingers folder or root folder not found.");
        throw new Error("Fingers folder or parent folder not found.");
      }

      const today = new Date();
      const formattedDate = today.toISOString().split("T")[0];
      const filename = `${tenantId}-${formattedDate}.json`;
      const buffer = Buffer.from(
        JSON.stringify(formattedData, null, 2),
        "utf8"
      );

      if (tenantData.rfidacrd_JsonFileID) {
        try {
          console.log("🧹 Deleting previous JSON file...");
          await filesService.deleteOne(tenantData.rfidacrd_JsonFileID);
          console.log("🗑️ Old file deleted.");
        } catch (err) {
          console.warn("⚠️ Could not delete old file:", err.message);
        }
      }

      console.log("📤 Uploading new JSON file:", filename);
      const uploadedFile = await filesService.uploadOne(buffer, filename, {
        title: filename,
        folder: fingersFolder.id,
        filename_download: filename,
        type: "application/json",
      });

      await tenantService.updateOne(tenantId, {
        rfidacrd_JsonFileID: uploadedFile.id,
      });

      console.log("✅ New RFID JSON file uploaded and linked:", filename);
    }

    console.log("🏁 RFID JSON build completed for all tenants.");
  }
};
