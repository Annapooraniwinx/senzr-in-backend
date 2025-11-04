// routes/searchLocation.js
import axios from "axios";

const GOOGLE_API_KEY = "AIzaSyAwpDlggo6hmUnaxPqzzS7ydmUhjKug11Y";

export default (router) => {
  // 🔍 Step 1: Autocomplete Search
  router.post("/location/search", async (req, res) => {
    const { query } = req.body;

    if (!query) return res.status(400).json({ error: "Missing query input" });

    try {
      const response = await axios.post(
        "https://maps.googleapis.com/maps/api/place/autocomplete/json",
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
  // 🔄 Convert coordinates to address (Reverse Geocoding)
  router.post("/location/reverse-geocode", async (req, res) => {
    const { lat, lng } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Latitude and longitude required" });
    }

    try {
      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/geocode/json`,
        {
          params: {
            latlng: `${lat},${lng}`,
            key: GOOGLE_API_KEY,
          },
        }
      );

      const result = response.data.results?.[0];

      if (!result) {
        return res
          .status(404)
          .json({ error: "No address found for given coordinates" });
      }

      res.json({
        address: result.formatted_address,
        place_id: result.place_id,
        location: result.geometry.location,
      });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({
        error: "Reverse geocoding failed",
        detail: err.response?.data || err.message,
      });
    }
  });

  // 📌 Step 5: Google Maps Geolocation API (get current location)
  router.post("/location/geolocate", async (req, res) => {
    try {
      // Optionally, you can send Wi-Fi or cell tower info in req.body for more accuracy
      const payload = req.body || {};

      const response = await axios.post(
        `https://www.googleapis.com/geolocation/v1/geolocate?key=${GOOGLE_API_KEY}`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = response.data;

      res.json({
        lat: data.location?.lat,
        lng: data.location?.lng,
        accuracy: data.accuracy, // in meters
      });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({
        error: "Geolocation API failed",
        detail: err.response?.data || err.message,
      });
    }
  });

  // 📍 Convert address to lat/lng (Geocoding)
  router.post("/location/geocode", async (req, res) => {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({ error: "Address is required" });
    }

    try {
      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/geocode/json`,
        {
          params: {
            address,
            key: GOOGLE_API_KEY,
          },
        }
      );

      const result = response.data.results?.[0];

      if (!result) {
        return res
          .status(404)
          .json({ error: "No location found for given address" });
      }

      res.json({
        place_id: result.place_id,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        full_address: result.formatted_address,
      });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({
        error: "Geocoding failed",
        detail: err.response?.data || err.message,
      });
    }
  });
};

// export default (router) => {
//   router.get("/", (req, res) => res.send("Hello, World!"));
// };
