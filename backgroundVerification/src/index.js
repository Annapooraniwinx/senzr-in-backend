import axios from "axios";

export default (router, { services, getSchema, database }) => {
  const { ItemsService } = services;

  router.post("/", async (req, res) => {
    try {
      const schema = await getSchema();

      const { employeeId, documentType, documentNumber } = req.body;

      if (!employeeId || !documentType || !documentNumber) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required fields: employeeId, documentType, documentNumber",
        });
      }

      const validDocumentTypes = [
        "pan",
        "aadhaar",
        "voter_id",
        "driving_license",
        "uan",
        "bank_account",
      ];
      if (!validDocumentTypes.includes(documentType)) {
        return res.status(400).json({
          success: false,
          message: `Invalid document type. Must be one of: ${validDocumentTypes.join(
            ", "
          )}`,
        });
      }

      const verificationResult = await verifyWithSurepass(
        documentType,
        documentNumber
      );

      const bgVerificationService = new ItemsService("bgVerification", {
        schema,
        accountability: req.accountability,
        knex: database,
      });

      const existingRecords = await bgVerificationService.readByQuery({
        filter: {
          employee: { _eq: employeeId },
        },
      });

      const now = new Date().toISOString();

      const verificationData = {
        documentNumber,
        status: verificationResult.success ? "verified" : "failed",
        verifiedAt: verificationResult.success ? now : null,
        payment: {
          amount: 10,
          currency: "INR",
          status: "pending",
        },
      };

      let record;

      if (existingRecords && existingRecords.length > 0) {
        const recordId = existingRecords[0].id;
        const updateData = {
          [`verifiedData.${documentType}`]: verificationData,
        };

        record = await bgVerificationService.updateOne(recordId, updateData);
      } else {
        const newRecord = {
          employee: employeeId,
          requestedAt: now,
          verifiedData: {
            [documentType]: verificationData,
          },
        };

        record = await bgVerificationService.createOne(newRecord);
      }

      return res.json({
        success: true,
        data: {
          id: record,
          documentType,
          status: verificationData.status,
          message: verificationResult.success
            ? "Document verified successfully"
            : "Document verification failed",
        },
        verificationDetails: verificationResult,
      });
    } catch (error) {
      console.error("Document verification error:", error);

      return res.status(500).json({
        success: false,
        message: "An error occurred during document verification",
        error: error.message,
      });
    }
  });

  async function verifyWithSurepass(documentType, documentNumber) {
    try {
      const SUREPASS_API_KEY = process.env.SUREPASS_API_KEY;

      if (!SUREPASS_API_KEY) {
        throw new Error("SUREPASS_API_KEY environment variable is not defined");
      }

      let endpoint = "";
      let requestBody = {};

      switch (documentType) {
        case "pan":
          endpoint = "https://kyc-api.surepass.io/api/v1/pan/pan";
          requestBody = { id_number: documentNumber };
          break;
        case "aadhaar":
          endpoint =
            "https://kyc-api.surepass.io/api/v1/aadhaar-v2/aadhaar-validation";
          requestBody = { id_number: documentNumber };
          break;
        case "voter_id":
          endpoint = "https://kyc-api.surepass.io/api/v1/voter-id/voter-id";
          requestBody = { id_number: documentNumber };
          break;
        case "driving_license":
          endpoint = "https://kyc-api.surepass.io/api/v1/dl/driving-license";
          requestBody = { id_number: documentNumber };
          break;
        case "uan":
          endpoint = "https://kyc-api.surepass.io/api/v1/uan/uan";
          requestBody = { id_number: documentNumber };
          break;
        case "bank_account":
          endpoint =
            "https://kyc-api.surepass.io/api/v1/bank-verification/account";
          requestBody = {
            account_number: documentNumber,
            ifsc: documentNumber.includes("-")
              ? documentNumber.split("-")[1]
              : "",
          };
          break;
        default:
          throw new Error("Unsupported document type");
      }

      const response = await axios.post(endpoint, requestBody, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUREPASS_API_KEY}`,
        },
      });

      const data = response.data;
      const success = data.success === true || data.status_code === 200;

      return {
        success,
        data: data,
        message: success ? "Verification successful" : "Verification failed",
      };
    } catch (error) {
      console.error("Surepass API error:", error);

      return {
        success: false,
        error: error.message || "Verification service unavailable",
        message: "Verification failed",
      };
    }
  }
};
