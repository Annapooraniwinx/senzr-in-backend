export default ({ action }, { services }) => {
  action(
    "accesslevels.items.update",
    async (input, { schema, accountability }) => {
      console.log("🔔 Hook triggered: accesslevels.items.update");
      await handleRFIDJson(input, { services, schema, accountability });
    }
  );

  async function handleRFIDJson(input, { services, schema, accountability }) {
    const { ItemsService, FilesService } = services;

    const items = input.items || (input.payload ? [input.payload] : []);
    console.log("📦 Items to process:", items.length);

    const tenantIds = Array.from(
      new Set(
        items
          .map((i) =>
            typeof i.tenant === "object" ? i.tenant?.tenantId : i.tenant
          )
          .filter(Boolean)
      )
    );

    console.log("🏢 Unique tenant IDs found:", tenantIds);

    for (const tenantId of tenantIds) {
      console.log("🚀 [ACCESSLEVEL] Building RFID JSON for tenant:", tenantId);

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
      console.log(`🎴 Cards found for tenant ${tenantId}:`, cards.length);

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
        `📊 Access levels found for tenant ${tenantId}:`,
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
          console.log("🔐 RFID Hex Added:", hex);
        }
      }

      const accesslevels = levels.map((l) => ({
        accessLevelNumber: l.accessLevelNumber,
        AccessLevelBitmap: l.accessLevelBitmap,
        DoorBitmap: l.doorBitmap,
      }));

      const formattedData = { rfidcardsHex, accesslevels };

      const tenantData = await tenantService.readOne(tenantId, {
        fields: ["tenantName", "tenantId", "rfidacrd_JsonFileID", "foldersId"],
      });

      console.log("📁 foldersId info fetched:", tenantData.foldersId);

      const folders = tenantData.foldersId || [];
      const fingersFolder = folders.find((f) => f.name === "Fingers");
      const rootFolder = folders.find((f) => f.id === fingersFolder?.parent);

      if (!fingersFolder || !rootFolder) {
        console.error(
          "❌ Fingers folder or parent folder not found.",
          fingersFolder,
          rootFolder
        );
        throw new Error("Fingers folder or parent folder not found.");
      }
    }

    console.log("🏁 RFID JSON generation complete for all tenants.");
  }
};
