import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
dotenv.config();

export default ({ action }, { services, database }) => {
  const { ItemsService } = services;

  action("items.create", async (meta, context) => {
    const { collection, key } = meta;
    const { accountability, schema } = context;

    // Only run for tenant collection
    if (collection !== "tenant") return;

    console.log("🏁Heina Jeson Tenant created! Starting additional setup...");

    const tenantId = key;
    let employeeId = null;
    let personalId = null;
    let employeeDetails = {
      firstName: null,
      email: null,
      phone: null,
    };

    const errorService = new ItemsService("registration_errors", {
      schema,
      accountability,
    });
    const pendingCollections = [];
    const createdResources = {
      tenant: tenantId,
      folders: [],
      attendanceCycle: null,
      shift: null,
      personalModule: null,
      salaryBreakdown: null,
      leaves: null,
      tenantTemplates: [],
    };

    // === NODEMAILER SETUP ===
    let transporter = null;
    try {
      const nodemailer = (await import("nodemailer")).default;
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: "fieldopsbysenzr@gmail.com",
          pass: "nsdy pgax pziz gazm",
        },
      });
      console.log("📧 Email transporter initialized");
    } catch (err) {
      console.error("❌ Failed to initialize email transporter:", err.message);
    }

    // === DYNAMIC AWS SDK LOADING (INSIDE ACTION) ===
    let s3 = null;

    // Load from .env (secure way)
    const BUCKET = process.env.BUCKET;
    const ACCESS_KEY = process.env.ACCESS_KEY;
    const SECRET_KEY = process.env.SECRET_KEY;
    const REGION = process.env.REGION;

    try {
      const AWS = await import("aws-sdk");
      s3 = new AWS.S3({
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
        region: REGION,
      });
      console.log("AWS SDK loaded successfully");
    } catch (err) {
      console.error(
        "❌ Failed to load AWS SDK (S3 will be skipped):",
        err.message
      );
    }

    // Wait for personal module
    const waitForPersonalModule = async () => {
      try {
        const personalService = new ItemsService("personalModule", {
          schema,
          accountability: { admin: true },
        });

        // Initial attempt
        let personalItems = await personalService.readByQuery({
          filter: { assignedUser: { tenant: { _eq: tenantId } } },
          fields: [
            "id",
            "employeeId",
            "assignedUser.id",
            "assignedUser.first_name",
            "assignedUser.email",
            "assignedUser.phone",
          ],
          limit: 1,
        });

        if (personalItems.length > 0) {
          return personalItems[0];
        }

        console.log(
          `⌛ Personal module not found yet. Waiting 1 minute before retrying...`
        );
        await new Promise((resolve) => setTimeout(resolve, 60000));

        // Then attempt 2 more times
        for (let attempt = 1; attempt <= 2; attempt++) {
          personalItems = await personalService.readByQuery({
            filter: { assignedUser: { tenant: { _eq: tenantId } } },
            fields: [
              "id",
              "employeeId",
              "assignedUser.id",
              "assignedUser.first_name",
              "assignedUser.email",
              "assignedUser.phone",
              "assignedUser.tenant.tenantName",
              "assignedUser.tenant.companyAddress",
            ],
            limit: 1,
          });

          if (personalItems.length > 0) {
            return personalItems[0];
          }

          console.log(
            `⌛ Personal module still not found. Retry attempt ${attempt}/2`
          );
        }

        throw new Error(
          `Personal module not found after 1 minute wait and 2 additional attempts for tenantId: ${tenantId}`
        );
      } catch (error) {
        console.error("❌ Error during retry fetch:", error);
        throw error;
      }
    };

    // === SEND EMAIL FUNCTION ===
    const sendStatusEmail = async (
      status,
      failedCollection = null,
      errorMsg = null
    ) => {
      if (!transporter) {
        console.warn("⚠️ Email transporter not available, skipping email");
        return;
      }

      try {
        const tenantService = new ItemsService("tenant", {
          schema,
          accountability,
        });
        const tenant = await tenantService.readOne(tenantId, {
          fields: ["tenantName", "companyAddress", "date_created"],
        });

        const tenantName = (tenant.tenantName ?? "Unnamed Tenant").trim();
        const companyAddress = (tenant.companyAddress ?? "Not provided").trim();
        const createdAt = new Date(tenant.date_created).toLocaleString(
          "en-IN",
          {
            timeZone: "Asia/Kolkata",
            dateStyle: "full",
            timeStyle: "medium",
          }
        );

        const statusEmoji = status === "success" ? "✅" : "❌";
        const statusText =
          status === "success" ? "Successfully Onboarded" : "Onboarding Failed";
        const statusColor = status === "success" ? "#10b981" : "#ef4444";

        const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tenant ${statusText}</title>
  <style>
    body {font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f4f7fa;margin:0;padding:0;}
    .container {max-width:620px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.1);}
    .header {background:#ffffff;color:#333;padding:30px;text-align:center;border-bottom:1px solid #eee;}
    .header h1 {margin:0;font-size:24px;font-weight:600;color:${statusColor};}
    .content {padding:30px;color:#333;}
    .info-box {background:#f8fafc;padding:15px;border-radius:8px;margin:15px 0;}
    .error-box {background:#fee;padding:15px;border-radius:8px;margin:15px 0;border-left:4px solid #ef4444;}
    .footer {background:#f8fafc;padding:20px;text-align:center;color:#64748b;font-size:13px;}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${statusEmoji} Tenant ${statusText}</h1>
      <p>Tenant registration ${
        status === "success" ? "completed successfully" : "encountered an error"
      }</p>
    </div>

    <div class="content">
      <p><strong>Hello Team,</strong></p>

      <h2 style="color:#4f46e5;font-size:18px;">Tenant Information</h2>
      <div class="info-box">
        <p><strong>Tenant Name:</strong> ${tenantName}</p>
        <p><strong>Tenant ID:</strong> ${tenantId}</p>
        <p><strong>Address:</strong> ${companyAddress}</p>
        <p><strong>Created:</strong> ${createdAt}</p>
      </div>

      ${
        employeeDetails.firstName
          ? `
      <h2 style="color:#4f46e5;font-size:18px;">Contact Details</h2>
      <div class="info-box">
        <p><strong>Name:</strong> ${employeeDetails.firstName}</p>
        <p><strong>Email:</strong> ${
          employeeDetails.email || "Not provided"
        }</p>
        <p><strong>Phone:</strong> ${
          employeeDetails.phone || "Not provided"
        }</p>
        <p><strong>Employee ID:</strong> ${employeeId}</p>
      </div>
      `
          : ""
      }

      ${
        status === "success"
          ? `
      <h2 style="color:#10b981;font-size:18px;">✅ Setup Completed</h2>
      <p style="margin-top:15px;">All resources have been configured successfully:</p>
      <ul>
        <li>S3 bucket and folders created</li>
        <li>Admin and Employee roles configured</li>
        <li>Default salary settings applied</li>
        <li>Attendance cycle and shifts created</li>
        <li>Leave management initialized</li>
        <li>Organization structure set up</li>
        <li>Salary breakdown configured</li>
        <li>Tenant templates applied</li>
      </ul>
      `
          : `
      <h2 style="color:#ef4444;font-size:18px;">❌ Setup Failed</h2>
      <div class="error-box">
        <p><strong>Failed at:</strong> ${failedCollection || "Unknown"}</p>
        <p><strong>Error:</strong> ${errorMsg || "No details available"}</p>
      </div>
      <p><strong>Action Required:</strong> Please check the logs and retry the setup process.</p>
      `
      }

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
Tenant ${statusText}:

Tenant Name: ${tenantName}
Tenant ID: ${tenantId}
Address: ${companyAddress}
Registered: ${createdAt}

${
  employeeDetails.firstName
    ? `
Primary Contact:
Name: ${employeeDetails.firstName}
Email: ${employeeDetails.email || "Not provided"}
Phone: ${employeeDetails.phone || "Not provided"}
Employee ID: ${employeeId}
`
    : ""
}

${
  status === "success"
    ? "All resources configured successfully."
    : `Failed at: ${failedCollection}\nError: ${errorMsg}`
}

Automated message from FieldOps by Senzr.
        `.trim();

        const mailOptions = {
          from: `"FieldOps by Senzr" <fieldopsbysenzr@gmail.com>`,
          to: "connect@iwinxdigital.com",
          cc: "jasper@senzr.in, annapoorani@iwinxdigital.com",
          subject: `${statusEmoji} Tenant ${statusText}: ${tenantName}`,
          html: htmlBody,
          text: textBody,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(
          `📧 ${
            status === "success" ? "Success" : "Failure"
          } email sent! Message ID:`,
          info.messageId
        );
      } catch (error) {
        console.error("🚨 Failed to send email:", error.message);
      }
    };

    try {
      // Fetch personalModule with modified retry
      try {
        const personalItem = await waitForPersonalModule();
        personalId = personalItem.id;
        employeeId = personalItem.employeeId;

        // Extract employee details
        if (personalItem.assignedUser) {
          employeeDetails.firstName =
            personalItem.assignedUser.first_name || null;
          employeeDetails.email = personalItem.assignedUser.email || null;
          employeeDetails.phone = personalItem.assignedUser.phone || null;
        }

        createdResources.personalModule = personalId;
        pendingCollections.push("personalModule");
        console.log(
          `🔍 Fetched personalModule: { id: ${personalId}, employeeId: ${employeeId}, name: ${employeeDetails.firstName} }`
        );
      } catch (error) {
        console.error("❌ Error fetching personal module:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "personalModule",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "directus_folders",
            "attendanceCycle",
            "shifts",
            "leave",
            "organization",
            "SalaryBreakdown",
            "tenant_template",
          ],
          status: "failed",
        });
        await sendStatusEmail("failed", "personalModule", error.message);
        return;
      }

      // === FOLDER STRUCTURE ===
      const folders = [];
      try {
        const mainFolderId = uuidv4();
        await database("directus_folders").insert({
          id: mainFolderId,
          name: tenantId,
        });
        folders.push({ id: mainFolderId, name: tenantId, parent: null });
        createdResources.folders.push({
          id: mainFolderId,
          name: tenantId,
          parent: null,
        });

        const childFolders = [
          "Profiles",
          "Faces",
          "Fingers",
          "Imported Files",
          "Documents",
          "DeviceImages",
          "TDS Documents",
          "Leave Documents",
          "Asserts",
          "Workorders",
          "rfidCard",
          "Expense",
        ];

        const folderIds = {};
        for (const folderName of childFolders) {
          const folderId = uuidv4();
          await database("directus_folders").insert({
            id: folderId,
            name: folderName,
            parent: mainFolderId,
          });
          folderIds[folderName] = folderId;
          folders.push({
            id: folderId,
            name: folderName,
            parent: mainFolderId,
          });
          createdResources.folders.push({
            id: folderId,
            name: folderName,
            parent: mainFolderId,
          });
        }

        const importedFilesSubFolders = ["EmployeeDatas", "AttendanceRecords"];
        for (const subFolder of importedFilesSubFolders) {
          const folderId = uuidv4();
          await database("directus_folders").insert({
            id: folderId,
            name: subFolder,
            parent: folderIds["Imported Files"],
          });
          folders.push({
            id: folderId,
            name: subFolder,
            parent: folderIds["Imported Files"],
          });
          createdResources.folders.push({
            id: folderId,
            name: subFolder,
            parent: folderIds["Imported Files"],
          });
        }

        const documentsSubFolders = ["OnboardDocuments", "OffBoardDocuments"];
        for (const subFolder of documentsSubFolders) {
          const folderId = uuidv4();
          await database("directus_folders").insert({
            id: folderId,
            name: subFolder,
            parent: folderIds["Documents"],
          });
          folders.push({
            id: folderId,
            name: subFolder,
            parent: folderIds["Documents"],
          });
          createdResources.folders.push({
            id: folderId,
            name: subFolder,
            parent: folderIds["Documents"],
          });
        }

        await database("tenant")
          .update({ foldersId: JSON.stringify(folders) })
          .where("tenantId", tenantId);
        console.log(
          `📁 Created folders: ${JSON.stringify(
            folders.map((f) => ({ id: f.id, name: f.name, parent: f.parent })),
            null,
            2
          )}`
        );
      } catch (error) {
        console.error("❌ Error creating folders:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "directus_folders",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "roleConfigurator",
            "salarySetting",
            "attendanceCycle",
            "shifts",
            "leave",
            "organization",
            "SalaryBreakdown",
            "tenant_template",
          ],
          status: "failed",
        });
        await sendStatusEmail("failed", "directus_folders", error.message);
        return;
      }
      pendingCollections.push("directus_folders");

      // === S3: Create tenant folder + 8 JSON files ===
      if (s3) {
        try {
          const tenantPrefix = `${tenantId}/`;
          await s3
            .putObject({
              Bucket: BUCKET,
              Key: tenantPrefix,
              Body: "",
              ContentType: "application/x-directory",
            })
            .promise();

          const files = [
            "employees.json",
            "faces.json",
            "fingerprints.json",
            "rfid.json",
            "doors.json",
            "devices.json",
            "access_levels.json",
            "four_door_controller.json",
          ];

          for (const file of files) {
            await s3
              .putObject({
                Bucket: BUCKET,
                Key: tenantPrefix + file,
                Body: "[]",
                ContentType: "application/json",
              })
              .promise();
          }

          console.log(
            `S3 tenant folder & 8 JSON files created for ${tenantId}`
          );
        } catch (s3Err) {
          console.error("S3 Error (non-fatal):", s3Err);
          await errorService.createOne({
            tenantId,
            employeeId: personalId || null,
            failed_collection: "s3_device_config",
            error_response: { message: s3Err.message, stack: s3Err.stack },
            pending_collections: pendingCollections.slice(),
            status: "failed",
          });
          // Continue — S3 is optional
        }
      } else {
        console.warn("AWS SDK not available — skipping S3 setup");
      }

      // === DEFAULT ROLE CONFIGURATORS (Admin + Employee) ===
      let adminRoleId = null;
      let employeeRoleId = null;

      try {
        const roleConfigService = new ItemsService("roleConfigurator", {
          schema,
          accountability,
        });

        // ---- ADMIN ROLE CONFIG ----
        const adminPayload = {
          roleName: "Admin",
          status: "MainTenant",
          description: "Tenant Admin",
          assignedRole: "Admin",
          parentId: "ea2303aa-1662-43ca-a7f7-ab84924a7e0a",
          Level: 0,
          tenant: tenantId,
          Role_Access: {
            client: { create: true, update: true, delete: true },
            workorder: { create: true, update: true, delete: true },
            assets: { create: true, update: true, delete: true },
            attendance: { create: true, update: true, delete: true },
            leave: { create: true, update: true, delete: true },
            expense: { create: true, update: true, delete: true },
            employee: { create: true, update: true, delete: true },
          },
          dataScope: {
            client: "organization-wide",
            workorder: "organization-wide",
            assets: "organization-wide",
            attendance: "organization-wide",
            leave: "organization-wide",
            expense: "organization-wide",
            employee: "organization-wide",
          },
          tab_access: {
            Overview: { Overview: true },
            "Clients & Sites": { "Clients & Sites": true },
            Products: { Products: true },
            "Work Orders": { "Work Orders": true, smartforms: true },
            Employees: {
              Employees: true,
              "All Employees Details": true,
              "All Admin Details": true,
              "Leave Details": true,
              "Attendance Details": true,
            },
            Attendance: {
              Attendance: true,
              "Attendance Details": {
                "Attendance Details": true,
                "Live Attendance": true,
                "Monthly Attendance": true,
                "Daily Attendance": true,
                "All In-Outs": true,
              },
            },
            Expenses: { Expenses: true },
            Requests: { Requests: true },
            Payroll: {
              Payroll: true,
              "Payroll Details": {
                "Payroll Details": true,
                "Employee Salaries": true,
                "Run Payroll": true,
                "Additional Pay": true,
              },
            },
            Reports: { Reports: true },
            Configurator: {
              Configurator: true,
              "Organization Configurator": {
                "Organization Configurator": true,
                Branches: true,
                Departments: true,
                Teams: true,
                "Admin Role": true,
                "Employee Role": true,
              },
              "Attendance Configurator": {
                "Attendance Configurator": true,
                Shifts: true,
                "Attendance Cycle": true,
                Leaves: true,
                Holidays: true,
              },
              "Expense Configurator": {
                "Expense Configurator": true,
                "Expense Categories": true,
                "Expense Rule": true,
              },
              "Payroll Configurator": {
                "Payroll Configurator": true,
                "Payroll Policies": true,
                "Penalty Policies": true,
              },
            },
            "Organization Settings": { "Organization Settings": true },
            "Subscription & Plans": { "Subscription & Plans": true },
            Compliance: { Compliance: true },
            "Live Tracking": { "Live Tracking": true },
            Uploads: { Uploads: true },
            Routes: { Routes: true },
          },
        };
        adminRoleId = await roleConfigService.createOne(adminPayload);
        createdResources.adminRoleConfig = adminRoleId;
        console.log(`👤 Created Admin roleConfigurator id=${adminRoleId}`);

        // ---- EMPLOYEE ROLE CONFIG ----
        const employeePayload = {
          roleName: "Employee",
          status: "MainTenant",
          description: "Tenant Employee",
          assignedRole: "Employee",
          parentId: "f667b169-c66c-4ec1-bef9-1831c1647c0d",
          Level: 0,
          tenant: tenantId,
          Role_Access: {
            attendance: { create: true, update: false, delete: false },
            employee: { create: false, update: false, delete: false },
            expense: { create: true, update: true, delete: true },
            leave: { create: true, update: true, delete: true },
            workorder: { create: true, update: true, delete: true },
          },
          dataScope: {
            attendance: "assigned-only",
            employee: "assigned-only",
            expense: "assigned-only",
            leave: "assigned-only",
            workorder: "assigned-only",
          },
          tab_access: {
            Attendance: {
              Attendance: true,
              "Attendance Details": {
                "Attendance Details": true,
                "Live Attendance": true,
                "Daily Attendance": true,
                "Monthly Attendance": true,
                "All In-Outs": true,
              },
            },
            "Clients & Sites": { "Clients & Sites": true },
            Employees: {
              Employees: true,
              "All Employees Details": true,
              "Leave Details": true,
              "Attendance Details": true,
            },
            Expenses: { Expenses: true },
            Requests: { Requests: true },
            "Work Orders": { "Work Orders": true },
          },
        };

        employeeRoleId = await roleConfigService.createOne(employeePayload);
        createdResources.employeeRoleConfig = employeeRoleId;
        console.log(
          `👤 Created Employee roleConfigurator id=${employeeRoleId}`
        );
      } catch (error) {
        console.error("❌ Error creating default role configurators:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "roleConfigurator",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "salarySetting",
            "attendanceCycle",
            "shifts",
            "leave",
            "organization",
            "SalaryBreakdown",
            "tenant_template",
          ],
          status: "failed",
        });
        await sendStatusEmail("failed", "roleConfigurator", error.message);
        return;
      }

      // === DEFAULT SALARY SETTING (Custom) ===
      try {
        const salarySettingService = new ItemsService("salarySetting", {
          schema,
          accountability,
        });

        const salarySettingPayload = {
          configName: "Custom",
          basicPay: 100,
          allowances: [],
          earnings: [],
          deductions: null,
          professionalTax: null,
          stateTaxes: null,
          LWF: null,
          adminCharges: { enable: false, charge: "0" },
          employeeDeductions: {
            EmployeePF: {
              selectedOption: 1800,
              options: [
                { label: "No Value", value: null },
                { label: "Minimum Amount", value: 1800 },
                { label: "Percentage", value: 12 },
              ],
              Calculations: [{ name: "Basic Pay", percentage: 100 }],
            },
            EmployeeESI: {
              selectedOption: 0.75,
              options: [
                { label: "No Value", value: null },
                { label: "Percentage", value: 0.75 },
              ],
              Calculations: [{ name: "Basic Pay", percentage: 100 }],
            },
          },
          employersContributions: {
            EmployerPF: {
              selectedOption: 1800,
              withinCTC: false,
              options: [
                { label: "No Value", value: null },
                { label: "Minimum Amount", value: 1800 },
                { label: "Percentage", value: 12 },
              ],
              Calculations: [{ name: "Basic Pay", percentage: 100 }],
            },
            EmployerESI: {
              selectedOption: 3.25,
              withinCTC: false,
              options: [
                { label: "No Value", value: null },
                { label: "Percentage", value: 3.25 },
              ],
              Calculations: [{ name: "Basic Pay", percentage: 100 }],
            },
          },
          tenant: tenantId,
        };

        const salarySettingId = await salarySettingService.createOne(
          salarySettingPayload
        );
        createdResources.salarySetting = salarySettingId;
        console.log(`💰 Created salarySetting (Custom) id=${salarySettingId}`);
      } catch (error) {
        console.error("❌ Error creating default salarySetting:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "salarySetting",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "attendanceCycle",
            "shifts",
            "leave",
            "organization",
            "SalaryBreakdown",
            "tenant_template",
          ],
          status: "failed",
        });
        await sendStatusEmail("failed", "salarySetting", error.message);
        return;
      }

      // === ATTENDANCE CYCLE ===
      let attendanceCycleId = null;
      try {
        const cycleService = new ItemsService("attendanceCycle", {
          schema,
          accountability,
        });
        const cyclePayload = {
          fixedCycle: true,
          tenant: tenantId,
          multi_attendance_cycle: {
            cycles: [
              {
                cycleId: 1,
                cycleName: "Normal Employee",
                startDate: 1,
                endDate: "end of the month",
                includeWeekends: true,
                includeHolidays: true,
              },
              {
                cycleId: 2,
                cycleName: "Daily wages Employee",
                startDate: 14,
                endDate: 15,
                includeWeekends: true,
                includeHolidays: true,
              },
            ],
          },
        };
        attendanceCycleId = await cycleService.createOne(cyclePayload);
        createdResources.attendanceCycle = attendanceCycleId;
        console.log(`📅 Created attendanceCycle id=${attendanceCycleId}`);
      } catch (error) {
        console.error("❌ Error creating attendance cycle:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "attendanceCycle",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "shifts",
            "leave",
            "organization",
            "SalaryBreakdown",
            "tenant_template",
          ],
          status: "failed",
        });
        await sendStatusEmail("failed", "attendanceCycle", error.message);
        return;
      }
      pendingCollections.push("attendanceCycle");

      // === SHIFT ===
      let shiftId = null;
      try {
        const shiftService = new ItemsService("shifts", {
          schema,
          accountability,
        });
        const shiftPayload = {
          shift: "GeneralShift",
          entryTime: "09:00:00",
          exitTime: "18:00:00",
          break: "00:30:00",
          status: "assigned",
          tenant: tenantId,
        };
        shiftId = await shiftService.createOne(shiftPayload);
        createdResources.shift = shiftId;
        console.log(`🕒 Created shift id=${shiftId}`);
      } catch (error) {
        console.error("❌ Error creating shift:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "shifts",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "leave",
            "organization",
            "SalaryBreakdown",
            "tenant_template",
          ],
          status: "failed",
        });
        await sendStatusEmail("failed", "shifts", error.message);
        return;
      }
      pendingCollections.push("shifts");

      // === LEAVES ===
      let leavesId = null;
      try {
        const leavesService = new ItemsService("leave", {
          schema,
          accountability,
        });
        const leavesPayload = {
          leaveBalance: {},
          CarryForwardleave: {},
          leaveTaken: {},
          monthLimit: {},
          assignedLeave: [],
          year: new Date().toISOString(),
          uniqueId: `${tenantId}-${employeeId}`,
          tenant: tenantId,
        };
        leavesId = await leavesService.createOne(leavesPayload);
        createdResources.leaves = leavesId;
        console.log(`🍃 Created leave id=${leavesId}`);
      } catch (error) {
        console.error("❌ Error creating leaves:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "leave",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [
            "organization",
            "SalaryBreakdown",
            "tenant_template",
          ],
          status: "failed",
        });
        await sendStatusEmail("failed", "leave", error.message);
        return;
      }
      pendingCollections.push("leave");

      // === CREATE ORGANIZATION FROM TENANT PAYLOAD ===
      try {
        const tenantPayload = meta.payload || {};
        const companyName = tenantPayload.tenantName || "";
        let companyAddress = tenantPayload.companyAddress || "";
        if (typeof companyAddress === "string") {
          companyAddress = companyAddress.replace(/^"+|"+$/g, "").trim();
        }

        const organizationService = new ItemsService("organization", {
          schema,
          accountability,
        });

        const organizationPayload = {
          orgName: companyName,
          orgType: "maintenant",
          orgAddress: companyAddress,
          tenant: tenantId,
        };

        const orgData = await organizationService.createOne(
          organizationPayload
        );
        const orgId = orgData.id || orgData;
        createdResources.organization = orgId;

        console.log(`🏢 Organization created id=${orgId}`);
      } catch (error) {
        console.error("❌ Failed to create organization:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "organization",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["SalaryBreakdown", "tenant_template"],
          status: "failed",
        });
        await sendStatusEmail("failed", "organization", error.message);
        return;
      }

      // === PATCH PERSONAL MODULE ===
      try {
        if (!adminRoleId) {
          throw new Error(
            "adminRoleId is missing — cannot patch personalModule"
          );
        }

        const personalItem = await waitForPersonalModule();
        const assignedUserId = personalItem.assignedUser.id;
        const personalService = new ItemsService("personalModule", {
          schema,
          accountability,
        });
        const personalUpdatePayload = {
          status: "active",
          accessOn: true,
          cycleType: 1,
          uniqueId: `${tenantId}-${employeeId}`,
          attendanceSettings: {
            isMonday: true,
            monJ: { shifts: [shiftId] },
            isTuesday: true,
            tueJ: { shifts: [shiftId] },
            isWednesday: true,
            wedJ: { shifts: [shiftId] },
            isThursday: true,
            thuJ: { shifts: [shiftId] },
            isFriday: true,
            friJ: { shifts: [shiftId] },
            isSaturday: true,
            satJ: { shifts: [shiftId] },
            isSunday: true,
            sunJ: { shifts: [] },
          },
          leaves: leavesId,
          assignedUser: {
            id: assignedUserId,
            roleConfig: adminRoleId,
          },
        };
        await personalService.updateOne(personalId, personalUpdatePayload);
        console.log(`🧑‍💼 Patched personalModule id=${personalId}`);
      } catch (error) {
        console.error("❌ Error patching personal module:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "personalModule",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["SalaryBreakdown", "tenant_template"],
          status: "failed",
        });
        await sendStatusEmail("failed", "personalModule_update", error.message);
        return;
      }

      // === SALARY BREAKDOWN ===
      try {
        const salaryService = new ItemsService("SalaryBreakdown", {
          schema,
          accountability,
        });
        const salaryPayload = {
          employee: personalId,
          tenant: tenantId,
        };
        const salaryId = await salaryService.createOne(salaryPayload);
        createdResources.salaryBreakdown = salaryId;
        console.log(`💵 Created SalaryBreakdown id=${salaryId}`);
      } catch (error) {
        console.error("❌ Error creating salary breakdown:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "SalaryBreakdown",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: ["tenant_template"],
          status: "failed",
        });
        await sendStatusEmail("failed", "SalaryBreakdown", error.message);
        return;
      }
      pendingCollections.push("SalaryBreakdown");

      // === TENANT TEMPLATES ===
      try {
        const formTemplateService = new ItemsService("form_template", {
          schema,
          accountability: { admin: true },
        });
        const tenantTemplateService = new ItemsService("tenant_template", {
          schema,
          accountability: { admin: true },
        });

        const availableTemplates = await formTemplateService.readByQuery({
          filter: { enableForm: { _eq: true } },
          fields: ["id", "formName", "custom_FormTemplate", "enableForm"],
          limit: -1,
        });

        for (const template of availableTemplates || []) {
          const tenantTemplatePayload = {
            formName: template.formName,
            custom_FormTemplate: template.custom_FormTemplate,
            enableForm: template.enableForm || true,
            tenant: tenantId,
            assignedOrgnization: null,
            templateId: template.id,
          };
          const tenantTemplateId = await tenantTemplateService.createOne(
            tenantTemplatePayload
          );
          createdResources.tenantTemplates.push(tenantTemplateId);
          console.log(`📋 Created tenant_template id=${tenantTemplateId}`);
        }
        console.log(
          `✅ Created ${createdResources.tenantTemplates.length} tenant templates`
        );
      } catch (error) {
        console.error("❌ Error creating tenant templates:", error);
        await errorService.createOne({
          tenantId,
          employeeId: personalId || null,
          failed_collection: "tenant_template",
          error_response: { message: error.message, stack: error.stack },
          pending_collections: [],
          status: "failed",
        });
        await sendStatusEmail("failed", "tenant_template", error.message);
        return;
      }
      pendingCollections.push("tenant_template");

      // === FINAL SUCCESS ===
      console.log(
        `🎉 All resources created successfully for tenant: ${tenantId}`
      );

      await errorService.createOne({
        tenantId,
        employeeId: personalId || null,
        failed_collection: null,
        error_response: null,
        pending_collections: ["NO Pending"],
        message: "All resources created successfully",
        status: "success",
      });

      // === SEND SUCCESS EMAIL ===
      await sendStatusEmail("success");
    } catch (error) {
      console.error("❌ Unexpected error in hook:", error);
      await errorService.createOne({
        tenantId,
        employeeId: personalId || null,
        failed_collection: "unknown",
        error_response: { message: error.message, stack: error.stack },
        pending_collections: pendingCollections,
        status: "failed",
      });

      // === SEND FAILURE EMAIL ===
      await sendStatusEmail("failed", "unknown", error.message);
    }
  });
};
