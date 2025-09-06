export default ({ action, filter }, { services }) => {
  const { ItemsService } = services;
  const processedItems = new Set();

  // Helper function: Batch-wise update controllerStatus to 'waiting'
  async function markControllersWaiting(controllerIds, schema, accountability) {
    if (!controllerIds.length) return;
    const controllerService = new ItemsService("controllers", {
      schema,
      accountability,
    });
    for (let i = 0; i < controllerIds.length; i += 25) {
      const batch = controllerIds.slice(i, i + 25);
      await controllerService.updateMany(
        batch,
        { controllerStatus: "waiting" },
        { emitEvents: false }
      );
    }
  }

  async function processCardEvent(
    cards,
    eventType,
    { schema, accountability }
  ) {
    if (!Array.isArray(cards)) cards = [cards];
    const validCards = cards.filter((c) => c && typeof c === "object");
    if (!validCards.length) return;

    const cardIds = validCards.map((c) => c.id).join(",");
    if (processedItems.has(cardIds)) return;
    processedItems.add(cardIds);

    try {
      for (const card of validCards) {
        const tenantId = card.tenant?.tenantId || card.tenant;
        const accessLevelsId = card.accessLevelsId;
        if (!tenantId || !accessLevelsId) continue;

        const accessLevelService = new ItemsService("accesslevels", {
          schema,
          accountability,
        });

        let accessLevel;
        const searchOptions = [
          accessLevelsId,
          String(accessLevelsId),
          Number(accessLevelsId),
        ];
        for (const option of searchOptions) {
          const found = await accessLevelService.readByQuery({
            filter: {
              _and: [
                { tenant: { _eq: tenantId } },
                {
                  _or: [
                    { id: { _eq: option } },
                    { accessLevelNumber: { _eq: option } },
                  ],
                },
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
          if (found.length) {
            accessLevel = found[0];
            break;
          }
        }
        if (!accessLevel) continue;

        console.group(`🧾 Access Level: ${accessLevel.accessLevelNumber}`);

        const controllerService = new ItemsService("controllers", {
          schema,
          accountability,
        });

        // If groupType is 'devices': mark specified controller IDs as waiting
        if (accessLevel.groupType === "devices") {
          console.group("🔧 Device Group Processing");

          const controllerIds = accessLevel.assignDevicesGroup || [];
          if (controllerIds.length) {
            console.log("Found Controller IDs:", controllerIds);
            await markControllersWaiting(controllerIds, schema, accountability);
            console.log("✅ Device Controllers marked as 'waiting'");
          } else {
            console.log("🚫 No controllers assigned in assignDevicesGroup");
          }

          console.groupEnd();

          // If groupType is 'doors': find controllers with selectedDoors including assigned doors
        } else if (accessLevel.groupType === "doors") {
          console.group("🚪 Door Group Processing");

          const doorIds = accessLevel.assignDoorsGroup || [];
          if (!doorIds.length) {
            console.log("🚫 No doors assigned.");
            console.groupEnd();
            console.groupEnd();
            continue;
          }

          const controllers = await controllerService.readByQuery({
            filter: { tenant: { _eq: tenantId } },
            fields: ["id", "selectedDoors"],
            limit: -1,
          });

          const matchingControllerIds = controllers
            .filter((controller) => {
              if (!Array.isArray(controller.selectedDoors)) return false;
              return controller.selectedDoors.some((door) =>
                doorIds.includes(door)
              );
            })
            .map((c) => c.id);

          console.log("Matching controllers:", matchingControllerIds);
          await markControllersWaiting(
            matchingControllerIds,
            schema,
            accountability
          );
          console.log("✅ Door Controllers marked as 'waiting'");

          console.groupEnd();
        } else {
          console.log("🚫 Unsupported groupType:", accessLevel.groupType);
        }

        console.groupEnd();
      }
    } catch (err) {
      console.error(`❌ Error in ${eventType} event:`, err.message);
    } finally {
      setTimeout(() => processedItems.delete(cardIds), 5000);
    }
  }

  action(
    "cardManagement.items.create",
    async (input, { schema, accountability }) => {
      const items = Array.isArray(input.items) ? input.items : [input.items];
      if (!items.length) return;
      await processCardEvent(items, "create", { schema, accountability });
    }
  );

  action(
    "cardManagement.items.update",
    async (input, { schema, accountability }) => {
      const keys = input.keys || (input.key ? [input.key] : []);
      if (!keys.length) return;

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
      const cards = await cardService.readMany(keys, {
        fields: ["id", "tenant.tenantId", "accessLevelsId"],
      });
      await processCardEvent(cards, "delete", { schema, accountability });
      return payload;
    }
  );
};
