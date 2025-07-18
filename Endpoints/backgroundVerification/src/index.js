// import axios from "axios";

// export default (router, { services, getSchema }) => {
//   const { ItemsService } = services;

//   // ✅ Bulk document verification: PAN, Aadhaar, Voter ID, etc.
//   router.post("/", async (req, res) => {
//     try {
//       const schema = await getSchema();
//       const { employeeId, documents } = req.body;

//       if (!employeeId || !Array.isArray(documents) || documents.length === 0) {
//         return res.status(400).json({
//           success: false,
//           message: "Missing employeeId or documents array",
//         });
//       }

//       const employeeService = new ItemsService("personalModule", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const employeeRecord = await employeeService.readByQuery({
//         filter: { id: { _eq: employeeId } },
//         limit: 1,
//       });

//       if (!employeeRecord?.length) {
//         return res.status(404).json({
//           success: false,
//           message: `Employee with ID '${employeeId}' not found`,
//         });
//       }

//       const employee = employeeRecord[0];
//       const dobToUse = req.body.dob || employee.dob;

//       const bgService = new ItemsService("bgVerification", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const existing = await bgService.readByQuery({
//         filter: { employee: { _eq: employeeId } },
//         limit: 1,
//       });

//       const now = new Date().toISOString();
//       let verifiedData = existing[0]?.verifiedData || {};
//       const results = [];

//       for (const doc of documents) {
//         const { documentType, documentNumber } = doc;

//         if (!documentType || !documentNumber) {
//           results.push({
//             documentType,
//             status: "failed",
//             error: "Missing documentType or documentNumber",
//           });
//           continue;
//         }

//         const verificationData = {
//           documentNumber,
//           status: "pending",
//           verifiedAt: now,
//           payment: {
//             amount: 10,
//             currency: "INR",
//             status: "pending",
//           },
//         };

//         verifiedData[documentType] = verificationData;

//         const result = await verifyWithSurepass(
//           documentType,
//           documentNumber,
//           dobToUse
//         );

//         verifiedData[documentType].status = result.success
//           ? "verified"
//           : "failed";

//         results.push({
//           documentType,
//           status: verifiedData[documentType].status,
//           verificationDetails: result.data,
//         });
//       }

//       if (existing.length > 0) {
//         await bgService.updateOne(existing[0].id, { verifiedData });
//       } else {
//         await bgService.createOne({
//           employee: employeeId,
//           requestedAt: now,
//           verifiedData,
//         });
//       }

//       return res.json({ success: true, results });
//     } catch (err) {
//       console.error("Bulk verification error:", err);
//       return res.status(500).json({
//         success: false,
//         message: "Internal server error",
//         error: err.message,
//       });
//     }
//   });

//   // ✅ Final status update (single document)
//   router.post("/update-status", async (req, res) => {
//     try {
//       const { employeeId, documents } = req.body;

//       if (!employeeId || !Array.isArray(documents) || documents.length === 0) {
//         return res.status(400).json({
//           success: false,
//           message: "Missing employeeId or documents array",
//         });
//       }

//       const schema = await getSchema();
//       const bgService = new ItemsService("bgVerification", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const existing = await bgService.readByQuery({
//         filter: { employee: { _eq: employeeId } },
//         limit: 1,
//       });

//       if (!existing.length) {
//         return res.status(404).json({
//           success: false,
//           message: "Verification record not found",
//         });
//       }

//       const verifiedData = existing[0].verifiedData || {};
//       const updatedDocs = [];

//       for (const doc of documents) {
//         const { documentType, status } = doc;

//         if (!documentType || !["verified", "failed"].includes(status)) {
//           continue;
//         }

//         if (!verifiedData[documentType]) verifiedData[documentType] = {};

//         verifiedData[documentType].status = status;
//         updatedDocs.push({ documentType, status });
//       }

//       await bgService.updateOne(existing[0].id, { verifiedData });

//       return res.json({
//         success: true,
//         updated: updatedDocs,
//       });
//     } catch (err) {
//       console.error("Bulk status update error:", err);
//       return res.status(500).json({
//         success: false,
//         message: "Failed to update statuses",
//         error: err.message,
//       });
//     }
//   });

//   // ✅ Aadhaar token initialization
//   router.post("/aadhaar/generate-token", async (req, res) => {
//     try {
//       const SUREPASS_API_KEY =
//         "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MTQ1OTUxOCwianRpIjoiODIxMjhkNTctZGM4ZS00MzcxLWI0YzUtOWViMWJiMmI5ODU2IiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTE0NTk1MTgsImV4cCI6MTc1NDA1MTUxOCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.vr3OctRUNgnLHCvSU6IZkQwfQZBFKwb_-NP-gSlAe7Y";

//       const { full_name, user_email, mobile_number } = req.body;

//       if (!full_name || !user_email || !mobile_number) {
//         return res.status(400).json({
//           success: false,
//           message:
//             "Missing required fields: full_name, user_email, mobile_number",
//         });
//       }

//       const response = await axios.post(
//         "https://sandbox.surepass.io/api/v1/digilocker/initialize",
//         {
//           data: {
//             expiry_minutes: 10,
//             send_sms: true,
//             send_email: true,
//             verify_phone: true,
//             verify_email: true,
//             signup_flow: true,
//             redirect_url: `https://appv1.samayaccess.com/employee-details/employee/${employeeId}/verificationmodule`,
//             state: `aadhaar-${Date.now()}`,
//             prefill_options: {
//               full_name,
//               user_email,
//               mobile_number,
//             },
//           },
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${SUREPASS_API_KEY}`,
//             "Content-Type": "application/json",
//           },
//         }
//       );

//       const { url, client_id, token } = response.data.data;

//       return res.json({
//         success: true,
//         digilockerURL: url,
//         session: {
//           client_id,
//           token,
//           expires_in: response.data.data.expiry_seconds,
//         },
//       });
//     } catch (err) {
//       console.error("Digilocker error:", err.response?.data || err.message);
//       return res.status(500).json({
//         success: false,
//         message: "Failed to initiate Aadhaar Digilocker flow",
//         error: err.response?.data || err.message,
//       });
//     }
//   });

//   // ✅ Surepass document verifier
//   async function verifyWithSurepass(documentType, documentNumber, dob = "") {
//     try {
//       const SUREPASS_API_KEY =
//         "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MTQ1OTUxOCwianRpIjoiODIxMjhkNTctZGM4ZS00MzcxLWI0YzUtOWViMWJiMmI5ODU2IiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTE0NTk1MTgsImV4cCI6MTc1NDA1MTUxOCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.vr3OctRUNgnLHCvSU6IZkQwfQZBFKwb_-NP-gSlAe7Y";

//       let endpoint = "";
//       let requestBody = {};

//       switch (documentType) {
//         case "pan":
//           endpoint = "https://sandbox.surepass.app/api/v1/pan/pan";
//           requestBody = { id_number: documentNumber };
//           break;
//         case "voter_id":
//           endpoint = "https://sandbox.surepass.io/api/v1/voter-id/voter-id";
//           requestBody = { id_number: documentNumber };
//           break;
//         case "driving_license":
//           endpoint =
//             "https://sandbox.surepass.io/api/v1/driving-license/driving-license";
//           requestBody = { id_number: documentNumber, dob };
//           break;
//         case "uan":
//           endpoint = "https://sandbox.surepass.app/api/v1/uan/uan";
//           requestBody = { id_number: documentNumber };
//           break;
//         case "bank_account":
//           const [account_number, ifsc] = documentNumber.split("-");
//           endpoint = "https://sandbox.surepass.app/api/v1/bank-verification/";
//           requestBody = { account_number, ifsc };
//           break;
//         default:
//           throw new Error(`Unsupported document type: ${documentType}`);
//       }

//       const response = await axios.post(endpoint, requestBody, {
//         headers: {
//           Authorization: `Bearer ${SUREPASS_API_KEY}`,
//           "Content-Type": "application/json",
//         },
//       });

//       const success =
//         response.data?.success === true && response.data?.status_code === 200;

//       return { success, data: response.data };
//     } catch (error) {
//       console.error("Surepass error:", error.response?.data || error.message);
//       return {
//         success: false,
//         data: error.response?.data || {},
//       };
//     }
//   }
// };

import axios from "axios";

export default (router, { services, getSchema }) => {
  const { ItemsService } = services;

  // ✅ Bulk document verification (includes Aadhaar Digilocker)
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
        const {
          documentType,
          documentNumber,
          full_name,
          user_email,
          mobile_number,
        } = doc;

        if (!documentType) {
          results.push({
            documentType,
            status: "failed",
            error: "Missing documentType",
          });
          continue;
        }

        // Always store status = pending first
        verifiedData[documentType] = {
          documentNumber: documentNumber || "aadhaar-via-digilocker",
          status: "pending",
          verifiedAt: now,
          payment: { amount: 10, currency: "INR", status: "pending" },
        };

        // Aadhaar via Digilocker (initialize only)
        if (documentType === "aadhaar") {
          if (!full_name || !user_email || !mobile_number) {
            results.push({
              documentType,
              status: "failed",
              error:
                "Missing Aadhaar fields: full_name, user_email, mobile_number",
            });
            continue;
          }

          try {
            const SUREPASS_API_KEY =
              "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MTQ1OTUxOCwianRpIjoiODIxMjhkNTctZGM4ZS00MzcxLWI0YzUtOWViMWJiMmI5ODU2IiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTE0NTk1MTgsImV4cCI6MTc1NDA1MTUxOCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.vr3OctRUNgnLHCvSU6IZkQwfQZBFKwb_-NP-gSlAe7Y";

            const digiRes = await axios.post(
              "https://sandbox.surepass.io/api/v1/digilocker/initialize",
              {
                data: {
                  expiry_minutes: 10,
                  send_sms: true,
                  send_email: true,
                  verify_phone: true,
                  verify_email: true,
                  signup_flow: false,
                  redirect_url: `https://appv1.samayaccess.com/employee-details/employee/${employeeId}/verificationmodule`,
                  state: `aadhaar-${employeeId}-${Date.now()}`,
                  prefill_options: {
                    full_name,
                    user_email,
                    mobile_number,
                  },
                },
              },
              {
                headers: {
                  Authorization: `Bearer ${SUREPASS_API_KEY}`,
                  "Content-Type": "application/json",
                },
              }
            );

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

        // All other document types (PAN, Voter ID, etc.)
        const result = await verifyWithSurepass(
          documentType,
          documentNumber,
          dobToUse
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

      // Update or create bgVerification record
      if (existing.length > 0) {
        await bgService.updateOne(existing[0].id, { verifiedData });
      } else {
        await bgService.createOne({
          employee: employeeId,
          requestedAt: now,
          verifiedData,
        });
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

  // ✅ Aadhaar DigiLocker status check using client_id
  router.get("/aadhaar/status/:client_id", async (req, res) => {
    try {
      const { client_id } = req.params;

      if (!client_id) {
        return res.status(400).json({
          success: false,
          message: "Missing Digilocker client_id in path",
        });
      }

      const SUREPASS_API_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MTQ1OTUxOCwianRpIjoiODIxMjhkNTctZGM4ZS00MzcxLWI0YzUtOWViMWJiMmI5ODU2IiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTE0NTk1MTgsImV4cCI6MTc1NDA1MTUxOCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.vr3OctRUNgnLHCvSU6IZkQwfQZBFKwb_-NP-gSlAe7Y";

      const response = await axios.get(
        `https://sandbox.surepass.io/api/v1/digilocker/status/${client_id}`,
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

  // ✅ Update status for verified/failed after final UI result
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

        if (!documentType || !["verified", "failed"].includes(status)) continue;

        if (!verifiedData[documentType]) verifiedData[documentType] = {};

        verifiedData[documentType].status = status;
        updatedDocs.push({ documentType, status });
      }

      await bgService.updateOne(existing[0].id, { verifiedData });

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

  // ✅ Helper for PAN, Voter ID, etc.
  async function verifyWithSurepass(documentType, documentNumber, dob = "") {
    try {
      const SUREPASS_API_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MTQ1OTUxOCwianRpIjoiODIxMjhkNTctZGM4ZS00MzcxLWI0YzUtOWViMWJiMmI5ODU2IiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTE0NTk1MTgsImV4cCI6MTc1NDA1MTUxOCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.vr3OctRUNgnLHCvSU6IZkQwfQZBFKwb_-NP-gSlAe7Y";

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
          endpoint = "https://sandbox.surepass.app/api/v1/uan/uan";
          requestBody = { id_number: documentNumber };
          break;
        case "bank_account":
          const [account_number, ifsc] = documentNumber.split("-");
          endpoint =
            "https://sandbox.surepass.app/api/v1/bank-verification/account";
          requestBody = { account_number, ifsc };
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
