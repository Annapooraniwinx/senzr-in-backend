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

      console.log("🧮 Generated Access Level Bitmap:", bitmap);
      return bitmap;
    } catch (error) {
      console.error("❌ Error generating access level bitmap:", error.message);
      return null;
    }
  }

  function generateDoorBitmap(doorNumbers, accessType) {
    try {
      console.log("🧮 Generating Door Bitmap for:", doorNumbers);

      const maxDoorNumber =
        doorNumbers.length > 0
          ? Math.max(...doorNumbers.filter((num) => !isNaN(parseInt(num))))
          : 0;

      const totalDoors = Math.max(96, maxDoorNumber);
      console.log(`➡️ Total doors for bitmap: ${totalDoors}`);

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

      const finalBitmap = hexValues.join(", ");
      console.log("🧮 Final Door Bitmap:", finalBitmap);
      return finalBitmap;
    } catch (error) {
      console.error("❌ Error generating door bitmap:", error.message);
      return null;
    }
  }

  async function updateControllers(
    doorNumbers,
    tenantId,
    schema,
    accountability
  ) {
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
          `📦 Updating controllers for door numbers batch: ${batchDoorNumbers.join(
            ", "
          )}`
        );

        const controllers = await controllerService.readByQuery({
          filter: {
            _and: [
              {
                assignedDoor: {
                  doors_id: {
                    doorNumber: {
                      _in: batchDoorNumbers,
                    },
                  },
                },
              },
              {
                tenant: {
                  tenantId: {
                    _eq: tenantId,
                  },
                },
              },
            ],
          },
          fields: [
            "id",
            "controllerStatus",
            "assignedDoor.doors_id.doorNumber",
          ],
        });

        if (controllers.length === 0) {
          console.log("⚠️ No controllers found for this batch");
          continue;
        }

        const controllerIds = controllers.map((controller) => controller.id);
        console.log(`🔍 Found controllers: ${controllerIds.join(", ")}`);

        for (let j = 0; j < controllerIds.length; j += 25) {
          const batchControllerIds = controllerIds.slice(j, j + 25);
          console.log(
            `🚀 Updating controller batch: ${batchControllerIds.join(", ")}`
          );

          try {
            await controllerService.updateMany(
              batchControllerIds,
              { controllerStatus: "waiting" },
              { emitEvents: false }
            );
            console.log(
              `✅ Updated ${batchControllerIds.length} controllers to "waiting"`
            );
          } catch (error) {
            console.error("❌ Error updating controller batch:", error.message);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error processing controllers:", error.message);
    }
  }

  action(
    "accesslevels.items.update",
    async (input, { schema, accountability }) => {
      console.log("🚩 Hook triggered: accesslevels.items.update");

      const keys = input.keys || (input.key ? [input.key] : []);
      if (keys.length === 0) {
        console.log("⚠️ No keys found");
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
        console.log("🔁 Skipping loop due to bitmap-only update");
        return;
      }

      const itemKey = keys.join(",");
      if (processedItems.has(itemKey)) {
        console.log(`🔁 Already processed item ${itemKey}`);
        return;
      }

      processedItems.add(itemKey);
      console.log("📥 Processing keys:", keys);

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
            "assignDoorsGroup",
            "assignDevicesGroup",
            "id",
          ],
        });

        for (const item of items) {
          console.log(
            `🧾 Processing Access Level: ${item.accessLevelNumber} (GroupType: ${item.groupType})`
          );
          const accessLevelBitmap = generateAccessLevelBitmap(item);
          const tenantId = item.tenant?.tenantId;
          const accessType = item.accessType;
          let allDoorNumbers = [];

          if (item.groupType === "devices") {
            const deviceIds = item.assignDevicesGroup || [];
            console.log("🖥️ Devices:", deviceIds);

            if (deviceIds.length === 0 || !tenantId) {
              console.log("⚠️ Skipping due to empty device list or tenant");
              await accessLevelService.updateOne(
                item.id,
                { accessLevelBitmap: JSON.stringify(accessLevelBitmap) },
                { emitEvents: false }
              );
              continue;
            }

            const controllerService = new ItemsService("controllers", {
              schema,
              accountability,
            });

            for (let i = 0; i < deviceIds.length; i += 100) {
              const batch = deviceIds.slice(i, i + 100);

              const controllers = await controllerService.readByQuery({
                filter: {
                  id: { _in: batch },
                  tenant: { tenantId: { _eq: tenantId } },
                },
                fields: ["assignedDoor.doors_id.doorNumber"],
              });
              console.log("📟 ⚠️ controllers", controllers);
              controllers.forEach((controller, index) => {
                const assigned = controller.assignedDoor || [];

                if (!Array.isArray(assigned)) {
                  console.log(
                    `⚠️ assignedDoor is not an array (index ${index}):`,
                    assigned
                  );
                  return;
                }

                if (assigned.length === 0) {
                  console.log(
                    `⚠️ assignedDoor is empty for controller (index ${index}):`,
                    controller
                  );
                  return;
                }

                assigned.forEach((entry, i) => {
                  console.log(`🔍 [${index}-${i}] assignedDoor entry:`, entry);
                  const doorNum = entry?.doors_id?.doorNumber;
                  if (doorNum) {
                    allDoorNumbers.push(doorNum);
                    console.log("📟 ✅ Found door from device:", doorNum);
                  } else {
                    console.log("🚫 doorNumber not found in entry:", entry);
                  }
                });
              });
            }
          } else if (item.groupType === "doors") {
            const doorGroups = item.assignDoorsGroup || [];
            console.log("🚪 Door Groups:", doorGroups);

            if (doorGroups.length === 0 || !tenantId) {
              console.log("⚠️ Skipping due to empty door group or tenant");
              await accessLevelService.updateOne(
                item.id,
                { accessLevelBitmap: JSON.stringify(accessLevelBitmap) },
                { emitEvents: false }
              );
              continue;
            }

            const doorsService = new ItemsService("doors", {
              schema,
              accountability,
            });

            for (let i = 0; i < doorGroups.length; i += 100) {
              const batch = doorGroups.slice(i, i + 100);
              console.log("🚪batch door id ", batch, tenantId);

              const doors = await doorsService.readByQuery({
                filter: {
                  _and: [
                    { id: { _in: doorGroups } },
                    { tenant: { tenantId: { _eq: tenantId } } },
                  ],
                },
                fields: ["doorNumber"],
              });

              doors.forEach((d) => {
                if (d.doorNumber) {
                  allDoorNumbers.push(d.doorNumber);
                  console.log("🚪 Found door:", d.doorNumber);
                }
              });
            }
          }

          const doorBitmap = generateDoorBitmap(allDoorNumbers, accessType);

          await accessLevelService.updateOne(
            item.id,
            {
              accessLevelBitmap: JSON.stringify(accessLevelBitmap),
              doorBitmap: JSON.stringify(doorBitmap),
            },
            { emitEvents: false }
          );
          console.log("✅ Bitmaps updated on access level");

          if (allDoorNumbers.length > 0) {
            console.log("🔄 Triggering controller update");
            await updateControllers(
              allDoorNumbers,
              tenantId,
              schema,
              accountability
            );
          }
        }
      } catch (error) {
        console.error(
          "❌ Error in main access level processing:",
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
