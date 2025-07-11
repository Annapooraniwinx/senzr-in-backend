// import axios from "axios";

// export default (router, { services, getSchema }) => {
//   const { ItemsService } = services;

//   // Step 1: Initial verification request
//   router.post("/", async (req, res) => {
//     try {
//       const schema = await getSchema();
//       const { employeeId, documentType, documentNumber, status } = req.body;

//       if (!employeeId || !documentType || !documentNumber || !status) {
//         return res.status(400).json({
//           success: false,
//           message:
//             "Missing fields: employeeId, documentType, documentNumber, status",
//         });
//       }

//       const validDocumentTypes = [
//         "pan",
//         "aadhaar",
//         "voter_id",
//         "driving_license",
//         "uan",
//         "bank_account",
//       ];

//       if (!validDocumentTypes.includes(documentType)) {
//         return res.status(400).json({
//           success: false,
//           message: `Invalid document type: ${documentType}`,
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
//       const employeeInternalId = employee.id;
//       const dobToUse = req.body.dob || employee.dob;

//       if (documentType === "driving_license" && !dobToUse) {
//         return res.status(400).json({
//           success: false,
//           message: "DOB required for driving license verification",
//         });
//       }

//       const bgService = new ItemsService("bgVerification", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const existing = await bgService.readByQuery({
//         filter: { employee: { _eq: employeeInternalId } },
//         limit: 1,
//       });

//       const now = new Date().toISOString();
//       const verificationData = {
//         documentNumber,
//         status: "pending",
//         verifiedAt: now,
//         payment: { amount: 10, currency: "INR", status: "pending" },
//       };

//       let bgRecord;
//       if (existing.length > 0) {
//         const recordId = existing[0].id;
//         const existingData = existing[0].verifiedData || {};

//         const updatedVerifiedData = {
//           ...existingData,
//           [documentType]: verificationData,
//         };

//         bgRecord = await bgService.updateOne(recordId, {
//           verifiedData: updatedVerifiedData,
//         });
//       } else {
//         bgRecord = await bgService.createOne({
//           employee: employeeInternalId,
//           requestedAt: now,
//           verifiedData: {
//             [documentType]: verificationData,
//           },
//         });
//       }

//       // Step 2: Call Surepass
//       const verificationResult = await verifyWithSurepass(
//         documentType,
//         documentNumber,
//         dobToUse
//       );

//       const verificationResponse = {
//         success: verificationResult.success,
//         documentType,
//         status: verificationResult.success ? "verified" : "failed",
//         verificationDetails: verificationResult.data,
//       };

//       return res.json(verificationResponse);
//     } catch (error) {
//       console.error("Verification Error:", error);
//       return res.status(500).json({
//         success: false,
//         message: "Internal error during verification",
//         error: error.message,
//       });
//     }
//   });

//   // Step 3: Final status update from UI
//   router.post("/update-status", async (req, res) => {
//     try {
//       const schema = await getSchema();
//       const { employeeId, documentType, status } = req.body;

//       if (!employeeId || !documentType || !["verified", "failed"].includes(status)) {
//         return res.status(400).json({
//           success: false,
//           message:
//             "Missing or invalid fields: employeeId, documentType, status must be 'verified' or 'failed'",
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

//       const bgService = new ItemsService("bgVerification", {
//         schema: req.schema,
//         accountability: req.accountability,
//       });

//       const existing = await bgService.readByQuery({
//         filter: { employee: { _eq: employee.id } },
//         limit: 1,
//       });

//       if (!existing.length) {
//         return res.status(404).json({
//           success: false,
//           message: `No bgVerification record found for employee ${employeeId}`,
//         });
//       }

//       const verifiedData = existing[0].verifiedData || {};
//       if (!verifiedData[documentType]) {
//         verifiedData[documentType] = {};
//       }

//       verifiedData[documentType].status = status;

//       await bgService.updateOne(existing[0].id, { verifiedData });

//       return res.json({
//         success: true,
//         message: `Status updated to '${status}' for ${documentType}`,
//       });
//     } catch (err) {
//       console.error("Update status error:", err);
//       return res.status(500).json({
//         success: false,
//         message: "Failed to update document status",
//         error: err.message,
//       });
//     }
//   });

//   // Aadhaar Digilocker Token (Unchanged)
//  router.post("/aadhaar/generate-token", async (req, res) => {
//     try {
//       const SUREPASS_API_KEY =
//         "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MTQ1OTUxOCwianRpIjoiODIxMjhkNTctZGM4ZS00MzcxLWI0YzUtOWViMWJiMmI5ODU2IiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTE0NTk1MTgsImV4cCI6MTc1NDA1MTUxOCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.vr3OctRUNgnLHCvSU6IZkQwfQZBFKwb_-NP-gSlAe7Y";

//       const { full_name, user_email, mobile_number } = req.body;

//       if (!full_name || !user_email || !mobile_number) {
//         return res.status(400).json({
//           success: false,
//           message: "Missing required fields",
//         });
//       }

//       const response = await axios.post(
//         "https://app.surepass.app/sandbox/api/v1/digilocker/initialize",
//         {
//           data: {
//             expiry_minutes: 10,
//             send_sms: true,
//             send_email: true,
//             verify_phone: true,
//             verify_email: true,
//             redirect_url: "https://app.samayaccess.com/login",
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

//       return res.json({ success: true, digilockerURL: response.data.url });
//     } catch (err) {
//       console.error("Digilocker error:", err.response?.data || err.message);
//       return res.status(500).json({
//         success: false,
//         message: "Failed to generate Digilocker token",
//         error: err.response?.data || err.message,
//       });
//     }
//   });

//   // Surepass Verification Utility
//   async function verifyWithSurepass(documentType, documentNumber, dob = "") {
//     try {
//       const SUREPASS_API_KEY = "YOUR_SUREPASS_API_KEY";

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
//           requestBody = {
//             id_number: documentNumber,
//             dob: dob || "1990-01-01",
//           };
//           break;
//         case "uan":
//           endpoint = "https://sandbox.surepass.app/api/v1/uan/uan";
//           requestBody = { id_number: documentNumber };
//           break;
//         case "bank_account":
//           endpoint =
//             "https://sandbox.surepass.app/api/v1/bank-verification/account";
//           const [account_number, ifsc] = documentNumber.split("-");
//           requestBody = { account_number, ifsc };
//           break;
//         default:
//           throw new Error("Unsupported document type");
//       }

//       const response = await axios.post(endpoint, requestBody, {
//         headers: {
//           "Content-Type": "application/json",
//           Authorization: `Bearer ${SUREPASS_API_KEY}`,
//         },
//       });

//       const success =
//         response.data?.success === true &&
//         response.data?.status_code === 200;

//       return { success, data: response.data };
//     } catch (error) {
//       console.error("Surepass error:", error.response?.data || error.message);
//       return { success: false, data: error.response?.data || {} };
//     }
//   }
// };

import axios from "axios";

export default (router, { services, getSchema }) => {
  const { ItemsService } = services;

  // ✅ Bulk document verification: PAN, Aadhaar, Voter ID, etc.
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

        if (!documentType || !documentNumber) {
          results.push({
            documentType,
            status: "failed",
            error: "Missing documentType or documentNumber",
          });
          continue;
        }

        const verificationData = {
          documentNumber,
          status: "pending",
          verifiedAt: now,
          payment: {
            amount: 10,
            currency: "INR",
            status: "pending",
          },
        };

        verifiedData[documentType] = verificationData;

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
      console.error("Bulk verification error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: err.message,
      });
    }
  });

  // ✅ Final status update (single document)
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
          continue;
        }

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
      console.error("Bulk status update error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update statuses",
        error: err.message,
      });
    }
  });

  // ✅ Aadhaar token initialization
  router.post("/aadhaar/generate-token", async (req, res) => {
    try {
      const SUREPASS_API_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1MTQ1OTUxOCwianRpIjoiODIxMjhkNTctZGM4ZS00MzcxLWI0YzUtOWViMWJiMmI5ODU2IiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTE0NTk1MTgsImV4cCI6MTc1NDA1MTUxOCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.vr3OctRUNgnLHCvSU6IZkQwfQZBFKwb_-NP-gSlAe7Y";

      const { full_name, user_email, mobile_number } = req.body;

      if (!full_name || !user_email || !mobile_number) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      const response = await axios.post(
        "https://app.surepass.app/sandbox/api/v1/digilocker/initialize",
        {
          data: {
            expiry_minutes: 10,
            send_sms: true,
            send_email: true,
            verify_phone: true,
            verify_email: true,
            redirect_url: "https://app.samayaccess.com/login",
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

      return res.json({ success: true, digilockerURL: response.data.url });
    } catch (err) {
      console.error("❌Digilocker error:", err.response?.data || err.message);
      return res.status(500).json({
        success: false,
        message: "Failed to generate Digilocker token",
        error: err.response?.data || err.message,
      });
    }
  });

  // ✅ Surepass document verifier
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
      console.error("Surepass error:", error.response?.data || error.message);
      return {
        success: false,
        data: error.response?.data || {},
      };
    }
  }
};
