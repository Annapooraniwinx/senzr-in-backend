import nodemailer from "nodemailer";

export default function registerEndpoint(router) {
  // =========================
  // 1. SEND OTP / HAPPY CODE
  // =========================
  router.post("/", async (req, res) => {
    try {
      const { to, subject, text, auth } = req.body;

      if (!to || !subject || !text || !auth?.user || !auth?.pass) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
          status_code: 400,
          data: null,
        });
      }

      // Create transporter
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: auth.user,
          pass: auth.pass,
        },
      });

      // Detect code type
      const codeType = subject.includes("Happy Code")
        ? "Happy Code"
        : "OTP Code";
      const code = text.split(":")[1]?.trim();

      // Email HTML template
      const htmlTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 20px; border-radius: 10px; border: 1px solid #ddd; background: #f9f9f9;">
          <h2 style="text-align: center; color: #333;">🔒 ${codeType}</h2>
          <p style="font-size: 16px; color: #555;">Dear User,</p>
          <p style="font-size: 16px; color: #555;">
            Your <strong>${codeType}</strong> is:
          </p>
          <h1 style="text-align: center; color: #2c7be5; letter-spacing: 3px;">${code}</h1>
          <p style="font-size: 14px; color: #888; text-align: center;">
            ⚠️ Please do not share this code with anyone.
          </p>
          <p style="margin-top: 20px; font-size: 14px; color: #444;">
            Regards,<br/>Your Security Team
          </p>
        </div>
      `;

      // Send mail
      await transporter.sendMail({
        from: `"Security System" <${auth.user}>`,
        to,
        subject,
        text,
        html: htmlTemplate,
      });

      return res.status(200).json({
        success: true,
        message: `${codeType} sent successfully`,
        status_code: 200,
        data: { to, subject, codeType },
      });
    } catch (error) {
      console.error("Email Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to send email",
        status_code: 500,
        data: null,
        error_details: error.message,
      });
    }
  });

  // =========================
  // 2. TASK COMPLETION FLOW
  // =========================
  router.post("/task/complete", async (req, res) => {
    try {
      const {
        task_id,
        client_email,
        admin_email,
        employee_email,
        employee_name,
      } = req.body;

      if (
        !task_id ||
        !client_email ||
        !admin_email ||
        !employee_email ||
        !employee_name
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
          status_code: 400,
          data: null,
        });
      }

      // Log for DB update (replace with DB logic if needed)
      console.log(`Task ${task_id} marked as completed by ${employee_name}`);

      // Mail Transporter (uses env for credentials)
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.MAIL_USER,
          pass: process.env.MAIL_PASS,
        },
      });

      // HTML Template
      const htmlTemplate = (role, message) => `
        <div style="font-family: Arial; padding:20px; border:1px solid #ddd; border-radius:10px; background:#f9f9f9;">
          <h2 style="color:#2c7be5;">Task #${task_id} Completed</h2>
          <p>Hello ${role},</p>
          <p>${message}</p>
          <p><strong>Completed by:</strong> ${employee_name}</p>
          <p style="font-size:12px; color:#888;">${new Date().toISOString()}</p>
        </div>
      `;

      // Send mail to Client
      await transporter.sendMail({
        from: `"Task System" <${process.env.MAIL_USER}>`,
        to: client_email,
        subject: `Task #${task_id} Completed - Please Provide Feedback`,
        html: htmlTemplate(
          "Client",
          "The task has been completed. Please reply with your feedback (rating & comments)."
        ),
      });

      // Send mail to Employee
      await transporter.sendMail({
        from: `"Task System" <${process.env.MAIL_USER}>`,
        to: employee_email,
        subject: `Confirmation: Task #${task_id} Completed`,
        html: htmlTemplate(
          "Employee",
          "Your task completion has been recorded successfully."
        ),
      });

      // Send mail to Admin
      await transporter.sendMail({
        from: `"Task System" <${process.env.MAIL_USER}>`,
        to: admin_email,
        subject: `Task #${task_id} Completed by ${employee_name}`,
        html: htmlTemplate(
          "Admin",
          `The task was marked as completed by ${employee_name}.`
        ),
      });

      return res.status(200).json({
        success: true,
        message: "Task marked as completed and emails sent",
        status_code: 200,
        data: { task_id, employee_name, completed: true },
      });
    } catch (error) {
      console.error("Task Completion Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to mark task as completed or send emails",
        status_code: 500,
        error_details: error.message,
      });
    }
  });
}
