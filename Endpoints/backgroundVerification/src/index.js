import axios from "axios";

export default (router, { services, getSchema }) => {
  const { ItemsService } = services;

  // ✅ Bulk document verification
  router.post("/", async (req, res) => {
    try {
      const schema = await getSchema();
      const { employeeId, documents } = req.body;

      if (!employeeId || !Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Missing employeeId or documents array",
        });
      }

      const employeeService = new ItemsService("personalModule", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const employeeRecord = await employeeService.readByQuery({
        filter: { id: { _eq: employeeId } },
        limit: 1,
      });

      if (!employeeRecord?.length) {
        return res.status(404).json({
          success: false,
          message: `Employee with ID '${employeeId}' not found`,
        });
      }

      const employee = employeeRecord[0];
      const dobToUse = req.body.dob || employee.dob;

      const bgService = new ItemsService("bgVerification", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const existing = await bgService.readByQuery({
        filter: { employee: { _eq: employeeId } },
        limit: 1,
      });

      const now = new Date().toISOString();
      let verifiedData = existing[0]?.verifiedData || {};
      const results = [];

      for (const doc of documents) {
        const { documentType, documentNumber } = doc;

        if (!documentType) {
          results.push({
            documentType,
            status: "failed",
            error: "Missing documentType",
          });
          continue;
        }

        verifiedData[documentType] = {
          documentNumber: documentNumber || "aadhaar-via-digilocker",
          status: "pending",
          verifiedAt: now,
          payment: { amount: 10, currency: "INR", status: "pending" },
        };

        // Aadhaar via DigiLocker
        if (documentType === "aadhaar") {
          try {
            const SUREPASS_API_KEY =
              "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MzcwMjc3OCwianRpIjoiYmIwZGUwY2MtODdmZC00ZWQzLWE5MDUtMTI1OThiYWI5MjVkIiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTM3MDI3NzgsImV4cCI6MTc1NDk5ODc3OCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.INN7SRy_BCgjFW-b6NzUyIROuexGciBBlEfO6_AAfEY";

            const digiRes = await axios.post(
              "https://sandbox.surepass.app/api/v1/digilocker/initialize",
              {
                data: {
                  expiry_minutes: 20,
                  send_sms: false,
                  send_email: false,
                  verify_phone: false,
                  verify_email: false,
                  skip_main_screen: false,
                  signup_flow: true,
                  // logo_url: "YOUR BRAND LOGO URL",
                  redirect_url: `https://appv1.samayaccess.com/employee-details/employee/${employeeId}/verificationmodule`,
                },
              },
              {
                headers: {
                  Authorization: `Bearer ${SUREPASS_API_KEY}`,
                  "Content-Type": "application/json",
                },
              }
            );
            console.log("✅ employeeId", employeeId);
            // ✅ Save pending status immediately for Aadhaar
            if (existing.length > 0) {
              await bgService.updateOne(existing[0].id, { verifiedData });
            } else {
              await bgService.createOne({
                employee: employeeId,
                requestedAt: now,
                verifiedData,
              });
            }

            const { url, token, client_id, expiry_seconds } = digiRes.data.data;

            results.push({
              documentType,
              status: "pending",
              digilocker: {
                url,
                token,
                client_id,
                expires_in: expiry_seconds,
              },
            });
          } catch (e) {
            console.error(
              "❌ Digilocker error:",
              e.response?.data || e.message
            );
            results.push({
              documentType,
              status: "failed",
              error: "Failed to initiate Aadhaar DigiLocker",
            });
          }

          continue;
        }

        // ✅ Other document types (PAN, DL, Voter, etc.)
        const result = await verifyWithSurepass(
          documentType,
          documentNumber,
          doc.dob || dobToUse
        );

        verifiedData[documentType].status = result.success
          ? "verified"
          : "failed";

        results.push({
          documentType,
          status: verifiedData[documentType].status,
          verificationDetails: result.data,
        });
      }

      // ✅ Save to bgVerification (if Aadhaar not handled already)
      if (!documents.some((d) => d.documentType === "aadhaar")) {
        if (existing.length > 0) {
          await bgService.updateOne(existing[0].id, { verifiedData });
        } else {
          await bgService.createOne({
            employee: employeeId,
            requestedAt: now,
            verifiedData,
          });
        }
      }

      return res.json({ success: true, results });
    } catch (err) {
      console.error("🔴 Bulk verification error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  });

  // ✅ Aadhaar DigiLocker status check
  router.get("/aadhaar/status", async (req, res) => {
    try {
      const client_id = req.query.client_id;

      if (!client_id) {
        return res.status(400).json({
          success: false,
          message: "Missing Digilocker client_id in query",
        });
      }

      const SUREPASS_API_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MzcwMjc3OCwianRpIjoiYmIwZGUwY2MtODdmZC00ZWQzLWE5MDUtMTI1OThiYWI5MjVkIiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTM3MDI3NzgsImV4cCI6MTc1NDk5ODc3OCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.INN7SRy_BCgjFW-b6NzUyIROuexGciBBlEfO6_AAfEY";

      const response = await axios.get(
        `https://sandbox.surepass.io/api/v1/digilocker/download-aadhaar/${client_id}`,
        {
          headers: {
            Authorization: `Bearer ${SUREPASS_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      return res.json({
        success: true,
        digilockerStatus: response.data,
      });
    } catch (err) {
      console.error(
        "🔴 Aadhaar Digilocker status error:",
        err.response?.data || err.message
      );
      return res.status(500).json({
        success: false,
        message: "Failed to fetch Aadhaar Digilocker status",
        error: err.response?.data || err.message,
      });
    }
  });

  // ✅ Update verification status (UI confirms verified/failed)
  router.post("/update-status", async (req, res) => {
    try {
      const { employeeId, documents } = req.body;

      if (!employeeId || !Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Missing employeeId or documents array",
        });
      }

      const schema = await getSchema();
      const bgService = new ItemsService("bgVerification", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const existing = await bgService.readByQuery({
        filter: { employee: { _eq: employeeId } },
        limit: 1,
      });

      if (!existing.length) {
        return res.status(404).json({
          success: false,
          message: "Verification record not found",
        });
      }

      const verifiedData = existing[0].verifiedData || {};
      const updatedDocs = [];

      for (const doc of documents) {
        const { documentType, status } = doc;

        if (!documentType || !["verified", "failed"].includes(status)) {
          console.log(
            `❌ Invalid or missing status for documentType: ${documentType}`
          );
          continue;
        }

        // Log if documentType is missing in current verifiedData
        if (!verifiedData[documentType]) {
          console.warn(
            `⚠️ ${documentType} not found in existing verifiedData. Creating entry.`
          );
          verifiedData[documentType] = {};
        }

        console.log(
          `📄 Updating '${documentType}' from '${verifiedData[documentType].status}' to '${status}'`
        );
        // verifiedData[documentType].status = status;
        // verifiedData[documentType].verifiedAt = new Date().toISOString();
        verifiedData[documentType].status = status;
        verifiedData[documentType].verifiedAt = new Date().toISOString();

        if (status === "verified") {
          if (!verifiedData[documentType].payment) {
            verifiedData[documentType].payment = {
              amount: 10,
              currency: "INR",
            };
          }
          verifiedData[documentType].payment.status = "verified";
        }

        updatedDocs.push({ documentType, status });
      }

      // Log the object before saving
      console.log(
        "🟡 Final verifiedData to save:",
        JSON.stringify(verifiedData, null, 2)
      );

      await bgService.updateOne(existing[0].id, { verifiedData });

      console.log("🟢 Updated bgVerification ID:", existing[0].id);

      // Confirm the update with a fresh read
      const check = await bgService.readOne(existing[0].id);
      console.log(
        "🔁 Post-update verifiedData:",
        JSON.stringify(check.verifiedData, null, 2)
      );

      return res.json({
        success: true,
        updated: updatedDocs,
      });
    } catch (err) {
      console.error("🔴 Status update error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update statuses",
        error: err.message,
      });
    }
  });

  // ✅ Surepass helper for PAN, DL, UAN, etc.
  async function verifyWithSurepass(documentType, documentNumber, dob = "") {
    try {
      const SUREPASS_API_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MzcwMjc3OCwianRpIjoiYmIwZGUwY2MtODdmZC00ZWQzLWE5MDUtMTI1OThiYWI5MjVkIiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTM3MDI3NzgsImV4cCI6MTc1NDk5ODc3OCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.INN7SRy_BCgjFW-b6NzUyIROuexGciBBlEfO6_AAfEY";

      let endpoint = "";
      let requestBody = {};

      switch (documentType) {
        case "pan":
          endpoint = "https://sandbox.surepass.app/api/v1/pan/pan";
          requestBody = { id_number: documentNumber };
          break;
        case "voter_id":
          endpoint = "https://sandbox.surepass.io/api/v1/voter-id/voter-id";
          requestBody = { id_number: documentNumber };
          break;
        case "driving_license":
          endpoint =
            "https://sandbox.surepass.io/api/v1/driving-license/driving-license";
          requestBody = { id_number: documentNumber, dob };
          break;
        case "uan":
          endpoint =
            "https://sandbox.surepass.io/api/v1/income/epfo/aadhaar-to-uan";
          requestBody = { aadhaar_number: documentNumber };
          break;
        case "bank_account":
          endpoint =
            "https://sandbox.surepass.io/api/v1/bank-verification/mobile-to-account";
          requestBody = { mobile_number: documentNumber };
          break;
        case "esic":
          endpoint = "https://sandbox.surepass.io/api/v1/esic/esic-v2";
          requestBody = { id_number: documentNumber };
          break;
        default:
          throw new Error(`Unsupported document type: ${documentType}`);
      }

      const response = await axios.post(endpoint, requestBody, {
        headers: {
          Authorization: `Bearer ${SUREPASS_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      const success =
        response.data?.success === true && response.data?.status_code === 200;

      return { success, data: response.data };
    } catch (error) {
      console.error(
        "❌ Surepass error:",
        error.response?.data || error.message
      );
      return { success: false, data: error.response?.data || {} };
    }
  }
};
