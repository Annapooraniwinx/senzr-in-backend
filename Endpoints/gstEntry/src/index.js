import axios from "axios";

export default function registerEndpoint(router) {
  router.post("/", async (req, res) => {
    const { gst_number } = req.body;

    if (!gst_number || gst_number.length !== 15) {
      return res.status(400).json({
        success: false,
        message: "Invalid GST number. It should be exactly 15 characters.",
        status_code: 400,
        data: null,
      });
    }

    const SUREPASS_URL = "https://kyc-api.surepass.app/api/v1/corporate/gstin";
    const BEARER_TOKEN =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc1NTMyMzYxNCwianRpIjoiMTQxZDgzZTktYWZiZS00ZjlhLTkyNGEtZjc4MzdhMTJjYjQzIiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmVzc2xAc3VyZXBhc3MuaW8iLCJuYmYiOjE3NTUzMjM2MTQsImV4cCI6MjM4NjA0MzYxNCwiZW1haWwiOiJlc3NsQHN1cmVwYXNzLmlvIiwidGVuYW50X2lkIjoibWFpbiIsInVzZXJfY2xhaW1zIjp7InNjb3BlcyI6WyJ1c2VyIl19fQ.kJXugMT6WOZ9s4W_lt8QUFXc7RYzqjbRmraHuipu978";

    try {
      const response = await axios.post(
        SUREPASS_URL,
        { id_number: gst_number },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${BEARER_TOKEN}`,
          },
        }
      );

      const responseData = response.data;

      return res.status(200).json({
        success: true,
        message: "GST details retrieved successfully",
        status_code: 200,
        data: responseData.data,
        meta: {
          gst_number,
          message_code: responseData.message_code,
          api_status: responseData.success,
        },
      });
    } catch (error) {
      console.error(
        "GST Verification Error:",
        error.response?.data || error.message
      );

      if (error.response) {
        return res.status(error.response.status).json({
          success: false,
          message:
            error.response.data?.message || "Failed to verify GST number",
          status_code: error.response.status,
          data: null,
          error_details: error.response.data,
        });
      } else if (error.request) {
        return res.status(500).json({
          success: false,
          message: "Network error occurred while verifying GST",
          status_code: 500,
          data: null,
        });
      } else {
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          status_code: 500,
          data: null,
        });
      }
    }
  });
}
