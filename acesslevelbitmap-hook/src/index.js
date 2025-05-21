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
        const chunk = bitmapArray.slice(i, i + 8).join("");
        const paddedChunk = chunk.padEnd(8, "0");
        const hexValue = parseInt(paddedChunk, 2)
          .toString(16)
          .toUpperCase()
          .padStart(2, "0");
        hexValues.push(`0x${hexValue}`);
      }

      return hexValues.join(", ");
    } catch (error) {
      console.error("❌ Error generating door bitmap:", error.message);
      return null;
    }
  }

  async function updateControllers(doorNumbers, schema, accountability) {
    if (!doorNumbers || doorNumbers.length === 0) {
      console.log("⚠️ No door numbers to update controllers");
      return;
    }

    try {
      const controllerService = new ItemsService("controllers", {
        schema,
        accountability,
      });

      for (let i = 0; i < doorNumbers.length; i += 50) {
        const batchDoorNumbers = doorNumbers.slice(i, i + 50);

        console.log(
          `🔄 Processing controller batch for door numbers: ${batchDoorNumbers.join(
            ", "
          )}`
        );

        const controllers = await controllerService.readByQuery({
          filter: {
            assignedDoor: {
              doors_id: {
                doorNumber: {
                  _in: batchDoorNumbers,
                },
              },
            },
          },
          fields: [
            "id",
            "controllerStatus",
            "assignedDoor.doors_id.doorNumber",
          ],
        });

        if (controllers.length === 0) {
          console.log("⚠️ No controllers found for this batch of door numbers");
          continue;
        }

        console.log(`🔍 Found ${controllers.length} controllers to update`);

        const controllerIds = controllers.map((controller) => controller.id);

        for (let j = 0; j < controllerIds.length; j += 25) {
          const batchControllerIds = controllerIds.slice(j, j + 25);

          console.log(
            `🔄 Updating controllers batch: ${batchControllerIds.join(", ")}`
          );

          try {
            await controllerService.updateMany(
              batchControllerIds,
              {
                controllerStatus: "waiting",
              },
              { emitEvents: false }
            );

            console.log(
              `✅ Updated ${batchControllerIds.length} controllers to "waiting" status`
            );
          } catch (error) {
            console.error("❌ Error updating controllers:", error.message);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error processing controllers update:", error.message);
    }
  }

  action(
    "accesslevels.items.update",
    async (input, { schema, accountability }) => {
      const keys = input.keys || (input.key ? [input.key] : []);
      console.log("✅ accesslevels.items.update ACTION triggered");
      console.log("Item Key(s):", keys);

      if (keys.length === 0) {
        console.log("⚠️ No keys found in update action");
        return;
      }

      const payload = input.payload || {};
      const payloadKeys = Object.keys(payload);
      if (
        payloadKeys.length === 1 ||
        (payloadKeys.length === 2 &&
          payloadKeys.includes("accessLevelBitmap") &&
          payloadKeys.includes("doorBitmap"))
      ) {
        console.log("🔄 Skipping bitmap update to prevent infinite loop");
        return;
      }

      const itemKey = keys.join(",");
      if (processedItems.has(itemKey)) {
        console.log("🔄 Already processed item(s):", itemKey);
        return;
      }

      processedItems.add(itemKey);

      try {
        const accessLevelService = new ItemsService("accesslevels", {
          schema,
          accountability,
        });

        const items = await accessLevelService.readByQuery({
          filter: { id: { _in: keys } },
          fields: [
            "accessLevelNumber",
            "_24hrs",
            "holidays",
            "maxWorkHours",
            "accessType",
            "workingHours",
            "groupType",
            "tenant.tenantId",
            "tenant.tenantName",
            "assignDoorsGroup",
            "assignDevicesGroup",
            "id",
          ],
        });

        for (const item of items) {
          const accessLevelBitmap = generateAccessLevelBitmap(item);

          console.log("🔢 accessLevelNumber:", item.accessLevelNumber);
          console.log("🕒 _24hrs:", item._24hrs);
          console.log("🎉 holidays:", item.holidays);
          console.log("⏰ maxWorkHours:", item.maxWorkHours);
          console.log("🔐 accessType:", item.accessType);
          console.log("🔣 Generated Access Level Bitmap:", accessLevelBitmap);

          const tenantId = item.tenant?.tenantId;

          if (item.groupType === "devices") {
            console.log(
              "🔌 Devices Group Data:",
              item.assignDevicesGroup || []
            );

            try {
              await accessLevelService.updateOne(
                item.id,
                {
                  accessLevelBitmap: JSON.stringify(accessLevelBitmap),
                },
                { emitEvents: false }
              );
              console.log("✅ Updated accessLevelBitmap for device group");
            } catch (error) {
              console.error(
                "❌ Error updating accessLevelBitmap:",
                error.message
              );
            }

            continue;
          } else if (item.groupType === "doors") {
            console.log("🚪 Doors Group Data:", item.assignDoorsGroup || []);

            if (!item.assignDoorsGroup || item.assignDoorsGroup.length === 0) {
              try {
                await accessLevelService.updateOne(
                  item.id,
                  {
                    accessLevelBitmap: JSON.stringify(accessLevelBitmap),
                  },
                  { emitEvents: false }
                );
                console.log("✅ Updated accessLevelBitmap (no door groups)");
              } catch (error) {
                console.error(
                  "❌ Error updating accessLevelBitmap:",
                  error.message
                );
              }

              continue;
            }

            if (!tenantId) {
              try {
                await accessLevelService.updateOne(
                  item.id,
                  {
                    accessLevelBitmap: JSON.stringify(accessLevelBitmap),
                  },
                  { emitEvents: false }
                );
                console.log("✅ Updated accessLevelBitmap (no tenant ID)");
              } catch (error) {
                console.error(
                  "❌ Error updating accessLevelBitmap:",
                  error.message
                );
              }

              continue;
            }

            const doorsService = new ItemsService("doors", {
              schema,
              accountability,
            });

            let allDoorNumbers = [];

            for (let i = 0; i < item.assignDoorsGroup.length; i += 100) {
              const batchDoorGroups = item.assignDoorsGroup.slice(i, i + 100);

              try {
                const doors = await doorsService.readByQuery({
                  filter: {
                    _and: [
                      { doorGroup: { _in: batchDoorGroups } },
                      { tenant: { tenantId: { _eq: tenantId } } },
                    ],
                  },
                  fields: [
                    "doorGroup",
                    "doorName",
                    "doorNumber",
                    "tenant.tenantId",
                    "tenant.tenantName",
                  ],
                });

                doors.forEach((door) => {
                  if (door.doorNumber) {
                    allDoorNumbers.push(door.doorNumber);
                    console.log("Door Number:", door.doorNumber);
                  }
                });
              } catch (error) {
                console.error("❌ Error querying doors:", error.message);
              }
            }

            const accessType = item.accessType;
            const doorBitmap = generateDoorBitmap(allDoorNumbers, accessType);

            console.log("🚪 Door Bitmap Results:");
            console.log("   Full Hex Bitmap:", doorBitmap);

            try {
              await accessLevelService.updateOne(
                item.id,
                {
                  accessLevelBitmap: JSON.stringify(accessLevelBitmap),
                  doorBitmap: JSON.stringify(doorBitmap),
                },
                { emitEvents: false }
              );
              console.log("✅ Updated accessLevelBitmap and doorBitmap");

              if (allDoorNumbers.length > 0) {
                console.log(
                  "🔄 Updating controllers for doors:",
                  allDoorNumbers
                );
                await updateControllers(allDoorNumbers, schema, accountability);
              }
            } catch (error) {
              console.error("❌ Error updating bitmaps:", error.message);
            }
          }
        }
      } catch (error) {
        console.error(
          "❌ Error processing access level update:",
          error.message
        );
      } finally {
        setTimeout(() => {
          processedItems.delete(itemKey);
        }, 5000);
      }
    }
  );
};
