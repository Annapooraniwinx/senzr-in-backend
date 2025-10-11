import { randomUUID } from "crypto";
import fetch from "node-fetch";

export default (router, { services }) => {
  const { ItemsService } = services;

  // ------------------ 1️⃣ SEND OTP ------------------
  router.post("/", async (req, res) => {
    try {
      const { phone, userApp } = req.body;

      console.log("📩 [REQUEST] /send-otp", { phone, userApp });

      if (!phone || userApp !== "fieldeasy") {
        return res
          .status(400)
          .json({ error: "Missing phone or invalid userApp" });
      }

      // Step 1: Find user by phone + userApp
      const personalService = new ItemsService("personalModule", {
        schema: req.schema,
      });

      const records = await personalService.readByQuery({
        filter: {
          _and: [
            { assignedUser: { phone: { _eq: phone } } },
            { assignedUser: { userApp: { _eq: userApp } } },
          ],
        },
        fields: [
          "id",
          "assignedUser.id",
          "assignedUser.phone",
          "assignedUser.userApp",
        ],
        limit: 1,
      });

      if (!records || records.length === 0) {
        return res
          .status(404)
          .json({ message: "User not found in personalModule" });
      }

      const record = records[0];
      const personalModuleId = record.id;
      const assignedUserId = record.assignedUser.id;

      // Step 2: Generate OTP and session UUID
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const session_uuid = randomUUID();

      console.log("🔢 Generated OTP:", otpCode);
      console.log("🆔 Session UUID:", session_uuid);

      // Step 3: Prepare body for MSG91 Flow API ✅ (Correct format)
      const smsBody = {
        template_id: "68e9f1bb04a89d56bb105bd8",
        short_url: "1",
        realTimeResponse: "1",
        recipients: [
          {
            mobiles: phone.replace("+", ""),
            var1: otpCode,
          },
        ],
      };

      console.log("📤 [MSG91 REQUEST BODY]:", JSON.stringify(smsBody, null, 2));

      // Step 4: Send OTP via MSG91 Flow API ✅
      const response = await fetch("https://api.msg91.com/api/v5/flow/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: "472414ALslxcGmklr68ea0c2cP1",
          accept: "application/json",
        },
        body: JSON.stringify(smsBody),
      });

      console.log("📡 [MSG91 STATUS]:", response.status);

      const smsResult = await response.json();
      console.log("📨 [MSG91 RESPONSE]:", JSON.stringify(smsResult, null, 2));

      // Step 5: Check for successful send
      if (
        !smsResult ||
        smsResult.type === "error" ||
        smsResult.status === "failure" ||
        smsResult.message?.toLowerCase()?.includes("error")
      ) {
        console.error("❌ Failed to send OTP:", smsResult);
        return res.status(500).json({
          success: false,
          message: "Failed to send OTP. Please try again.",
          msg91Response: smsResult,
        });
      }

      // Step 6: Save OTP + UUID in assignedUser
      const payload = {
        assignedUser: {
          id: assignedUserId,
          otp_session_uuid: session_uuid,
          otp: otpCode,
        },
      };

      await personalService.updateOne(personalModuleId, payload);

      return res.status(200).json({
        message: "OTP sent successfully via MSG91",
        otp_session_uuid: session_uuid,
      });
    } catch (err) {
      console.error("💥 [ERROR] /send-otp:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------ 2️⃣ VERIFY OTP ------------------
  router.post("/verify-otp", async (req, res) => {
    try {
      const { phone, otp, otp_session_uuid } = req.body;

      console.log("📩 [REQUEST] /verify-otp", { phone, otp, otp_session_uuid });

      if (!phone || !otp || !otp_session_uuid) {
        return res
          .status(400)
          .json({ error: "Missing phone, otp, or session" });
      }

      const personalService = new ItemsService("personalModule", {
        schema: req.schema,
      });

      // Step 1: Find matching record
      const records = await personalService.readByQuery({
        filter: {
          _and: [
            { assignedUser: { phone: { _eq: phone } } },
            { assignedUser: { otp_session_uuid: { _eq: otp_session_uuid } } },
            { assignedUser: { otp: { _eq: otp } } },
          ],
        },
        fields: ["id", "assignedUser.id"],
        limit: 1,
      });

      if (!records || records.length === 0) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid OTP or session" });
      }

      // Step 2: Clear OTP after success
      const record = records[0];
      const payload = {
        assignedUser: {
          id: record.assignedUser.id,
          otp: null,
        },
      };

      await personalService.updateOne(record.id, payload);

      return res
        .status(200)
        .json({ success: true, message: "OTP verified successfully" });
    } catch (err) {
      console.error("💥 [ERROR] /verify-otp:", err);
      res.status(500).json({ error: err.message });
    }
  });
};
