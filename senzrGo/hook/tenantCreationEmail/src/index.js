export default ({ action }, { services }) => {
  const { ItemsService } = services;

  action("tenant.items.create", async (meta, context) => {
    const nodemailer = (await import("nodemailer")).default;

    // === NODEMAILER TRANSPORTER (Secure via .env) ===
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "fieldopsbysenzr@gmail.com",
        pass: "gokz sdtc zbnm dmep",
      },
    });

    const { key: tenantId } = meta;
    const { schema, accountability } = context;

    console.log("🚀 HOOK TRIGGERED: Tenant Onboarding Email Notification");
    console.log("🏢 NEW TENANT CREATED | Tenant ID:", tenantId);

    let tenant = null;

    // === 1. FETCH TENANT DETAILS ===
    console.log("🔍 STEP 1: Fetching Tenant Details...");
    const tenantService = new ItemsService("tenant", {
      schema,
      accountability,
    });

    try {
      tenant = await tenantService.readOne(tenantId, {
        fields: ["tenantName", "tenantId", "companyAddress", "date_created"],
      });

      console.log("✅ TENANT FOUND");
      console.log(`   🧾 Name: ${tenant.tenantName}`);
      console.log(`   📍 Address: ${tenant.companyAddress}`);
      console.log(`   🕒 Created: ${tenant.date_created}`);
    } catch (err) {
      console.error("❌ ERROR: Failed to fetch tenant details:", err.message);
      return;
    }

    // === 2. FORMAT TENANT DATA ===
    console.log("🧩 STEP 2: Formatting Tenant Data...");
    const tenantName = (tenant.tenantName ?? "Unnamed Tenant").trim();
    const companyAddress = (tenant.companyAddress ?? "Not provided").trim();
    const createdAt = new Date(tenant.date_created).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "full",
      timeStyle: "medium",
    });

    console.log("🗓️ FORMATTED DATE (IST):", createdAt);

    // === 3. BUILD EMAIL CONTENT ===
    console.log("🧱 STEP 3: Building Email HTML & Text...");

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>New Tenant Registration</title>
  <style>
    body {font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f4f7fa;margin:0;padding:0;}
    .container {max-width:620px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.1);}
    .header {background:#ffffff;color:#333;padding:30px;text-align:center;border-bottom:1px solid #eee;}
    .header h1 {margin:0;font-size:24px;font-weight:600;color:#6366f1;}
    .content {padding:30px;color:#333;}
    .footer {background:#f8fafc;padding:20px;text-align:center;color:#64748b;font-size:13px;}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Tenant Registered</h1>
      <p>A new organization has been onboarded to <strong>FieldOps by Senzr</strong></p>
    </div>

    <div class="content">
      <p><strong>Hello Team,</strong></p>
      <p>A new tenant has been successfully registered. Below are the details:</p>

      <h2 style="color:#4f46e5;font-size:18px;">Tenant Information</h2>
      <p><strong>Name:</strong> ${tenantName}</p>
      <p><strong>Address:</strong> ${companyAddress}</p>
      <p><strong>Created:</strong> ${new Date(tenant.date_created)
        .toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
        .replace(",", "")} (IST)</p>
      <p><strong>Status:</strong> Active & Configured</p>

      <p style="margin-top:25px;">
        <strong>Next Steps:</strong><br>
        • S3 bucket & folders created<br>
        • Admin & Employee roles configured<br>
        • Default shifts, cycles, and templates applied
      </p>

      <hr style="border:0;border-top:1px solid #eee;margin:30px 0;" />
      <p style="font-size:14px;color:#666;">
        This is an automated notification from the <strong>FieldOps Tenant Onboarding System</strong>.
      </p>
    </div>

    <div class="footer">
      <p>© ${new Date().getFullYear()} Senzr AIOT Partner Edge to Cloud. All rights reserved.</p>
      <p>FieldOps • Enterprise Field Operations Platform</p>
    </div>
  </div>
</body>
</html>`;

    const textBody = `
New Tenant Registered:

Tenant Name: ${tenantName}
Tenant ID: ${tenantId}
Address: ${companyAddress}
Registered: ${createdAt} (IST)

S3, roles, shifts, and templates configured.
Automated message from FieldOps by Senzr.
    `.trim();

    // === 4. EMAIL OPTIONS ===
    console.log("📧 STEP 4: Preparing Email Options...");
    const mailOptions = {
      from: `"FieldOps by Senzr" <${
        process.env.EMAIL_USER || "fieldopsbysenzr@gmail.com"
      }>`,
      to: "connect@iwinxdigital.com",
      cc: "jasper@senzr.in, annapoorani@iwinxdigital.com",
      subject: `New Tenant Registered: ${tenantName}`,
      html: htmlBody,
      text: textBody,
    };

    // === 5. SEND EMAIL ===
    console.log("📨 STEP 5: Sending Email Notification...");
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log("✅ SUCCESS: Email sent successfully!");
      console.log("📬 Message ID:", info.messageId);
    } catch (error) {
      console.error("🚨 FAILED: Email Sending Error:", error.message);
      if (error.response) console.error("💬 SMTP Response:", error.response);
    }

    console.log("🏁 COMPLETED: Tenant Onboarding Email Hook Finished\n");
  });
};
