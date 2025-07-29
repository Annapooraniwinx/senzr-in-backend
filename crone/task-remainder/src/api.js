// // /src/api.js
// import { jsPDF } from "jspdf";
// import autoTable from "jspdf-autotable";
// import nodemailer from "nodemailer";
// import dayjs from "dayjs";

// export default {
//   id: "tenant-daily-task-report",
//   handler: async (_options, { services, logger, getSchema, env }) => {
//     const { ItemsService } = services;
//     const schema = await getSchema();

//     const today = dayjs().format("YYYY-MM-DD");
//     const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");

//     const tenantService = new ItemsService("tenant", { schema });
//     const userService = new ItemsService("personalModule", { schema });
//     const taskService = new ItemsService("tasks", { schema });

//     const tenants = await tenantService.readByQuery({
//       fields: ["tenantId", "tenantName"],
//     });

//     for (const tenant of tenants) {
//       const tenantId = tenant.tenantId;
//       const tenantName = tenant.tenantName;

//       // Get Admin users from personalModule for this tenant
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

//       // Get task data
//       const taskRes = await taskService.readByQuery({
//         filter: {
//           _and: [
//             {
//               assignedUser: {
//                 tenant: {
//                   tenantId: { _eq: "017de815-e5b3-4c9d-9c94-6a88dde014d9" },
//                 },
//               },
//             },
//             {
//               _or: [
//                 {
//                   dueTime: { _eq: yesterday },
//                   status: { _in: ["completed", "overdue"] },
//                 },
//                 {
//                   from: { _eq: today },
//                   status: { _eq: "inprocess" },
//                 },
//               ],
//             },
//           ],
//         },
//         fields: [
//           "title",
//           "status",
//           "dueTime",
//           "from",
//           "assignedUser.first_name",
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

//       // Generate PDF
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
//           t.assignedUser?.first_name || "—",
//         ]),
//       });

//       const pdfBuffer = doc.output("arraybuffer");

//       // Send email & SMS to each admin user
//       for (const admin of adminUsers) {
//         const email = admin.assignedUser?.email;
//         const phone = admin.assignedUser?.phone;

//         if (email) {
//           await sendEmail({
//             to: email,
//             subject: `📋 ${tenantName} Task Report - ${today}`,
//             pdfBuffer,
//             from: env.EMAIL_USERNAME,
//           });

//           logger.info(`📧 Email sent to ${email}`);
//         }

//         if (phone) {
//           await sendSMS(
//             phone,
//             `Sensen Task Report for ${today} is sent to your email.`
//           );
//           logger.info(`📱 SMS sent to ${phone}`);
//         }
//       }
//     }
//   },
// };

// // EMAIL SENDER
// async function sendEmail({ to, subject, pdfBuffer, from }) {
//   const transporter = nodemailer.createTransport({
//     service: "gmail",
//     auth: {
//       user: "iwinxdigitaltechnologies@gmail.com",
//       pass: "uoav ukqz ycjq vskn",
//     },
//   });

//   await transporter.sendMail({
//     from: `"Sensen Reports" <${from}>`,
//     to,
//     subject,
//     text: "Please find attached your daily task report.",
//     attachments: [
//       {
//         filename: "TaskReport.pdf",
//         content: Buffer.from(pdfBuffer),
//       },
//     ],
//   });
// }

// // MOCK SMS FUNCTION
// async function sendSMS(phone, message) {
//   console.log(`(Mock) Sending SMS to ${phone}: ${message}`);
//   // You can integrate Twilio, Gupshup, MSG91 here
// }

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import nodemailer from "nodemailer";
import dayjs from "dayjs";

export default {
  id: "dailytask",
  handler: async (_options, { services, getSchema, env }) => {
    const { ItemsService } = services;
    const schema = await getSchema();
    console.log("📦 schema:", schema, ItemsService);

    const today = dayjs().format("YYYY-MM-DD");
    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");

    console.log("📅 Today:", today);
    console.log("📅 Yesterday:", yesterday);

    const tenantService = new ItemsService("tenant", { schema });
    const userService = new ItemsService("personalModule", { schema });
    const taskService = new ItemsService("tasks", { schema });

    console.log("📦 Fetching tenants...");
    const tenants = await tenantService.readByQuery({
      fields: ["tenantId", "tenantName"],
    });

    for (const tenant of tenants) {
      const tenantId = tenant.tenantId;
      const tenantName = tenant.tenantName;

      console.log(`🏢 Processing Tenant: ${tenantName} (${tenantId})`);

      // Get Admin users from personalModule for this tenant
      console.log("👥 Fetching Admin users...");
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
        console.log(
          `🚫 No fieldops Admin users found for tenant: ${tenantName}`
        );
        continue;
      } else {
        console.log(`✅ Found ${adminUsers.length} admin user(s)`);
      }

      // Get task data
      console.log("📋 Fetching tasks...");
      const taskRes = await taskService.readByQuery({
        filter: {
          _and: [
            {
              tenant: {
                tenantId: { _eq: "017de815-e5b3-4c9d-9c94-6a88dde014d9" },
              },
            },
            {
              _or: [
                {
                  dueTime: { _eq: yesterday },
                  status: { _in: ["completed", "overdue"] },
                },
                {
                  from: { _eq: today },
                  status: { _eq: "inprocess" },
                },
              ],
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
        console.log(`📭 No tasks to report for tenant: ${tenantName}`);
        continue;
      }

      console.log(`📄 Generating PDF for ${tasks.length} task(s)...`);
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
      console.log("✅ PDF generated successfully");

      // Send email & SMS to each admin user
      for (const admin of adminUsers) {
        const email = admin.assignedUser?.email;
        const phone = admin.assignedUser?.phone;

        if (email) {
          console.log(`📧 Sending email to ${email}...`);
          await sendEmail({
            to: email,
            subject: `📋 ${tenantName} Task Report - ${today}`,
            pdfBuffer,
            from: env.EMAIL_USERNAME,
          });
          console.log(`✅ Email sent to ${email}`);
        }

        if (phone) {
          console.log(`📱 Sending SMS to ${phone}...`);
          await sendSMS(
            phone,
            `Sensen Task Report for ${today} is sent to your email.`
          );
          console.log(`✅ SMS sent to ${phone}`);
        }
      }
    }

    console.log("🏁 Report generation and notifications completed.");
  },
};

// EMAIL SENDER
async function sendEmail({ to, subject, pdfBuffer, from }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "iwinxdigitaltechnologies@gmail.com",
      pass: "uoav ukqz ycjq vskn",
    },
  });

  console.log("📨 Sending email with attachment...");
  await transporter.sendMail({
    from: `"Sensen Reports" <${from}>`,
    to,
    subject,
    text: "Please find attached your daily task report.",
    attachments: [
      {
        filename: "TaskReport.pdf",
        content: Buffer.from(pdfBuffer),
      },
    ],
  });
}

// MOCK SMS FUNCTION
async function sendSMS(phone, message) {
  console.log(`📲 (Mock) Sending SMS to ${phone}: ${message}`);
  // Integrate real SMS provider here (e.g., Twilio, MSG91)
}
