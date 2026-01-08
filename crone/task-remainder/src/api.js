// import { jsPDF } from "jspdf";
// import autoTable from "jspdf-autotable";
// import nodemailer from "nodemailer";
// import dayjs from "dayjs";

// export default {
//   id: "dailytask",
//   handler: async (_options, { services, logger, getSchema, env }) => {
//     const { ItemsService } = services;
//     const schema = await getSchema();

//     const today = dayjs().format("YYYY-MM-DD");
//     const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
//     console.log("📧 Yesterday:", yesterday);
//     console.log("📧 Today:", today);

//     const tenantService = new ItemsService("tenant", { schema });
//     const userService = new ItemsService("personalModule", { schema });
//     const taskService = new ItemsService("tasks", { schema });

//     const tenants = await tenantService.readByQuery({
//       fields: ["tenantId", "tenantName"],
//     });

//     for (const tenant of tenants) {
//       const tenantId = tenant.tenantId;
//       const tenantName = tenant.tenantName;

//       const adminsRes = await userService.readByQuery({
//         filter: {
//           _and: [
//             { assignedUser: { tenant: { tenantId: { _eq: tenantId } } } },
//             { assignedUser: { role: { name: { _eq: "Admin" } } } },
//             { assignedUser: { userApp: { _eq: "fieldops" } } },
//           ],
//         },
//         fields: [
//           "assignedUser.email",
//           "assignedUser.phone",
//           "assignedUser.first_name",
//         ],
//       });

//       const adminUsers = adminsRes || [];

//       if (!adminUsers.length) {
//         logger.info(
//           `🚫 No fieldops Admin users found for tenant: ${tenantName}`
//         );
//         continue;
//       }

//       const taskRes = await taskService.readByQuery({
//         filter: {
//           _and: [
//             {
//               employeeId: {
//                 assignedUser: {
//                   tenant: {
//                     tenantId: { _eq: tenantId },
//                   },
//                 },
//               },
//             },
//             {
//               from: { _between: [yesterday, today] },
//               status: { _in: ["completed", "overdue", "inprocess"] },
//             },
//           ],
//         },
//         fields: [
//           "title",
//           "status",
//           "dueTime",
//           "from",
//           "employeeId.assignedUser.first_name",
//           "orgId.orgName",
//           "orgId.orgAddress",
//           "prodName.productName",
//         ],
//       });

//       const tasks = taskRes || [];

//       if (!tasks.length) {
//         logger.info(`📭 No tasks to report for tenant: ${tenantName}`);
//         continue;
//       }

//       const doc = new jsPDF();
//       doc.text(`Daily Task Report - ${tenantName}`, 10, 10);

//       autoTable(doc, {
//         startY: 20,
//         head: [["Title", "Status", "Due", "From", "User"]],
//         body: tasks.map((t) => [
//           t.title,
//           t.status,
//           t.dueTime || "-",
//           t.from || "-",
//           t.employeeId?.assignedUser?.first_name || "—",
//         ]),
//       });

//       const pdfBuffer = doc.output("arraybuffer");

//       for (const admin of adminUsers) {
//         const email = admin.assignedUser?.email;
//         const phone = admin.assignedUser?.phone;

//         if (email) {
//           await sendEmail({
//             to: email,
//             subject: `📋 ${tenantName} Task Report - ${today}`,
//             pdfBuffer,
//             from: env.EMAIL_USERNAME,
//             tenantName,
//             today,
//           });
//           logger.info(`📧 Email sent to ${email}`);
//         }

//         if (phone) {
//           const message = `Sensen Task Report for ${tenantName} dated ${today} is sent to your email.`;
//           await sendSMS(phone, message);
//           await sendWhatsApp(phone, tenantName, today);
//           logger.info(`📱 SMS and 💬 WhatsApp sent to ${phone}`);
//         }
//       }
//     }
//   },
// };

// // ========== 📧 EMAIL FUNCTION ==========
// async function sendEmail({ to, subject, pdfBuffer, from, tenantName, today }) {
//   const transporter = nodemailer.createTransport({
//     service: "gmail",
//     auth: {
//       user: "iwinxdigitaltechnologies@gmail.com",
//       pass: "uoav ukqz ycjq vskn",
//     },
//   });

//   const htmlBody = `
//     <p>Dear Team,</p>
//     <p>Please find attached the <strong>Daily Task Report</strong> for <strong>${tenantName}</strong> dated <strong>${today}</strong>.</p>
//     <p>Summary includes task title, status, timing, and assigned personnel.</p>
//     <p>For any queries, please contact the operations team.</p>
//     <br />
//     <p>Regards,<br/><strong>Sensen Team</strong></p>
//   `;

//   await transporter.sendMail({
//     from: `"Sensen Reports" <${from}>`,
//     to,
//     subject,
//     text: `Daily Task Report for ${tenantName} - ${today} is attached.`,
//     html: htmlBody,
//     attachments: [
//       {
//         filename: `TaskReport_${tenantName}_${today}.pdf`,
//         content: Buffer.from(pdfBuffer),
//       },
//     ],
//   });
// }

// // ========== 📱 SMS FUNCTION (MOCK) ==========
// async function sendSMS(phone, message) {
//   console.log(`📱 (Mock) Sending SMS to ${phone}: ${message}`);
//   // TODO: Replace with real provider like MSG91, Twilio, etc.
// }

// // ========== 💬 WHATSAPP FUNCTION (MOCK) ==========
// async function sendWhatsApp(phone, tenantName, today) {
//   const message = `Hello 👋,

// Here is your *Daily Task Report* for *${tenantName}* dated *${today}*.

// 📎 The report has been emailed to you in PDF format.

// Please review it and contact the Sensen Ops team for queries.

// Thanks,
// Team Sensen`;

//   console.log(`💬 (Mock) Sending WhatsApp to ${phone}: ${message}`);
//   // TODO: Integrate with Twilio WhatsApp / Gupshup here
// }
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import nodemailer from "nodemailer";
import dayjs from "dayjs";
import fetch from "node-fetch";

export default {
  id: "dailytask",
  handler: async (_options, { services, logger, getSchema, env }) => {
    const { ItemsService } = services;
    const schema = await getSchema();

    const today = dayjs().format("YYYY-MM-DD");
    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");

    const tenantService = new ItemsService("tenant", { schema });
    const userService = new ItemsService("personalModule", { schema });
    const taskService = new ItemsService("tasks", { schema });

    const tenants = await tenantService.readByQuery({
      fields: ["tenantId", "tenantName"],
    });

    for (const tenant of tenants) {
      const tenantId = tenant.tenantId;
      const tenantName = tenant.tenantName;

      const adminsRes = await userService.readByQuery({
        filter: {
          _and: [
            { assignedUser: { tenant: { tenantId: { _eq: tenantId } } } },
            { assignedUser: { role: { name: { _eq: "Admin" } } } },
            { assignedUser: { userApp: { _eq: "fieldops" } } },
          ],
        },
        fields: [
          "assignedUser.email",
          "assignedUser.phone",
          "assignedUser.first_name",
        ],
      });

      const adminUsers = adminsRes || [];

      if (!adminUsers.length) {
        logger.info(
          `🚫 No fieldops Admin users found for tenant: ${tenantName}`
        );
        continue;
      }

      const taskRes = await taskService.readByQuery({
        filter: {
          _and: [
            {
              employeeId: {
                assignedUser: {
                  tenant: {
                    tenantId: { _eq: tenantId },
                  },
                },
              },
            },
            {
              from: { _between: [yesterday, today] },
              status: { _in: ["completed", "overdue", "inprocess"] },
            },
          ],
        },
        fields: [
          "title",
          "status",
          "dueTime",
          "from",
          "employeeId.assignedUser.first_name",
          "orgId.orgName",
          "orgId.orgAddress",
          "prodName.productName",
        ],
      });

      const tasks = taskRes || [];

      if (!tasks.length) {
        logger.info(`📭 No tasks to report for tenant: ${tenantName}`);
        continue;
      }

      // === Generate PDF for email only ===
      const doc = new jsPDF();
      doc.text(`Daily Task Report - ${tenantName}`, 10, 10);

      autoTable(doc, {
        startY: 20,
        head: [["Title", "Status", "Due", "From", "User"]],
        body: tasks.map((t) => [
          t.title,
          t.status,
          t.dueTime || "-",
          t.from || "-",
          t.employeeId?.assignedUser?.first_name || "—",
        ]),
      });

      const pdfBuffer = doc.output("arraybuffer");

      // === Send to all Admin users ===
      for (const admin of adminUsers) {
        const email = admin.assignedUser?.email;
        const phone = admin.assignedUser?.phone;

        if (email) {
          await sendEmail({
            to: email,
            subject: `📋 ${tenantName} Task Report - ${today}`,
            pdfBuffer,
            from: env.EMAIL_USERNAME,
            tenantName,
            today,
          });
          logger.info(`📧 Email sent to ${email}`);
        }

        if (phone) {
          const msg = `Sensen Task Report for ${tenantName} dated ${today} has been sent to your registered email.`;
          await sendSMS(phone, msg);
          await sendWhatsAppTemplate(phone, tenantName, today, msg);
          logger.info(`📱 SMS and 💬 WhatsApp sent to ${phone}`);
        }
      }
    }
  },
};

// ========== 📧 EMAIL FUNCTION ==========
async function sendEmail({ to, subject, pdfBuffer, from, tenantName, today }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "fieldopsbysenzr@gmail.com",
      pass: "nsdy pgax pziz gazm",
    },
  });

  const htmlBody = `
    <p>Dear Team,</p>
    <p>Please find attached the <strong>Daily Task Report</strong> for <strong>${tenantName}</strong> dated <strong>${today}</strong>.</p>
    <p>This report includes completed, pending, and in-process tasks, along with timing and assigned personnel.</p>
    <br />
    <p>Regards,<br/><strong>Sensen Team</strong></p>
  `;

  await transporter.sendMail({
    from: `"Sensen Reports" <${from}>`,
    to,
    subject,
    text: `Daily Task Report for ${tenantName} - ${today} is attached.`,
    html: htmlBody,
    attachments: [
      {
        filename: `TaskReport_${tenantName}_${today}.pdf`,
        content: Buffer.from(pdfBuffer),
      },
    ],
  });
}

// ========== 📱 MSG91 SMS FUNCTION (FLOW API) ==========
async function sendSMS(phone, tenantName, today, taskCount) {
  const apiKey = "464131A0Rz2wIpy689a1409P1";
  const templateId = "689dc00be8b00007ec767993";

  const payload = {
    template_id: templateId,
    short_url: "0",
    realTimeResponse: "1",
    recipients: [
      {
        mobiles: `91${phone}`,
        VAR1: tenantName,
        VAR2: today,
        VAR3: taskCount,
      },
    ],
  };

  try {
    const res = await fetch(`https://control.msg91.com/api/v5/flow`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authkey: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    console.log("📱 SMS Response:", result);
  } catch (err) {
    console.error("❌ SMS error:", err);
  }
}

// ========== 💬 MSG91 WHATSAPP TEMPLATE FUNCTION ==========
async function sendWhatsAppTemplate(phone, tenantName, today, message) {
  const apiKey = "464131A0Rz2wIpy689a1409P1";
  const integratedNumber = "+919344297569";
  const templateName = `${tenantName} daily_task_report`;
  const language = "en";

  const payload = {
    integrated_number: integratedNumber,
    recipient_number: `+91${phone}`,
    type: "template",
    template_name: templateName,
    language,
    variables: ["Team", today, message],
  };

  try {
    const res = await fetch(
      "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authkey: apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await res.json();
    console.log("💬 WhatsApp Template Response:", result);
  } catch (err) {
    console.error("❌ WhatsApp Template Error:", err);
  }
}
