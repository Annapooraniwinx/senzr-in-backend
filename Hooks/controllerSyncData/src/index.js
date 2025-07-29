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
      console.log("⚠️ No door numbers found to update controllers.");
      return;
    }

    try {
      const controllerService = new ItemsService("controllers", {
        schema,
        accountability,
      });

      for (let i = 0; i < doorNumbers.length; i += 50) {
        const batch = doorNumbers.slice(i, i + 50);

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

        for (let j = 0; j < controllerIds.length; j += 25) {
          const idBatch = controllerIds.slice(j, j + 25);

          await controllerService.updateMany(
            idBatch,
            { controllerStatus: "waiting" },
            { emitEvents: false }
          );
        }
      }

      console.log("✅ Controller statuses updated to 'waiting'.");
    } catch (error) {
      console.error("❌ Error while updating controllers:", error.message);
    }
  }

  action(
    "cardManagement.items.create",
    async (input, { schema, accountability }) => {
      let items = [];

      if (input.items) {
        items = Array.isArray(input.items) ? input.items : [input.items];
      } else if (input.payload) {
        items = [input.payload];
      }

      if (!items.length) {
        console.warn("⚠️ No valid cards to process during CREATE.");
        return;
      }

      await processCardEvent(items, "create", { schema, accountability });
    }
  );

  action(
    "cardManagement.items.update",
    async (input, { schema, accountability }) => {
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
        console.error("❌ Error fetching cards for delete:", error.message);
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
      console.warn(`⚠️ Invalid cards received during ${eventType}:`, cards);
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

        if (!tenantId || !accessLevelsId) {
          console.warn("⚠️ Missing tenantId or accessLevelsId:", card);
          continue;
        }

        const accessLevelService = new ItemsService("accesslevels", {
          schema,
          accountability,
        });

        // Try multiple possible field mappings to find the access level
        let accessLevels = [];

        // First try: assume accessLevelsId maps to the 'id' field
        try {
          accessLevels = await accessLevelService.readByQuery({
            filter: {
              _and: [
                { id: { _eq: accessLevelsId } },
                { tenant: { _eq: tenantId } },
              ],
            },
            fields: [
              "id",
              "groupType",
              "assignDoorsGroup",
              "assignDevicesGroup",
              "accessLevelNumber",
            ],
            limit: 1,
          });
        } catch (error) {
          console.log("❌ Error querying by ID:", error.message);
        }

        // Second try: if not found by ID, try by accessLevelNumber
        if (!accessLevels || accessLevels.length === 0) {
          try {
            accessLevels = await accessLevelService.readByQuery({
              filter: {
                _and: [
                  { accessLevelNumber: { _eq: accessLevelsId } },
                  { tenant: { _eq: tenantId } },
                ],
              },
              fields: [
                "id",
                "groupType",
                "assignDoorsGroup",
                "assignDevicesGroup",
                "accessLevelNumber",
              ],
              limit: 1,
            });
          } catch (error) {
            console.log(
              "❌ Error querying by accessLevelNumber:",
              error.message
            );
          }
        }

        // Third try: convert to string and try again (in case of type mismatch)
        if (!accessLevels || accessLevels.length === 0) {
          try {
            accessLevels = await accessLevelService.readByQuery({
              filter: {
                _and: [
                  { accessLevelNumber: { _eq: String(accessLevelsId) } },
                  { tenant: { _eq: tenantId } },
                ],
              },
              fields: [
                "id",
                "groupType",
                "assignDoorsGroup",
                "assignDevicesGroup",
                "accessLevelNumber",
              ],
              limit: 1,
            });
          } catch (error) {
            console.log(
              "❌ Error querying by accessLevelNumber (string):",
              error.message
            );
          }
        }

        // Fourth try: try as number (in case it's stored as number)
        if (!accessLevels || accessLevels.length === 0) {
          try {
            accessLevels = await accessLevelService.readByQuery({
              filter: {
                _and: [
                  { accessLevelNumber: { _eq: Number(accessLevelsId) } },
                  { tenant: { _eq: tenantId } },
                ],
              },
              fields: [
                "id",
                "groupType",
                "assignDoorsGroup",
                "assignDevicesGroup",
                "accessLevelNumber",
              ],
              limit: 1,
            });
          } catch (error) {
            console.log(
              "❌ Error querying by accessLevelNumber (number):",
              error.message
            );
          }
        }

        if (!accessLevels || accessLevels.length === 0) {
          console.warn(
            "⚠️ No access level found for accessLevelsId:",
            accessLevelsId,
            "tenant:",
            tenantId
          );

          // Debug: Let's see what access levels exist for this tenant
          try {
            const allAccessLevels = await accessLevelService.readByQuery({
              filter: {
                tenant: { _eq: tenantId },
              },
              fields: ["id", "accessLevelNumber", "groupType"],
              limit: 10,
            });
          } catch (debugError) {
            console.log(
              "❌ Error fetching all access levels for debug:",
              debugError.message
            );
          }

          continue;
        }

        const accessLevel = accessLevels[0];

        if (accessLevel.groupType === "doors") {
          const doorGroups = accessLevel.assignDoorsGroup || [];
          if (doorGroups.length === 0) {
            console.log("🚫 No door groups assigned.");
            continue;
          }

          const doorsService = new ItemsService("doors", {
            schema,
            accountability,
          });

          const doors = await doorsService.readByQuery({
            filter: {
              _and: [
                { id: { _in: doorGroups } },
                { tenant: { _eq: tenantId } },
              ],
            },
            fields: ["doorNumber"],
            limit: -1,
          });

          const doorNumbers = doors.map((d) => d.doorNumber).filter(Boolean);

          if (doorNumbers.length > 0) {
            await updateControllers(
              doorNumbers,
              tenantId,
              schema,
              accountability
            );
          } else {
            console.log("❗ No valid door numbers found for update.");
          }
        } else if (accessLevel.groupType === "devices") {
          const deviceControllers = accessLevel.assignDevicesGroup || [];
          if (deviceControllers.length === 0) {
            console.log("🚫 No device controllers assigned.");
            continue;
          }

          const controllerService = new ItemsService("controllers", {
            schema,
            accountability,
          });

          const controllerData = await controllerService.readByQuery({
            filter: {
              _and: [
                { id: { _in: deviceControllers } },
                { tenant: { _eq: tenantId } },
              ],
            },
            fields: ["assignedDoor.doors_id.doorNumber"],
            limit: -1,
          });

          const doorNumbers = controllerData
            .flatMap((c) => {
              if (Array.isArray(c.assignedDoor)) {
                return c.assignedDoor
                  .map((door) => door.doors_id?.doorNumber)
                  .filter(Boolean);
              }
              return [];
            })
            .filter(Boolean);
          if (doorNumbers.length > 0) {
            await updateControllers(
              doorNumbers,
              tenantId,
              schema,
              accountability
            );
          } else {
            console.log(
              "❗ No valid door numbers found in device controllers."
            );
          }
        } else {
          console.log("🚫 Unsupported groupType:", accessLevel.groupType);
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
