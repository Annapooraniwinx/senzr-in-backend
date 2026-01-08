import { randomUUID } from "crypto";
import nodemailer from "nodemailer";

export default (router, { services }) => {
  const { ItemsService } = services;

  router.post("/generate-session", async (req, res) => {
    console.log("📩 [REQUEST RECEIVED] /generate-session");

    try {
      const { email, userApp } = req.body;
      console.log("🧠 [INPUT DATA]", { email, userApp });

      if (!email || !userApp) {
        console.log("⚠️ Missing email or userApp in request body");
        return res.status(400).json({ error: "Missing email or userApp" });
      }

      // Step 1: Initialize service for 'personalModule'
      const personalService = new ItemsService("personalModule", {
        schema: req.schema,
      });

      console.log(
        "🔍 [STEP 1] Searching personalModule for matching assignedUser..."
      );

      // Step 2: Find record by assignedUser.email + assignedUser.userApp
      const records = await personalService.readByQuery({
        filter: {
          _and: [
            { assignedUser: { email: { _eq: email } } },
            { assignedUser: { userApp: { _eq: userApp } } },
          ],
        },
        fields: [
          "id",
          "assignedUser.id",
          "assignedUser.email",
          "assignedUser.userApp",
          "assignedUser.otp_session_uuid",
        ],
        limit: 1,
      });

      if (!records || records.length === 0) {
        console.log("❌ [NOT FOUND] No matching assignedUser found ", records);
        return res
          .status(404)
          .json({ message: "User not found in personalModule" });
      }

      const record = records[0];
      const personalModuleId = record.id;
      const assignedUserId = record.assignedUser?.id;

      if (!assignedUserId) {
        console.log("⚠️ [MISSING] assignedUser.id not found in record");
        return res.status(404).json({ message: "Assigned user ID missing" });
      }

      console.log("✅ [FOUND] assignedUser found:", {
        personalModuleId,
        assignedUserId,
        email: record.assignedUser.email,
      });

      // Step 3: Generate UUID + OTP
      const session_uuid = randomUUID();
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      console.log("🆔 [STEP 2] Generated UUID:", session_uuid);
      console.log("🔢 [STEP 3] Generated OTP:", otpCode);

      // Step 4: Update assignedUser inside personalModule
      const payload = {
        assignedUser: {
          id: assignedUserId,
          otp_session_uuid: session_uuid,
          otp: otpCode,
        },
      };

      await personalService.updateOne(personalModuleId, payload);

      // Step 5: Email setup (using Gmail)
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: "fieldopsbysenzr@gmail.com",
          pass: "nsdy pgax pziz gazm",
        },
      });

      // Step 6: Styled HTML email (Fieldseasy theme 💙)
      const mailOptions = {
        from: '"Fieldseasy" <fieldopsbysenzr@gmail.com>',
        to: email,
        subject: "Your Fieldseasy OTP Code",
        html: `
        <div style="background-color:#122f68; padding:40px; font-family:Arial, sans-serif;">
          <div style="max-width:480px; margin:0 auto; background:#0f2a57; border:1px solid #2a4a8a; border-radius:8px; padding:24px; color:#d7e3ff;">
            
            <div style="text-align:center;">
              <div style="width:60px;height:60px;background:linear-gradient(135deg,#5b7fff,#4dd6c2);
                bordepermanently deleter-radius:50%;display:inline-flex;align-items:center;justify-content:center;">
                <span style="color:white;font-size:26px;font-weight:bold;"></span>
              </div>
              <h2 style="margin-top:12px;color:#d7e3ff;">Fieldseasy</h2>
              <p style="color:#b9d1ff;font-size:14px;">Your Workforce Management Solution</p>
            </div>

            <div style="margin-top:30px;font-size:16px;line-height:1.6;">
              <p>Hello,</p>
              <p>We received a request to sign in to your Fieldseasy account.</p>
              <p>Please use the OTP below to continue:</p>
              <div style="background:linear-gradient(135deg,#5b7fff,#4dd6c2);
                color:#fff;font-size:28px;font-weight:bold;text-align:center;
                padding:16px;border-radius:8px;margin:20px 0;">
                ${otpCode}
              </div>
              <p>This OTP is valid for 10 minutes. Do not share this code with anyone.</p>
            </div>

            <div style="text-align:center;margin-top:30px;color:#b9d1ff;font-size:12px;">
              © 2025 Fieldseasy • <a href="https://fieldseasy.com" style="color:#5b7fff;text-decoration:none;">fieldseasy.com</a>
            </div>
          </div>
        </div>`,
      };

      // Step 7: Send email
      await transporter.sendMail(mailOptions);
      console.log(`📧 OTP email sent successfully to ${email}`);

      // Step 8: Final response
      return res.status(200).json({
        message: "OTP generated, saved, and sent successfully",
        otp_session_uuid: session_uuid,
        otpCode: otpCode,
      });
    } catch (err) {
      console.error(
        "💥 [EXCEPTION] Error generating session UUID or sending email:",
        err
      );
      res.status(500).json({
        error: "Internal Server Error",
        details: err.message,
      });
    }
  });
};
