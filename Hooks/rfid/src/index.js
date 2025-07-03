export default ({ filter, action }, { services, getSchema }) => {
  filter("items.create", () => {
    console.log("Creating Item!");
  });

  action("items.create", () => {
    console.log("Item created!");
  });

  // Add new action for RFID card access
  action("rfidcard.accessed", async (data) => {
    console.log("🔑 RFID Card Accessed!");
    console.log("Tenant ID:", data.tenantId);
    console.log("Access Level IDs:", data.keys);
    console.log("Timestamp:", data.timestamp);
    console.log("Request URL:", data.url);
    console.log("IP Address:", data.ip);

    try {
      console.log("Processing RFID access...");

      const { ItemsService } = services;
      const schema = await getSchema();

      const cardManagementService = new ItemsService("cardManagement", {
        schema: schema,
        accountability: null,
      });

      const accessLevelsService = new ItemsService("accesslevels", {
        schema: schema,
        accountability: null,
      });

      console.log("Querying cardManagement collection...");

      const cardManagementData = await cardManagementService.readByQuery({
        fields: [
          "id",
          "tenant.tenantId",
          "accessLevelsId",
          "cardAccessLevelArray",
          "cardAccessLevelHex",
          "employeeId.employeeId",
        ],
        filter: {
          tenant: {
            tenantId: {
              _eq: data.tenantId,
            },
          },
        },
      });

      console.log("🔐 Querying accesslevels collection...");

      const accessLevelsData = await accessLevelsService.readByQuery({
        fields: [
          "tenant.tenantId",
          "doorBitmap",
          "accessLevelNumber",
          "accessLevelBitmap",
          "id",
        ],
        filter: {
          tenant: {
            tenantId: {
              _eq: data.tenantId,
            },
          },
        },
      });

      console.log(
        "🎯 Raw cardManagement data:",
        JSON.stringify(cardManagementData, null, 2)
      );
      console.log(
        "🎯 Raw accesslevels data:",
        JSON.stringify(accessLevelsData, null, 2)
      );

      // Extract RFID cards hex values
      const rfidcardsHex = cardManagementData
        .filter((card) => card.cardAccessLevelHex)
        .map((card) => card.cardAccessLevelHex);

      // Format access levels data
      const accesslevels = accessLevelsData.map((level) => ({
        accessLevelNumber: level.accessLevelNumber,
        AccessLevelBitmap: level.accessLevelBitmap,
        DoorBitmap: level.doorBitmap,
      }));

      // Final formatted data
      const formattedData = {
        rfidcardsHex: rfidcardsHex,
        accesslevels: accesslevels,
      };

      console.log("📊 FORMATTED RFID DATA:");
      console.log("========================");
      console.log(JSON.stringify(formattedData, null, 2));

      console.log("🎯 RFID Cards Count:", rfidcardsHex.length);
      console.log("🔐 Access Levels Count:", accesslevels.length);

      console.log("RFID access processed successfully");
    } catch (error) {
      console.error("❌ Error in RFID hook:", error.message);
      console.error("Error stack:", error.stack);
    }
  });
};
