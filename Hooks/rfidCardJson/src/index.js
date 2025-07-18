// export default ({ action }, { services }) => {
//   const { ItemsService, FilesService } = services;

//   async function buildAndSaveRFIDJson(tenantId, schema, accountability) {
//     try {
//       console.log("🚀 [START] Building RFID JSON for tenant:", tenantId);

//       const cardService = new ItemsService("cardManagement", {
//         schema,
//         accountability,
//       });
//       const accessLevelService = new ItemsService("accesslevels", {
//         schema,
//         accountability,
//       });
//       const tenantService = new ItemsService("tenant", {
//         schema,
//         accountability,
//       });
//       const filesService = new FilesService({ schema, accountability });

//       console.log("📥 Fetching RFID cards...");
//       const cards = await cardService.readByQuery({
//         filter: { tenant: tenantId },
//         fields: [
//           "id",
//           "tenant.tenantId",
//           "accessLevelsId",
//           "cardAccessLevelArray",
//           "cardAccessLevelHex",
//           "employeeId.employeeId",
//         ],
//         limit: -1,
//       });

//       console.log("📥 Fetching Access Levels...");
//       const levels = await accessLevelService.readByQuery({
//         filter: { tenant: tenantId },
//         fields: [
//           "tenant.tenantId",
//           "doorBitmap",
//           "accessLevelBitmap",
//           "accessLevelNumber",
//           "id",
//         ],
//         limit: -1,
//       });

//       console.log(
//         `🧾 Found ${cards.length} cards, ${levels.length} access levels.`
//       );

//       const rfidcardsHex = cards
//         .map((c) => c.cardAccessLevelHex)
//         .filter(Boolean);
//       const accesslevels = levels.map((l) => ({
//         accessLevelNumber: l.accessLevelNumber,
//         AccessLevelBitmap: l.accessLevelBitmap,
//         DoorBitmap: l.doorBitmap,
//       }));

//       const formattedData = { rfidcardsHex, accesslevels };

//       console.log("📂 Looking for Fingers folder...");
//       const tenantData = await tenantService.readOne(tenantId, {
//         fields: ["tenantName", "tenantId", "rfidacrd_JsonFileID", "foldersId"],
//       });

//       const folders = tenantData.foldersId || [];

//       const fingersFolder = folders.find((f) => f.name === "Fingers");
//       const rootFolder = folders.find((f) => f.id === fingersFolder?.parent);

//       if (!fingersFolder || !rootFolder) {
//         console.error("❌ Missing Fingers folder or its parent.");
//         throw new Error("Fingers folder or parent folder not found.");
//       }

//       const today = new Date();
//       const formattedDate = today.toISOString().split("T")[0];
//       const filename = `${tenantId}-${formattedDate}.json`;

//       console.log("📝 Preparing JSON file:", filename);
//       const buffer = Buffer.from(
//         JSON.stringify(formattedData, null, 2),
//         "utf8"
//       );

//       if (tenantData.rfidacrd_JsonFileID) {
//         try {
//           console.log(
//             "🗑️ Deleting old JSON file:",
//             tenantData.rfidacrd_JsonFileID
//           );
//           await filesService.deleteOne(tenantData.rfidacrd_JsonFileID);
//           console.log("✅ Old file deleted.");
//         } catch (err) {
//           console.warn("⚠️ Could not delete old file:", err.message);
//         }
//       }

//       console.log("📤 Uploading new JSON file...");
//       const uploadedFile = await filesService.uploadOne(buffer, filename, {
//         title: filename,
//         folder: fingersFolder.id,
//         filename_download: filename,
//         type: "application/json",
//       });

//       const fileId = uploadedFile.id;
//       console.log("✅ File uploaded with ID:", fileId);

//       console.log("🔗 Updating tenant with new file ID...");
//       await tenantService.updateOne(tenantId, {
//         rfidacrd_JsonFileID: fileId,
//       });

//       console.log("🏁 [DONE] JSON export and file update complete.");
//     } catch (error) {
//       console.error("❌ Error during RFID file save process:", error.message);
//       throw new Error(error.message);
//     }
//   }

//   async function triggerHook(input, { schema, accountability }) {
//     console.log("📡 Hook triggered: Detecting tenant IDs...");
//     const items = input.items || (input.payload ? [input.payload] : []);
//     const tenantIds = Array.from(
//       new Set(
//         items
//           .map((i) =>
//             typeof i.tenant === "object" ? i.tenant?.tenantId : i.tenant
//           )
//           .filter(Boolean)
//       )
//     );

//     console.log("👥 Tenants to process:", tenantIds);

//     for (const tenantId of tenantIds) {
//       await buildAndSaveRFIDJson(tenantId, schema, accountability);
//     }

//     console.log("✅ All tenant JSON files processed.");
//   }

//   // 🎯 Hook Triggers
//   action("cardManagement.items.create", triggerHook);
//   action("cardManagement.items.update", triggerHook);
//   action("accesslevels.items.create", triggerHook);
//   action("accesslevels.items.update", triggerHook);
// };

// 📁 File: cardManagement-rfid-hook.js

export default ({ action }, { services }) => {
  const { ItemsService, FilesService } = services;

  async function buildAndSaveRFIDJson(tenantId, schema, accountability) {
    try {
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

      console.log("📥 [CARD] Fetching RFID cards...");
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

      console.log("📥 [CARD] Fetching Access Levels...");
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
        `🧾 [CARD] Found ${cards.length} cards, ${levels.length} access levels.`
      );

      const rfidcardsHex = cards
        .map((c) => c.cardAccessLevelHex)
        .filter(Boolean);
      const accesslevels = levels.map((l) => ({
        accessLevelNumber: l.accessLevelNumber,
        AccessLevelBitmap: l.accessLevelBitmap,
        DoorBitmap: l.doorBitmap,
      }));

      const formattedData = { rfidcardsHex, accesslevels };

      console.log("📂 [CARD] Looking for Fingers folder...");
      const tenantData = await tenantService.readOne(tenantId, {
        fields: ["tenantName", "tenantId", "rfidacrd_JsonFileID", "foldersId"],
      });

      const folders = tenantData.foldersId || [];
      const fingersFolder = folders.find((f) => f.name === "Fingers");
      const rootFolder = folders.find((f) => f.id === fingersFolder?.parent);

      if (!fingersFolder || !rootFolder) {
        console.error("❌ [CARD] Missing Fingers folder or its parent.");
        throw new Error("Fingers folder or parent folder not found.");
      }

      const today = new Date();
      const formattedDate = today.toISOString().split("T")[0];
      const filename = `${tenantId}-${formattedDate}.json`;

      console.log("📝 [CARD] Preparing JSON file:", filename);
      const buffer = Buffer.from(
        JSON.stringify(formattedData, null, 2),
        "utf8"
      );

      if (tenantData.rfidacrd_JsonFileID) {
        try {
          console.log(
            "🗑️ [CARD] Deleting old JSON file:",
            tenantData.rfidacrd_JsonFileID
          );
          await filesService.deleteOne(tenantData.rfidacrd_JsonFileID);
          console.log("✅ [CARD] Old file deleted.");
        } catch (err) {
          console.warn("⚠️ [CARD] Could not delete old file:", err.message);
        }
      }

      console.log("📤 [CARD] Uploading new JSON file...");
      const uploadedFile = await filesService.uploadOne(buffer, filename, {
        title: filename,
        folder: fingersFolder.id,
        filename_download: filename,
        type: "application/json",
      });

      const fileId = uploadedFile.id;
      console.log("✅ [CARD] File uploaded with ID:", fileId);

      console.log("🔗 [CARD] Updating tenant with new file ID...");
      await tenantService.updateOne(tenantId, {
        rfidacrd_JsonFileID: fileId,
      });

      console.log("🏁 [CARD] JSON export and file update complete.");
    } catch (error) {
      console.error(
        "❌ [CARD] Error during RFID file save process:",
        error.message
      );
      throw new Error(error.message);
    }
  }

  async function triggerCardHook(input, { schema, accountability }) {
    console.log("📡 [CARD] Hook triggered");
    const items = input.items || (input.payload ? [input.payload] : []);
    const tenantIds = Array.from(
      new Set(
        items
          .map((i) =>
            typeof i.tenant === "object" ? i.tenant?.tenantId : i.tenant
          )
          .filter(Boolean)
      )
    );
    console.log("👥 [CARD] Tenants to process:", tenantIds);

    for (const tenantId of tenantIds) {
      await buildAndSaveRFIDJson(tenantId, schema, accountability);
    }

    console.log("✅ [CARD] All tenant JSON files processed.");
  }

  // 🎯 Hook Triggers
  action("cardManagement.items.create", triggerCardHook);
  action("cardManagement.items.update", triggerCardHook);
};
