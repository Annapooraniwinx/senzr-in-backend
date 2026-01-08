import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

export default (router) => {
  router.post(
    "/",
    upload.any(),   
    (req, res) => {
      const { message, model } = req.body;   
      const files = req.files || [];         

      return res.json({
        status: "success",
        received: {
          message: message || null,
          model: model || null,
          files: files.map((f) => ({
            originalName: f.originalname,
            mimeType: f.mimetype,
            size: f.size,
          })),
        },
      });
    }
  );
};
