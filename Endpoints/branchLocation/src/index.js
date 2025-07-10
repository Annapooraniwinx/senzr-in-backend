// routes/searchLocation.js
import axios from "axios";

const GOOGLE_API_KEY = "AIzaSyCwp-gBFBiutZVlE-a-84hHnA2XeMRGE1g";

export default (router) => {
  // 🔍 Step 1: Autocomplete Search
  router.post("/location/search", async (req, res) => {
    const { query } = req.body;

    if (!query) return res.status(400).json({ error: "Missing query input" });

    try {
      const response = await axios.post(
        "https://places.googleapis.com/v1/places:autocomplete",
        {
          input: query,
          languageCode: "en",
          regionCode: "IN",
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
          },
        }
      );

      const suggestions = (response.data.suggestions || []).map((s) => ({
        place_id: s.placePrediction.placeId,
        description: s.placePrediction.text.text,
      }));

      res.json({ suggestions });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({
        error: "Autocomplete failed",
        detail: err.response?.data || err.message,
      });
    }
  });

  // 📍 Step 2: Place Details (lat/lng/address)
  router.get("/location/details", async (req, res) => {
    const { placeId } = req.query;

    if (!placeId) return res.status(400).json({ error: "Missing placeId" });

    try {
      const response = await axios.get(
        `https://places.googleapis.com/v1/places/${placeId}`,
        {
          params: {
            fields: "location,formattedAddress,displayName",
          },
          headers: {
            "X-Goog-Api-Key": GOOGLE_API_KEY,
          },
        }
      );

      const data = response.data;

      res.json({
        name: data.displayName?.text,
        address: data.formattedAddress,
        lat: data.location?.latitude,
        lng: data.location?.longitude,
        placeId,
      });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({
        error: "Place details failed",
        detail: err.response?.data || err.message,
      });
    }
  });

  router.get("/", (req, res) =>
    res.send("🌍 Places API (New) backend working")
  );
};

// export default (router) => {
//   router.get("/", (req, res) => res.send("Hello, World!"));
// };
