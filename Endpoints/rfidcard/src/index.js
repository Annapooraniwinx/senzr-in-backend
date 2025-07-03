// module.exports = function registerEndpoint(router, { services, emitter }) {
//   router.get("/", async (req, res) => {
//     console.log("🎯 RFID request:", req.url);

//     try {
//       const { tenantId, acceslevlId } = req.query;

//       if (!tenantId) {
//         return res.status(400).json({ error: "tenantId is required" });
//       }

//       const keys = acceslevlId
//         ? Array.isArray(acceslevlId)
//           ? acceslevlId
//           : [acceslevlId]
//         : [];

//       const eventPayload = {
//         tenantId,
//         keys,
//         timestamp: new Date().toISOString(),
//         url: req.originalUrl,
//         ip: req.ip,
//       };

//       // ✅ Fire the custom event for the hook to catch
//       emitter.emit("rfidcard.accessed", eventPayload);
//       console.log("✅rfidcard.accessed");

//       return res.json({
//         tenantId,
//         keys,
//       });
//     } catch (error) {
//       console.error("Error:", error.message);
//       return res.status(500).json({
//         error: "Server error",
//         message: error.message,
//       });
//     }
//   });
// };

export default {
  id: "rfid", // Endpoint will be accessible at /rfid
  handler: (router, { emitter }) => {
    router.get("/", async (req, res) => {
      try {
        const { tenantId, acceslevlId } = req.query;

        if (!tenantId) {
          return res.status(400).json({ error: "tenantId is required" });
        }

        const keys = acceslevlId
          ? Array.isArray(acceslevlId)
            ? acceslevlId
            : [acceslevlId]
          : [];

        const payload = {
          tenantId,
          keys,
          timestamp: new Date().toISOString(),
          url: req.originalUrl,
          ip: req.ip,
        };

        console.log("📡 RFID Request Received:", payload);

        // 🔥 Emit custom event
        emitter.emit("rfidcard.accessed", payload);

        return res.json({
          tenantId,
          keys,
        });
      } catch (error) {
        console.error("❌ Error handling /rfid:", error);
        return res.status(500).json({
          error: "Server error",
          message: error.message,
        });
      }
    });
  },
};
