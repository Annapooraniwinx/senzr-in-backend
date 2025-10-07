import Razorpay from "razorpay";
import crypto from "crypto";

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID, // Add to your .env file
  key_secret: process.env.RAZORPAY_KEY_SECRET, // Add to your .env file
});

export default (router, { services, exceptions }) => {
  const { ItemsService } = services;
  const { ServiceUnavailableException, ForbiddenException } = exceptions;

  // Health check endpoint
  router.get("/", (req, res) => res.send("Payment API Ready"));

  // 1. CREATE RAZORPAY ORDER
  router.post("/create-order", async (req, res) => {
    try {
      const { amount, currency, tenantId, planDetails } = req.body;

      // Validate request
      if (!amount || !currency || !tenantId || !planDetails) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required fields: amount, currency, tenantId, planDetails",
        });
      }

      // Validate tenant exists and user has permission
      const tenantService = new ItemsService("tenant", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const tenant = await tenantService.readOne(tenantId);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          message: "Tenant not found",
        });
      }

      // Create Razorpay order
      // Amount must be in smallest currency unit (paise for INR)
      const razorpayAmount =
        currency === "INR"
          ? Math.round(amount * 100) // Convert to paise
          : Math.round(amount * 100); // Convert to cents for USD

      const orderOptions = {
        amount: razorpayAmount,
        currency: currency,
        receipt: `rcpt_${tenantId}_${Date.now()}`,
        notes: {
          tenant_id: tenantId,
          plan_details: JSON.stringify(planDetails),
        },
      };

      const razorpayOrder = await razorpay.orders.create(orderOptions);

      // Store initial payment record in database
      const paymentService = new ItemsService("payment", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const paymentRecord = await paymentService.createOne({
        status: "pending",
        renewby: tenantId,
        renewplan: planDetails.features.map((f) => f.name).join(", "),
        planvalidity: `${planDetails.start_date} to ${planDetails.end_date}`,
        plandetails: JSON.stringify(planDetails),
        commissiondetails: JSON.stringify({
          razorpay_order_id: razorpayOrder.id,
          amount: amount,
          currency: currency,
          created_at: new Date().toISOString(),
        }),
        sort: 0,
      });

      // Return order details to frontend
      res.json({
        success: true,
        order_id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key_id: process.env.RAZORPAY_KEY_ID,
        payment_record_id: paymentRecord,
      });
    } catch (error) {
      console.error("Error creating Razorpay order:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create payment order",
        error: error.message,
      });
    }
  });

  // 2. VERIFY PAYMENT (Called from frontend after payment)
  router.post("/verify-payment", async (req, res) => {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        payment_record_id,
      } = req.body;

      // Validate required fields
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({
          success: false,
          message: "Missing payment verification details",
        });
      }

      // Verify signature
      const sign = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSign = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(sign.toString())
        .digest("hex");

      const isValid = expectedSign === razorpay_signature;

      if (!isValid) {
        // Update payment record as failed
        const paymentService = new ItemsService("payment", {
          schema: req.schema,
          accountability: req.accountability,
        });

        await paymentService.updateOne(payment_record_id, {
          status: "failed",
          commissiondetails: JSON.stringify({
            razorpay_order_id,
            razorpay_payment_id,
            error: "Invalid signature",
            verified_at: new Date().toISOString(),
          }),
        });

        return res.status(400).json({
          success: false,
          message: "Payment verification failed - Invalid signature",
        });
      }

      // Fetch payment details from Razorpay
      const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);

      // Update payment record as success
      const paymentService = new ItemsService("payment", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const paymentRecord = await paymentService.readOne(payment_record_id);
      const planDetails = JSON.parse(paymentRecord.plandetails);

      await paymentService.updateOne(payment_record_id, {
        status: "success",
        commissiondetails: JSON.stringify({
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          payment_method: paymentDetails.method,
          amount_paid: paymentDetails.amount / 100,
          currency: paymentDetails.currency,
          verified_at: new Date().toISOString(),
          payment_details: paymentDetails,
        }),
      });

      // Update tenant plan
      const tenantService = new ItemsService("tenant", {
        schema: req.schema,
        accountability: req.accountability,
      });

      await tenantService.updateOne(paymentRecord.renewby, {
        plan: JSON.stringify(planDetails),
      });

      res.json({
        success: true,
        message: "Payment verified successfully",
        payment_id: razorpay_payment_id,
      });
    } catch (error) {
      console.error("Error verifying payment:", error);
      res.status(500).json({
        success: false,
        message: "Payment verification failed",
        error: error.message,
      });
    }
  });

  // 3. RAZORPAY WEBHOOK (For server-to-server notification)
  router.post("/webhook", async (req, res) => {
    try {
      // Verify webhook signature
      const webhookSignature = req.headers["x-razorpay-signature"];
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (webhookSignature !== expectedSignature) {
        return res.status(400).json({
          success: false,
          message: "Invalid webhook signature",
        });
      }

      const event = req.body.event;
      const payloadData = req.body.payload.payment.entity;

      // Handle different webhook events
      switch (event) {
        case "payment.captured":
          // Payment successful
          console.log("Payment captured:", payloadData.id);
          break;

        case "payment.failed":
          // Payment failed
          const paymentService = new ItemsService("payment", {
            schema: req.schema,
          });

          // Find payment by razorpay_order_id
          const payments = await paymentService.readByQuery({
            filter: {
              commissiondetails: {
                _contains: payloadData.order_id,
              },
            },
          });

          if (payments.length > 0) {
            await paymentService.updateOne(payments[0].id, {
              status: "failed",
              commissiondetails: JSON.stringify({
                ...JSON.parse(payments[0].commissiondetails),
                error: payloadData.error_description,
                failed_at: new Date().toISOString(),
              }),
            });
          }
          break;

        default:
          console.log("Unhandled webhook event:", event);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).json({
        success: false,
        message: "Webhook processing failed",
      });
    }
  });

  // 4. GET PAYMENT STATUS
  router.get("/status/:paymentRecordId", async (req, res) => {
    try {
      const paymentService = new ItemsService("payment", {
        schema: req.schema,
        accountability: req.accountability,
      });

      const payment = await paymentService.readOne(req.params.paymentRecordId);

      res.json({
        success: true,
        payment: {
          id: payment.id,
          status: payment.status,
          plan: payment.renewplan,
          validity: payment.planvalidity,
          details: JSON.parse(payment.commissiondetails),
        },
      });
    } catch (error) {
      console.error("Error fetching payment status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch payment status",
      });
    }
  });

  // 5. HANDLE PAYMENT FAILURE
  router.post("/handle-failure", async (req, res) => {
    try {
      const { payment_record_id, error_description } = req.body;

      const paymentService = new ItemsService("payment", {
        schema: req.schema,
        accountability: req.accountability,
      });

      await paymentService.updateOne(payment_record_id, {
        status: "failed",
        commissiondetails: JSON.stringify({
          error: error_description,
          failed_at: new Date().toISOString(),
        }),
      });

      res.json({
        success: true,
        message: "Payment failure recorded",
      });
    } catch (error) {
      console.error("Error handling payment failure:", error);
      res.status(500).json({
        success: false,
        message: "Failed to record payment failure",
      });
    }
  });
};
