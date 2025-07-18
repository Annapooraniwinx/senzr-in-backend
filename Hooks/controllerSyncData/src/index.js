export default ({ action, filter }, { services }) => {
  const { ItemsService } = services;
  const processedItems = new Set();

  async function updateControllers(
    doorNumbers,
    tenantId,
    schema,
    accountability
  ) {
    if (!doorNumbers || doorNumbers.length === 0) {
      console.log("ℹ️ No door numbers found to update controllers.");
      return;
    }

    try {
      const controllerService = new ItemsService("controllers", {
        schema,
        accountability,
      });

      console.log("🔄 Updating controllers for tenant:", tenantId);

      for (let i = 0; i < doorNumbers.length; i += 50) {
        const batch = doorNumbers.slice(i, i + 50);
        console.log("📦 Processing controller batch:", batch);

        const controllers = await controllerService.readByQuery({
          filter: {
            _and: [
              { assignedDoor: { doors_id: { doorNumber: { _in: batch } } } },
              { tenant: { _eq: tenantId } },
            ],
          },
          fields: ["id"],
          limit: -1,
        });

        const controllerIds = controllers.map((c) => c.id);
        console.log("📊 Controller IDs to update:", controllerIds);

        for (let j = 0; j < controllerIds.length; j += 25) {
          const idBatch = controllerIds.slice(j, j + 25);
          console.log("✏️ Updating controller batch:", idBatch);

          await controllerService.updateMany(
            idBatch,
            { controllerStatus: "waiting" },
            { emitEvents: false }
          );
        }
      }

      console.log("✅ Controllers updated to 'waiting' state.");
    } catch (error) {
      console.error("❌ Controller update error:", error.message);
    }
  }

  action(
    "cardManagement.items.create",
    async (input, { schema, accountability }) => {
      console.log("📥 CREATE action triggered on cardManagement.");
      console.log("🧾 Raw input:", JSON.stringify(input, null, 2));

      let items = [];

      // Handle both single and multiple create events
      if (input.items) {
        items = Array.isArray(input.items) ? input.items : [input.items];
      } else if (input.payload) {
        items = [input.payload];
      }

      if (!items.length) {
        console.warn("⚠️ No valid cards to process during create.");
        return;
      }

      await processCardEvent(items, "create", { schema, accountability });
    }
  );

  action(
    "cardManagement.items.update",
    async (input, { schema, accountability }) => {
      console.log("📥 UPDATE action triggered on cardManagement.");

      const keys = input.keys || (input.key ? [input.key] : []);
      const cardService = new ItemsService("cardManagement", {
        schema,
        accountability,
      });
      const cards = await cardService.readMany(keys, {
        fields: ["id", "tenant.tenantId", "accessLevelsId"],
      });

      await processCardEvent(cards, "update", { schema, accountability });
    }
  );

  filter(
    "cardManagement.items.delete",
    async (payload, { schema, accountability }) => {
      const keys = payload.keys || [];

      console.log("🗑 DELETE filter triggered on cardManagement:", keys);

      const cardService = new ItemsService("cardManagement", {
        schema,
        accountability,
      });

      try {
        const cards = await cardService.readMany(keys, {
          fields: ["id", "tenant.tenantId", "accessLevelsId"],
        });

        await processCardEvent(cards, "delete", { schema, accountability });
      } catch (error) {
        console.error("❌ Error during delete pre-fetch:", error.message);
      }

      return payload;
    }
  );

  async function processCardEvent(
    cards,
    eventType,
    { schema, accountability }
  ) {
    if (!cards || typeof cards !== "object") {
      console.warn(
        `⚠️ Invalid cards data received during ${eventType}:`,
        cards
      );
      return;
    }

    const cardsArray = Array.isArray(cards) ? cards : [cards];
    const validCards = cardsArray.filter(
      (card) => card && typeof card === "object"
    );

    if (validCards.length === 0) {
      console.warn(`⚠️ No valid cards to process during ${eventType}.`);
      return;
    }

    const cardIds = validCards.map((c) => c.id).join(",");
    if (processedItems.has(cardIds)) {
      console.log(`🔁 Skipping duplicate processing for cards: ${cardIds}`);
      return;
    }
    processedItems.add(cardIds);

    try {
      for (const card of validCards) {
        const tenantId =
          typeof card.tenant === "object" ? card.tenant?.tenantId : card.tenant;
        const accessLevelsId = card.accessLevelsId;

        console.log(`📄 Processing card: ${card.id} for ${eventType}`);

        if (!tenantId || !accessLevelsId) {
          console.warn(
            `⚠️ Missing tenantId (${tenantId}) or accessLevelsId (${accessLevelsId}) for card:`,
            card.id
          );
          continue;
        }

        const accessLevelService = new ItemsService("accesslevels", {
          schema,
          accountability,
        });

        const accessLevels = await accessLevelService.readByQuery({
          filter: {
            _and: [
              { accessLevelNumber: { _eq: accessLevelsId } },
              { tenant: { _eq: tenantId } },
              { status: { _neq: "archived" } },
            ],
          },
          fields: ["id", "groupType", "assignDoorsGroup"],
          limit: 1,
        });

        if (!accessLevels || accessLevels.length === 0) {
          console.warn(
            "⚠️ Access level not found or archived for:",
            accessLevelsId
          );
          continue;
        }

        const accessLevel = accessLevels[0];

        if (accessLevel.groupType !== "doors") {
          console.log(
            "ℹ️ Skipping non-door access level group:",
            accessLevel.groupType
          );
          continue;
        }

        const doorGroups = accessLevel.assignDoorsGroup || [];
        if (doorGroups.length === 0) {
          console.log("ℹ️ No door groups assigned.");
          continue;
        }

        const doorsService = new ItemsService("doors", {
          schema,
          accountability,
        });

        const doors = await doorsService.readByQuery({
          filter: {
            _and: [
              { doorGroup: { _in: doorGroups } },
              { tenant: { _eq: tenantId } },
              { status: { _neq: "archived" } },
            ],
          },
          fields: ["doorNumber"],
          limit: -1,
        });

        const doorNumbers = doors.map((d) => d.doorNumber).filter(Boolean);

        console.log("📊 Door numbers fetched:", doorNumbers);

        if (doorNumbers.length > 0) {
          await updateControllers(
            doorNumbers,
            tenantId,
            schema,
            accountability
          );
        } else {
          console.log("ℹ️ No valid door numbers found.");
        }
      }
    } catch (error) {
      console.error(
        `❌ ${eventType.toUpperCase()} processing error:`,
        error.message
      );
    } finally {
      setTimeout(() => processedItems.delete(cardIds), 5000);
    }
  }
};
