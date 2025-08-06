export default ({ action }, { services }) => {
  const { ItemsService } = services;
  const processedItems = new Set();

  function generateAccessLevelBitmap(accessLevelData) {
    try {
      const maxWorkHours = Math.min(accessLevelData.maxWorkHours || 0, 15);
      const accessTypeBit = accessLevelData.accessType ? 1 : 0;
      const holidaysBit = accessLevelData.holidays ? 1 : 0;
      const workingHoursBit = accessLevelData.workingHours ? 1 : 0;
      const _24hrsBit = accessLevelData._24hrs ? 1 : 0;
      const maxWorkHoursBinary = maxWorkHours.toString(2).padStart(4, "0");
      const bitmap = `${maxWorkHoursBinary}.${_24hrsBit}${workingHoursBit}${holidaysBit}${accessTypeBit}`;
      return bitmap;
    } catch (error) {
      console.error("❌ Error generating access level bitmap:", error.message);
      return null;
    }
  }

  function generateDoorBitmap(doorNumbers, accessType) {
    try {
      const maxDoorNumber =
        doorNumbers.length > 0
          ? Math.max(...doorNumbers.filter((num) => !isNaN(parseInt(num))))
          : 0;
      const totalDoors = Math.max(96, maxDoorNumber);

      const bitmapArray = new Array(totalDoors).fill(0);

      if (accessType === 1 || accessType === true) {
        doorNumbers.forEach((doorNumber) => {
          const doorNum = parseInt(doorNumber);
          if (!isNaN(doorNum) && doorNum > 0 && doorNum <= totalDoors) {
            bitmapArray[totalDoors - doorNum] = 1;
          }
        });
      }

      const hexValues = [];
      for (let i = 0; i < bitmapArray.length; i += 8) {
        const chunk = bitmapArray
          .slice(i, i + 8)
          .join("")
          .padEnd(8, "0");
        const hexValue = parseInt(chunk, 2)
          .toString(16)
          .toUpperCase()
          .padStart(2, "0");
        hexValues.push(`0x${hexValue}`);
      }

      const finalBitmap = hexValues.join(", ");
      console.log("🧮 Final Door Bitmap:", finalBitmap);
      return finalBitmap;
    } catch (error) {
      console.error("❌ Error generating door bitmap:", error.message);
      return null;
    }
  }

  async function updateControllersFromDoorNumbers(
    doorNumbers,
    tenantId,
    schema,
    accountability
  ) {
    const controllerService = new ItemsService("controllers", {
      schema,
      accountability,
    });

    try {
      const controllers = await controllerService.readByQuery({
        filter: {
          tenant: { tenantId: { _eq: tenantId } },
        },
        fields: ["id", "selectedDoors"],
        limit: -1,
      });

      const controllerIdsToUpdate = [];

      for (const controller of controllers) {
        const selectedDoorIds = controller.selectedDoors || [];
        if (!Array.isArray(selectedDoorIds) || selectedDoorIds.length === 0)
          continue;

        const matching = selectedDoorIds.some((doorId) =>
          doorNumbers.includes(doorId)
        );
        if (matching) {
          controllerIdsToUpdate.push(controller.id);
        }
      }

      for (let i = 0; i < controllerIdsToUpdate.length; i += 25) {
        const batch = controllerIdsToUpdate.slice(i, i + 25);
        await controllerService.updateMany(
          batch,
          { controllerStatus: "waiting" },
          { emitEvents: false }
        );
      }
    } catch (error) {
      console.error("❌ Error updating controllers from doors:", error.message);
    }
  }

  async function updateDeviceControllers(
    controllerIds,
    tenantId,
    schema,
    accountability
  ) {
    const controllerService = new ItemsService("controllers", {
      schema,
      accountability,
    });

    try {
      const validIds = controllerIds.filter((id) => !!id);
      for (let i = 0; i < validIds.length; i += 25) {
        const batch = validIds.slice(i, i + 25);
        await controllerService.updateMany(
          batch,
          { controllerStatus: "waiting" },
          { emitEvents: false }
        );
      }
    } catch (error) {
      console.error("❌ Error updating device controllers:", error.message);
    }
  }

  action(
    "accesslevels.items.update",
    async (input, { schema, accountability }) => {
      const keys = input.keys || (input.key ? [input.key] : []);
      const payload = input.payload || {};
      const payloadKeys = Object.keys(payload);
      const skipUpdate =
        payloadKeys.length === 1 ||
        (payloadKeys.length === 2 &&
          payloadKeys.includes("accessLevelBitmap") &&
          payloadKeys.includes("doorBitmap"));

      if (keys.length === 0 || skipUpdate) return;

      const itemKey = keys.join(",");
      if (processedItems.has(itemKey)) return;
      processedItems.add(itemKey);

      try {
        const accessLevelService = new ItemsService("accesslevels", {
          schema,
          accountability,
        });

        const items = await accessLevelService.readByQuery({
          filter: { id: { _in: keys } },
          fields: [
            "id",
            "tenant.tenantId",
            "groupType",
            "assignDoorsGroup",
            "assignDevicesGroup",
            "accessLevelNumber",
            "_24hrs",
            "holidays",
            "maxWorkHours",
            "accessType",
            "workingHours",
          ],
        });

        for (const item of items) {
          const tenantId = item.tenant?.tenantId;
          const accessLevelBitmap = generateAccessLevelBitmap(item);
          let doorNumbers = [];

          if (item.groupType === "doors") {
            const doorsService = new ItemsService("doors", {
              schema,
              accountability,
            });

            const doorIds = item.assignDoorsGroup || [];

            if (doorIds.length > 0 && tenantId) {
              const doors = await doorsService.readByQuery({
                filter: {
                  _and: [
                    { id: { _in: doorIds } },
                    { tenant: { tenantId: { _eq: tenantId } } },
                  ],
                },
                fields: ["id", "doorNumber"],
                limit: -1,
              });

              doorNumbers = doors.map((d) => d.doorNumber).filter(Boolean);
              const doorIdsFromDB = doors.map((d) => d.id);

              await updateControllersFromDoorNumbers(
                doorIdsFromDB,
                tenantId,
                schema,
                accountability
              );
            }
          } else if (item.groupType === "devices") {
            const controllerService = new ItemsService("controllers", {
              schema,
              accountability,
            });
            const doorsService = new ItemsService("doors", {
              schema,
              accountability,
            });

            const controllerIds = item.assignDevicesGroup || [];
            await updateDeviceControllers(
              controllerIds,
              tenantId,
              schema,
              accountability
            );

            for (let i = 0; i < controllerIds.length; i += 50) {
              const batch = controllerIds.slice(i, i + 50);
              const controllers = await controllerService.readByQuery({
                filter: {
                  id: { _in: batch },
                  tenant: { tenantId: { _eq: tenantId } },
                },
                fields: ["selectedDoors"],
                limit: -1,
              });

              for (const controller of controllers) {
                const doorIds = controller.selectedDoors || [];
                if (!Array.isArray(doorIds) || doorIds.length === 0) continue;

                const doors = await doorsService.readByQuery({
                  filter: {
                    _and: [
                      { id: { _in: doorIds } },
                      { tenant: { tenantId: { _eq: tenantId } } },
                    ],
                  },
                  fields: ["doorNumber"],
                  limit: -1,
                });

                doors.forEach((d) => {
                  if (d.doorNumber) {
                    doorNumbers.push(d.doorNumber);
                  }
                });
              }
            }
          }

          const doorBitmap = generateDoorBitmap(doorNumbers, item.accessType);
          await accessLevelService.updateOne(
            item.id,
            {
              accessLevelBitmap: JSON.stringify(accessLevelBitmap),
              doorBitmap: JSON.stringify(doorBitmap),
            },
            { emitEvents: false }
          );
        }
      } catch (error) {
        console.error("❌ Hook processing error:", error.message);
      } finally {
        setTimeout(() => processedItems.delete(itemKey), 5000);
      }
    }
  );
};
