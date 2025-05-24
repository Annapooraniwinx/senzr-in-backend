//BACKEND CODE ENCRPYTED
import crypto from "crypto";

const ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const encrypt = (text) => {
  try {
    console.log("🔒 Starting encryption...");
    const algorithm = "aes-256-cbc";
    const key = Buffer.from(ENCRYPTION_KEY, "hex");
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const result = iv.toString("hex") + ":" + encrypted;
    console.log("✅ Encryption successful.");
    return result;
  } catch (error) {
    console.error("❌ Encryption failed:", error);
    throw error;
  }
};

const fieldsToEncrypt = [
  "voter_ID",
  "driving_License",
  "UAN",
  "IFSC",
  "pan",
  "aadhar",
];

const encryptAssignedUserFields = (assignedUser) => {
  if (!assignedUser) return;

  fieldsToEncrypt.forEach((field) => {
    if (assignedUser[field]) {
      console.log(`🛡 Encrypting assignedUser.${field}...`);
      assignedUser[field] = encrypt(assignedUser[field]);
    } else {
      console.log(`ℹ️ assignedUser.${field} not found, skipping...`);
    }
  });
};

export default ({ filter }) => {
  filter("personalModule.items.create", async (payload) => {
    if (payload.assignedUser) {
      console.log("🛠 Processing assignedUser fields during CREATE...");
      encryptAssignedUserFields(payload.assignedUser);
    } else {
      console.log("ℹ️ No assignedUser found during CREATE.");
    }
    return payload;
  });

  filter("personalModule.items.update", async (payload) => {
    if (payload.assignedUser) {
      console.log("🛠 Processing assignedUser fields during UPDATE...");
      encryptAssignedUserFields(payload.assignedUser);
    } else {
      console.log("ℹ️ No assignedUser found during UPDATE.");
    }
    return payload;
  });
};
