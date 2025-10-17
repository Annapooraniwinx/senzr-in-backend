import fetch from "node-fetch";
import nodemailer from "nodemailer";

export default (router, { services }) => {
  const { ItemsService } = services;

  // ------------------ 1️⃣ SEND FORGOT PIN OTP ------------------
  router.post("/forgot-pin", async (req, res) => {
    try {
      const { phone, email, userApp } = req.body;
      console.log("📩 [REQUEST] /forgot-pin", { phone, email, userApp });

      if ((!phone && !email) || !userApp) {
        return res
          .status(400)
          .json({ error: "Missing phone/email or userApp" });
      }

      const personalService = new ItemsService("personalModule", {
        schema: req.schema,
      });

      // Step 1️⃣ — Find user
      let filter = { _and: [{ assignedUser: { userApp: { _eq: userApp } } }] };
      if (phone) filter._and.push({ assignedUser: { phone: { _eq: phone } } });
      if (email) filter._and.push({ assignedUser: { email: { _eq: email } } });

      const records = await personalService.readByQuery({
        filter,
        fields: [
          "id",
          "assignedUser.id",
          "assignedUser.email",
          "assignedUser.phone",
          "assignedUser.userApp",
        ],
        limit: 1,
      });

      if (!records || records.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const record = records[0];
      const personalModuleId = record.id;
      const assignedUserId = record.assignedUser.id;

      // Step 2️⃣ — Generate OTP
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      console.log("🔢 [OTP GENERATED]:", otpCode);

      // Step 3️⃣ — Save OTP
      const payload = {
        assignedUser: {
          id: assignedUserId,
          otp: otpCode,
        },
      };
      await personalService.updateOne(personalModuleId, payload);

      // Step 4️⃣ — Dynamic branding
      const appName =
        userApp?.toLowerCase() === "fieldops" ? "FieldOps" : "Fieldseasy";
      // Step 5️⃣ — Send OTP via Email or SMS
      if (email) {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: "fieldopsbysenzr@gmail.com",
            pass: "gokz sdtc zbnm dmep",
          },
        });

        const mailOptions = {
          from: `"${appName}" <fieldopsbysenzr@gmail.com>`,
          to: email,
          subject: `${appName} Forgot PIN OTP`,
          html: `
          <div style="background-color:#122f68; padding:40px; font-family:Arial, sans-serif;">
            <div style="max-width:480px; margin:0 auto; background:#0f2a57; border:1px solid #2a4a8a; border-radius:8px; padding:24px; color:#d7e3ff;">
              <div style="text-align:center;">
                <div style="width:60px;height:60px;background:linear-gradient(135deg,#5b7fff,#4dd6c2);
                  border-radius:50%;display:inline-flex;align-items:center;justify-content:center;"></div>
                <h2 style="margin-top:12px;color:#d7e3ff;">${appName}</h2>
                <p style="color:#b9d1ff;font-size:14px;">Forgot PIN Verification</p>
              </div>
              <div style="margin-top:30px;font-size:16px;line-height:1.6;">
                <p>Hello,</p>
                <p>Use the OTP below to reset your ${appName} PIN:</p>
                <div style="background:linear-gradient(135deg,#5b7fff,#4dd6c2);
                  color:#fff;font-size:28px;font-weight:bold;text-align:center;
                  padding:16px;border-radius:8px;margin:20px 0;">
                  ${otpCode}
                </div>
                <p>This OTP is valid for 10 minutes. Do not share it with anyone.</p>
              </div>
            ""
          )}</a>
              </div>
            </div>
          </div>`,
        };

        await transporter.sendMail(mailOptions);
        console.log(`📧 OTP sent via email to ${email}`);
      } else if (phone) {
        const smsBody = {
          template_id: "68ef54f8352db42ab01fa2c5",
          short_url: "1",
          realTimeResponse: "1",
          recipients: [
            {
              mobiles: phone.replace("+", ""),
              var1: otpCode,
            },
          ],
        };

        const response = await fetch("https://api.msg91.com/api/v5/flow/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authkey: "472414ALslxcGmklr68ea0c2cP1",
            accept: "application/json",
          },
          body: JSON.stringify(smsBody),
        });

        const smsResult = await response.json();
        console.log("📨 [MSG91 RESPONSE]:", smsResult);

        if (
          !smsResult ||
          smsResult.type === "error" ||
          smsResult.status === "failure"
        ) {
          return res
            .status(500)
            .json({ message: "Failed to send OTP via MSG91", smsResult });
        }
      }

      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
      });
    } catch (err) {
      console.error("💥 [ERROR] /forgot-pin:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ------------------ 2️⃣ VERIFY FORGOT PIN OTP ------------------
  router.post("/verify-forgotpin-otp", async (req, res) => {
    try {
      const { phone, email, otp } = req.body;
      console.log("📩 [REQUEST] /verify-forgotpin-otp", { phone, email, otp });

      if ((!phone && !email) || !otp) {
        return res.status(400).json({ error: "Missing phone/email or OTP" });
      }

      const personalService = new ItemsService("personalModule", {
        schema: req.schema,
      });

      // Step 1️⃣ — Find record with matching OTP
      let filter = { _and: [{ assignedUser: { otp: { _eq: otp } } }] };
      if (phone) filter._and.push({ assignedUser: { phone: { _eq: phone } } });
      if (email) filter._and.push({ assignedUser: { email: { _eq: email } } });

      const records = await personalService.readByQuery({
        filter,
        fields: ["id", "assignedUser.id"],
        limit: 1,
      });

      if (!records || records.length === 0) {
        return res.status(401).json({ success: false, message: "Invalid OTP" });
      }

      // Step 2️⃣ — Clear OTP
      const record = records[0];
      const payload = {
        assignedUser: { id: record.assignedUser.id, otp: null },
      };
      await personalService.updateOne(record.id, payload);

      return res
        .status(200)
        .json({ success: true, message: "OTP verified successfully" });
    } catch (err) {
      console.error("💥 [ERROR] /verify-forgotpin-otp:", err);
      res.status(500).json({ error: err.message });
    }
  });
};
