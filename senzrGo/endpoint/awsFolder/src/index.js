export default (router) => {
  router.post("/create-s3-tenant-folders", async (req, res) => {
    try {
      const { tenantIds } = req.body;

      if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
        return res
          .status(400)
          .json({ error: "tenantIds must be a non-empty array" });
      }

      // ---- Load AWS SDK (same pattern you already use) ----
      let s3 = null;
      const BUCKET = process.env.BUCKET;
      const ACCESS_KEY = process.env.ACCESS_KEY;
      const SECRET_KEY = process.env.SECRET_KEY;
      const REGION = process.env.REGION;

      try {
        const AWS = await import("aws-sdk");
        s3 = new AWS.S3({
          accessKeyId: ACCESS_KEY,
          secretAccessKey: SECRET_KEY,
          region: REGION,
        });
        console.log("AWS SDK loaded successfully");
      } catch (err) {
        console.error("Failed to load AWS SDK:", err.message);
        return res.status(500).json({ error: "AWS SDK could not be loaded" });
      }

      // ---- Files that must be created inside each tenant folder ----
      const files = [
        "employees.json",
        "faces.json",
        "fingerprints.json",
        "rfid.json",
        "doors.json",
        "devices.json",
        "access_levels.json",
        "four_door_controller.json",
      ];

      const results = {
        succeeded: [],
        failed: [],
      };

      // ---- Process each tenantId sequentially (you can parallelise with Promise.all if you want) ----
      for (const tenantId of tenantIds) {
        try {
          const prefix = `${tenantId}/`;

          // 1. Create the "folder" (empty object with x-directory content-type)
          await s3
            .putObject({
              Bucket: BUCKET,
              Key: prefix,
              Body: "",
              ContentType: "application/x-directory",
            })
            .promise();

          // 2. Create the 8 JSON files
          for (const file of files) {
            await s3
              .putObject({
                Bucket: BUCKET,
                Key: prefix + file,
                Body: "[]",
                ContentType: "application/json",
              })
              .promise();
          }

          console.log(`S3 folder & files created for tenant ${tenantId}`);
          results.succeeded.push(tenantId);
        } catch (s3Err) {
          console.error(`S3 error for tenant ${tenantId}:`, s3Err.message);
          results.failed.push({ tenantId, error: s3Err.message });
        }
      }

      // ---- Final response ----
      return res.status(200).json({
        message: "S3 tenant folder creation completed",
        ...results,
      });
    } catch (err) {
      console.error("Unexpected error in /create-s3-tenant-folders:", err);
      return res.status(500).json({ error: err.message });
    }
  });
};
